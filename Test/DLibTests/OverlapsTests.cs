using DLib.Model;
using Microsoft.VisualStudio.TestTools.UnitTesting;
using System;

namespace DoctorSlots.Tests
{
  [TestClass]
  public class OverlapTests
  {
    private Event MakeEvent(int startHour, int endHour) =>
        new Event
        {
          Day = new DateTime(2025, 9, 21),
          StartTime = new TimeSpan(startHour, 0, 0),
          EndTime = new TimeSpan(endHour, 0, 0),
          Kind = EvKind.Appointment
        };

    private bool IsOverlapping(Event app, Event slot)
    {
      var appStart = app.StartTime;
      var appEnd = app.EndTime;
      var slotStart = slot.StartTime;
      var slotEnd = slot.EndTime;
      return appStart < slotEnd && slotStart < appEnd;
    }

    [TestMethod]
    public void Overlap_PartialAtStart_ReturnsTrue()
    {
      var app = MakeEvent(9, 11);
      var slot = MakeEvent(10, 12);
      Assert.IsTrue(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void Overlap_PartialAtEnd_ReturnsTrue()
    {
      var app = MakeEvent(10, 12);
      var slot = MakeEvent(9, 11);
      Assert.IsTrue(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void Overlap_OneInsideTheOther_ReturnsTrue()
    {
      var app = MakeEvent(10, 12);
      var slot = MakeEvent(9, 13);
      Assert.IsTrue(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void Overlap_IdenticalIntervals_ReturnsTrue()
    {
      var app = MakeEvent(9, 12);
      var slot = MakeEvent(9, 12);
      Assert.IsTrue(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void NoOverlap_AppBeforeSlot_ReturnsFalse()
    {
      var app = MakeEvent(8, 9);
      var slot = MakeEvent(9, 12);
      Assert.IsFalse(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void NoOverlap_AppAfterSlot_ReturnsFalse()
    {
      var app = MakeEvent(12, 13);
      var slot = MakeEvent(9, 12);
      Assert.IsFalse(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void TouchingBoundaries_AppEndsWhenSlotStarts_ReturnsFalse()
    {
      var app = MakeEvent(8, 9);
      var slot = MakeEvent(9, 10);
      Assert.IsFalse(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void TouchingBoundaries_SlotEndsWhenAppStarts_ReturnsFalse()
    {
      var app = MakeEvent(9, 10);
      var slot = MakeEvent(8, 9);
      Assert.IsFalse(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void Overlap_LongAppShortSlotInside_ReturnsTrue()
    {
      var app = MakeEvent(8, 12);
      var slot = MakeEvent(9, 10);
      Assert.IsTrue(IsOverlapping(app, slot));
    }

    [TestMethod]
    public void Overlap_ShortAppLongSlotInside_ReturnsTrue()
    {
      var app = MakeEvent(9, 10);
      var slot = MakeEvent(8, 12);
      Assert.IsTrue(IsOverlapping(app, slot));
    }
  }
}
