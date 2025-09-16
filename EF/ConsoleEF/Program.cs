using Microsoft.EntityFrameworkCore;
using ConfigurazioniDemo.Models;
using ConfigurazioniDemo.Data;

var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseInMemoryDatabase("DemoConfig")
    .Options;

using var context = new AppDbContext(options);

// Popolamento iniziale
context.Configurazioni.AddRange(
    new Nazione { Nome = "Italia", CodiceIso = "IT" },
    new Provincia { Nome = "Roma", CodiceProvincia = "RM", NazioneId = 1 },
    new Lingua { Nome = "Italiano", CodiceLingua = "it" },
    new Categoria { Nome = "Elettronica", DescrizioneEstesa = "Prodotti elettronici" }
);
context.SaveChanges();

// Query con filtro per tipo
var nazioni = context.Configurazioni.OfType<Nazione>().ToList();
var province = context.Configurazioni.OfType<Provincia>().ToList();

var cose = context.Configurazioni.ToList();
foreach (var c in cose)
    Console.WriteLine($"- {c.Nome} ({c.GetType().Name})");

Console.WriteLine("Nazioni:");
foreach (var n in nazioni)
    Console.WriteLine($"- {n.Nome} ({n.CodiceIso})");

Console.WriteLine("\nProvince:");
foreach (var p in province)
    Console.WriteLine($"- {p.Nome} ({p.CodiceProvincia})");
