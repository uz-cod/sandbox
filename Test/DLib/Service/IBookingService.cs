using DLib.Model;

namespace DLib.Service
{
  public interface IBookingService
  {
    public List<Event> GetAvailableSlots(DateTime startTime, int days = 7);
  }
}
