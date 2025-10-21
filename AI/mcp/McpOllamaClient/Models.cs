using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace McpOllamaClient
{
  public class McpTool
  {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string Description { get; set; } = "";

    [JsonPropertyName("inputSchema")]
    public Dictionary<string, object> InputSchema { get; set; } = new();
  }

  public class McpToolsResponse
  {
    [JsonPropertyName("result")]
    public McpToolsResponseTools ResTools { get; set; } = new();
  }

  public class McpToolsResponseTools
  {
    [JsonPropertyName("tools")]
    public List<McpTool> Tools { get; set; } = new();
  }


  public class McpToolResult
  {
    [JsonPropertyName("content")]
    public List<McpContent> Content { get; set; } = new();
  }

  public class McpContent
  {
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("text")]
    public string? Text { get; set; }
  }

  public class OllamaStreamResponseChunk
  {
    [JsonPropertyName("message")]
    public OllamaMessage? Message { get; set; }

    [JsonPropertyName("done")]
    public bool Done { get; set; }
  }
  public class OllamaMessage
  {
    [JsonPropertyName("role")]
    public string Role { get; set; } = "";

    [JsonPropertyName("content")]
    public string Content { get; set; } = "";

    [JsonPropertyName("tool_calls")]
    public List<OllamaToolCall>? ToolCalls { get; set; }
  }

  public class OllamaToolCall
  {
    [JsonPropertyName("function")]
    public OllamaFunction Function { get; set; } = new();
  }

  public class OllamaFunction
  {
    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("arguments")]
    public Dictionary<string, object> Arguments { get; set; } = new();
  }

  public class OllamaResponse
  {
    public string Content { get; set; } = "";
    public List<OllamaToolCall>? ToolCalls { get; set; }
  }
  public class OllamaApiResponse
  {
    [JsonPropertyName("message")]
    public OllamaMessage? Message { get; set; }
  }
}
