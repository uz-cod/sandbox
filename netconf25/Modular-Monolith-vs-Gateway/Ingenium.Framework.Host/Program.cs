using Ingenium.Framework.Host;
using Ingenium.Framework.Host.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Scalar.AspNetCore;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Loads configuration based on EnvironmentName
var environment = builder.Environment.EnvironmentName;

builder.Configuration
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true)
    .AddJsonFile($"appsettings.{environment}.json", optional: true, reloadOnChange: true);

// Serilog configuration
Log.Logger = new Serilog.LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .CreateLogger();

// Add services
builder.Services.AddEndpointsApiExplorer();

// CORS configuration
builder.Services.AddCors(options =>
{
    options.AddPolicy("default", policy =>
    {
        policy.AllowAnyOrigin()
            .AllowAnyHeader()
            .AllowAnyMethod();
    });
});

//Controller configuration to use only micro-backends controllers
builder.Services.AddControllers()
.ConfigureApplicationPartManager(manager =>
{
    //Clear default controller discovery
    manager.ApplicationParts.Clear();
    manager.FeatureProviders.Add(new InternalControllerFeatureProvider());
});

// Registrazione di altre opzioni e servizi
builder.Services.AddTransient<IPostConfigureOptions<MvcOptions>, ModuleRoutingMvcOptionsPostConfigure>();
builder.Services.AddHttpContextAccessor();

////////////////////////////////////
// Micro-backends registration
////////////////////////////////////
var microBackends = builder.Configuration.GetSection("MicroBackends").Get<List<MicroBackendConfig>>();
if (microBackends != null)
{
    foreach (var microBackend in microBackends)
    {
        builder.Services.AddModule(builder.Environment, builder.Configuration, microBackend.AssemblyName, microBackend.TypeName, microBackend.RoutePrefix);
    }
}

builder.Services.AddOpenApi();

var app = builder.Build();


if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();

    //Taken out for DEMO Purposes
    //app.MapOpenApi();
    //app.MapScalarApiReference();
}

app.MapOpenApi();
app.MapScalarApiReference();

app.UseRouting();

app.UseCors("default");

app.MapControllers();

// Add modules with route prefix
var modules = app.Services.GetRequiredService<IEnumerable<Module>>();
foreach (var module in modules)
{
    app.Map($"/{module.RoutePrefix}", builder =>
    {
        builder.UseRouting();
        module.Startup.Configure(builder, app.Environment);
    }) ;
}

app.Run();