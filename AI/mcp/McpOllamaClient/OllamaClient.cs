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

    public async Task<OllamaResponse> ChatAsyncStream(
    List<OllamaMessage> messages,
    List<McpTool> tools)
    {
      var request = new
      {
        model = _model,
        messages = messages,
        tools = ConvertToOllamaTools(tools),
        stream = true // Impostato a true per abilitare lo streaming
      };

      var json = JsonSerializer.Serialize(request, new JsonSerializerOptions
      {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
      });

      var content = new StringContent(json, Encoding.UTF8, "application/json");

      // Invia la richiesta e specifica di leggere solo gli header prima
      var httpRequestMessage = new HttpRequestMessage(HttpMethod.Post, "/api/chat")
      {
        Content = content
      };
      var response = await _httpClient.SendAsync(httpRequestMessage, HttpCompletionOption.ResponseHeadersRead);

      response.EnsureSuccessStatusCode();

      var fullContent = new StringBuilder();
      var toolCalls = new List<OllamaToolCall>();

      // Leggi lo stream di dati
      using (var stream = await response.Content.ReadAsStreamAsync())
      using (var reader = new StreamReader(stream))
      {
        while (!reader.EndOfStream)
        {
          var line = await reader.ReadLineAsync();
          if (string.IsNullOrWhiteSpace(line))
          {
            continue;
          }

          // Deserializza ogni singolo "chunk" della risposta
          var chunk = JsonSerializer.Deserialize<OllamaStreamResponseChunk>(line);

          if (chunk?.Message?.Content != null)
          {
            // Scrivi il pezzo di testo ricevuto direttamente in console
            Console.Write(chunk.Message.Content);
            fullContent.Append(chunk.Message.Content);
          }

          if (chunk?.Message?.ToolCalls != null && chunk.Message.ToolCalls.Any())
          {
            toolCalls.AddRange(chunk.Message.ToolCalls);
          }
        }
      }

      // Aggiunge una nuova riga alla fine per pulizia della console
      Console.WriteLine();

      return new OllamaResponse
      {
        Content = fullContent.ToString(),
        ToolCalls = toolCalls.Any() ? toolCalls : null
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
        stream = false
      };

      var json = JsonSerializer.Serialize(request, new JsonSerializerOptions
      {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
      });

      var content = new StringContent(json, Encoding.UTF8, "application/json");
      var response = await _httpClient.PostAsync("/api/chat", content);

      response.EnsureSuccessStatusCode();

      var responseJson = await response.Content.ReadAsStringAsync();

      Console.WriteLine(responseJson);

      var ollamaResponse = JsonSerializer.Deserialize<OllamaApiResponse>(responseJson);

      return new OllamaResponse
      {
        Content = ollamaResponse?.Message?.Content ?? "",
        ToolCalls = ollamaResponse?.Message?.ToolCalls
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
