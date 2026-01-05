using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Domain.Models;
using Microsoft.AspNetCore.Mvc;

namespace Ingenium.Framework.Catalog.Api.Controllers
{
    [ApiController]
    [Route("[module]/v1/[controller]")]
    public class CategoryController : ControllerBase
    {

        private readonly ILogger<CategoryController> _logger;
        private readonly ICategoryService _categoryService;

        public CategoryController(ICategoryService categoryService, ILogger<CategoryController> logger)
        {
            _logger = logger;
            _categoryService = categoryService;
        }

        [HttpGet]
        public async Task<IActionResult> Get()
        {
            return Ok(await _categoryService.GetCategoriesAsync());
        }

        [HttpGet("{id}")]
        public async Task<IActionResult> Get(int id)
        {
            var entity =  await _categoryService.GetCategoryAsync(id);
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
        public async Task<IActionResult> CreateCategoryAsync(Category category)
        {
            var result = await _categoryService.CreateCategoryAsync(category);
            return Ok(result);
        }

        [HttpPut]
        public async Task<IActionResult> UpdateCategoryAsync(Category category)
        {
            var result = await _categoryService.UpdateCategoryAsync(category);
            return Ok(result);
        }

        [HttpDelete("{id}")]
        public async Task<IActionResult> DeleteCategoryAsync(int id)
        {
            var entity = await _categoryService.DeleteCategoryAsync(id);
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
