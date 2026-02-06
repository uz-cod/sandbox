using Microsoft.AspNetCore.Mvc.ApplicationParts;
using System.Reflection;
using IStartup = Ingenium.Framework.Common.IStartup;
using Module = Ingenium.Framework.Host.Models.Module;

namespace Ingenium.Framework.Host
{    
    public static class ModuleServiceCollection
    {
        /// <summary>
        /// Adds a module.
        /// </summary>
        /// <param name="services"></param>
        /// <param name="routePrefix">The prefix of the routes to the module.</param>
        /// <typeparam name="TStartup">The type of the startup class of the module.</typeparam>
        /// <returns></returns>
        public static IServiceCollection AddModule(this IServiceCollection services, IWebHostEnvironment environment, IConfiguration configuration, string assemblyName, string typeName, string routePrefix)            
        {
            //Load assembly dynamically
#if DEBUG
            var moduleAssembly = Assembly.LoadFrom(Path.Combine(environment.ContentRootPath, $"bin/Debug/net9.0/{assemblyName}"));
#else
            var moduleAssembly = Assembly.LoadFrom(Path.Combine(environment.ContentRootPath, assemblyName));
#endif
            //Create Startup instance
            var startup = moduleAssembly.CreateInstance(typeName) as IStartup;
            
            if (startup != null)
            {
                // Register assembly in MVC so it can find controllers of the module
                services.AddControllers().ConfigureApplicationPartManager(manager =>
                    manager.ApplicationParts.Add(new AssemblyPart(moduleAssembly)));
                
                // Call ConfigureServices of the module
                startup.ConfigureServices(services, configuration);

                services.AddSingleton(new Module(routePrefix, startup));
            }

            return services;
        }
    }
}
