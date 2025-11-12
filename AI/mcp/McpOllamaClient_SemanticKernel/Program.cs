using Microsoft.Extensions.Configuration;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

// Configure Semantic Kernel
var builder = Kernel.CreateBuilder();
builder.Services.AddOpenAIChatCompletion(
    //modelId: "llama3.2",
    modelId: "qwen3:8b",
    apiKey: null, // No API key needed for Ollama
    endpoint: new Uri("http://localhost:11434/v1") // Ollama server endpoint
);
var kernel = builder.Build();

var cfgBuilder = new ConfigurationBuilder()
    .SetBasePath(AppDomain.CurrentDomain.BaseDirectory) // Imposta la directory di base
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true) // Carica appsettings.json
    .AddUserSecrets<Program>(); // Carica i segreti utente (specifica una classe nel tuo progetto)

IConfigurationRoot configuration = cfgBuilder.Build();
string connectionString = configuration.GetConnectionString("DefaultConnection");

// Set up MCP Client
await using IMcpClient mcpClient = await McpClientFactory.CreateAsync(
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
#pragma warning disable SKEXP0001 // Suppress diagnostics for experimental features
kernel.Plugins.AddFromFunctions("McpTools", tools.Select(t => t.AsKernelFunction()));
#pragma warning restore SKEXP0001

// Chat loop
Console.WriteLine("Chat with the AI. Type 'exit' to stop.");
var history = new ChatHistory();
history.AddSystemMessage("You are an assistant that can call MCP tools to process user queries.");

// Get chat completion service
var chatCompletionService = kernel.GetRequiredService<IChatCompletionService>();

var basicPrompt = "i dati che ti servono sono prevalentemente nelle viste IA_* (esempio: IA_Attivita, IA_Ticket, ecc)" +
                  "Le viste devono essere trattate come tabelle." +
                  "I tool che ti vengono forniti possono essere utilizzati sia con viste che con tabelle";

var firstMessage = $"{basicPrompt}. Quante tabelle/viste con prefisso IA vedi?";
history.AddUserMessage(firstMessage);

OpenAIPromptExecutionSettings openAIPromptExecutionSettings = new()
{
  ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions,
};

// Get the response from the AI
var initRes = await chatCompletionService.GetChatMessageContentAsync(
    history,
    executionSettings: openAIPromptExecutionSettings,
    kernel: kernel);

Console.WriteLine($"Assistant > {initRes.Content}");


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