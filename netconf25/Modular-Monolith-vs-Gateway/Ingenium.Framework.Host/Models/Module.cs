using System.Reflection;

namespace Ingenium.Framework.Host.Models
{
    public class Module
    {
        /// <summary>
        /// Route prefix to all controller and endpoints in the module.
        /// It is used to group all controllers and endpoints in the module.
        /// It should be unique between modules.
        /// </summary>
        public string RoutePrefix { get; }

        /// <summary>
        /// Returns the startup class of the module.
        /// </summary>
        public Ingenium.Framework.Common.IStartup Startup { get; }

        /// <summary>
        /// Returns the assembly of the module.
        /// </summary>
        public Assembly Assembly => Startup.GetType().Assembly;

        public Module(string routePrefix, Ingenium.Framework.Common.IStartup startup)
        {
            RoutePrefix = routePrefix;
            Startup = startup;
        }
    }
}