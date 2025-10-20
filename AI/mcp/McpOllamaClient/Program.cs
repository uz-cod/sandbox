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
  private const string OLLAMA_MODEL = "qwen3:4b"; // Modello con tool calling

  static async Task Main(string[] args)
  {
    Console.WriteLine("=== MCP Client con Ollama + SQL Server ===\n");

    // Path del server MCP SQL (modifica secondo il tuo ambiente)
    var mcpServerPath = @"C:\dev\MCP\SQL-AI-samples\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0\MssqlMcp.exe";
    var connectionString = "User ID=lyra;Password=Lyra_!_DAJETUTTA2025;Server=SRVW16DB1;Initial Catalog=ls_softeam;TrustServerCertificate=True";

    var orc = new McpOllamaOrchestrator(mcpServerPath, connectionString, OLLAMA_URL, OLLAMA_MODEL);
    await orc.InitializeAsync();

    Console.WriteLine("\nClient pronto. Scrivi 'exit' per uscire.\n");

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




