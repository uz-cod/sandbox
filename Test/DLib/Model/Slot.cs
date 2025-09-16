using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Model
{
  public class Slot
  {

    public DateTime Day { get; set; }
    public TimeSpan StartTime { get; set; }
    public TimeSpan EndTime { get; set; }

    public string Type { get; set; } //opening/appointment
    public string Notes { get; set; }

  }



}
