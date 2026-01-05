using Ingenium.Framework.Host.Models;
using Microsoft.AspNetCore.Mvc.ApplicationModels;

namespace Ingenium.Framework.Host
{
    public class ModuleRoutingConvention : IActionModelConvention
    {
        private readonly IEnumerable<Module> _modules;

        public ModuleRoutingConvention(IEnumerable<Module> modules)
        {
            _modules = modules;
        }

        public void Apply(ActionModel action)
        {
            var module = _modules.FirstOrDefault(m => m.Assembly == action.Controller.ControllerType.Assembly);
            if (module == null)
            {
                return;
            }

            action.RouteValues.Add("module", module.RoutePrefix);
        }
    }
}
