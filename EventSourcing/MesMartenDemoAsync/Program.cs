using Domain;
using JasperFx;
using JasperFx.Events.Projections;
using Marten;
using Marten.Events;
using Marten.Events.Projections;
using System;
using System.Threading.Tasks;
using Testcontainers.PostgreSql;
using Weasel.Core;

// Namespace deve coincidere col precedente o copia le classi qui sotto
namespace MesMartenDemoV8Fixed
{
  class Program
  {
    static async Task Main(string[] args)
    {
      Console.WriteLine("--- [Marten ASYNC DAEMON] Avvio... ---");

      // 1. Setup Container (Uguale a prima)
      await using var pgContainer = new PostgreSqlBuilder()
          .WithImage("postgres:15-alpine")
          .Build();
      await pgContainer.StartAsync();
      var connString = pgContainer.GetConnectionString();

      // 2. Setup Store
      var store = DocumentStore.For(opts =>
      {
        opts.Connection(connString);
        opts.AutoCreateSchemaObjects = AutoCreate.All;

        // *** CAMBIAMENTO CHIAVE 1 ***
        // Impostiamo il ciclo di vita su ASYNC.
        // Marten NON aggiornerà la vista durante il SaveChanges.
        opts.Projections.Add<AvanzamentoOrdineProjection>(ProjectionLifecycle.Async);
      });

      // 3. Avvio del DAEMON (Il "Worker" di background)
      // In una app ASP.NET Core questo si fa con .AddAsyncDaemon() nella DI.
      // In una Console App dobbiamo avviarlo manualmente.
      using var daemon = await store.BuildProjectionDaemonAsync();

      // Diciamo al demone di partire e processare tutto
      await daemon.StartAllAsync();

      var ordineId = Guid.NewGuid();
      Console.WriteLine($"\n--- Ordine: {ordineId} ---");

      // A. INSERIMENTO AD ALTA VELOCITÀ (Simulazione PLC)
      using (var session = store.LightweightSession())
      {
        session.Events.StartStream(ordineId, new OrdineDiProduzioneCreato(ordineId, "TURBINA-K9", 100));

        // Immagina un loop veloce
        session.Events.Append(ordineId, new ProduzioneAvviata(ordineId));
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, true));
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, true));
        session.Events.Append(ordineId, new PezzoProdotto(ordineId, false)); // Scarto

        // Qui il commit è istantaneo perché NON deve aggiornare la vista
        await session.SaveChangesAsync();
        Console.WriteLine(">> [PLC] Eventi salvati su disco (Commit veloce).");
      }

      // B. LA PROVA DEL NOVE (Race Condition)
      // Se interroghiamo SUBITO, potremmo trovare la vista vuota o vecchia, 
      // perché il Daemon (che gira su un altro thread) potrebbe non aver ancora finito.
      using (var query = store.QuerySession())
      {
        var viewSubito = await query.LoadAsync<AvanzamentoOrdine>(ordineId);
        if (viewSubito == null)
        {
          Console.ForegroundColor = ConsoleColor.Yellow;
          Console.WriteLine(">> [DASHBOARD] Query Immediata: Dati non ancora presenti (Normale in Async!)");
          Console.ResetColor();
        }
        else
        {
          // Potrebbe capitare che il PC sia così veloce da aver già finito, ma raramente
          Console.WriteLine($">> [DASHBOARD] Query Immediata: {viewSubito.TotalePezzi} pezzi (Già processato?)");
        }
      }

      // C. ATTESA SINCRONIZZATA
      // Marten offre questo metodo SPETTACOLARE per i test/demo.
      // "Blocca l'esecuzione finché il Read Model non ha processato tutti gli eventi attuali".
      Console.WriteLine(">> [SYSTEM] Attesa allineamento Daemon...");
      await daemon.WaitForNonStaleData(TimeSpan.FromSeconds(5));

      // D. QUERY FINALE
      using (var query = store.QuerySession())
      {
        var viewFinale = await query.LoadAsync<AvanzamentoOrdine>(ordineId);

        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine($" $"Pezzi: {viewFinale.PezziBuoni} OK | {viewFinale.PezziScarti} KO");
        Console.WriteLine($"Ultimo Update: {viewFinale.UltimoAggiornamento:HH:mm:ss.fff}");
        Console.ResetColor();
      }

      Console.WriteLine("\nPremi ENTER per chiudere...");
      Console.ReadLine();
    }
  }
}