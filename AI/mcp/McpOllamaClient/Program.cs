using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;


namespace McpOllamaClient;

class Program
{
  private const string OLLAMA_URL = "http://localhost:11434";
  private const string OLLAMA_MODEL = "llama3.2"; // Modello con tool calling

  static async Task Main(string[] args)
  {
    Console.WriteLine("=== MCP Client con Ollama + SQL Server ===\n");

    // Path del server MCP SQL (modifica secondo il tuo ambiente)
    var mcpServerPath = @"C:\dev\MCP\SQL-AI-samples\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0\MssqlMcp.exe";
    var connectionString = "User ID=lyra;Password=Lyra_!_DAJETUTTA2025;Server=SRVW16DB1;Initial Catalog=ls_softeam;TrustServerCertificate=True";

    var orchestrator = new McpOllamaOrchestrator(mcpServerPath, connectionString);
    await orchestrator.InitializeAsync();

    Console.WriteLine("\nClient pronto. Scrivi 'exit' per uscire.\n");

    while (true)
    {
      Console.Write("Tu: ");
      var userInput = Console.ReadLine();

      if (string.IsNullOrWhiteSpace(userInput) || userInput.ToLower() == "exit")
        break;

      await orchestrator.ProcessUserQueryAsync(userInput);
    }

    await orchestrator.DisposeAsync();
  }
}

// ==================== ORCHESTRATORE ====================
public class McpOllamaOrchestrator : IAsyncDisposable
{
  private readonly McpClient _mcpClient;
  private readonly OllamaClient _ollamaClient;
  private List<McpTool> _availableTools = new();

  public McpOllamaOrchestrator(string mcpServerPath, string connectionString)
  {
    _mcpClient = new McpClient(mcpServerPath, connectionString);
    _ollamaClient = new OllamaClient();
  }

  public async Task InitializeAsync()
  {
    Console.WriteLine("Avvio MCP Server...");
    await _mcpClient.ConnectAsync();

    Console.WriteLine("Recupero tools disponibili...");
    _availableTools = await _mcpClient.GetToolsAsync();

    Console.WriteLine($"Tools disponibili: {_availableTools.Count}");
    foreach (var tool in _availableTools)
    {
      Console.WriteLine($"  - {tool.Name}: {tool.Description}");
    }
  }

  public async Task ProcessUserQueryAsync(string userQuery)
  {
    var conversationHistory = new List<OllamaMessage>
        {
            new OllamaMessage { Role = "user", Content = userQuery }
        };

    const int maxIterations = 5;
    for (int i = 0; i < maxIterations; i++)
    {
      var response = await _ollamaClient.ChatAsync("mistral", conversationHistory, _availableTools);

      // Aggiungi risposta assistente alla cronologia
      conversationHistory.Add(new OllamaMessage
      {
        Role = "assistant",
        Content = response.Content,
        ToolCalls = response.ToolCalls
      });

      // Se non ci sono tool calls, siamo alla risposta finale
      if (response.ToolCalls == null || response.ToolCalls.Count == 0)
      {
        Console.WriteLine($"\nAssistente: {response.Content}\n");
        break;
      }

      // Esegui i tool calls
      Console.WriteLine($"\n[Eseguo {response.ToolCalls.Count} tool call(s)...]");
      foreach (var toolCall in response.ToolCalls)
      {
        Console.WriteLine($"  Tool: {toolCall.Function.Name}");

        var toolResult = await _mcpClient.ExecuteToolAsync(
            toolCall.Function.Name,
            toolCall.Function.Arguments
        );

        // Aggiungi risultato alla cronologia
        conversationHistory.Add(new OllamaMessage
        {
          Role = "tool",
          Content = toolResult
        });
      }
    }
  }

  public async ValueTask DisposeAsync()
  {
    await _mcpClient.DisconnectAsync();
    _ollamaClient.Dispose();
  }
}

// ==================== MCP CLIENT (STDIO) ====================
public class McpClient
{
  private Process? _process;
  private StreamWriter? _stdin;
  private StreamReader? _stdout;
  private readonly string _serverPath;
  private readonly string _connectionString;

  public McpClient(string serverPath, string connectionString)
  {
    _serverPath = serverPath;
    _connectionString = connectionString;
  }

  public async Task ConnectAsync()
  {
    _process = new Process
    {
      StartInfo = new ProcessStartInfo
      {
        FileName = _serverPath,
        Arguments = $"--connection-string \"{_connectionString}\"",
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
      }
    };

    _process.Start();
    _stdin = _process.StandardInput;
    _stdout = _process.StandardOutput;

    // Inizializzazione MCP (handshake)
    await SendRequestAsync("initialize", new { protocolVersion = "2024-11-05" });
    await SendNotificationAsync("initialized", new { });
  }

  public async Task<List<McpTool>> GetToolsAsync()
  {
    var response = await SendRequestAsync("tools/list", new { });

    var toolsResponse = JsonSerializer.Deserialize<McpToolsResponse>(response);
    return toolsResponse?.ResTools.Tools ?? new List<McpTool>();
  }

  public async Task<string> ExecuteToolAsync(string toolName, Dictionary<string, object> arguments)
  {
    var response = await SendRequestAsync("tools/call", new
    {
      name = toolName,
      arguments = arguments
    });

    var result = JsonSerializer.Deserialize<McpToolResult>(response);

    if (result?.Content != null && result.Content.Count > 0)
    {
      return result.Content[0].Text ?? "";
    }

    return "Nessun risultato";
  }

  private async Task<string> SendRequestAsync(string method, object paramsObj)
  {
    var request = new
    {
      jsonrpc = "2.0",
      id = Guid.NewGuid().ToString(),
      method = method,
      @params = paramsObj
    };

    var json = JsonSerializer.Serialize(request);
    await _stdin!.WriteLineAsync(json);
    await _stdin.FlushAsync();

    var responseLine = await _stdout!.ReadLineAsync();
    return responseLine ?? "{}";
  }

  private async Task SendNotificationAsync(string method, object paramsObj)
  {
    var notification = new
    {
      jsonrpc = "2.0",
      method = method,
      @params = paramsObj
    };

    var json = JsonSerializer.Serialize(notification);
    await _stdin!.WriteLineAsync(json);
    await _stdin.FlushAsync();
  }

  public async Task DisconnectAsync()
  {
    if (_process != null && !_process.HasExited)
    {
      _stdin?.Close();
      _stdout?.Close();
      _process.Kill();
      await _process.WaitForExitAsync();
    }
  }
}

// ==================== OLLAMA CLIENT ====================
public class OllamaClient : IDisposable
{
  private readonly HttpClient _httpClient;

  public OllamaClient()
  {
    _httpClient = new HttpClient
    {
      BaseAddress = new Uri(OLLAMA_URL.Value),
      Timeout = TimeSpan.FromMinutes(2)
    };
  }

  public async Task<OllamaResponse> ChatAsync(
      string model,
      List<OllamaMessage> messages,
      List<McpTool> tools)
  {
    var request = new
    {
      model = model,
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

// ==================== MODELLI DATI ====================
public class McpTool
{
  [JsonPropertyName("name")]
  public string Name { get; set; } = "";

  [JsonPropertyName("description")]
  public string Description { get; set; } = "";

  [JsonPropertyName("inputSchema")]
  public Dictionary<string, object> InputSchema { get; set; } = new();
}


public class McpToolsResponse
{
  [JsonPropertyName("result")]
  public McpToolsResponseTools ResTools { get; set; } = new();
}

public class McpToolsResponseTools
{
  [JsonPropertyName("tools")]
  public List<McpTool> Tools { get; set; } = new();
}


public class McpToolResult
{
  [JsonPropertyName("content")]
  public List<McpContent> Content { get; set; } = new();
}

public class McpContent
{
  [JsonPropertyName("type")]
  public string Type { get; set; } = "";

  [JsonPropertyName("text")]
  public string? Text { get; set; }
}

public class OllamaMessage
{
  [JsonPropertyName("role")]
  public string Role { get; set; } = "";

  [JsonPropertyName("content")]
  public string Content { get; set; } = "";

  [JsonPropertyName("tool_calls")]
  public List<OllamaToolCall>? ToolCalls { get; set; }
}

public class OllamaToolCall
{
  [JsonPropertyName("function")]
  public OllamaFunction Function { get; set; } = new();
}

public class OllamaFunction
{
  [JsonPropertyName("name")]
  public string Name { get; set; } = "";

  [JsonPropertyName("arguments")]
  public Dictionary<string, object> Arguments { get; set; } = new();
}

public class OllamaResponse
{
  public string Content { get; set; } = "";
  public List<OllamaToolCall>? ToolCalls { get; set; }
}

public class OllamaApiResponse
{
  [JsonPropertyName("message")]
  public OllamaMessage? Message { get; set; }
}

// Costanti per Ollama
static class OLLAMA_URL
{
  public const string Value = "http://localhost:11434";
}

