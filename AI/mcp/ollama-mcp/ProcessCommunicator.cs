using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ollama_mcp
{
  using System;
  using System.Diagnostics;
  using System.IO;
  using System.Text;
  using System.Threading;
  using System.Threading.Tasks;



  public class ProcessCommunicator : IDisposable
  {
    private Process? _process;
    private StreamWriter? _stdinWriter;
    private StreamReader? _stdoutReader;
    private StreamReader? _stderrReader;
    private readonly CancellationTokenSource _cancellationTokenSource = new();
    private bool _disposed;

    public event EventHandler<string>? MessageReceived;
    public event EventHandler<string>? ErrorReceived;
    public event EventHandler? ProcessExited;

    public async Task<bool> StartProcessAsync(string executablePath, string? arguments = null)
    {
      try
      {
        var startInfo = new ProcessStartInfo
        {
          FileName = executablePath,
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
        _process.Exited += (sender, e) => ProcessExited?.Invoke(this, EventArgs.Empty);

        if (!_process.Start())
        {
          return false;
        }

        // Ottieni i stream per la comunicazione
        _stdinWriter = _process.StandardInput;
        _stdoutReader = _process.StandardOutput;
        _stderrReader = _process.StandardError;

        // Avvia il monitoring degli output in background
        _ = Task.Run(() => MonitorOutputAsync(_cancellationTokenSource.Token));
        _ = Task.Run(() => MonitorErrorAsync(_cancellationTokenSource.Token));

        return true;
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Errore nell'avvio del processo: {ex.Message}");
        return false;
      }
    }

    public async Task<bool> SendMessageAsync(string message)
    {
      if (_stdinWriter == null || _process?.HasExited == true)
      {
        return false;
      }

      try
      {
        await _stdinWriter.WriteLineAsync(message);
        await _stdinWriter.FlushAsync();
        return true;
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Errore nell'invio del messaggio: {ex.Message}");
        return false;
      }
    }

    private async Task MonitorOutputAsync(CancellationToken cancellationToken)
    {
      if (_stdoutReader == null) return;

      try
      {
        while (!cancellationToken.IsCancellationRequested && !_process?.HasExited == true)
        {
          var line = await _stdoutReader.ReadLineAsync();
          if (line != null)
          {
            MessageReceived?.Invoke(this, line);
          }
          else
          {
            // End of stream
            break;
          }
        }
      }
      catch (ObjectDisposedException)
      {
        // Process terminato normalmente
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Errore nel monitoring dell'output: {ex.Message}");
      }
    }

    private async Task MonitorErrorAsync(CancellationToken cancellationToken)
    {
      if (_stderrReader == null) return;

      try
      {
        while (!cancellationToken.IsCancellationRequested && !_process?.HasExited == true)
        {
          var line = await _stderrReader.ReadLineAsync();
          if (line != null)
          {
            ErrorReceived?.Invoke(this, line);
          }
          else
          {
            break;
          }
        }
      }
      catch (ObjectDisposedException)
      {
        // Process terminato normalmente
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Errore nel monitoring degli errori: {ex.Message}");
      }
    }

    public void TerminateProcess()
    {
      try
      {
        if (_process != null && !_process.HasExited)
        {
          _process.Kill();
          _process.WaitForExit(5000); // Timeout di 5 secondi
        }
      }
      catch (Exception ex)
      {
        Console.WriteLine($"Errore nella terminazione del processo: {ex.Message}");
      }
    }

    public void Dispose()
    {
      if (_disposed) return;

      _cancellationTokenSource.Cancel();

      _stdinWriter?.Close();
      _stdoutReader?.Close();
      _stderrReader?.Close();

      TerminateProcess();

      _process?.Dispose();
      _cancellationTokenSource.Dispose();

      _disposed = true;
      GC.SuppressFinalize(this);
    }
  }

}
