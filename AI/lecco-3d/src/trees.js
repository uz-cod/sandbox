// Low-poly unit tree meshes (height 1, base at y = 0), built once at startup.
// Vertex: position(3) normal(3) part(1: 0 trunk, 1 foliage) -> 28 bytes.

function pushTri(v, a, b, c, na, nb, nc, part) {
  for (const [p, n] of [[a, na], [b, nb], [c, nc]]) v.push(p[0], p[1], p[2], n[0], n[1], n[2], part);
}

function trunk(v, r, h, sides) {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
    const p00 = [Math.cos(a0) * r, 0, Math.sin(a0) * r], p10 = [Math.cos(a1) * r, 0, Math.sin(a1) * r];
    const p01 = [Math.cos(a0) * r * 0.6, h, Math.sin(a0) * r * 0.6], p11 = [Math.cos(a1) * r * 0.6, h, Math.sin(a1) * r * 0.6];
    const n0 = [Math.cos(a0), 0, Math.sin(a0)], n1 = [Math.cos(a1), 0, Math.sin(a1)];
    pushTri(v, p00, p01, p11, n0, n0, n1, 0);
    pushTri(v, p00, p11, p10, n0, n1, n1, 0);
  }
}

// cone from y0 (radius r) to apex y1, normals tilted outwards/up
function cone(v, r, y0, y1, sides, droop) {
  const slope = r / (y1 - y0);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2, am = (a0 + a1) / 2;
    const b0 = [Math.cos(a0) * r, y0 - droop, Math.sin(a0) * r], b1 = [Math.cos(a1) * r, y0 - droop, Math.sin(a1) * r];
    const apex = [0, y1, 0];
    const nrm = (a) => { const l = Math.hypot(1, slope); return [Math.cos(a) / l, slope / l + 0.25, Math.sin(a) / l]; };
    pushTri(v, b0, apex, b1, nrm(a0), nrm(am), nrm(a1), 1);
    // underside (dark, closes the tier)
    pushTri(v, b0, b1, [0, y0 + 0.02, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0], 1);
  }
}

export function buildTreeMeshes() {
  // conifer: trunk + 4 overlapping tiers
  const c = [];
  trunk(c, 0.022, 0.4, 5);
  const tiers = [[0.27, 0.16, 0.50], [0.22, 0.34, 0.68], [0.16, 0.52, 0.85], [0.10, 0.70, 1.0]];
  for (const [r, y0, y1] of tiers) cone(c, r, y0, y1, 8, 0.03);

  // broadleaf: trunk + lumpy ellipsoid crown (lat-long, deterministic bumps)
  const b = [];
  trunk(b, 0.03, 0.5, 5);
  const LAT = 7, LON = 12, cy = 0.62, rx = 0.33, ry = 0.36;
  const P = (i, j) => {
    const th = (i / LAT) * Math.PI, ph = (j / LON) * Math.PI * 2;
    const bump = 1 + 0.11 * Math.sin(ph * 3 + i * 1.7) * Math.sin(th * 2 + j * 0.9);
    const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
    return { p: [nx * rx * bump, cy + ny * ry * bump * (ny < 0 ? 0.8 : 1), nz * rx * bump], n: [nx, ny, nz] };
  };
  for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
    const a = P(i, j), bb = P(i + 1, j), cc = P(i + 1, j + 1), d = P(i, j + 1);
    pushTri(b, a.p, bb.p, cc.p, a.n, bb.n, cc.n, 1);
    pushTri(b, a.p, cc.p, d.p, a.n, cc.n, d.n, 1);
  }
  return { conifer: new Float32Array(c), broadleaf: new Float32Array(b) };
}
