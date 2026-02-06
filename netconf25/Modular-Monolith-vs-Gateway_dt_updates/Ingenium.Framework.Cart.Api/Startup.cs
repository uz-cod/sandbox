using Ingenium.Framework.Cart.Domain.Interfaces;
using Ingenium.Framework.Cart.Infrastructure.Services;
using IStartup = Ingenium.Framework.Common.IStartup;

namespace Ingenium.Framework.Cart.Api
{
    public class Startup : IStartup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<ICartService, CartService>();            
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            app.UseEndpoints(endpoints =>
               endpoints.MapGet("/TestEndpoint",
                   async context =>
                   {
                       await context.Response.WriteAsync("Hello World from TestEndpoint in Cart Module");
                   })
           );
        }
    }
}
