using Ingenium.Framework.Core.Data;
using IStartup = Ingenium.Framework.Common.IStartup;
using Microsoft.EntityFrameworkCore;
using Ingenium.Framework.Core.Domain.Models;

namespace Ingenium.Framework.Core.Api
{
    public class Startup : IStartup
    {
        public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
        {
            services.Configure<ApplicationSettings>(configuration.GetSection("Ingenium.Framework.Core"));

            //Register shared DataContext
            services.AddDbContext<EcommerceContext>((sp, o) =>
            {
                o.UseSqlServer(configuration.GetValue<string>("Ingenium.Framework.Core:ConnectionString"));
            });
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
