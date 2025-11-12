using Microsoft.Extensions.Configuration;


namespace McpOllamaClient;

class Program
{

  //private const string OLLAMA_URL = "http://localhost:11434";
  //private const string OLLAMA_MODEL = "qwen3:8b"; // Modello con tool calling

  private const string OLLAMA_URL = "http://wksnvidia1:11435/";
  private const string OLLAMA_MODEL = "gemma3:12b"; // Modello con tool calling


  //private const string OLLAMA_MODEL = "qwen3-vl:235b-cloud"; // Modello con tool calling
  //private const string OLLAMA_MODEL = "mistral"; // Modello con tool calling
  //private const string OLLAMA_MODEL = "mistral"; // Modello con tool calling

  static async Task Main(string[] args)
  {
    Console.WriteLine("=== MCP Client con Ollama + SQL Server ===\n");

    // Path del server MCP SQL (modifica secondo il tuo ambiente)
    var mcpServerPath = @"C:\dev\MCP\SQL-AI-samples\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0\MssqlMcp.exe";
    
    var builder = new ConfigurationBuilder()
        .SetBasePath(AppDomain.CurrentDomain.BaseDirectory) // Imposta la directory di base
        .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true) // Carica appsettings.json
        .AddUserSecrets<Program>(); // Carica i segreti utente (specifica una classe nel tuo progetto)

    IConfigurationRoot configuration = builder.Build();

    // 2. Ottieni la connection string
    string connectionString = configuration.GetConnectionString("DefaultConnection");

    Console.WriteLine($"Connection String utilizzata: {connectionString}");

    var orc = new McpOllamaOrchestrator(mcpServerPath, connectionString, OLLAMA_URL, OLLAMA_MODEL);
    await orc.InitializeAsync();

    Console.WriteLine("\nClient pronto. Scrivi 'exit' per uscire.\n");


    Console.WriteLine("invio primo prompt...");

    var basicPrompt = "i dati che ti servono sono prevalentemente nelle viste IA_* (esempio: IA_Attivita, IA_Ticket, ecc)" +
                      "Le viste devono essere trattate come tabelle." +
                      "I tool che ti vengono forniti possono essere utilizzati sia con viste che con tabelle";

    var firstMessage = $"{basicPrompt}. Quante tabelle/viste con prefisso IA vedi?";

    Console.WriteLine(firstMessage);
    await orc.ProcessUserQueryAsync(firstMessage);

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





