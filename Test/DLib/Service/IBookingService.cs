using DLib.Model;

namespace DLib.Service
{
  public interface IBookingService
  {

    TimeSpan DefaultAppointmentDuration { get; set; }

    public List<AvailableSlot> GetAvailableSlots(DateTime startTime, int days = 7);
  }
}
