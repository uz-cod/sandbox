using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Ingenium.Framework.Common
{
    /// <summary>
    /// Represents the startup class of a module
    /// </summary>
    public interface IStartup
    {
        /// <summary>
        /// Configures the services of the module.
        /// </summary>
        /// <param name="services"></param>
        /// <param name="configuration"></param>
        void ConfigureServices(IServiceCollection services, IConfiguration configuration);
        /// <summary>
        /// Configures the application of the module.
        /// </summary>
        /// <param name="app"></param>
        /// <param name="env"></param>
        void Configure(IApplicationBuilder app, IWebHostEnvironment env);
    }
}