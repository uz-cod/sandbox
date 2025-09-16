using DLib.Model;
using DLib.Repository;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Service
{
  internal partial class BookingService : IBookingService
  {

    private readonly TimeSpan AppointmentDuration = TimeSpan.FromMinutes(30);

    IAppointmentsRepository _AppointmentsRepository;

    public BookingService(IAppointmentsRepository appointmentsRepository)
    {
      _AppointmentsRepository = appointmentsRepository;
    }

    public List<Slot> GetAvailableSlots(DateTime startTime, int days = 7)
    {

      //all slots from repository
      var allSlots = _AppointmentsRepository.GetSlots(startTime, days);

      List<Slot> availableSlots = new List<Slot>();
      var openingSlots = allSlots.Where(s => s.Type == "opening");

      int count = 0;
      foreach (var item in openingSlots)
      {
        //divide into 30 min slots
        var currentStartTime = item.StartTime;
        while (currentStartTime.Add(TimeSpan.FromMinutes(AppointmentDuration.Minutes)) < item.EndTime)
        {
          count++;
          var s = new Slot
          {
            Day = item.Day,
            StartTime = currentStartTime,
            EndTime = currentStartTime.Add(TimeSpan.FromMinutes(AppointmentDuration.Minutes)),
            Type = "available",
            Notes = $"Available slot #{count}"
          };
          availableSlots.Add(s);

          Console.WriteLine($"added available slot #{count} [{s.StartTime}-{s.EndTime}]");
          currentStartTime = currentStartTime.Add(AppointmentDuration);
        }
      }

      return availableSlots;
    }
  }
}
