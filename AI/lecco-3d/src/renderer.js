// WebGPU setup, startup precompute passes and the per-frame render (allocation-free loop body).
import commonWGSL from './shaders/common.wgsl';
import terrainWGSL from './shaders/terrain.wgsl';
import skyWGSL from './shaders/sky.wgsl';
import normalsWGSL from './shaders/precompute-normals.wgsl';
import shadeWGSL from './shaders/precompute-shade.wgsl';
import buildingsWGSL from './shaders/buildings.wgsl';
import pinsWGSL from './shaders/pins.wgsl';
import { meta } from './terrain-data.js';
import { perspectiveReverseZ, viewFromYawPitch, multiply, invert } from './math.js';

const GRID = 128;                // cells per clipmap level side (must match terrain.wgsl)
const LEVELS = 10;
const BASE_SPACING = 2;          // metres, finest level
const MARGIN = 6000;             // precomputed region extends this far beyond the crop
const SAMPLES = 4;
const FOV_Y = (60 * Math.PI) / 180;
const NEAR = 0.5;

// Frame uniform layout (floats), see struct Frame in common.wgsl
const U_VIEWPROJ = 0, U_INVVP = 16, U_CAM = 32, U_SUN = 36, U_SUNCOL = 40, U_TERR = 44, U_EXT = 48, U_SCREEN = 52, U_FOG = 56, U_MISC = 60, U_GRID = 64;

export async function createRenderer(canvas, { heights, water }, osm, opts) {
  if (!navigator.gpu) throw new Error('WebGPU non disponibile in questo browser.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('Nessun adattatore WebGPU disponibile.');
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.error('WebGPU device lost:', info.message));
  // Off-screen mode (headless screenshots): no swap chain at all, frames go to a texture.
  const ctx = opts.offscreen ? null : canvas.getContext('webgpu');
  const format = opts.offscreen ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
  ctx?.configure({ device, format, alphaMode: 'opaque' });

  const N = meta.samples;
  const EXT_SIZE = meta.extent + 2 * MARGIN;
  const extOrigin = [meta.origin[0] - MARGIN, meta.origin[1] - MARGIN];

  // ---------------------------------------------------------------- data textures
  const heightTex = device.createTexture({ size: [N, N], format: 'r32float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: heightTex }, heights, { bytesPerRow: N * 4 }, [N, N]);
  const waterTex = device.createTexture({ size: [N, N], format: 'rg8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: waterTex }, water, { bytesPerRow: N * 2 }, [N, N]);
  const PRE = opts.precomputeSize;
  const normalTex = device.createTexture({ size: [PRE, PRE], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  const shadeTex = device.createTexture({ size: [PRE, PRE], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING });
  const linSamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

  // ---------------------------------------------------------------- uniforms
  const frame = new Float32Array(68);
  const frameBuf = device.createBuffer({ size: frame.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const levelData = new Float32Array(LEVELS * 8);
  const levelBuf = device.createBuffer({ size: levelData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const sunAz = (opts.sunAzimuth * Math.PI) / 180, sunEl = (opts.sunElevation * Math.PI) / 180;
  frame.set([Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl), 0], U_SUN);
  frame.set([1.0 * 3.3, 0.94 * 3.3, 0.84 * 3.3, 0], U_SUNCOL);
  frame.set([meta.origin[0], meta.origin[1], meta.spacing, N], U_TERR);
  frame.set([extOrigin[0], extOrigin[1], EXT_SIZE, 1 / EXT_SIZE], U_EXT);
  frame.set([5.5e-5, 1 / 1700, opts.exposure, 1.0], U_FOG);
  frame.set([opts.snowLine, opts.relief, opts.debug, 0], U_MISC);
  frame.set(osm.gridInfo, U_GRID);
  device.queue.writeBuffer(frameBuf, 0, frame);

  // ---------------------------------------------------------------- layouts
  const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const ALL = VF | GPUShaderStage.COMPUTE;
  const baseEntries = [
    { binding: 0, visibility: ALL, buffer: { type: 'uniform' } },
    { binding: 1, visibility: ALL, texture: { sampleType: 'unfilterable-float' } },
  ];
  const terrainLayout = device.createBindGroupLayout({
    entries: [
      ...baseEntries,
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 4, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 5, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 6, visibility: VF, sampler: { type: 'filtering' } },
      { binding: 7, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 8, visibility: VF, buffer: { type: 'read-only-storage' } },
      { binding: 9, visibility: VF, buffer: { type: 'read-only-storage' } },
    ],
  });
  const buildLayout = device.createBindGroupLayout({
    entries: [
      ...baseEntries,
      { binding: 2, visibility: VF, texture: { sampleType: 'float' } },
      { binding: 3, visibility: VF, sampler: { type: 'filtering' } },
    ],
  });
  const skyLayout = device.createBindGroupLayout({ entries: [baseEntries[0]] });
  const storageLayout = (format) => device.createBindGroupLayout({
    entries: [...baseEntries, { binding: 2, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format } }],
  });
  const normalsLayout = storageLayout('rgba16float');
  const shadeLayout = storageLayout('rgba8unorm');

  const module = async (label, code) => {
    const m = device.createShaderModule({ label, code: commonWGSL + '\n' + code });
    const info = await m.getCompilationInfo();
    const errs = info.messages.filter((x) => x.type === 'error');
    if (errs.length) throw new Error(`${label}: ${errs.map((e) => `line ${e.lineNum}: ${e.message}`).join('\n')}`);
    return m;
  };
  const [terrainMod, skyMod, normalsMod, shadeMod, buildMod, pinMod] = await Promise.all([
    module('terrain', terrainWGSL), module('sky', skyWGSL), module('normals', normalsWGSL), module('shade', shadeWGSL),
    module('buildings', buildingsWGSL), module('pins', pinsWGSL),
  ]);

  // ---------------------------------------------------------------- OSM buffers
  const storage = (data) => {
    const b = device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const segBuf = storage(osm.segs), attrBuf = storage(osm.attr), gridBuf = storage(osm.grid);
  const meshBuf = device.createBuffer({ size: Math.max(40, osm.mesh.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(meshBuf, 0, osm.mesh);
  const meshVerts = osm.mesh.length / 10;
  const pinBuf = device.createBuffer({ size: Math.max(32, osm.pins.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(pinBuf, 0, osm.pins);
  const pinCount = osm.pins.length / 8;

  // ---------------------------------------------------------------- precompute (startup)
  const runCompute = async (mod, entryPoint, layout, target) => {
    const pipe = await device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: mod, entryPoint } });
    const bg = device.createBindGroup({ layout, entries: [
      { binding: 0, resource: { buffer: frameBuf } },
      { binding: 1, resource: heightTex.createView() },
      { binding: 2, resource: target.createView() },
    ] });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipe);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(PRE / 8), Math.ceil(PRE / 8));
    pass.end();
    device.queue.submit([enc.finish()]);
    await device.queue.onSubmittedWorkDone();
  };
  const tPre = performance.now();
  opts.onProgress?.('Normali del terreno…');
  await runCompute(normalsMod, 'csNormals', normalsLayout, normalTex);
  opts.onProgress?.('Ombre e occlusione ambientale…');
  await runCompute(shadeMod, 'csShade', shadeLayout, shadeTex);
  const precomputeMs = performance.now() - tPre;

  // ---------------------------------------------------------------- render pipelines
  const depthStencil = { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' };
  const multisample = { count: SAMPLES };
  const [terrainPipe, skyPipe, buildPipe, pinPipe] = await Promise.all([
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [terrainLayout] }),
      vertex: { module: terrainMod, entryPoint: 'vsTerrain' },
      fragment: { module: terrainMod, entryPoint: 'fsTerrain', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample,
    }),
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skyLayout] }),
      vertex: { module: skyMod, entryPoint: 'vsSky' },
      fragment: { module: skyMod, entryPoint: 'fsSky', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
      multisample,
    }),
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [buildLayout] }),
      vertex: { module: buildMod, entryPoint: 'vsBuild', buffers: [{ arrayStride: 40, attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 12, format: 'float32x3' },
        { shaderLocation: 2, offset: 24, format: 'float32x2' },
        { shaderLocation: 3, offset: 32, format: 'float32x2' },
      ] }] },
      fragment: { module: buildMod, entryPoint: 'fsBuild', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample,
    }),
    device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skyLayout] }),
      vertex: { module: pinMod, entryPoint: 'vsPin', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x4' },
        { shaderLocation: 1, offset: 16, format: 'float32x4' },
      ] }] },
      fragment: { module: pinMod, entryPoint: 'fsPin', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil, multisample: { count: SAMPLES, alphaToCoverageEnabled: false },
    }),
  ]);
  const terrainBG = device.createBindGroup({ layout: terrainLayout, entries: [
    { binding: 0, resource: { buffer: frameBuf } },
    { binding: 1, resource: heightTex.createView() },
    { binding: 2, resource: { buffer: levelBuf } },
    { binding: 3, resource: normalTex.createView() },
    { binding: 4, resource: shadeTex.createView() },
    { binding: 5, resource: waterTex.createView() },
    { binding: 6, resource: linSamp },
    { binding: 7, resource: { buffer: segBuf } },
    { binding: 8, resource: { buffer: attrBuf } },
    { binding: 9, resource: { buffer: gridBuf } },
  ] });
  const buildBG = device.createBindGroup({ layout: buildLayout, entries: [
    { binding: 0, resource: { buffer: frameBuf } },
    { binding: 1, resource: heightTex.createView() },
    { binding: 2, resource: shadeTex.createView() },
    { binding: 3, resource: linSamp },
  ] });
  const skyBG = device.createBindGroup({ layout: skyLayout, entries: [{ binding: 0, resource: { buffer: frameBuf } }] });

  // ---------------------------------------------------------------- clipmap index buffers
  // [full grid | ring with hole at (32|33, 32|33)] x4. Uniform diagonal so collapsed fine
  // cells reproduce the coarse triangulation exactly.
  const W = GRID + 1;
  const HOLE = GRID / 2;
  const fullCount = GRID * GRID * 6, ringCount = (GRID * GRID - HOLE * HOLE) * 6;
  const idx = new Uint16Array(fullCount + 4 * ringCount);
  let o = 0;
  const emit = (hx, hz) => {
    for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
      if (hx >= 0 && i >= hx && i < hx + HOLE && j >= hz && j < hz + HOLE) continue;
      const v = j * W + i;
      idx[o++] = v; idx[o++] = v + W; idx[o++] = v + W + 1;
      idx[o++] = v; idx[o++] = v + W + 1; idx[o++] = v + 1;
    }
  };
  emit(-1, -1);
  for (let v = 0; v < 4; v++) emit(32 + (v & 1), 32 + (v >> 1));
  const indexBuf = device.createBuffer({ size: idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(indexBuf, 0, idx);
  const levelFirst = new Uint32Array(LEVELS);
  const levelCount = new Uint32Array(LEVELS);

  // ---------------------------------------------------------------- render targets
  let msaaTex = null, depthTex = null, msaaView = null, depthView = null;
  const colorAttachment = { view: null, resolveTarget: null, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'discard' };
  const depthAttachment = { view: null, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' };
  const passDesc = { colorAttachments: [colorAttachment], depthStencilAttachment: depthAttachment };

  function resize(w, h) {
    canvas.width = w; canvas.height = h;
    msaaTex?.destroy(); depthTex?.destroy();
    msaaTex = device.createTexture({ size: [w, h], format, sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    depthTex = device.createTexture({ size: [w, h], format: 'depth32float', sampleCount: SAMPLES, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    msaaView = msaaTex.createView(); depthView = depthTex.createView();
    colorAttachment.view = msaaView;
    depthAttachment.view = depthView;
    frame[U_SCREEN] = w; frame[U_SCREEN + 1] = h; frame[U_SCREEN + 2] = 1 / w; frame[U_SCREEN + 3] = 1 / h;
  }

  // ---------------------------------------------------------------- per frame
  const cmdBufs = [null];
  const proj = new Float32Array(16), view = new Float32Array(16), vp = new Float32Array(16), ivp = new Float32Array(16);

  function updateLevels(cx, cz) {
    let prevCx = 0, prevCz = 0;
    for (let l = 0; l < LEVELS; l++) {
      const s = BASE_SPACING * (1 << l);
      const ccx = Math.floor(cx / (2 * s)) * 2 * s, ccz = Math.floor(cz / (2 * s)) * 2 * s;
      const b = l * 8;
      levelData[b] = ccx - (GRID / 2) * s;
      levelData[b + 1] = ccz - (GRID / 2) * s;
      levelData[b + 2] = s;
      const last = l === LEVELS - 1;
      levelData[b + 3] = last ? 1e9 : 45 * s;
      levelData[b + 4] = last ? 1e9 + 1 : 61.5 * s;
      if (l === 0) { levelFirst[l] = 0; levelCount[l] = fullCount; }
      else {
        const hx = Math.round((prevCx - ccx) / s), hz = Math.round((prevCz - ccz) / s);
        levelFirst[l] = fullCount + (hx + 2 * hz) * ringCount;
        levelCount[l] = ringCount;
      }
      prevCx = ccx; prevCz = ccz;
    }
  }

  function render(cam, time, target = null) {
    const w = canvas.width, h = canvas.height;
    perspectiveReverseZ(proj, FOV_Y, w / h, NEAR);
    viewFromYawPitch(view, cam.yaw, cam.pitch);
    multiply(vp, proj, view);
    invert(ivp, vp);
    frame.set(vp, U_VIEWPROJ);
    frame.set(ivp, U_INVVP);
    frame[U_CAM] = cam.x; frame[U_CAM + 1] = cam.y; frame[U_CAM + 2] = cam.z; frame[U_CAM + 3] = time;
    device.queue.writeBuffer(frameBuf, 0, frame);
    updateLevels(cam.x, cam.z);
    device.queue.writeBuffer(levelBuf, 0, levelData);

    colorAttachment.resolveTarget = target ?? ctx.getCurrentTexture().createView();
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass(passDesc);
    pass.setPipeline(terrainPipe);
    pass.setBindGroup(0, terrainBG);
    pass.setIndexBuffer(indexBuf, 'uint16');
    const nl = opts.debugLevels ?? LEVELS;
    for (let l = 0; l < nl; l++) pass.drawIndexed(levelCount[l], 1, levelFirst[l], 0, l);
    if (meshVerts > 0) {
      pass.setPipeline(buildPipe);
      pass.setBindGroup(0, buildBG);
      pass.setVertexBuffer(0, meshBuf);
      pass.draw(meshVerts);
    }
    if (pinCount > 0 && frame[U_MISC + 3] > 0) {
      pass.setPipeline(pinPipe);
      pass.setBindGroup(0, skyBG);
      pass.setVertexBuffer(0, pinBuf);
      pass.draw(6, pinCount);
    }
    pass.setPipeline(skyPipe);
    pass.setBindGroup(0, skyBG);
    pass.draw(3);
    pass.end();
    cmdBufs[0] = enc.finish();
    device.queue.submit(cmdBufs);
  }

  // Off-screen frame read back to RGBA8 (headless screenshots: canvas capture of a
  // WebGPU swap chain is unreliable there). Not used in the interactive loop.
  async function capture(cam, time) {
    const w = canvas.width, h = canvas.height;
    const tex = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    render(cam, time, tex.createView());
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8ClampedArray(w * h * 4);
    const bgra = format.startsWith('bgra');
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = y * bpr + x * 4, d = (y * w + x) * 4;
      out[d] = src[s + (bgra ? 2 : 0)]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + (bgra ? 0 : 2)]; out[d + 3] = 255;
    }
    buf.unmap(); buf.destroy(); tex.destroy();
    return new ImageData(out, w, h);
  }

  // selected summit bit mask: highlights its itineraries and shows its trailhead pins
  function setSelection(mask) { frame[U_MISC + 3] = mask; }

  return { device, resize, render, capture, setSelection, viewProj: vp, precomputeMs, adapterInfo: adapter.info };
}
