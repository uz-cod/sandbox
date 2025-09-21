using DLib.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Repository
{
  public interface IAppointmentsRepository
  {

    List<Event> Events { get; set; }
 //   List<Event> GetEvents(DateTime startTime, int days = 7);

  }
}
