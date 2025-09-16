// See https://aka.ms/new-console-template for more information
using DLib.Repository;
using DLib.Service;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;


var serviceProvider = new ServiceCollection()
           .AddLogging()
           .AddSingleton<IAppointmentsRepository, AppointmentsRepository>()
           .AddSingleton<IBookingService, BookingService>()
           .BuildServiceProvider();

//do the actual work here
var bookingSvc = serviceProvider.GetService<IBookingService>();
var res = bookingSvc.GetAvailableSlots(new DateTime(2025, 9, 16), 10);



Console.WriteLine("Hello, World!");
