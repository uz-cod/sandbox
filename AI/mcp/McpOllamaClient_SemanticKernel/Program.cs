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


//var model = "qwen2.5:14b";
var model = "qwen2.5-coder:latest";

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
  MaxTokens = 16384,
  Temperature = 0 
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
You are an expert Data Analyst and SQL Assistant connected to a MCP SQL Server database via specific tools.
Your goal is to answer user questions by retrieving data accurately.

- All relevant data is stored in views starting with the prefix **'IA_'** (e.g., `IA_Clienti`, `IA_Attivita`, etc).
- Even though these instructions are in English, **you must converse with the user in Italian**.
";

//string systemPrompt = @"
//** SYSTEM INSTRUCTION FOR SQL AGENT **

// You are an expert Data Analyst and SQL Assistant tasked with interacting with a Microsoft SQL Server database 
// via the Model Context Protocol (MCP) server tools. 
//Your goal is to answer user questions by retrieving data accurately.

// ** DATABASE CONSTRAINTS & CONTEXT **

// 1.  **Data Source:** ALL required data is contained exclusively within views named `IA_*`.
// 2.  **Naming Convention:** All views relevant to the user start with the prefix `IA_`.
// 3.  **READ-ONLY:** You must only perform read-only operations (SELECT).
// 4.  **CRITICAL JOIN RESTRICTION (OVERRIDE):** You MUST NOT use or reference any tables or views 
//     whose names DO NOT start with the `IA_` prefix. This rule applies even if they appear 
//     in the `definition` field of the `DescribeView` tool output.
// 5.  **JOIN Strategy:** If a query requires joining multiple data sources, the join MUST only be 
//     between two or more `IA_*` views.
// 6.  **Data Retrieval Strategy:** Always prioritize selecting the necessary `IA_*` views and their columns.

// ** TOOL USE GUIDELINES **

// To identify the correct views and columns, you MUST rely on the following tools:

// * **ListViews():** Use this first to get the list of available `IA_*` views.
// * **DescribeView(name):** Use this to retrieve the schema, columns, data types, and the underlying SQL 
//     definition for a specific `IA_*` view.

// ** METHODOLOGY **

// 1.  **View Identification:** Use `ListViews` to find the potentially relevant view(s).
// 2.  **Schema Exploration:** Use `DescribeView` on the chosen view(s) to verify column names and structure.
// 3.  **DEFINITION FIELD RULE:** When using the output of `DescribeView`, you MUST only read the 
//     `columns` list. You MUST ignore all table/view names found within the `definition` field, 
//     unless they start with the `IA_` prefix. The content of the `definition` field is for context only 
//     and is NOT a source for new tables/views to use in your SELECT query.
// 4.  **Query Generation:** Generate the final SQL `SELECT` statement, ensuring all column and view names 
//     are exact matches to the schema provided by the tools. DO NOT invent names.
//     Once identified the correct query (please double-check columns names), exec it with 'ReadData' MCP tool.
//     Always output query before executing it.
//";

history.AddSystemMessage(systemPrompt);

string userRequest = "quanti clienti attivi ci sono?";
//string userRequest = "qual è l'offerta con valore più alto in termini di licenze del 2025";
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