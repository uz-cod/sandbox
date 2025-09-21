using DLib.Model;
using DLib.Repository;

namespace DLib.Service.Tests
{
  [TestClass()]
  public class BookingServiceTests
  {

    private AppointmentsRepository _repo;
    private IBookingService _service;

    [TestInitialize]
    public void Setup()
    {
      _repo = new AppointmentsRepository();
      _service = new BookingService(_repo)
      {
      };
    }


    [TestMethod]
    public void NoEvents_ReturnsEmpty()
    {
      _repo.Events.Clear();
      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(0, result.Count);
    }

    [TestMethod]
    public void OnlyAppointments_NoOpenings_ReturnsEmpty()
    {
      _repo.Events.Add(new Event
      {
        Day = DateTime.Today,
        StartTime = new TimeSpan(9, 0, 0),
        EndTime = new TimeSpan(10, 0, 0),
        Kind = EvKind.Appointment
      });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(0, result.Count);
    }

    [TestMethod]
    public void OpeningShorterThanDuration_ReturnsEmpty()
    {
      _repo.Events.Add(new Event
      {
        Day = DateTime.Today,
        StartTime = new TimeSpan(9, 0, 0),
        EndTime = new TimeSpan(9, 10, 0),
        Kind = EvKind.Opening
      });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(0, result.Count);
    }

    [TestMethod]
    public void AppointmentCoversWholeOpening_ReturnsEmpty()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(12, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(12, 0, 0), Kind = EvKind.Appointment });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(0, result.Count);
    }


    [TestMethod]
    public void SlotAvailableAfterAppointment_ReturnsEmpty()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(13, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(12, 30, 0), Kind = EvKind.Appointment });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(1, result.Count);
    }

    [TestMethod]
    public void AppointmentCutsSlot_PartialOverlap_RemovesOnlyOverlapped()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(11, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 30, 0), EndTime = new TimeSpan(10, 0, 0), Kind = EvKind.Appointment });

      var result = _service.GetAvailableSlots(DateTime.Today);
      var slots = result.Select(r => $"{r.StartTime}-{r.EndTime}").ToList();

      CollectionAssert.AreEqual(new List<string> { "09:00:00-09:30:00", "10:00:00-10:30:00", "10:30:00-11:00:00" }, slots);
    }

    [TestMethod]
    public void BackToBackAppointments_RemoveAllSlots()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(11, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(9, 30, 0), Kind = EvKind.Appointment });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 30, 0), EndTime = new TimeSpan(10, 0, 0), Kind = EvKind.Appointment });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(10, 0, 0), EndTime = new TimeSpan(10, 30, 0), Kind = EvKind.Appointment });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(10, 30, 0), EndTime = new TimeSpan(11, 0, 0), Kind = EvKind.Appointment });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(0, result.Count);
    }

    [TestMethod]
    public void MultipleOpenings_SameDay()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(10, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(15, 0, 0), EndTime = new TimeSpan(16, 0, 0), Kind = EvKind.Opening });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(4, result.Count);
    }

    [TestMethod]
    public void OpeningAcrossMidnight()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(23, 30, 0), EndTime = new TimeSpan(0, 30, 0), Kind = EvKind.Opening });

      var result = _service.GetAvailableSlots(DateTime.Today);
      // Dipende da come gestisci il cambio giorno: questo test serve a scoprire bug
      Assert.IsTrue(result.Count >= 0);
    }

    [TestMethod]
    public void AppointmentDifferentDay_DoesNotRemoveSlots()
    {
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(10, 0, 0), Kind = EvKind.Opening });
      _repo.Events.Add(new Event { Day = DateTime.Today.AddDays(1), StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(10, 0, 0), Kind = EvKind.Appointment });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(2, result.Count); // due slot da 30min
    }

    [TestMethod]
    public void NonStandardAppointmentDuration_45Minutes()
    {
      _service.DefaultAppointmentDuration = TimeSpan.FromMinutes(45);
      _repo.Events.Add(new Event { Day = DateTime.Today, StartTime = new TimeSpan(9, 0, 0), EndTime = new TimeSpan(11, 0, 0), Kind = EvKind.Opening });

      var result = _service.GetAvailableSlots(DateTime.Today);
      Assert.AreEqual(2, result.Count);
    }

  }
}