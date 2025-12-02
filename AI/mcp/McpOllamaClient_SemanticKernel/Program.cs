using McpOllamaClient_SemanticKernel;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using System;
using System.Text;
using System.Threading;


var model = "qwen2.5:14b";
//var model = "llama3.2";
//var ollamaUri = new Uri("http://localhost:11434/v1");

var ollamaUri = new Uri("http://wksnvidia1:11435/v1");

// Configure Semantic Kernel
var builder = Kernel.CreateBuilder();
builder.Services.AddOpenAIChatCompletion(
    modelId: model,
    apiKey: null,
    endpoint: ollamaUri
);

//debug tooling
builder.Services.AddSingleton<IFunctionInvocationFilter, ToolLoggingFilter>();

var kernel = builder.Build();

var cfgBuilder = new ConfigurationBuilder()
    .SetBasePath(AppDomain.CurrentDomain.BaseDirectory) // Imposta la directory di base
    .AddJsonFile("appsettings.json", optional: false, reloadOnChange: true) // Carica appsettings.json
    .AddUserSecrets<Program>(); // Carica i segreti utente (specifica una classe nel tuo progetto)

IConfigurationRoot configuration = cfgBuilder.Build();

string connectionString = configuration.GetConnectionString("DefaultConnection");
Environment.SetEnvironmentVariable("CONNECTION_STRING", connectionString);

Console.WriteLine($"start SQLServer MCP Server...");
// Set up MCP Clent
//await using McpClient mcpClient = await McpClient.CreateAsync(
//    new StdioClientTransport(new()
//    {
//      Command = "dotnet run",
//      Arguments = ["--project", "C:\\dev\\pers\\sandbox\\AI\\mcp\\MssqlMcp\\MssqlMcp.csproj"],
//      Name = "MsSqlMcpServer",
//    }));

string binPath = @"C:\dev\pers\sandbox\AI\mcp\MssqlMcp\dotnet\MssqlMcp\bin\Debug\net8.0";
string exeName = "MssqlMcp.exe";
await using McpClient mcpClient = await McpClient.CreateAsync(
    new StdioClientTransport(new()
    {
      Command = Path.Combine(binPath, exeName),
      Arguments = [],
      Name = "MsSqlMcpServer",
    }));


Console.WriteLine($"discovering tools...");
// Retrieve and load tools from the server
IList<McpClientTool> tools = await mcpClient.ListToolsAsync().ConfigureAwait(false);

// List all available tools from the MCP server
Console.WriteLine("Available MCP Tools:");
foreach (var tool in tools)
{
  Console.WriteLine($"{tool.Name}: {tool.Description}");
}

// Register MCP tools with Semantic Kernel
kernel.Plugins.AddFromFunctions("McpTools", tools.Select(t => t.AsKernelFunction()));

//debug/test
var mcpPlugin = kernel.Plugins["McpTools"];
//foreach (var func in mcpPlugin)
//{
//  Console.WriteLine($"\nFunction: {func.Name}");
//  Console.WriteLine($"\nDesc:     {func.Description}");
//  foreach (var param in func.Metadata.Parameters)
//  {
//    Console.WriteLine($"    Param: {param.Name}");
//    Console.WriteLine($"    Schema: {param.Schema}");
//    Console.WriteLine($"    Desc: {param.Description}");
//  }
//}

// Chat loop
Console.WriteLine("Chat with the AI. Type 'exit' to stop.");

// Get chat completion service
var chatCompletionService = kernel.GetRequiredService<IChatCompletionService>();

OpenAIPromptExecutionSettings openAIPromptExecutionSettings = new()
{
  ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions,
  MaxTokens = 4000, // Qwen 2.5 gestisce bene contesti lunghi
  Temperature = 0.1 // Bassa per precisione tecnica
};

//setup chat
var history = new ChatHistory();
//string systemPrompt = @"
//You are an expert Data Analyst and SQL Assistant connected to a SQL Server database via specific tools.
//Your goal is to answer user questions by retrieving data accurately.

//### 1. THE GOLDEN RULE: ""IA_"" VIEWS ONLY
//The database contains many technical tables/views, but you must focus ONLY on the views created for you.
//- **Naming Convention**: All relevant data is stored in views starting with the prefix **'IA_'** (e.g., `IA_Clienti`, `IA_Attivita`, etc).
//- **Ignore**: Completely ignore any table/view that does not start with 'IA_'.

//### 2. STANDARD OPERATING PROCEDURE (Execution Loop)
//You must strictly follow these steps for every user request involving data:

//**STEP 1: DISCOVERY (List)**
//- Call the `ListViews` tool immediately.
//- Look specifically for views starting with `IA_` that seem relevant to the user's question. 

//**STEP 2: INSPECTION (Describe)**
//- Once you identify a potential `IA_` candidate, call `DescribeTable` (or `DescribeView`) on it.
//- **CRITICAL**: Do not guess column names. You MUST see the schema output before writing a query.

//**STEP 3: EXECUTION (Query)**
//- Use the `ReadData` (or SQL query) tool to fetch the data.
//- Since data is denormalized, prefer simple `SELECT` statements with `WHERE` filters over complex logic.

//### 3. BEHAVIORAL GUIDELINES
//- **Read-Only**: You can only read data. Never attempt to write, update, or drop.
//- **Honesty**: If you cannot find an `IA_` view relevant to the request, state that information is missing instead of hallucinating.
//- **Formatting**: Present the final answer clearly to the user.

//### 4. OUTPUT LANGUAGE
//- Even though these instructions are in English, **you must converse with the user in Italian**.
//";

string systemPrompt = @"
You are an expert Data Analyst and SQL Assistant connected to a SQL Server database via specific tools.
Your goal is to answer user questions by retrieving data accurately.

- All relevant data is stored in views starting with the prefix **'IA_'** (e.g., `IA_Clienti`, `IA_Attivita`, etc).

- Even though these instructions are in English, **you must converse with the user in Italian**.
";

history.AddSystemMessage(systemPrompt);

string userRequest = "quanti clienti attivi ci sono?";
history.AddUserMessage(userRequest);

Console.ForegroundColor = ConsoleColor.Green;
Console.WriteLine($"User > {userRequest}");
Console.ResetColor();

using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(5));

bool streaming = true;
if (!streaming)
{
  var result = await chatCompletionService.GetChatMessageContentAsync(
      history,
      executionSettings: openAIPromptExecutionSettings,
      kernel: kernel,
      cancellationToken: cts.Token
   );

  Console.WriteLine($"Assistant > {result.Content}");
}
else
{
  try
  {
    var responseBuilder = new StringBuilder();

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
  catch (Exception ex)
  {
    Console.WriteLine($"Error: {ex.Message}");
    history.RemoveAt(history.Count - 1);
  }

  // Get the response from the AI
}

//Console.WriteLine($"FINE STEP 1");
//Console.ReadKey();

while (true)
{
  Console.Write("User > ");
  var input = Console.ReadLine();
  if (input?.Trim().ToLower() == "exit") break;

  history.AddUserMessage(input);

  // Get the response from the AI
  var result = await chatCompletionService.GetChatMessageContentAsync(
      history,
      executionSettings: openAIPromptExecutionSettings,
      kernel: kernel);

  Console.WriteLine($"Assistant > {result.Content}");
  history.AddMessage(result.Role, result.Content ?? string.Empty);
}