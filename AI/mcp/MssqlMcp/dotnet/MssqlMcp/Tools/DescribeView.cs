using System.ComponentModel;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Logging;
using ModelContextProtocol.Server;

namespace Mssql.McpServer;

public partial class Tools
{
    [McpServerTool(
        Title = "Describe View",
        ReadOnly = true,
        Idempotent = true,
        Destructive = false),
        Description("Returns view schema and definition")]
    public async Task<DbOperationResult> DescribeView(
        [Description("Name of view")] string name)
    {
        string? schema = null;
        if (name.Contains('.'))
        {
            var parts = name.Split('.');
            if (parts.Length > 1)
            {
                name = parts[1];
                schema = parts[0];
            }
        }

        // Query per i metadati della vista + DEFINIZIONE SQL (cruciale per le viste)
        const string ViewInfoQuery = @"
            SELECT 
                v.object_id AS id,
                v.name,
                s.name AS [schema],
                v.type_desc AS type,
                ep.value AS description,
                OBJECT_DEFINITION(v.object_id) AS definition
            FROM sys.views v
            INNER JOIN sys.schemas s ON v.schema_id = s.schema_id
            LEFT JOIN sys.extended_properties ep ON ep.major_id = v.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
            WHERE v.name = @ViewName AND (s.name = @ViewSchema OR @ViewSchema IS NULL)";

        // Query per le colonne (cambiato il target in sys.views)
        const string ColumnsQuery = @"
            SELECT c.name, ty.name AS type, c.max_length AS length, c.precision, c.is_nullable AS nullable, p.value AS description
            FROM sys.columns c
            INNER JOIN sys.types ty ON c.user_type_id = ty.user_type_id
            LEFT JOIN sys.extended_properties p ON p.major_id = c.object_id AND p.minor_id = c.column_id AND p.name = 'MS_Description'
            WHERE c.object_id = (SELECT object_id FROM sys.views v INNER JOIN sys.schemas s ON v.schema_id = s.schema_id WHERE v.name = @ViewName and (s.name = @ViewSchema or @ViewSchema IS NULL ) )";

        // Query per gli indici (Le viste indicizzate esistono in SQL Server)
        const string IndexesQuery = @"
            SELECT i.name, i.type_desc AS type, p.value AS description,
            STUFF((SELECT ',' + c.name FROM sys.index_columns ic
                INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id ORDER BY ic.key_ordinal FOR XML PATH('')), 1, 1, '') AS keys
            FROM sys.indexes i
            LEFT JOIN sys.extended_properties p ON p.major_id = i.object_id AND p.minor_id = i.index_id AND p.name = 'MS_Description'
            WHERE i.object_id = ( SELECT object_id FROM sys.views v INNER JOIN sys.schemas s ON v.schema_id = s.schema_id WHERE v.name = @ViewName and (s.name = @ViewSchema or @ViewSchema IS NULL ) )";

        var conn = await _connectionFactory.GetOpenConnectionAsync();
        try
        {
            using (conn)
            {
                var result = new Dictionary<string, object>();

                // View Info & Definition
                using (var cmd = new SqlCommand(ViewInfoQuery, conn))
                {
                    var _ = cmd.Parameters.AddWithValue("@ViewName", name);
                    _ = cmd.Parameters.AddWithValue("@ViewSchema", schema == null ? DBNull.Value : schema);

                    using var reader = await cmd.ExecuteReaderAsync();
                    if (await reader.ReadAsync())
                    {
                        result["view"] = new
                        {
                            id = reader["id"],
                            name = reader["name"],
                            schema = reader["schema"],
                            type = reader["type"],
                            description = reader["description"] is DBNull ? null : reader["description"],
                            definition = reader["definition"] is DBNull ? "N/A" : reader["definition"] // Qui c'è il codice SQL della vista
                        };
                    }
                    else
                    {
                        return new DbOperationResult(success: false, error: $"View '{name}' not found.");
                    }
                }

                // Columns
                using (var cmd = new SqlCommand(ColumnsQuery, conn))
                {
                    var _ = cmd.Parameters.AddWithValue("@ViewName", name);
                    _ = cmd.Parameters.AddWithValue("@ViewSchema", schema == null ? DBNull.Value : schema);

                    using var reader = await cmd.ExecuteReaderAsync();
                    var columns = new List<object>();
                    while (await reader.ReadAsync())
                    {
                        columns.Add(new
                        {
                            name = reader["name"],
                            type = reader["type"],
                            length = reader["length"],
                            precision = reader["precision"],
                            nullable = (bool)reader["nullable"],
                            description = reader["description"] is DBNull ? null : reader["description"]
                        });
                    }
                    result["columns"] = columns;
                }

                // Indexes (per Indexed Views)
                using (var cmd = new SqlCommand(IndexesQuery, conn))
                {
                    var _ = cmd.Parameters.AddWithValue("@ViewName", name);
                    _ = cmd.Parameters.AddWithValue("@ViewSchema", schema == null ? DBNull.Value : schema);

                    using var reader = await cmd.ExecuteReaderAsync();
                    var indexes = new List<object>();
                    while (await reader.ReadAsync())
                    {
                        indexes.Add(new
                        {
                            name = reader["name"],
                            type = reader["type"],
                            description = reader["description"] is DBNull ? null : reader["description"],
                            keys = reader["keys"]
                        });
                    }
                    result["indexes"] = indexes;
                }

                return new DbOperationResult(success: true, data: result);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "DescribeView failed: {Message}", ex.Message);
            return new DbOperationResult(success: false, error: ex.Message);
        }
    }
}