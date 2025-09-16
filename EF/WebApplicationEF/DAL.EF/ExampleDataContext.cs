using Microsoft.EntityFrameworkCore;

namespace DAL.EF
{
    public class ExampleDataContext : DbContext
    {
        public ExampleDataContext(DbContextOptions<ExampleDataContext> options) : base(options)
        {
        }

        public DbSet<Scimmia> Scimmie { get; set; }

        public DbSet<Zoo> Zoos { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.ApplyConfigurationsFromAssembly(typeof(ExampleDataContext).Assembly);
        }
    }
}
