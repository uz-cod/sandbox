// See https://aka.ms/new-console-template for more information
using DLib.Repository;
using DLib.Service;
using Microsoft.Extensions.DependencyInjection;

var serviceProvider = new ServiceCollection()
                      .AddLogging()
                      .AddSingleton<IAppointmentsRepository, AppointmentsRepository>()
                      .AddSingleton<IBookingService, BookingService>()
                      .BuildServiceProvider();


var repo = serviceProvider.GetRequiredService<IAppointmentsRepository>();
repo.Events = (repo as AppointmentsRepository).SampleEvents;

var bookingSvc = serviceProvider.GetService<IBookingService>();

var res = bookingSvc.GetAvailableSlots(new DateTime(2025, 9, 16), 0);

var resGrouped = res.GroupBy(x => x.Day).ToList();

foreach (var item in resGrouped)
{
  Console.WriteLine($"day: {item.Key.Date} => {string.Join(",", item.Select(x => $"{x.StartTime}-{x.EndTime}").ToList()) } ");
}


Console.WriteLine("Hello, World!");
