
using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Infrastructure.Services;
using IStartup = Ingenium.Framework.Common.IStartup;

namespace Ingenium.Framework.Catalog.Api
{
    public class Startup : IStartup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<ICategoryService, CategoryService>();
            services.AddScoped<IProductService, ProductService>();
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            app.UseEndpoints(endpoints =>
               endpoints.MapGet("/TestEndpoint",
                   async context =>
                   {
                       await context.Response.WriteAsync("Hello World from TestEndpoint in Catalog Module");
                   })
           );
        }
    }
}
