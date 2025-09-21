using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Model
{

  public enum EvKind
  {
    Opening,
    Appointment,
    AvailableSlot
  }

  public abstract class Event
  {
    public DateTime Day { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }

    //public EvKind Kind { get; set; } //opening/appointment/available

    /// <summary>
    /// public string Kind { get; set; } //opening/appointment
    /// </summary>
    public string Notes { get; set; }

    public virtual string EvType => throw new NotImplementedException();

    public override string ToString()
    {
      return $"{EvType.ToString().Substring(0, 3)} - [{Day.Date.ToString("yyyy-MM-dd")}] {StartTime}-{EndTime}";
    }

  }

  public class Opening : Event
  {
    public override string EvType => EvKind.Opening.ToString();
  }
  public class AvailableSlot : Event
  {
    public override string EvType => EvKind.AvailableSlot.ToString();
  }
  public class Appointment : Event
  {
    public override string EvType => EvKind.Appointment.ToString();
  }





}
