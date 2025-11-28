using Microsoft.Extensions.Configuration;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using System.Text;
using System.Threading;


var model = "qwen3:8b";
//var model = "llama3.2";
var ollamaUri = new Uri("http://localhost:11434/v1");

// Configure Semantic Kernel
var builder = Kernel.CreateBuilder();
builder.Services.AddOpenAIChatCompletion(
    modelId: model,
    apiKey: null,
    endpoint: ollamaUri
);

var kernel = builder.Build();
var cfgBuilder = new ConfigurationBuilder()
    .SetBasePath(AppDomain.CurrentDomain.BaseDirectory) // Imposta la directory di base
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true) // Carica appsettings.json
    .AddUserSecrets<Program>(); // Carica i segreti utente (specifica una classe nel tuo progetto)

IConfigurationRoot configuration = cfgBuilder.Build();

string connectionString = configuration.GetConnectionString("DefaultConnection");
Environment.SetEnvironmentVariable("CONNECTION_STRING", connectionString);

// Set up MCP Clent
await using McpClient mcpClient = await McpClient.CreateAsync(
    new StdioClientTransport(new()
    {
      Command = "dotnet run",
      Arguments = ["--project", "C:\\dev\\pers\\sandbox\\AI\\mcp\\MssqlMcp\\MssqlMcp.csproj"],
      Name = "McpServer",
    }));

// Retrieve and load tools from the server
IList<McpClientTool> tools = await mcpClient.ListToolsAsync().ConfigureAwait(false);

// List all available tools from the MCP server
Console.WriteLine("\n\nAvailable MCP Tools:");
foreach (var tool in tools)
{
  Console.WriteLine($"{tool.Name}: {tool.Description}");
}

// Register MCP tools with Semantic Kernel
kernel.Plugins.AddFromFunctions("McpTools", tools.Select(t => t.AsKernelFunction()));

//debug/test
var mcpPlugin = kernel.Plugins["McpTools"];
foreach (var func in mcpPlugin)
{
  Console.WriteLine($"\nFunction: {func.Name}");
  // Verifica che Qwen vedrà i parametri
  foreach (var param in func.Metadata.Parameters)
  {
    Console.WriteLine($"  - Param: {param.Name} ({param.ParameterType?.Name})");
    Console.WriteLine($"    Desc: {param.Description}");
  }
}

// Chat loop
Console.WriteLine("Chat with the AI. Type 'exit' to stop.");


// Get chat completion service
var chatCompletionService = kernel.GetRequiredService<IChatCompletionService>();

OpenAIPromptExecutionSettings openAIPromptExecutionSettings = new()
{
  ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions,

  // Evita loop infiniti se Qwen si incastra
  MaxTokens = 4000, // Qwen 2.5 gestisce bene contesti lunghi
  Temperature = 0.1 // Bassa per precisione tecnica
};

//setup chat
var history = new ChatHistory();
string systemPrompt = @"
Sei un assistente database intelligente connesso a un server MCP (in grado di interagire con un DB SQL Server).
NON conosci a priori la struttura del database.

I dati che ti servono sono prevalentemente nelle viste IA_* (esempio: IA_Attivita,IA_Ticket, ecc)

I tool sono in grado di trattare nello stesso modo viste e tabelle indistintamente.

Il tuo obiettivo è rispondere alla domanda dell'utente usando i tool a disposizione.
Strategia obbligatoria:

1. ESPLORA: Usa i tool di listing (es. list_tables) per capire cosa c'è nel DB.
2. ISPEZIONA: Usa i tool di schema (es. describe_table) per capire le colonne delle tabelle rilevanti.
3. INTERROGA: Usa i tool di lettura (es. query/select) per ottenere i dati.
4. RISPONDI: Formula la risposta finale solo dopo aver letto i dati reali.

Non tirare a indovinare nomi di tabelle o colonne.";

history.AddSystemMessage(systemPrompt);

history.AddUserMessage($"Quanto clienti attivi ci sono?");
//history.AddUserMessage($"Trovami l'offerta con valore più alto del 2025");


using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(10));

bool streaming = true;

if (!streaming)
{
  var initRes = await chatCompletionService.GetChatMessageContentAsync(
      history,
      executionSettings: openAIPromptExecutionSettings,
      kernel: kernel,
      cancellationToken: cts.Token
   );

  Console.WriteLine($"Assistant > {initRes.Content}");
}
else
{
  try
  {

    var responseBuilder = new StringBuilder();

    // STREAMING: GetStreamingChatMessageContentsAsync invece di GetChatMessageContentAsync
    await foreach (var chunk in chatCompletionService.GetStreamingChatMessageContentsAsync(
        history,
        executionSettings: openAIPromptExecutionSettings,
        kernel: kernel,
        cancellationToken: cts.Token))
    {
      // Stampa ogni chunk man mano che arriva
      if (!string.IsNullOrEmpty(chunk.Content))
      {
        Console.Write(chunk.Content);
        responseBuilder.Append(chunk.Content);
      }
    }

    Console.WriteLine(); // Newline dopo la risposta completa

    // Aggiungi la risposta completa alla history
    var fullResponse = responseBuilder.ToString();
    history.AddAssistantMessage(fullResponse);

    Console.WriteLine($"Assistant > {fullResponse}");

  }
  catch (OperationCanceledException)
  {
    Console.WriteLine("\n⏱️ Timeout: Request exceeded 5 minutes.");
    history.RemoveAt(history.Count - 1);
  }
  catch (HttpRequestException ex)
  {
    Console.WriteLine($"\n❌ Connection error: {ex.Message}");
    history.RemoveAt(history.Count - 1);
  }
  catch (Exception ex)
  {
    Console.WriteLine($"\n❌ Error: {ex.Message}");
    history.RemoveAt(history.Count - 1);
  }

  // Get the response from the AI
}


while (true)
{
  Console.Write("User > ");
  var input = Console.ReadLine();
  if (input?.Trim().ToLower() == "exit") break;

  history.AddUserMessage(input);

  // Enable auto function calling
  openAIPromptExecutionSettings = new()
  {
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions
  };

  // Get the response from the AI
  var result = await chatCompletionService.GetChatMessageContentAsync(
      history,
      executionSettings: openAIPromptExecutionSettings,
      kernel: kernel);

  Console.WriteLine($"Assistant > {result.Content}");
  history.AddMessage(result.Role, result.Content ?? string.Empty);
}