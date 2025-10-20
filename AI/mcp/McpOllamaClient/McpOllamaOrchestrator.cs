using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace McpOllamaClient
{
  public class McpOllamaOrchestrator : IAsyncDisposable
  {
    private readonly McpClient _mcpClient;
    private readonly OllamaClient _ollamaClient;
    private List<McpTool> _availableTools = new();

    public McpOllamaOrchestrator(string mcpServerPath, string mcpDBConnstr, string ollamaUrl, string ollamaModel)
    {
      _mcpClient = new McpClient(mcpServerPath, mcpDBConnstr);
      _ollamaClient = new OllamaClient(ollamaUrl, ollamaModel);
    }

    public async Task InitializeAsync()
    {
      Console.WriteLine("Avvio MCP Server...");
      await _mcpClient.ConnectAsync();

      Console.WriteLine("Recupero tools disponibili...");
      _availableTools = await _mcpClient.GetToolsAsync();

      Console.WriteLine($"Tools disponibili: {_availableTools.Count}");
      foreach (var tool in _availableTools)
      {
        Console.WriteLine($"  - {tool.Name}: {tool.Description}");
      }
    }

    public async Task ProcessUserQueryAsync(string userQuery)
    {
      var conversationHistory = new List<OllamaMessage>
        {
            new OllamaMessage { Role = "user", Content = userQuery }
        };

      const int maxIterations = 5;
      for (int i = 0; i < maxIterations; i++)
      {
        var response = await _ollamaClient.ChatAsync(conversationHistory, _availableTools);

        // Aggiungi risposta assistente alla cronologia
        conversationHistory.Add(new OllamaMessage
        {
          Role = "assistant",
          Content = response.Content,
          ToolCalls = response.ToolCalls
        });

        Console.WriteLine($"\nAssistente: {response.Content}\n");

        // Se non ci sono tool calls, siamo alla risposta finale
        if (response.ToolCalls == null || response.ToolCalls.Count == 0)
        {
          Console.WriteLine($"no tools call - fine");
          break;
        }

        // Esegui i tool calls
        Console.WriteLine($"\n[Eseguo {response.ToolCalls.Count} tool call(s)...]");
        foreach (var toolCall in response.ToolCalls)
        {
          Console.WriteLine($"  Tool: {toolCall.Function.Name}");

          var toolResult = await _mcpClient.ExecuteToolAsync(
              toolCall.Function.Name,
              toolCall.Function.Arguments
          );

          // Aggiungi risultato alla cronologia
          conversationHistory.Add(new OllamaMessage
          {
            Role = "tool",
            Content = toolResult
          });
        }
      }
    }

    public async ValueTask DisposeAsync()
    {
      await _mcpClient.DisconnectAsync();
      _ollamaClient.Dispose();
    }
  }


}
