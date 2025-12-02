using Microsoft.SemanticKernel;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace McpOllamaClient_SemanticKernel
{
  public class ToolLoggingFilter : IFunctionInvocationFilter
  {
    public async Task OnFunctionInvocationAsync(FunctionInvocationContext context, Func<FunctionInvocationContext, Task> next)
    {
      // --- PRE-ESECUZIONE (Equivalente a FunctionInvoking) ---
      Console.ForegroundColor = ConsoleColor.Yellow;
      Console.WriteLine($"\n[AI DECISION] Qwen sta chiamando: '{context.Function.Name}'");

      if (context.Arguments.Count > 0)
      {
        Console.WriteLine("[PARAMS] Arguments:");
        foreach (var arg in context.Arguments)
        {
          // Visualizza nome e valore dell'argomento
          Console.WriteLine($"   - {arg.Key}: {arg.Value}");
        }
      }
      else
      {
        Console.WriteLine("[PARAMS] Nessun argomento.");
      }
      Console.ResetColor();

      // --- ESEGUI LA FUNZIONE REALE (Il tuo tool MCP) ---
      try
      {
        await next(context); // Passa il controllo al prossimo step
      }
      catch (Exception ex)
      {
        Console.ForegroundColor = ConsoleColor.Red;
        Console.WriteLine($"[ERROR] Errore durante l'esecuzione del tool: {ex.Message}");
        Console.ResetColor();
        throw; // Rilancia l'errore per farlo gestire a SK
      }

      // --- POST-ESECUZIONE (Equivalente a FunctionInvoked) ---
      Console.ForegroundColor = ConsoleColor.Cyan;

      try
      {
        // Recuperiamo il risultato dal contesto
        var result = context.Result;
        string resultString = result?.ToString() ?? "NULL";

        string jsonFormatted = FormatNestedJson(resultString);
        if (jsonFormatted.Length >1000)
           jsonFormatted = jsonFormatted.Substring(0, 300) + "... [Output troncato per console]";

        Console.WriteLine($"[MCP RESPONSE]\n{jsonFormatted}");


        Console.ResetColor();
      }
      catch (Exception ex) 
      {
        Console.WriteLine($"ERROR! " + ex.Message);
      }
    }

    public static string FormatNestedJson(string rawInput)
    {
      // 1. Parsing dell'involucro esterno per estrarre la stringa target.
      // Usiamo JsonDocument per navigare nella struttura: $.content[0].text
      using var outerDoc = JsonDocument.Parse(rawInput);

      // Estraiamo il valore del campo 'text'. 
      // La prima deserializzazione gestisce l'unescaping delle virgolette (\u0022 -> ")
      string innerJsonString = outerDoc.RootElement
                                       .GetProperty("content")[0]
                                       .GetProperty("text").GetString()!;

      // 2. Parsing del JSON interno (il tuo DbOperationResult).
      // Questo è il contenuto che vogliamo formattare.
      using var innerDoc = JsonDocument.Parse(innerJsonString);

      // 3. Serializzazione con indentazione (Pretty-Print).
      var options = new JsonSerializerOptions
      {
        WriteIndented = true,
        // L'encoder rilassato è utile per non codificare caratteri come \\r\\n o lettere accentate all'interno del codice SQL
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
      };

      return JsonSerializer.Serialize(innerDoc.RootElement, options);
    }

  }
}
