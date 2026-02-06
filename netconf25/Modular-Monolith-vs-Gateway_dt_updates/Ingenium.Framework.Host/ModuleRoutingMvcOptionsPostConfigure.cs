using Ingenium.Framework.Host.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Ingenium.Framework.Host
{
    public class ModuleRoutingMvcOptionsPostConfigure : IPostConfigureOptions<MvcOptions>
    {
        private readonly IEnumerable<Module> _modules;

        public ModuleRoutingMvcOptionsPostConfigure(IEnumerable<Module> modules)
        {
            _modules = modules;
        }

        public void PostConfigure(string name, MvcOptions options)
        {
            options.Conventions.Add(new ModuleRoutingConvention(_modules));
        }
    }
}
