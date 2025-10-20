using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace McpOllamaClient
{
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
}
