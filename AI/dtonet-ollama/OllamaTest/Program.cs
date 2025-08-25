using System.Net.Http;
using System.Text;
using System.Text.Json;

class Program
{
  static async Task Main()
  {
    var client = new HttpClient();

    var request = new
    {
      model = "mistral",
      prompt = "Scrivi un haiku sui cani"
    };

    var json = JsonSerializer.Serialize(request);
    var content = new StringContent(json, Encoding.UTF8, "application/json");

    var response = await client.PostAsync("http://localhost:11434/api/generate", content);
    var result = await response.Content.ReadAsStringAsync();

    Console.WriteLine(result);
  }
}
