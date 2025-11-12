using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace McpOllamaClient
{
  public class OllamaClient : IDisposable
  {
    private readonly HttpClient _httpClient;
    private string _model;

    public OllamaClient(string url, string model)
    {
      _model = model;
      _httpClient = new HttpClient
      {
        BaseAddress = new Uri(url),
        Timeout = TimeSpan.FromMinutes(3)
      };
    }

    public async Task<OllamaResponse> ChatAsync(
    List<OllamaMessage> messages,
    List<McpTool> tools)
    {
      var request = new
      {
        model = _model,
        messages = messages,
        tools = ConvertToOllamaTools(tools),
        stream = true
      };

      var json = JsonSerializer.Serialize(request, new JsonSerializerOptions
      {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
      });

      var content = new StringContent(json, Encoding.UTF8, "application/json");

      var httpRequestMessage = new HttpRequestMessage(HttpMethod.Post, "/api/chat")
      {
        Content = content
      };

      var response = await _httpClient.SendAsync(httpRequestMessage, HttpCompletionOption.ResponseHeadersRead);

      if (response.StatusCode != System.Net.HttpStatusCode.OK)
      {
        var resKO = await response.Content.ReadAsStringAsync();
        Console.WriteLine(resKO);
        return new OllamaResponse
        {
          Content = resKO
        };
      }

      response.EnsureSuccessStatusCode();
      // --- Fine spinner connessione ---

      var fullContent = new StringBuilder();
      var toolCalls = new List<OllamaToolCall>();

      // Leggi lo stream
      using (var stream = await response.Content.ReadAsStreamAsync())
      using (var reader = new StreamReader(stream))
      {
        string? line;

        // Loop finché lo stream non è finito
        while (true)
        {
          line = await reader.ReadLineAsync();

          // Se la riga è null, lo stream è terminato
          if (line == null)
          {
            break;
          }

          if (string.IsNullOrWhiteSpace(line))
          {
            continue;
          }

          // Deserializza e scrivi (SENZA spinner attivo)
          var chunk = JsonSerializer.Deserialize<OllamaStreamResponseChunk>(line);

          if (chunk?.Message?.Content != null)
          {
            Console.Write(chunk.Message.Content);
            fullContent.Append(chunk.Message.Content);
          }

          if (chunk?.Message?.ToolCalls != null && chunk.Message.ToolCalls.Any())
          {
            toolCalls.AddRange(chunk.Message.ToolCalls);
          }
        }
      }

      Console.WriteLine(); // Aggiunge una nuova riga alla fine

      return new OllamaResponse
      {
        Content = fullContent.ToString(),
        ToolCalls = toolCalls.Any() ? toolCalls : null
      };
    }


    private List<object> ConvertToOllamaTools(List<McpTool> mcpTools)
    {
      return mcpTools.Select(t => new
      {
        type = "function",
        function = new
        {
          name = t.Name,
          description = t.Description,
          parameters = t.InputSchema
        }
      }).Cast<object>().ToList();
    }

    public void Dispose()
    {
      _httpClient?.Dispose();
    }
  }
}
