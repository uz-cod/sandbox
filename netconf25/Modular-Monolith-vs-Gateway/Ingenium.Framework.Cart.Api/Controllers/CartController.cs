using Ingenium.Framework.Cart.Domain.Interfaces;
using Ingenium.Framework.Cart.Domain.Models;
using Microsoft.AspNetCore.Mvc;

namespace Ingenium.Framework.Cart.Api.Controllers
{
    [ApiController]
    [Route("[module]/v1/[controller]")]
    public class CartController : ControllerBase
    {
        private readonly ILogger<CartController> _logger;
        private readonly ICartService _cartService;

        public CartController(ILogger<CartController> logger, ICartService cartService)
        {
            _logger = logger;
            _cartService = cartService;
        }

        [HttpPost("add")]
        public async Task<IActionResult> AddProductToCart(AddProductRequest model)
        {
            var result = await _cartService.AddProductToCartAsync(model.CustomerId, model.ProductId, model.Quantity);
            return Ok(result);
        }

        [HttpDelete("empty/{customerId}")]
        public async Task<IActionResult> EmptyCart(int customerId)
        {
            await _cartService.EmptyCartAsync(customerId);
            return Ok();
        }

        [HttpGet("total/{customerId}")]
        public async Task<IActionResult> GetCartTotal(int customerId)
        {
            var result = await _cartService.GetCartTotalAsync(customerId);
            return Ok(result);
        }

        [HttpGet("items/{customerId}")]
        public async Task<IActionResult> GetCart(int customerId)
        {
            var result = await _cartService.GetCartAsync(customerId);
            return Ok(result);
        }
    }
}
