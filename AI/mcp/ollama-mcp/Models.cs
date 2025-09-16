using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace ollama_mcp
{
  public class JsonRpcRequest
  {
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("method")]
    public string Method { get; set; } = string.Empty;

    [JsonPropertyName("params")]
    public object? Params { get; set; }

    [JsonPropertyName("id")]
    public object? Id { get; set; }
  }

  // Risposta JSON-RPC 2.0 (successo)
  public class JsonRpcResponse
  {
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("result")]
    public object? Result { get; set; }

    [JsonPropertyName("id")]
    public object? Id { get; set; }
  }

  // Risposta JSON-RPC 2.0 (errore)
  public class JsonRpcErrorResponse
  {
    [JsonPropertyName("jsonrpc")]
    public string JsonRpc { get; set; } = "2.0";

    [JsonPropertyName("error")]
    public JsonRpcError Error { get; set; } = new();

    [JsonPropertyName("id")]
    public object? Id { get; set; }
  }

  public class JsonRpcError
  {
    [JsonPropertyName("code")]
    public int Code { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public object? Data { get; set; }
  }

  // Codici di errore standard JSON-RPC
  public static class JsonRpcErrorCodes
  {
    public const int ParseError = -32700;
    public const int InvalidRequest = -32600;
    public const int MethodNotFound = -32601;
    public const int InvalidParams = -32602;
    public const int InternalError = -32603;

    // Codici custom (da -32099 a -32000)
    public const int ProcessingError = -32001;
    public const int ValidationError = -32002;
  }

  // Esempi di parametri per metodi specifici
  public class EchoParams
  {
    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;
  }

  public class CalculateParams
  {
    [JsonPropertyName("a")]
    public double A { get; set; }

    [JsonPropertyName("b")]
    public double B { get; set; }

    [JsonPropertyName("operation")]
    public string Operation { get; set; } = string.Empty; // add, subtract, multiply, divide
  }
}
