using Domain;
using JasperFx;
using JasperFx.Events;
using JasperFx.Events.Projections;
using Marten;
using Marten.Events;
using Marten.Events.Aggregation; // Namespace per SingleStreamProjection
using Marten.Events.Projections;
using System;
using System.Threading.Tasks;
using Testcontainers.PostgreSql;
using Weasel.Core;

namespace MesMartenDemoV8Fixed
{
 

  // ==========================================
  // 4. MAIN PROGRAM
  // ==========================================
  class Program
  {
    static async Task Main(string[] args)
    {
      Console.WriteLine("--- [Marten v8 FIX + Testcontainers] Avvio PostgreSQL... ---");

      await using var pgContainer = new PostgreSqlBuilder()
          .WithImage("postgres:15-alpine")
          .Build();

      await pgContainer.StartAsync();
      var connString = pgContainer.GetConnectionString();

      Console.WriteLine($">> Connessione: {connString}");

      var store = DocumentStore.For(opts =>
      {
        opts.Connection(connString);
        opts.AutoCreateSchemaObjects = AutoCreate.All;
        opts.Projections.Add<AvanzamentoOrdineProjection>(ProjectionLifecycle.Inline);
      });

      var ordineId = Guid.NewGuid();
      Console.WriteLine($"\n--- Ordine: {ordineId} ---");

      // A. START
      using (var session = store.LightweightSession())
      {
        session.Events.StartStream(ordineId,
                                  new OrdineDiProduzioneCreato(ordineId, "ALBERO-CAMME-V6", 50),
                                  new ProduzioneAvviata(ordineId)
        );
        await session.SaveChangesAsync();
        Console.WriteLine(">> 1. Ordine Avviato.");
      }

      // B. WORK
      using (var session = store.LightweightSession())
      {
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, true));
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, true));
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, false, "Sbeccatura"));

        await session.SaveChangesAsync();
        Console.WriteLine(">> 2. Produzione registrata.");
      }

      // C. QUERY
      using (var query = store.QuerySession())
      {
        var view = await query.LoadAsync<AvanzamentoOrdine>(ordineId);

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine($"\n[READ MODEL VIEW]");
        Console.WriteLine($"ID: {view.Id}");
        Console.WriteLine($"Prodotto: {view.CodiceProdotto} ({view.Stato})");
        Console.WriteLine($"Pezzi: {view.PezziBuoni} OK | {view.PezziScarti} KO");
        Console.WriteLine($"OEE Qualità: {view.OEE_Qualita}%");
        Console.ResetColor();
      }

      Console.WriteLine("\nPremi ENTER per chiudere...");
      Console.ReadLine();
    }
  }
}