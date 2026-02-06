using Microsoft.AspNetCore.Mvc;

namespace Ingenium.Framework.Core.Api.Controllers
{
    [ApiController]
    [Route("[module]/v1/[controller]")]
    public class DiagnosticsController : ControllerBase
    {
        private readonly ILogger<DiagnosticsController> _logger;

        public DiagnosticsController(ILogger<DiagnosticsController> logger)
        {
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> Get()
        {
            return Ok("Ingenium Framework Core module loaded.");
        }
    }
}
