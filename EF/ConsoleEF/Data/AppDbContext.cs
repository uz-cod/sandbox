using Microsoft.EntityFrameworkCore;
using ConfigurazioniDemo.Models;

namespace ConfigurazioniDemo.Data;

public class AppDbContext : DbContext
{
    public DbSet<ConfigurazioneBase> Configurazioni { get; set; }

    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options) { }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<ConfigurazioneBase>()
            .HasDiscriminator<string>("TipoConfigurazione")
            .HasValue<Nazione>("Nazione")
            .HasValue<Provincia>("Provincia")
            .HasValue<Lingua>("Lingua")
            .HasValue<Categoria>("Categoria");
    }
}
