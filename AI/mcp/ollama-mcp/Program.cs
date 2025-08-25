using System;
using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using System.Reflection;
using System.Text;
using System.Text.Json;

class Program
{
  static async Task Main()
  {
    var client = new HttpClient();

    Console.WriteLine("Chat con Ollama + SQL MCP (digita 'exit' per uscire)");

    Environment.SetEnvironmentVariable("CONNECTION_STRING", "User ID=preplyrlyraarod;Password=LyraPreProd10Lyra_!_DAJETUTTA20251!;Server=SRVW16DB1;Initial Catalog=ls_softeam_preprod;TrustServerCertificate=True");

    var availableTools = new Dictionary<string, string>
    {
        { "Describe Table", "Returns table schema. Parameter: name(string)." },
        { "Read Data", "Executes SQL queries against SQL Database to read data. Parameter: sql(string)" },
        { "List Tables", "Lists all tables in the SQL Database." }
    };

    var model = "mistral";
    var prompt =
      @"
        You are an AI assistant that helps users to interact with a SQL Database.
        We are in a middleware context: Ollama determines the action to perform, then you call a separate MCP SQL Server to execute SQL commands, then you explain the result to the user.
        All data is contained into DB Views, which name starts with 'AI.'. 
  
        If you need to perform SQL operation return a JSON with:
        - action: tool name
        - pars: object with tool required parameters
      You have access to the following tools:
      ";
    
    availableTools.ToList().ForEach(a => prompt += $"- {a.Key}: {a.Value}\n");

    while (true)
    {
      Console.Write("Tu: ");
      var input = Console.ReadLine();
      if (input == "exit") break;

      // Step 1: Chiedo a Ollama di darmi un'azione strutturata
      var request = new
      {
        model = model,
        prompt = $"{prompt}.\nRequest: {input}"
      };

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


      try
      {
        var actionDoc = JsonDocument.Parse(fullOutput);

        string action = actionDoc.RootElement.GetProperty("action").GetString();
        string pars = ""; 
        if (actionDoc.RootElement.TryGetProperty("pars", out var parsElem))
        {
          pars = parsElem.GetRawText(); 
        }

        if (availableTools.ContainsKey(action))
        {

          // Step 2: Chiama il tuo server MCP con la query
          //var sqlResult = await CallMcpServerAsync(query);

          var sqlResult = await CallMcpServerStdioAsync(action, pars);

          // Step 3: Re-inietta il risultato nel modello
          var followUpReq = new
          {
            model,
            prompt = $"L'utente ha chiesto: {input}\nEcco il risultato SQL:\n{sqlResult}\nSpiega in linguaggio naturale."
          };

          var followUpContent = new StringContent(JsonSerializer.Serialize(followUpReq), Encoding.UTF8, "application/json");
          var followUpResp = await client.PostAsync("http://localhost:11434/api/generate", followUpContent);
          var followUpRaw = await followUpResp.Content.ReadAsStringAsync();

          using var followUpDoc = JsonDocument.Parse(followUpRaw);
          var finalAnswer = followUpDoc.RootElement.GetProperty("response").GetString();

          Console.WriteLine($"\nOllama: {finalAnswer}\n");
        }
        else
        {
          Console.WriteLine($"\nOllama: {fullOutput}\n");
        }
      }
      catch
      {
        Console.WriteLine($"\nOllama (testo libero): {fullOutput}\n");
      }
    }
  }

  //via http
  static async Task<string> CallMcpServerAsync(string query)
  {
    using var http = new HttpClient();
    var req = new { action = "query_sql", query };
    var content = new StringContent(JsonSerializer.Serialize(req), Encoding.UTF8, "application/json");

    var resp = await http.PostAsync("http://localhost:5000/mcp", content); // endpoint MCP tuo
    return await resp.Content.ReadAsStringAsync();
  }

  //via processo
  static async Task<string> CallMcpServerStdioAsync(string tool, string pars)
  {

    string responseJson = string.Empty;

    try
    {
      var startInfo = new ProcessStartInfo
      {
        FileName = "MssqlMcp.exe",  // path del tuo MCP eseguibile
        WorkingDirectory = "C:\\Users\\dtentori\\OneDrive - SOFTEAM SPA\\Documenti\\GitHub\\sandbox\\AI\\mcp\\MssqlMcp\\bin\\Debug\\net8.0",
        Arguments = "",          
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = false
      };

      using var process = Process.Start(startInfo);
      if (process == null) throw new Exception("Impossibile avviare MCP");

      process.BeginOutputReadLine();
      process.BeginErrorReadLine();

      // Prepara richiesta JSON
      var request = new { action = tool, pars };
      var requestJson = JsonSerializer.Serialize(request);

      // Scrivi su stdin e aggiungi newline (MCP usa messaggi line-based)
      await process.StandardInput.WriteLineAsync(requestJson);
      await process.StandardInput.FlushAsync();

      // Leggi la risposta (una riga di JSON)
      responseJson = await process.StandardOutput.ReadLineAsync();

      // Optional: leggere anche eventuali errori
      _ = Task.Run(async () =>
      {
        while (!process.StandardError.EndOfStream)
        {
          var err = await process.StandardError.ReadLineAsync();
          Console.Error.WriteLine("[MCP Error] " + err);
        }
      });
    }
    catch (Exception ex)
    {
      throw ex;
    }

    return responseJson;
  }
}
