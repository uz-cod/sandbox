using DLib.Model;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DLib.Repository
{
  internal interface IAppointmentsRepository
  {
    List<Event> GetEvents(DateTime startTime, int days = 7);

  }
}
