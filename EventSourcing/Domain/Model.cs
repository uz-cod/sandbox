using JasperFx.Events;
using Marten.Events.Aggregation;

namespace Domain
{
  // ==========================================
  // 1. EVENTI
  // ==========================================
  public record OrdineDiProduzioneCreato(Guid OrdineId, string CodiceProdotto, int QuantitaTarget);
  public record ProduzioneAvviata(Guid OrdineId);
  public record PezzoProdotto(Guid OrdineId, bool Conforme, string MotivoScarto = null);
  public record OrdineCompletato(Guid OrdineId);

  // ==========================================
  // 2. READ MODEL
  // ==========================================
  public class AvanzamentoOrdine
  {
    public Guid Id { get; set; }
    public string CodiceProdotto { get; set; } = string.Empty;
    public int QuantitaTarget { get; set; }
    public int PezziBuoni { get; set; }
    public int PezziScarti { get; set; }
    public int TotalePezzi => PezziBuoni + PezziScarti;
    public string Stato { get; set; } = "Definito";
    public DateTime UltimoAggiornamento { get; set; }
    public double OEE_Qualita => TotalePezzi == 0 ? 0 : Math.Round(((double)PezziBuoni / TotalePezzi) * 100, 2);
  }

  public class AvanzamentoOrdineProjection : SingleStreamProjection<AvanzamentoOrdine, Guid>
  {
    // CREATE
    public AvanzamentoOrdine Create(OrdineDiProduzioneCreato evt)
    {
      return new AvanzamentoOrdine
      {
        Id = evt.OrdineId,
        CodiceProdotto = evt.CodiceProdotto,
        QuantitaTarget = evt.QuantitaTarget,
        Stato = "Pianificato",
        UltimoAggiornamento = DateTime.UtcNow
      };
    }

    public void Apply(IEvent<ProduzioneAvviata> evt, AvanzamentoOrdine view)
    {
      view.Stato = "In Esecuzione";
      view.UltimoAggiornamento = evt.Timestamp.DateTime;
    }

    public void Apply(PezzoProdotto evt, AvanzamentoOrdine view)
    {
      if (evt.Conforme)
        view.PezziBuoni++;
      else
        view.PezziScarti++;
    }

    // APPLY 3 (Con Metadati)
    public void Apply(IEvent<OrdineCompletato> evt, AvanzamentoOrdine view)
    {
      view.Stato = "Completato";
      view.UltimoAggiornamento = evt.Timestamp.DateTime;
    }
  }
}
