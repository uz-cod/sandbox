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

    public List<AvailableSlot> GetAvailableSlots(DateTime startTime, int days = 7)
    {
      //all slots from repository
      var events = _AppointmentsRepository.Events;

      List<AvailableSlot> slots = new List<AvailableSlot>();
      var openings = events.OfType<Opening>().ToList();
      var appointments = events.OfType<Appointment>().ToList();

      List<AvailableSlot> availableSlots = new List<AvailableSlot>();

      int count = 0;
      foreach (var opening in openings)
      {
        var currentStartTime = opening.StartTime;
        while (currentStartTime.Add(DefaultAppointmentDuration) <= opening.EndTime)
        {
          count++;
          var e = new AvailableSlot
          {
            Day = opening.Day,
            StartTime = currentStartTime,
            EndTime = currentStartTime.Add(DefaultAppointmentDuration),
           // Kind = EvKind.AvailableSlot,
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


    public List<AvailableSlot> GetAvailableSlotsV2(DateTime startDay, int days = 7)
    {
      var events = _AppointmentsRepository.Events;

      // Separiamo subito openings e appointments per giorno
      var openingsByDay = events
          .OfType<Opening>()
          .GroupBy(e => e.Day.Date)
          .ToDictionary(g => g.Key, g => g.ToList());

      var appointmentsByDay = events
          .OfType<Appointment>() 
          .GroupBy(e => e.Day.Date)
          .ToDictionary(g => g.Key, g => g.ToList());

      var availableSlots = new List<AvailableSlot>();
      int count = 0;

      foreach (var kvp in openingsByDay)
      {
        var day = kvp.Key;
        var openings = kvp.Value;
        // appointmentsByDay.TryGetValue(day, out var appointments);
        var appointments = appointmentsByDay[day];

        foreach (var opening in openings)
        {
          var openingStart = day + opening.StartTime;
          var openingEnd = day + opening.EndTime;

          for (var currentStart = openingStart;
               currentStart.Add(DefaultAppointmentDuration) <= openingEnd;
               currentStart = currentStart.Add(DefaultAppointmentDuration))
          {
            var slot = new AvailableSlot
            {
              Day = day,
              StartTime = currentStart.TimeOfDay,
              EndTime = currentStart.Add(DefaultAppointmentDuration).TimeOfDay,
            //  Kind = EvKind.AvailableSlot,
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
