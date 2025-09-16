using DLib.Model;

namespace DLib.Service
{
  public interface IBookingService
  {
    public List<Slot> GetAvailableSlots(DateTime startTime, int days = 7);
  }
}
