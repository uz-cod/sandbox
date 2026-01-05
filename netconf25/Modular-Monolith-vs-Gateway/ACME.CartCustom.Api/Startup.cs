using ACME.CartCustom.Domain.Interfaces;
using ACME.CartCustom.Infrastructure.Services;
using Ingenium.Framework.Cart.Domain.Interfaces;
using Ingenium.Framework.Cart.Infrastructure.Services;
using IStartup = Ingenium.Framework.Common.IStartup;

namespace ACME.CartCustom.Api
{
    public class Startup : IStartup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            //New interface and new service implementation
            services.AddScoped<ICartCustomService, CartCustomService>();
            
            //Cart Domain Interface and override service implementation
            services.AddScoped<ICartService, CartExtendedService>();
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
