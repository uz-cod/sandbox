using DAL.EF;

using Microsoft.EntityFrameworkCore;

namespace WebApplicationEF
{
    public class DbInitializerHostedService : IHostedService
    {
        private readonly IDbContextFactory<ExampleDataContext> contextFactory;

        public DbInitializerHostedService(IDbContextFactory<ExampleDataContext> contextFactory)
        {
            this.contextFactory = contextFactory;
        }
        public async Task StartAsync(CancellationToken stoppingToken)
        {
            using var exampleDataContext = contextFactory.CreateDbContext();
            await exampleDataContext.Database.EnsureCreatedAsync(stoppingToken);
        }

        public Task StopAsync(CancellationToken stoppingToken)
        {
            // The code in here will run when the application stops
            // In your case, nothing to do
            return Task.CompletedTask;
        }
    }
}
