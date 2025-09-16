using ollama_mcp;
using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace JsonRpcInteractiveClient;

public class JsonRpcInteractiveClient : IDisposable
{
  private Process? _process;
  private StreamWriter? _stdinWriter;
  private StreamReader? _stdoutReader;
  private StreamReader? _stderrReader;
  private readonly CancellationTokenSource _cancellationTokenSource = new();
  private bool _disposed;

  // Per gestire le risposte asincrone
  private readonly ConcurrentDictionary<object, TaskCompletionSource<JsonDocument>> _pendingRequests = new();
  private int _requestIdCounter = 0;

  private static readonly JsonSerializerOptions JsonOptions = new()
  {
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = false
  };

  // Eventi per debugging e logging
  public event EventHandler<string>? MessageReceived;
  public event EventHandler<string>? MessageSent;
  public event EventHandler<string>? ErrorReceived;
  public event EventHandler? ProcessExited;

  public async Task<bool> ConnectToServerAsync(string serverExecutablePath, string? arguments = null)
  {
    try
    {
      var startInfo = new ProcessStartInfo
      {
        FileName = serverExecutablePath,
        Arguments = arguments ?? string.Empty,
        UseShellExecute = false,
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        CreateNoWindow = true,
        StandardInputEncoding = Encoding.UTF8,
        StandardOutputEncoding = Encoding.UTF8,
        StandardErrorEncoding = Encoding.UTF8
      };

      _process = new Process { StartInfo = startInfo };
      _process.EnableRaisingEvents = true;
      _process.Exited += (sender, e) =>
      {
        ProcessExited?.Invoke(this, EventArgs.Empty);
        // Completa tutte le richieste pendenti con errore
        foreach (var kvp in _pendingRequests)
        {
          kvp.Value.SetException(new InvalidOperationException("Server process terminated"));
        }
        _pendingRequests.Clear();
      };

      if (!_process.Start())
      {
        return false;
      }

      _stdinWriter = _process.StandardInput;
      _stdoutReader = _process.StandardOutput;
      _stderrReader = _process.StandardError;

      // Avvia il monitoring degli stream
      _ = Task.Run(() => MonitorServerResponsesAsync(_cancellationTokenSource.Token));
      _ = Task.Run(() => MonitorServerErrorsAsync(_cancellationTokenSource.Token));

      // Piccola attesa per dare tempo al server di avviarsi
      await Task.Delay(500);

      return true;
    }
    catch (Exception ex)
    {
      Console.WriteLine($"❌ Errore nella connessione al server: {ex.Message}");
      return false;
    }
  }

  public async Task StartInteractiveChatAsync()
  {
    Console.WriteLine("🚀 Client JSON-RPC Interattivo Avviato");
    Console.WriteLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Console.WriteLine("💡 Comandi disponibili:");
    Console.WriteLine("  • Testo normale → viene inviato come metodo 'chat' o 'message'");
    Console.WriteLine("  • /method <nome> [params] → chiamata JSON-RPC diretta");
    Console.WriteLine("  • /raw <json> → invia JSON-RPC raw");
    Console.WriteLine("  • /notify <method> [params] → notifica (senza risposta)");
    Console.WriteLine("  • /help → mostra questo aiuto");
    Console.WriteLine("  • /quit → esci");
    Console.WriteLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Console.WriteLine();

    while (!_cancellationTokenSource.Token.IsCancellationRequested)
    {
      Console.Write("💬 > ");
      var input = Console.ReadLine();

      if (string.IsNullOrWhiteSpace(input))
        continue;

      try
      {
        await ProcessUserInputAsync(input.Trim());
      }
      catch (Exception ex)
      {
        Console.WriteLine($"❌ Errore: {ex.Message}");
      }
    }
  }

  private async Task ProcessUserInputAsync(string input)
  {
    // Comandi speciali
    if (input.StartsWith("/"))
    {
      await ProcessCommandAsync(input);
      return;
    }

    // Input normale - invialo come messaggio di chat
    await SendChatMessageAsync(input);
  }

  private async Task ProcessCommandAsync(string command)
  {
    var parts = ParseCommand(command);
    var cmd = parts[0].ToLower();

    switch (cmd)
    {
      case "/quit":
      case "/exit":
        _cancellationTokenSource.Cancel();
        Console.WriteLine("👋 Disconnessione in corso...");
        break;

      case "/help":
        ShowHelp();
        break;

      case "/method":
        if (parts.Length < 2)
        {
          Console.WriteLine("❌ Uso: /method <nome_metodo> [parametri_json]");
          return;
        }
        await SendMethodCallAsync(parts[1], parts.Length > 2 ? parts[2] : null);
        break;

      case "/notify":
        if (parts.Length < 2)
        {
          Console.WriteLine("❌ Uso: /notify <nome_metodo> [parametri_json]");
          return;
        }
        await SendNotificationAsync(parts[1], parts.Length > 2 ? parts[2] : null);
        break;

      case "/raw":
        if (parts.Length < 2)
        {
          Console.WriteLine("❌ Uso: /raw <json_completo>");
          return;
        }
        await SendRawJsonAsync(parts[1]);
        break;

      default:
        Console.WriteLine($"❌ Comando sconosciuto: {cmd}. Usa /help per l'elenco comandi.");
        break;
    }
  }

  private static string[] ParseCommand(string command)
  {
    // Parsing semplice che rispetta le virgolette
    var regex = new Regex(@"[\""].+?[\""]|[^ ]+", RegexOptions.Compiled);
    var matches = regex.Matches(command);
    var result = new string[matches.Count];

    for (int i = 0; i < matches.Count; i++)
    {
      result[i] = matches[i].Value.Trim('"');
    }

    return result;
  }

  private async Task SendChatMessageAsync(string message)
  {
    // Prova prima con "chat", poi con "message" se il server non supporta "chat"
    try
    {
      var response = await SendJsonRpcRequestAsync("chat", message, 10000);
      DisplayResponse(response);
    }
    catch (JsonRpcException ex) when (ex.ErrorCode == JsonRpcErrorCodes.MethodNotFound)
    {
      try
      {
        var response = await SendJsonRpcRequestAsync("message", message, 10000);
        DisplayResponse(response);
      }
      catch (JsonRpcException ex2) when (ex2.ErrorCode == JsonRpcErrorCodes.MethodNotFound)
      {
        Console.WriteLine("❌ Il server non supporta metodi 'chat' o 'message'. Usa /method per chiamate dirette.");
      }
    }
  }

  private async Task SendMethodCallAsync(string method, string? paramsJson)
  {
    object? parameters = null;

    if (!string.IsNullOrEmpty(paramsJson))
    {
      try
      {
        using var jsonDoc = JsonDocument.Parse(paramsJson);
        parameters = jsonDoc.RootElement.Clone();
      }
      catch (JsonException)
      {
        // Se non è JSON valido, trattalo come stringa
        parameters = paramsJson;
      }
    }

    var response = await SendJsonRpcRequestAsync(method, parameters);
    DisplayResponse(response);
  }

  private async Task SendNotificationAsync(string method, string? paramsJson)
  {
    object? parameters = null;

    if (!string.IsNullOrEmpty(paramsJson))
    {
      try
      {
        using var jsonDoc = JsonDocument.Parse(paramsJson);
        parameters = jsonDoc.RootElement.Clone();
      }
      catch (JsonException)
      {
        parameters = paramsJson;
      }
    }

    var request = new JsonRpcRequest
    {
      Method = method,
      Params = parameters
      // Nessun Id per le notifiche
    };

    await SendJsonRpcMessageAsync(request);
    Console.WriteLine("📤 Notifica inviata (nessuna risposta attesa)");
  }

  private async Task SendRawJsonAsync(string json)
  {
    try
    {
      // Valida che sia JSON valido
      using var jsonDoc = JsonDocument.Parse(json);

      if (_stdinWriter == null || _process?.HasExited == true)
      {
        throw new InvalidOperationException("Server non disponibile");
      }

      await _stdinWriter.WriteLineAsync(json);
      await _stdinWriter.FlushAsync();

      MessageSent?.Invoke(this, json);
      Console.WriteLine("📤 JSON raw inviato");
    }
    catch (JsonException ex)
    {
      Console.WriteLine($"❌ JSON non valido: {ex.Message}");
    }
  }

  private async Task<JsonDocument> SendJsonRpcRequestAsync(string method, object? parameters, int timeoutMs = 30000)
  {
    var requestId = Interlocked.Increment(ref _requestIdCounter);

    var request = new JsonRpcRequest
    {
      Method = method,
      Params = parameters,
      Id = requestId
    };

    var tcs = new TaskCompletionSource<JsonDocument>();
    _pendingRequests[requestId] = tcs;

    try
    {
      await SendJsonRpcMessageAsync(request);

      // Attendi la risposta con timeout
      using var cts = new CancellationTokenSource(timeoutMs);
      cts.Token.Register(() => tcs.TrySetCanceled());

      return await tcs.Task;
    }
    catch (TaskCanceledException)
    {
      throw new TimeoutException($"Timeout dopo {timeoutMs}ms per il metodo '{method}'");
    }
    finally
    {
      _pendingRequests.TryRemove(requestId, out _);
    }
  }

  private async Task SendJsonRpcMessageAsync(JsonRpcRequest request)
  {
    var json = JsonSerializer.Serialize(request, JsonOptions);

    if (_stdinWriter == null || _process?.HasExited == true)
    {
      throw new InvalidOperationException("Server non disponibile");
    }

    await _stdinWriter.WriteLineAsync(json);
    await _stdinWriter.FlushAsync();

    MessageSent?.Invoke(this, json);
  }

  private void DisplayResponse(JsonDocument responseDoc)
  {
    var root = responseDoc.RootElement;

    if (root.TryGetProperty("error", out var errorElement))
    {
      var error = JsonSerializer.Deserialize<JsonRpcError>(errorElement.GetRawText(), JsonOptions);
      Console.WriteLine($"❌ Errore [{error?.Code}]: {error?.Message}");
      if (error?.Data != null)
      {
        Console.WriteLine($"   Dati: {error.Data}");
      }
    }
    else if (root.TryGetProperty("result", out var resultElement))
    {
      Console.WriteLine($"✅ Risposta: {FormatJsonResult(resultElement)}");
    }
    else
    {
      Console.WriteLine($"⚠️  Risposta non standard: {responseDoc.RootElement}");
    }
  }

  private static string FormatJsonResult(JsonElement result)
  {
    return result.ValueKind switch
    {
      JsonValueKind.String => result.GetString() ?? "",
      JsonValueKind.Number => result.GetRawText(),
      JsonValueKind.True => "true",
      JsonValueKind.False => "false",
      JsonValueKind.Null => "null",
      _ => JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true })
    };
  }

  private static void ShowHelp()
  {
    Console.WriteLine();
    Console.WriteLine("📚 Guida Comandi:");
    Console.WriteLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Console.WriteLine("🗨️  Messaggio normale:");
    Console.WriteLine("   Ciao server! → {\"jsonrpc\":\"2.0\",\"method\":\"chat\",\"params\":\"Ciao server!\",\"id\":1}");
    Console.WriteLine();
    Console.WriteLine("⚙️  Chiamata metodo:");
    Console.WriteLine("   /method ping → {\"jsonrpc\":\"2.0\",\"method\":\"ping\",\"id\":2}");
    Console.WriteLine("   /method echo \"Hello World\" → con parametro stringa");
    Console.WriteLine("   /method calculate '{\"a\":5,\"b\":3,\"op\":\"+\"}' → con parametro JSON");
    Console.WriteLine();
    Console.WriteLine("📣 Notifica (senza risposta):");
    Console.WriteLine("   /notify status → {\"jsonrpc\":\"2.0\",\"method\":\"status\"}");
    Console.WriteLine();
    Console.WriteLine("🔧 JSON Raw:");
    Console.WriteLine("   /raw '{\"jsonrpc\":\"2.0\",\"method\":\"custom\",\"id\":1}' → invia JSON direttamente");
    Console.WriteLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    Console.WriteLine();
  }

  private async Task MonitorServerResponsesAsync(CancellationToken cancellationToken)
  {
    if (_stdoutReader == null) return;

    try
    {
      while (!cancellationToken.IsCancellationRequested && _process?.HasExited != true)
      {
        var line = await _stdoutReader.ReadLineAsync();
        if (line == null) break;

        MessageReceived?.Invoke(this, line);

        try
        {
          using var jsonDoc = JsonDocument.Parse(line);
          var root = jsonDoc.RootElement;

          if (root.TryGetProperty("id", out var idElement) &&
              !idElement.ValueKind.Equals(JsonValueKind.Null))
          {
            var id = idElement.ValueKind == JsonValueKind.Number ?
                     (object)idElement.GetInt32() :
                     idElement.GetString()!;

            if (_pendingRequests.TryGetValue(id, out var tcs))
            {
              tcs.SetResult(JsonDocument.Parse(line));
            }
          }
          else
          {
            // Notifica dal server o messaggio senza ID
            Console.WriteLine($"📥 Notifica server: {FormatJsonResult(root)}");
          }
        }
        catch (JsonException ex)
        {
          Console.WriteLine($"❌ Errore parsing risposta JSON: {ex.Message}");
          Console.WriteLine($"   Ricevuto: {line}");
        }
      }
    }
    catch (Exception ex)
    {
      Console.WriteLine($"❌ Errore nel monitoring risposte: {ex.Message}");
    }
  }

  private async Task MonitorServerErrorsAsync(CancellationToken cancellationToken)
  {
    if (_stderrReader == null) return;

    try
    {
      while (!cancellationToken.IsCancellationRequested && _process?.HasExited != true)
      {
        var line = await _stderrReader.ReadLineAsync();
        if (line == null) break;

        ErrorReceived?.Invoke(this, line);
        Console.WriteLine($"🔴 Server Error: {line}");
      }
    }
    catch (Exception ex)
    {
      Console.WriteLine($"❌ Errore nel monitoring errori server: {ex.Message}");
    }
  }

  public void Dispose()
  {
    if (_disposed) return;

    _cancellationTokenSource.Cancel();

    foreach (var kvp in _pendingRequests)
    {
      kvp.Value.SetException(new ObjectDisposedException(nameof(JsonRpcInteractiveClient)));
    }
    _pendingRequests.Clear();

    _stdinWriter?.Close();
    _stdoutReader?.Close();
    _stderrReader?.Close();

    try
    {
      if (_process != null && !_process.HasExited)
      {
        _process.Kill();
        _process.WaitForExit(5000);
      }
    }
    catch { }

    _process?.Dispose();
    _cancellationTokenSource.Dispose();

    _disposed = true;
    GC.SuppressFinalize(this);
  }
}

public class JsonRpcException : Exception
{
  public int ErrorCode { get; }

  public JsonRpcException(string message, int errorCode) : base(message)
  {
    ErrorCode = errorCode;
  }
}

// Programma principale
public class Program
{
  public static async Task Main(string[] args)
  {
    Console.Clear();
    Console.WriteLine("🔗 JSON-RPC Interactive Client");
    Console.WriteLine("═══════════════════════════════");

    if (args.Length == 0)
    {
      Console.WriteLine("❌ Uso: JsonRpcClient.exe <path_to_server_executable> [arguments]");
      Console.WriteLine("   Esempio: JsonRpcClient.exe MyJsonRpcServer.exe --port 8080");
      return;
    }

    string serverPath = args[0];
    string? serverArgs = args.Length > 1 ? string.Join(" ", args[1..]) : null;

    using var client = new JsonRpcInteractiveClient();

    // Eventi per debugging (opzionale)
    client.MessageSent += (s, msg) => Console.WriteLine($"📤 [DEBUG] Inviato: {msg}");
    client.MessageReceived += (s, msg) => Console.WriteLine($"📥 [DEBUG] Ricevuto: {msg}");
    client.ErrorReceived += (s, err) => Console.WriteLine($"🔴 [STDERR] {err}");
    client.ProcessExited += (s, e) =>
    {
      Console.WriteLine("⚠️  Il server è terminato.");
      Environment.Exit(0);
    };

    Console.WriteLine($"🚀 Connessione al server: {serverPath}");
    if (!string.IsNullOrEmpty(serverArgs))
    {
      Console.WriteLine($"📋 Argomenti: {serverArgs}");
    }

    if (await client.ConnectToServerAsync(serverPath, serverArgs))
    {
      await client.StartInteractiveChatAsync();
    }
    else
    {
      Console.WriteLine("❌ Impossibile connettersi al server JSON-RPC");
    }
  }
}