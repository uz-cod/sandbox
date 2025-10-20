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
        Timeout = TimeSpan.FromMinutes(2)
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
