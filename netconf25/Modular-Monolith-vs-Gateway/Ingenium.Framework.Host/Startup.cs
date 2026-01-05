using Easyone.Framework.Common.Filters;
using Easyone.Framework.Common.Interfaces;
using Easyone.Framework.Common.Middleware;
using Easyone.Framework.Common.Models;
using Easyone.Framework.Common.Options;
using Easyone.Framework.Common.Providers;
using Easyone.Framework.Common.Repositories;
using Easyone.Framework.Common.Services;
using Easyone.Framework.Host.Models;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi.Models;
using Serilog;
using System.IdentityModel.Tokens.Jwt;
using Scalar.AspNetCore;

namespace Easyone.Framework.Host
{
    public class Startup
    {
        private readonly IWebHostEnvironment _environment;
        private readonly IConfiguration _configuration;

        public Startup(IWebHostEnvironment environment, IConfiguration configuration)
        {
            _environment = environment;
            _configuration = configuration;

            //Create global logger (Serilog)
            Log.Logger = new Serilog.LoggerConfiguration().ReadFrom.
                         Configuration(configuration)
                        .CreateLogger();
        }

        public void ConfigureServices(IServiceCollection services)
        {
            services.AddSwaggerGen(options =>
            {
                options.SwaggerDoc("v1", new OpenApiInfo()
                {
                    Version = "v1",
                    Title = "Easyone Micro-Backend"
                });

                options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
                {
                    Description = "JWT Authorization header using the Bearer scheme (Example: 'Bearer 12345abcdef')",
                    Name = "Authorization",
                    In = ParameterLocation.Header,
                    Type = SecuritySchemeType.ApiKey,
                    Scheme = "Bearer"
                });

                options.AddSecurityRequirement(new OpenApiSecurityRequirement
                {
                    {
                        new OpenApiSecurityScheme
                        {
                            Reference = new OpenApiReference
                            {
                                Type = ReferenceType.SecurityScheme,
                                Id = "Bearer"
                            }
                        },
                        Array.Empty<string>()
                    }
                });
            });

            services.AddEndpointsApiExplorer();
            
            services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();

            services.ConfigureOptions<JwtOptionsSetup>();
            services.ConfigureOptions<JwtBearerOptionsSetup>();


            services.AddAuthorization(options =>
            {
                options.AddPolicy("Tenant", policy => policy.RequireClaim("TenantId"));
            });


            services.AddCors(options =>
            {
                // this defines a CORS policy called "default"
                options.AddPolicy("default", policy =>
                {
                    policy.AllowAnyOrigin()
                        .AllowAnyHeader()
                        .AllowAnyMethod();
                });
            });


            services.AddControllers(config =>
                {
                    config.Filters.Add<TenantFilter>();
                    config.Filters.Add<AsyncTenantFilter>();
                })
                .ConfigureApplicationPartManager(manager =>
            {
                // Clear all auto detected controllers.
                manager.ApplicationParts.Clear();
                // Add feature provider to allow "internal" controller
                manager.FeatureProviders.Add(new InternalControllerFeatureProvider());

            });

            // Register a convention allowing to us to prefix routes to modules.
            services.AddTransient<IPostConfigureOptions<MvcOptions>, ModuleRoutingMvcOptionsPostConfigure>();

            services.Configure<ApplicationSettings>(_configuration.GetSection("ApplicationSettings"));
            services.AddHttpContextAccessor();
            //services.AddScoped<IUnitOfWork, UnitOfWork>();
            
            services.AddScoped<ITenantRepository, TenantRepository>();
            services.AddScoped<ITenantService, TenantService>();
            services.AddScoped<ITenantResolver, TenantResolver>();

            services.AddScoped<IJwtProvider, JwtProvider>();
            //services.AddSingleton<IHttpContextAccessor, HttpContextAccessor>();

            ////////////////////////////////
            //Add Micro-Backends to host
            ////////////////////////////////
            var microBackends = _configuration.GetSection("MicroBackends").Get<List<MicroBackendConfig>>();
            if (microBackends != null)
            {
                foreach (var microBackend in microBackends)
                {
                    services.AddModule(_environment, _configuration, microBackend.AssemblyName, microBackend.TypeName, microBackend.RoutePrefix);
                }
            }
        }

        public void Configure(IApplicationBuilder app, IWebHostEnvironment env)
        {
            if (env.IsDevelopment())
            {
                app.UseDeveloperExceptionPage();
                app.UseSwagger();
                
            }

            

            //Centralized exception handling with log
            app.UseMiddleware<ExceptionHandlingMiddleware>();

            //Non permette la sovrascrittura dei claims
            JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();
            app.UseAuthentication();

            app.UseRouting();

            app.UseCors("default");

            app.UseAuthorization();
            app.UseEndpoints(endpoints => { endpoints.MapControllers(); });


            // Adds endpoints defined in modules
            var modules = app.ApplicationServices.GetRequiredService<IEnumerable<Module>>();
            foreach (var module in modules)
            {
                app.Map($"/{module.RoutePrefix}", builder =>
                {
                    builder.UseRouting();
                    module.Startup.Configure(builder, env);
                });
            }

        }

    }
}
