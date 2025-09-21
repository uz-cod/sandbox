using DLib.Model;
using DLib.Repository;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Service
{
  public class BookingService : IBookingService
  {

    public TimeSpan DefaultAppointmentDuration { get; set; } = TimeSpan.FromMinutes(30);

    IAppointmentsRepository _AppointmentsRepository;

    public BookingService(IAppointmentsRepository appointmentsRepository)
    {
      _AppointmentsRepository = appointmentsRepository;
    }

    public List<Event> GetAvailableSlots(DateTime startTime, int days = 7)
    {

      //return GetAvailableSlotsV2(startDay: startTime, days: days);

      //all slots from repository
      var events = _AppointmentsRepository.Events;

      List<Event> slots = new List<Event>();
      var openings = events.Where(s => s.Kind == "opening").ToList();
      var appointments = events.Where(s => s.Kind == "appointment").ToList();

      List<Event> availableSlots = new List<Event>();

      int count = 0;
      foreach (var opening in openings)
      {
        var currentStartTime = opening.StartTime;
        while (currentStartTime.Add(DefaultAppointmentDuration) <= opening.EndTime)
        {
          count++;
          var e = new Event
          {
            Day = opening.Day,
            StartTime = currentStartTime,
            EndTime = currentStartTime.Add(DefaultAppointmentDuration),
            Kind = "available",
            Notes = $"Available slot #{count}"
          };

          slots.Add(e);

          Console.WriteLine($"added available slot #{count} [{e.StartTime}-{e.EndTime}]");
          currentStartTime = currentStartTime.Add(DefaultAppointmentDuration);
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


    public List<Event> GetAvailableSlotsV2(DateTime startDay, int days = 7)
    {
      var events = _AppointmentsRepository.Events;

      // Separiamo subito openings e appointments per giorno
      var openingsByDay = events
          .Where(e => e.Kind == "opening")
          .GroupBy(e => e.Day.Date)
          .ToDictionary(g => g.Key, g => g.ToList());

      var appointmentsByDay = events
          .Where(e => e.Kind == "appointment")
          .GroupBy(e => e.Day.Date)
          .ToDictionary(g => g.Key, g => g.ToList());

      var availableSlots = new List<Event>();
      int count = 0;

      foreach (var kvp in openingsByDay)
      {
        var day = kvp.Key;
        var openings = kvp.Value;
        appointmentsByDay.TryGetValue(day, out var appointments);

        foreach (var opening in openings)
        {
          var openingStart = day + opening.StartTime;
          var openingEnd = day + opening.EndTime;

          for (var currentStart = openingStart;
               currentStart.Add(DefaultAppointmentDuration) <= openingEnd;
               currentStart = currentStart.Add(DefaultAppointmentDuration))
          {
            var slot = new Event
            {
              Day = day,
              StartTime = currentStart.TimeOfDay,
              EndTime = currentStart.Add(DefaultAppointmentDuration).TimeOfDay,
              Kind = "available",
              Notes = $"Available slot #{++count}"
            };

            // Skip overlap check if no appointments that day
            if (appointments == null || !appointments.Any(app => IsOverlapping(app, slot)))
            {
              availableSlots.Add(slot);
            }
          }
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
