using DLib.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Repository
{

  public class AppointmentsRepository : IAppointmentsRepository
  {
    public List<Event> Events { get; set; } = new List<Event> ();


    public List<Event> SampleEvents
    {
      get
      {

        List<Event> sampledata = new List<Event>();

        // 16/9
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 16),
          StartTime = new TimeSpan(9, 0, 0),
          EndTime = new TimeSpan(12, 0, 0),
          Kind = "opening",
          Notes = "Sample opening slot"
        }); //3 hours -> 6 as

        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 16),
          StartTime = new TimeSpan(10, 0, 0),
          EndTime = new TimeSpan(10, 30, 0),
          Kind = "appointment",
          Notes = "Sample appointment slot #overlaps"
        });

        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 16),
          StartTime = new TimeSpan(11, 0, 0),
          EndTime = new TimeSpan(11, 30, 0),
          Kind = "appointment",
          Notes = "Sample appointment slot #overlaps"
        });

        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 16),
          StartTime = new TimeSpan(14, 00, 0),
          EndTime = new TimeSpan(18, 00, 0),
          Kind = "opening",
          Notes = "Sample opening slot"
        }); //1 hour -> 2 as
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 16),
          StartTime = new TimeSpan(15, 0, 0),
          EndTime = new TimeSpan(16, 0, 0),
          Kind = "appointment",
          Notes = "Sample appointment slot"
        });


        // 17/9
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 17),
          StartTime = new TimeSpan(16, 00, 0),
          EndTime = new TimeSpan(16, 30, 0),
          Kind = "opening",
          Notes = "Sample opening slot"
        }); //30 minutes - 1 as
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 17),
          StartTime = new TimeSpan(16, 30, 0),
          EndTime = new TimeSpan(17, 0, 0),
          Kind = "appointment",
          Notes = "Sample appointment slot"
        });
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 17),
          StartTime = new TimeSpan(17, 00, 0),
          EndTime = new TimeSpan(18, 10, 0),
          Kind = "opening",
          Notes = "Sample opening slot"
        }); //1h 10' - 2 as
        sampledata.Add(new Event
        {
          Day = new DateTime(2025, 9, 21),
          StartTime = new TimeSpan(9, 0, 0),
          EndTime = new TimeSpan(12, 0, 0),
          Kind = "opening",
          Notes = "Sample opening slot"
        }); //3 hours -> 6 as

        return sampledata;
      }
    }
  }
}
