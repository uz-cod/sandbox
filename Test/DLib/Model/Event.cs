using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Model
{
  public class Event
  {
    public DateTime Day { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }
    public string Kind { get; set; } //opening/appointment
    public string Notes { get; set; }

    public override string ToString()
    {
      return $"{Kind.Substring(0,3)} - [{Day.Date.ToString("yyyy-MM-dd")}] {StartTime}-{EndTime}";
    }

  }



}
