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
   private const string OLLAMA_MODEL = "qwen3:8b"; // Modello con tool calling
  //private const string OLLAMA_MODEL = "qwen3-vl:235b-cloud"; // Modello con tool calling
  //private const string OLLAMA_MODEL = "mistral"; // Modello con tool calling
  //private const string OLLAMA_MODEL = "mistral"; // Modello con tool calling

  static async Task Main(string[] args)
  {
    Console.WriteLine("=== MCP Client con Ollama + SQL Server ===\n");

    // Path del server MCP SQL (modifica secondo il tuo ambiente)
    var mcpServerPath = @"C:\dev\MCP\SQL-AI-samples\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0\MssqlMcp.exe";
    var connectionString = "User ID=lyra;Password=Lyra_!_DAJETUTTA2025;Server=SRVW16DB1;Initial Catalog=ls_softeam;TrustServerCertificate=True";

    var orc = new McpOllamaOrchestrator(mcpServerPath, connectionString, OLLAMA_URL, OLLAMA_MODEL);
    await orc.InitializeAsync();

    Console.WriteLine("\nClient pronto. Scrivi 'exit' per uscire.\n");


    Console.WriteLine("invio primo prompt...");

    var basicPrompt = "i dati che ti servono sono contenuti nelle viste 'IA_*'. " +
                      "Le viste devono essere trattate come tabelle."
                      + "I tool che ti vengono forniti possono essere utilizzati sia con viste che con tabelle";
    
    await orc.ProcessUserQueryAsync($"{basicPrompt} Quante tabelle/viste sei in grado di utilizzare?'");

    Console.WriteLine("inizio conversazione");

    while (true)
    {
      Console.Write("Tu: ");
      var userInput = Console.ReadLine();

      if (string.IsNullOrWhiteSpace(userInput) || userInput.ToLower() == "exit")
        break;

      await orc.ProcessUserQueryAsync(userInput);
    }

    await orc.DisposeAsync();
  }
}




