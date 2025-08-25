using System.Net.Http;
using System.Net.Http.Json;
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

    //var json = JsonSerializer.Serialize(request);
    //var content = new StringContent(json, Encoding.UTF8, "application/json");


    Console.WriteLine($"creazione haiku canino...");
    var response = await client.PostAsJsonAsync("http://localhost:11434/api/generate", request);

    await using var stream = await response.Content.ReadAsStreamAsync();
    using var reader = new StreamReader(stream);

    string fullOutput = "";

    while (!reader.EndOfStream)
    {
      var line = await reader.ReadLineAsync();
      if (string.IsNullOrWhiteSpace(line)) continue;

      var doc = JsonDocument.Parse(line);
      var chunk = doc.RootElement.GetProperty("response").GetString();
      fullOutput += chunk;
      Console.Write(chunk);

      if (doc.RootElement.TryGetProperty("done", out var done) && done.GetBoolean())
        break;
    }

    Console.WriteLine($"fine!");
  }
}
