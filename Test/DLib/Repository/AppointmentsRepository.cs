using DLib.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Repository
{
  internal class AppointmentsRepository : IAppointmentsRepository
  {
    public List<Slot> GetSlots(DateTime startTime, int days = 7)
    {

      List<Slot> sampleSlots = new List<Slot>();

      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 16),
        StartTime = new TimeSpan(9, 0, 0),
        EndTime = new TimeSpan(12, 0, 0),
        Type = "opening",
        Notes = "Sample opening slot"
      }); //3 hours -> 6 as
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 16),
        StartTime = new TimeSpan(14, 00, 0),
        EndTime = new TimeSpan(15, 00, 0),
        Type = "opening",
        Notes = "Sample opening slot"
      }); //1 hour -> 2 as
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 16),
        StartTime = new TimeSpan(15, 0, 0),
        EndTime = new TimeSpan(16, 0, 0),
        Type = "appointment",
        Notes = "Sample appointment slot"
       });
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 17),
        StartTime = new TimeSpan(16, 00, 0),
        EndTime = new TimeSpan(16, 30, 0),
        Type = "opening",
        Notes = "Sample opening slot"
      }); //30 minutes - 1 as
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 17),
        StartTime = new TimeSpan(16, 30, 0),
        EndTime = new TimeSpan(17, 0, 0),
        Type = "appointment",
        Notes = "Sample appointment slot"
      });
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 17),
        StartTime = new TimeSpan(17, 00, 0),
        EndTime = new TimeSpan(18, 10, 0),
        Type = "opening",
        Notes = "Sample opening slot"
      }); //1h 10' - 2 as
      sampleSlots.Add(new Slot
      {
        Day = new DateTime(2025, 9, 21),
        StartTime = new TimeSpan(9, 0, 0),
        EndTime = new TimeSpan(12, 0, 0),
        Type = "opening",
        Notes = "Sample opening slot"
      }); //3 hours -> 6 as

      return sampleSlots.Where(s => s.Day >= startTime.Date && s.Day <= startTime.AddDays(days)).ToList();

    }
  }
}
