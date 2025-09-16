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

    public List<Event> GetAvailableSlots(DateTime startTime, int days = 7)
    {

      //all slots from repository
      var events = _AppointmentsRepository.GetEvents(startTime, days);

      List<Event> slots = new List<Event>();
      var openings = events.Where(s => s.Kind == "opening").ToList();
      var appointments = events.Where(s => s.Kind == "appointment").ToList();

      List<Event> availableSlots = new List<Event>();

      int count = 0;
      foreach (var opening in openings)
      {
        //divide into 30 min slots
        var currentStartTime = opening.StartTime;
        while (currentStartTime.Add(TimeSpan.FromMinutes(AppointmentDuration.Minutes)) <= opening.EndTime)
        {
          count++;
          var e = new Event
          {
            Day = opening.Day,
            StartTime = currentStartTime,
            EndTime = currentStartTime.Add(TimeSpan.FromMinutes(AppointmentDuration.Minutes)),
            Kind = "available",
            Notes = $"Available slot #{count}"
          };

          slots.Add(e);

          Console.WriteLine($"added available slot #{count} [{e.StartTime}-{e.EndTime}]");
          currentStartTime = currentStartTime.Add(AppointmentDuration);
        }
      }

      //rimozione slot in overlap con appuntamenti del giorno
      foreach (var slot in slots)
      {
        if (appointments.Where(a => a.Day == slot.Day).Count(app => IsOverlapping(app, slot)) == 0)
        {
          availableSlots.Add(slot);
        }
      }

      return availableSlots;
    }


    bool IsOverlapping(Event app, Event slot)
    {

      var appStart = app.StartTime;
      var appEnd = app.EndTime;

      var slotStart = slot.StartTime;
      var slotEnd = slot.EndTime;

      //l’appuntamento inizia prima che finisca lo slot
      //e lo slot inizia prima che finisca l’appuntamento

      bool isOverlapping = appStart < slotEnd && slotStart < appEnd;

      return isOverlapping;
    }


  }
}
