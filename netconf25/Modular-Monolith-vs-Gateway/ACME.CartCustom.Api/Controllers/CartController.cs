using ACME.CartCustom.Domain.Interfaces;
using Microsoft.AspNetCore.Mvc;

namespace ACME.CartCustom.Api.Controllers
{
    [ApiController]
    [Route("[module]/v1/[controller]")]
    public class CartController : ControllerBase
    {
        private readonly ILogger<CartController> _logger;
        private readonly ICartCustomService _customCartService;

        public CartController(ILogger<CartController> logger, ICartCustomService customCartService)
        {
            _logger = logger;
            _customCartService = customCartService;
        }

        [HttpGet("discount/{customerId}")]
        public async Task<IActionResult> GetCustomerDiscountAsync(int customerId)
        {
            return Ok(await _customCartService.GetCustomerDiscountAsync(customerId));
        }
    }
}
