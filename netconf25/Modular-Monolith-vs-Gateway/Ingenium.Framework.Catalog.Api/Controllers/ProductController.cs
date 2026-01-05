using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Domain.Models;
using Microsoft.AspNetCore.Mvc;

namespace Ingenium.Framework.Catalog.Api.Controllers
{
    [ApiController]
    [Route("[module]/v1/[controller]")]
    public class ProductController : ControllerBase
    {

        private readonly ILogger<CategoryController> _logger;
        private readonly IProductService _productService;

        public ProductController(IProductService productService, ILogger<CategoryController> logger)
        {
            _logger = logger;
            _productService = productService;
        }

        [HttpGet]
        public async Task<IActionResult> Get()
        {
            return Ok(await _productService.GetProductsAsync());
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> Get(int id)
        {
            var entity =  await _productService.GetProductAsync(id);
            if (entity == null)
            {
                return NotFound();
            }
            else
            {
                return Ok(entity);
            }
        }

        [HttpPost]
        public async Task<IActionResult> CreateCategoryAsync(Product category)
        {
            var result = await _productService.CreateProductAsync(category);
            return Ok(result);
        }

        [HttpPut]
        public async Task<IActionResult> UpdateCategoryAsync(Product category)
        {
            var result = await _productService.UpdateProductAsync(category);
            return Ok(result);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteCategoryAsync(int id)
        {
            var entity = await _productService.DeleteProductAsync(id);
            if (entity == null)
            {
                return NotFound();
            }
            else
            {
                return Ok(entity);
            }
        }

    }
}
