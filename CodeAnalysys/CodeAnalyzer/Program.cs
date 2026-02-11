using LibGit2Sharp;
using Microsoft.Build.Locator;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.MSBuild;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

public class SolutionDiffAnalyzer
{
  private readonly HttpClient _httpClient;

  static async Task Main(string[] args)
  {
    var analyzer = new SolutionDiffAnalyzer();

    var repoRoot = @"C:\dev\lyra\lyra.master";
    var slnPath = @$"{repoRoot}\LyraWebApplication\LyraWebApplication.sln";
    var branch1 = "master";
    var branch2 = "tck260012963_lyrax-modalita-lista-griglia-righe-notespese";

    using var repo = new Repository(repoRoot);
    var results = await analyzer.AnalyzeAllProjects(repo, slnPath, branch1, branch2);

    // Salva report
    await File.WriteAllTextAsync(
        "diff-report.md",
        string.Join("\n\n", results.Select(r => $"## {r.Key}\n{r.Value}"))
    );

    Console.WriteLine($"\nAnalisi completata: {results.Count} file modificati");
  }

  static SolutionDiffAnalyzer()
  {
    // Necessario per MSBuildWorkspace
    MSBuildLocator.RegisterDefaults();
  }

  public SolutionDiffAnalyzer()
  {
    _httpClient = new HttpClient
    {
      BaseAddress = new Uri("http://localhost:11434")
    };
  }

  public async Task<Dictionary<string, string>> AnalyzeAllProjects(
      Repository repo,
      string solutionPath,
      string branch1Name,
      string branch2Name)
  {
    var results = new Dictionary<string, string>();

    // Crea workspace e carica la solution
    using var workspace = MSBuildWorkspace.Create();

    workspace.RegisterWorkspaceFailedHandler((arg) =>
    {
      Console.WriteLine($"Warning: {arg.Diagnostic.Message}");
    });

    var sln = await workspace.OpenSolutionAsync(solutionPath);

    Console.WriteLine($"Analizzando {sln.Projects.Count()} progetti...");

    // Analizza ogni progetto nella solution
    foreach (var project in sln.Projects)
    {
      Console.WriteLine($"Progetto: {project.Name}");

      // Analizza ogni documento (file .cs) nel progetto
      foreach (var document in project.Documents)
      {
        // Salta file generati automaticamente
        if (document.Name.EndsWith(".g.cs") ||
            document.Name.EndsWith(".Designer.cs"))
          continue;

        // Salta file in cartelle bin o obj
        if (document.FilePath != null)
        {
          var normalizedPath = document.FilePath.Replace("/", "\\");
          if (normalizedPath.Contains("\\bin\\") ||
              normalizedPath.Contains("\\obj\\"))
          {
            continue;
          }
        }

        //var slnFileRelativePath = GetRelativePath(solutionPath, document.FilePath);
        var repoFileRelativePath = GetRelativePath(repo.Info.WorkingDirectory, document.FilePath);

        try
        {
          var analysis = await AnalyzeDocumentDifferences(
              repo,
              branch1Name,
              branch2Name,
              repoFileRelativePath);

          if (!string.IsNullOrEmpty(analysis))
          {
            results[repoFileRelativePath] = analysis;
            Console.WriteLine($"{repoFileRelativePath} - differenze trovate");
          }
        }
        catch (Exception ex)
        {
          Console.WriteLine($"{repoFileRelativePath} - errore: {ex.Message}");
        }
      }
    }

    var finalReport = await GenerateFinalReport(results);

    return results;
  }

  private async Task<string> AnalyzeDocumentDifferences(
    Repository repository,
    string branch1Name,
    string branch2Name,
    string fileRelativePath)
  {
    var diffContext = new StringBuilder();
    string gitPath = fileRelativePath.Replace("\\", "/");
    diffContext.AppendLine($"File: {gitPath}");

    // Ottieni codice da entrambi i branch
    var code1 = await GetCodeFromBranch(repository, branch1Name, gitPath);
    var code2 = await GetCodeFromBranch(repository, branch2Name, gitPath);

    // CASO 1: File aggiunto in branch2 (esiste solo in branch2)
    if (string.IsNullOrEmpty(code1) && !string.IsNullOrEmpty(code2))
    {
      diffContext.AppendLine($"\n✓ FILE AGGIUNTO in '{branch2Name}'");
      diffContext.AppendLine($"Righe: {code2.Split('\n').Length}");
      diffContext.AppendLine($"Contenuto (preview):\n{TruncateCode(code2, 500)}");
      return diffContext.ToString();
    }

    // CASO 2: File rimosso in branch2 (esiste solo in branch1)
    if (!string.IsNullOrEmpty(code1) && string.IsNullOrEmpty(code2))
    {
      diffContext.AppendLine($"\n✗ FILE RIMOSSO in '{branch2Name}'");
      diffContext.AppendLine($"Righe rimosse: {code1.Split('\n').Length}");
      diffContext.AppendLine($"Contenuto originale (preview):\n{TruncateCode(code1, 500)}");
      return diffContext.ToString();
    }

    // CASO 3: File non esiste in entrambi i branch (errore)
    if (string.IsNullOrEmpty(code1) && string.IsNullOrEmpty(code2))
    {
      diffContext.AppendLine($"\n⚠ FILE NON TROVATO in nessuno dei due branch");
      return diffContext.ToString();
    }

    // CASO 4: File identico
    if (code1 == code2)
    {
      return string.Empty; // Nessuna differenza
    }

    // CASO 5: File modificato - Analisi semantica con Roslyn
    var tree1 = CSharpSyntaxTree.ParseText(code1);
    var tree2 = CSharpSyntaxTree.ParseText(code2);

    // Confronto semantico: ignora whitespace, newlines, indentazioni
    if (tree1.IsEquivalentTo(tree2))
    {
      diffContext.AppendLine($"\n≈ FILE MODIFICATO (solo formattazione/whitespace)");
      return diffContext.ToString();
    }

    var root1 = await tree1.GetRootAsync();
    var root2 = await tree2.GetRootAsync();

    diffContext.AppendLine($"FILE MODIFICATO");

    // Estrai tutti i membri significativi
    var members1 = root1.DescendantNodes()
      .Where(n => n is MemberDeclarationSyntax)
      .Cast<MemberDeclarationSyntax>()
      .ToList();

    var members2 = root2.DescendantNodes()
      .Where(n => n is MemberDeclarationSyntax)
      .Cast<MemberDeclarationSyntax>()
      .ToList();

    // Costruisci una mappa per confronto
    var map1 = new Dictionary<string, MemberDeclarationSyntax>();
    foreach (var member in members1)
    {
      var signature = GetMemberSignature(member);

      if (!map1.TryAdd(signature, member))
      {
        // Non è stato possibile aggiungere - chiave duplicata
        Console.WriteLine($"Duplicato in branch1: {signature}");
        Console.WriteLine($"Tipo membro: {member.Kind()}");
        Console.WriteLine($"Contenuto: {member.ToFullString()}");
      }
    }

    var map2 = new Dictionary<string, MemberDeclarationSyntax>();
    foreach (var member in members2)
    {
      var signature = GetMemberSignature(member);

      if (!map2.TryAdd(signature, member))
      {
        // Non è stato possibile aggiungere - chiave duplicata
        Console.WriteLine($"Duplicato in branch2: {signature}");
        Console.WriteLine($"Tipo membro: {member.Kind()}");
        Console.WriteLine($"Contenuto: {member.ToFullString()}");
      }
    }

    int changeCount = 0;

    // Membri modificati o rimossi
    foreach (var kvp in map1)
    {
      if (!map2.TryGetValue(kvp.Key, out var member2))
      {
        diffContext.AppendLine($"\n--- RIMOSSO: {kvp.Key}");
        changeCount++;
      }
      else if (!kvp.Value.IsEquivalentTo(member2))
      {
        diffContext.AppendLine($"\n--- MODIFICATO: {kvp.Key}");
        diffContext.AppendLine($"Prima:\n{TruncateCode(kvp.Value.ToFullString())}");
        diffContext.AppendLine($"Dopo:\n{TruncateCode(member2.ToFullString())}");
        changeCount++;

        if (changeCount >= 5) break;
      }
    }

    // Membri aggiunti
    if (changeCount < 5)
    {
      foreach (var kvp in map2)
      {
        if (!map1.ContainsKey(kvp.Key))
        {
          diffContext.AppendLine($"\n--- AGGIUNTO: {kvp.Key}");
          changeCount++;
          if (changeCount >= 5) break;
        }
      }
    }

    return diffContext.ToString();
  }

  private string GetMemberSignature(MemberDeclarationSyntax member)
  {
    var signature = new StringBuilder();

    // Tipo di membro
    signature.Append(member.Kind().ToString());
    signature.Append(":");

    // Nome/Identificatore
    var identifier = member switch
    {
      MethodDeclarationSyntax m => m.Identifier.Text,
      PropertyDeclarationSyntax p => p.Identifier.Text,
      ClassDeclarationSyntax cls => cls.Identifier.Text,
      InterfaceDeclarationSyntax iface => iface.Identifier.Text,
      ConstructorDeclarationSyntax ctor => ctor.Identifier.Text,
      FieldDeclarationSyntax field => string.Join(",", field.Declaration.Variables.Select(v => v.Identifier.Text)),
      _ => "Unknown"
    };
    signature.Append(identifier);

    // Parametri (per metodi e costruttori)
    if (member is MethodDeclarationSyntax method)
    {
      signature.Append("(");
      signature.Append(string.Join(",", method.ParameterList.Parameters.Select(p =>
        $"{p.Modifiers}{p.Type?.ToString() ?? "var"}")));
      signature.Append(")");
      signature.Append($":{method.ReturnType}");
    }
    else if (member is ConstructorDeclarationSyntax ctor)
    {
      signature.Append("(");
      signature.Append(string.Join(",", ctor.ParameterList.Parameters.Select(p =>
        $"{p.Modifiers}{p.Type?.ToString() ?? "var"}")));
      signature.Append(")");
    }

    // Tipo (per proprietà e campi)
    if (member is PropertyDeclarationSyntax property)
    {
      signature.Append($":{property.Type}");
    }
    else if (member is FieldDeclarationSyntax field)
    {
      signature.Append($":{field.Declaration.Type}");
    }

    // Modificatori
    var modifiers = member.Modifiers.Select(m => m.Text);
    if (modifiers.Any())
    {
      signature.Append($"|{string.Join(",", modifiers)}");
    }

    return signature.ToString();
  }

  private string TruncateCode(string code, int maxLength = 200)
  {
    if (string.IsNullOrEmpty(code)) return string.Empty;

    code = code.Trim();
    if (code.Length <= maxLength) return code;

    return code.Substring(0, maxLength) + "...";
  }


  private string GetNodeDescription(SyntaxNode node)
  {
    return node switch
    {
      Microsoft.CodeAnalysis.CSharp.Syntax.MethodDeclarationSyntax method
          => $"Metodo: {method.Identifier.ValueText}",
      Microsoft.CodeAnalysis.CSharp.Syntax.PropertyDeclarationSyntax prop
          => $"Proprietà: {prop.Identifier.ValueText}",
      Microsoft.CodeAnalysis.CSharp.Syntax.ClassDeclarationSyntax cls
          => $"Classe: {cls.Identifier.ValueText}",
      Microsoft.CodeAnalysis.CSharp.Syntax.FieldDeclarationSyntax field
          => $"Campo: {field.Declaration.Variables.FirstOrDefault()?.Identifier.ValueText}",
      _ => node.GetType().Name.Replace("Syntax", "")
    };
  }


  private async Task<string> GetCodeFromBranch(Repository repo, string branch, string filePath)
  {
    var targetBranch = repo.Branches.FirstOrDefault(b =>
     b.IsRemote &&
     (b.FriendlyName == $"origin/{branch}" ||
      b.CanonicalName == $"refs/remotes/origin/{branch}"));

    if (targetBranch == null)
    {
      throw new Exception(string.Format("branch not found: {branch}", targetBranch));
      return string.Empty;
    }

    // Ottieni il commit puntato dal branch
    var commit = targetBranch.Tip;

    // Ottieni il tree entry (file) dal commit
    var treeEntry = commit[filePath];

    if (treeEntry == null || treeEntry.TargetType != TreeEntryTargetType.Blob)
    {
      return string.Empty;
    }

    // Leggi il contenuto del blob
    var blob = (Blob)treeEntry.Target;
    return blob.GetContentText();
  }

  private string GetRelativePath(string basePath, string fullPath)
  {
    var baseUri = new Uri(Path.GetDirectoryName(basePath) + Path.DirectorySeparatorChar);
    var fullUri = new Uri(fullPath);
    return baseUri.MakeRelativeUri(fullUri).ToString().Replace('/', Path.DirectorySeparatorChar);
  }

  private async Task<string> GenerateFinalReport(Dictionary<string, string> results)
  {
    var report = new StringBuilder();
    report.AppendLine("# Report Differenze Branch\n");
    report.AppendLine($"Totale file modificati: {results.Count}\n");

    foreach (var (file, analysis) in results)
    {
      report.AppendLine($"## {file}");
      report.AppendLine(analysis);
      report.AppendLine();
    }

    return report.ToString();
  }
}

