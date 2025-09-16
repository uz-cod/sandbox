using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace McpSqlClient
{
  // Modelli per il protocollo JSON-RPC
  public class JsonRpcRequest
  {
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString();

    [JsonPropertyName("method")]
    public string Method { get; set; }

    [JsonPropertyName("params")]
    public object? Params { get; set; }
  }

  public class JsonRpcResponse<T>
  {
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("id")]
    public string Id { get; set; }

    [JsonPropertyName("result")]
    public T? Result { get; set; }

    [JsonPropertyName("error")]
    public JsonRpcError? Error { get; set; }
  }

  public class JsonRpcError
  {
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; }

    [JsonPropertyName("data")]
    public object? Data { get; set; }
  }

  // Modelli specifici MCP
  public class InitializeParams
  {
    [JsonPropertyName("protocolVersion")]
    public string ProtocolVersion { get; set; } = "2024-11-05";

    [JsonPropertyName("capabilities")]
    public ClientCapabilities Capabilities { get; set; } = new();

    [JsonPropertyName("clientInfo")]
    public ClientInfo ClientInfo { get; set; } = new();
  }

  public class ClientCapabilities
  {
    [JsonPropertyName("tools")]
    public ToolCapabilities? Tools { get; set; } = new();
  }

  public class ToolCapabilities
  {
    [JsonPropertyName("listChanged")]
    public bool ListChanged { get; set; } = true;
  }

  public class ClientInfo
  {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "MCP SQL Client";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0.0";
  }

  public class InitializeResult
  {
    [JsonPropertyName("protocolVersion")]
    public string ProtocolVersion { get; set; }

    [JsonPropertyName("capabilities")]
    public ServerCapabilities Capabilities { get; set; }

    [JsonPropertyName("serverInfo")]
    public ServerInfo ServerInfo { get; set; }
  }

  public class ServerCapabilities
  {
    [JsonPropertyName("tools")]
    public ToolsCapability? Tools { get; set; }
  }

  public class ToolsCapability
  {
    [JsonPropertyName("listChanged")]
    public bool ListChanged { get; set; }
  }

  public class ServerInfo
  {
    [JsonPropertyName("name")]
    public string Name { get; set; }

    [JsonPropertyName("version")]
    public string Version { get; set; }
  }

  public class Tool
  {
    [JsonPropertyName("name")]
    public string Name { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("inputSchema")]
    public JsonElement InputSchema { get; set; }
  }

  public class ToolsListResult
  {
    [JsonPropertyName("tools")]
    public List<Tool> Tools { get; set; } = new();
  }

  public class CallToolParams
  {
    [JsonPropertyName("name")]
    public string Name { get; set; }

    [JsonPropertyName("arguments")]
    public Dictionary<string, object>? Arguments { get; set; }
  }

  public class ToolResult
  {
    [JsonPropertyName("content")]
    public List<TextContent> Content { get; set; } = new();

    [JsonPropertyName("isError")]
    public bool IsError { get; set; }
  }

  public class TextContent
  {
    [JsonPropertyName("type")]
    public string Type { get; set; } = "text";

    [JsonPropertyName("text")]
    public string Text { get; set; }
  }

  public class McpClient : IDisposable
  {
    private readonly Process _process;
    private readonly StreamWriter _stdin;
    private readonly StreamReader _stdout;
    private bool _initialized = false;

    public McpClient(string serverExecutable, string[] arguments)
    {
      var startInfo = new ProcessStartInfo
      {
        FileName = serverExecutable,
        Arguments = string.Join(" ", arguments),
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true
      };

      _process = new Process { StartInfo = startInfo };
      _process.Start();

      _stdin = _process.StandardInput;
      _stdout = _process.StandardOutput;
    }

    public async Task<InitializeResult> InitializeAsync()
    {
      var request = new JsonRpcRequest
      {
        Method = "initialize",
        Params = new InitializeParams()
      };

      var response = await SendRequestAsync<InitializeResult>(request);
      if (response.Result == null)
        throw new InvalidOperationException($"Initialize failed: {response.Error?.Message}");

      // Send initialized notification
      var initializedNotification = new JsonRpcRequest
      {
        Method = "notifications/initialized",
        Id = null // Notifications don't have ID
      };

      await SendNotificationAsync(initializedNotification);
      _initialized = true;

      return response.Result;
    }

    public async Task<ToolsListResult> ListToolsAsync()
    {
      if (!_initialized)
        throw new InvalidOperationException("Client not initialized");

      var request = new JsonRpcRequest
      {
        Method = "tools/list",
        Params = new { }
      };

      var response = await SendRequestAsync<ToolsListResult>(request);
      if (response.Result == null)
        throw new InvalidOperationException($"List tools failed: {response.Error?.Message}");

      return response.Result;
    }

    public async Task<ToolResult> CallToolAsync(string toolName, Dictionary<string, object>? arguments = null)
    {
      if (!_initialized)
        throw new InvalidOperationException("Client not initialized");

      var request = new JsonRpcRequest
      {
        Method = "tools/call",
        Params = new CallToolParams
        {
          Name = toolName,
          Arguments = arguments
        }
      };

      var response = await SendRequestAsync<ToolResult>(request);
      if (response.Result == null)
        throw new InvalidOperationException($"Call tool failed: {response.Error?.Message}");

      return response.Result;
    }

    private async Task<JsonRpcResponse<T>> SendRequestAsync<T>(JsonRpcRequest request)
    {
      var json = JsonSerializer.Serialize(request, new JsonSerializerOptions
      {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
      });

      await _stdin.WriteLineAsync(json);
      await _stdin.FlushAsync();

      var responseJson = await _stdout.ReadLineAsync();
      if (responseJson == null)
        throw new InvalidOperationException("No response received");

      return JsonSerializer.Deserialize<JsonRpcResponse<T>>(responseJson, new JsonSerializerOptions
      {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
      });
    }

    private async Task SendNotificationAsync(JsonRpcRequest notification)
    {
      var json = JsonSerializer.Serialize(notification, new JsonSerializerOptions
      {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
      });

      await _stdin.WriteLineAsync(json);
      await _stdin.FlushAsync();
    }

    public void Dispose()
    {
      _stdin?.Dispose();
      _stdout?.Dispose();
      _process?.Kill();
      _process?.Dispose();
    }
  }

  class Program
  {
    static async Task Main(string[] args)
    {
      Console.WriteLine("=== MCP SQL Server Client ===\n");

      // Configura qui il percorso del tuo server MCP SQL Server
      string serverExecutable = @"C:\dev\MCP\SQL-AI-samples\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0\MssqlMcp.exe"; // Sostituisci con il tuo server
      //string[] serverArgs = { "--db-path", "test.db" }; // Sostituisci con i parametri del tuo server
      string[] serverArgs = { };

      Environment.SetEnvironmentVariable("CONNECTION_STRING", "User ID=lyra;Password=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX;Server=SRVW16DB1;Initial Catalog=ls_softeam;TrustServerCertificate=True");

      try
      {
        using var client = new McpClient(serverExecutable, serverArgs);

        // 1. Inizializza la connessione
        Console.WriteLine("🔄 Initializing connection...");
        var initResult = await client.InitializeAsync();
        Console.WriteLine($"✅ Connected to: {initResult.ServerInfo.Name} v{initResult.ServerInfo.Version}");
        Console.WriteLine($"📋 Protocol version: {initResult.ProtocolVersion}\n");

        // 2. Lista i tool disponibili
        Console.WriteLine("🔍 Listing available tools...");
        var toolsList = await client.ListToolsAsync();
        Console.WriteLine($"Found {toolsList.Tools.Count} tools:");

        foreach (var tool in toolsList.Tools)
        {
          Console.WriteLine($"  - {tool.Name}: {tool.Description ?? "No description"}");
        }
        Console.WriteLine();

        // 3. Menu interattivo per testare i tool
        while (true)
        {
          Console.WriteLine("=== Test Menu ===");
          Console.WriteLine("1. List tables");
          Console.WriteLine("2. Execute query");
          Console.WriteLine("3. Describe table");
          Console.WriteLine("4. Custom tool call");
          Console.WriteLine("5. Exit");
          Console.Write("Select option (1-5): ");

          var choice = Console.ReadLine();
          Console.WriteLine();

          switch (choice)
          {
            case "1":
              await TestListTables(client);
              break;
            case "2":
              await TestReadData(client);
              break;
            case "3":
              await TestDescribeTable(client);
              break;
            case "4":
              await TestCustomToolCall(client, toolsList.Tools);
              break;
            case "5":
              Console.WriteLine("👋 Goodbye!");
              return;
            default:
              Console.WriteLine("❌ Invalid option. Please try again.");
              break;
          }

          Console.WriteLine("\nPress Enter to continue...");
          Console.ReadLine();
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Error: {ex.Message}");
        Console.WriteLine($"Stack trace: {ex.StackTrace}");
      }
    }

    private static async Task TestListTables(McpClient client)
    {
      try
      {
        Console.WriteLine("📋 Calling list_tables tool...");
        var result = await client.CallToolAsync("ListTables");

        Console.WriteLine("Response:");
        foreach (var content in result.Content)
        {
          Console.WriteLine($"  {content.Text}");
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Error: {ex.Message}");
      }
    }

    private static async Task TestReadData(McpClient client)
    {
      try
      {
        Console.Write("Enter SQL query: ");
        var query = Console.ReadLine();

        if (string.IsNullOrWhiteSpace(query))
        {
          Console.WriteLine("❌ Query cannot be empty");
          return;
        }

        Console.WriteLine($"🔍 Executing query: {query}");
        var args = new Dictionary<string, object>
        {
          ["sql"] = query
        };

        var result = await client.CallToolAsync("ReadData", args);

        Console.WriteLine("Response:");
        foreach (var content in result.Content)
        {
          Console.WriteLine($"  {content.Text}");
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Error: {ex.Message}");
      }
    }

    private static async Task TestDescribeTable(McpClient client)
    {
      try
      {
        Console.Write("Enter table name: ");
        var tableName = Console.ReadLine();

        if (string.IsNullOrWhiteSpace(tableName))
        {
          Console.WriteLine("❌ Table name cannot be empty");
          return;
        }

        Console.WriteLine($"📝 Describing table: {tableName}");
        var args = new Dictionary<string, object>
        {
          ["table_name"] = tableName
        };

        var result = await client.CallToolAsync("DescribeTable", args);

        Console.WriteLine("Response:");
        foreach (var content in result.Content)
        {
          Console.WriteLine($"  {content.Text}");
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Error: {ex.Message}");
      }
    }

    private static async Task TestCustomToolCall(McpClient client, List<Tool> availableTools)
    {
      try
      {
        Console.WriteLine("Available tools:");
        for (int i = 0; i < availableTools.Count; i++)
        {
          Console.WriteLine($"  {i + 1}. {availableTools[i].Name}");
        }

        Console.Write("Select tool number: ");
        if (!int.TryParse(Console.ReadLine(), out int toolIndex) ||
            toolIndex < 1 || toolIndex > availableTools.Count)
        {
          Console.WriteLine("❌ Invalid tool selection");
          return;
        }

        var selectedTool = availableTools[toolIndex - 1];
        Console.WriteLine($"Selected tool: {selectedTool.Name}");
        Console.WriteLine($"Schema: {selectedTool.InputSchema}");

        Console.Write("Enter arguments as JSON (or press Enter for empty): ");
        var argsInput = Console.ReadLine();

        Dictionary<string, object>? arguments = null;
        if (!string.IsNullOrWhiteSpace(argsInput))
        {
          try
          {
            arguments = JsonSerializer.Deserialize<Dictionary<string, object>>(argsInput);
          }
          catch (JsonException)
          {
            Console.WriteLine("❌ Invalid JSON format");
            return;
          }
        }

        Console.WriteLine($"🔧 Calling tool: {selectedTool.Name}");
        var result = await client.CallToolAsync(selectedTool.Name, arguments);

        Console.WriteLine("Response:");
        foreach (var content in result.Content)
        {
          Console.WriteLine($"  {content.Text}");
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Error: {ex.Message}");
      }
    }
  }
}