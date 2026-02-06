
using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Infrastructure.Services;
using IStartup = Ingenium.Framework.Common.IStartup;

namespace Ingenium.Framework.Catalog.Api
{
    public class StartupRemote : IStartup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            
            services.AddHttpClient<RemoteCatalogService>(client =>
            {
                client.BaseAddress = new Uri("https://localhost:7443");
            });            

            services.AddScoped<ICategoryService, CategoryServiceRemote>();
            services.AddScoped<IProductService, ProductServiceRemote>();
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
