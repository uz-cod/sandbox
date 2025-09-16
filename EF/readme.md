## Componenti principali di EF Core

### 1. **DbContext**

Il `DbContext` è il **cuore** di EF Core. Rappresenta una **sessione con il database** e permette di:

- Gestire la connessione al database
- Mappare le entità alle tabelle
- Tracciare le modifiche sulle entità
- Salvare i dati (SaveChanges)
- Fornire accesso ai DbSet<> per eseguire query

**Esempio**:

```csharp
public class AppDbContext : DbContext
{
    public DbSet<Customer> Customers { get; set; }

    public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options) { }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // configurazioni con Fluent API
    }
}
```

---

### 2. **Provider di database**

EF Core è **agnostico rispetto al database**: usa i provider per supportare database diversi (SQL Server, PostgreSQL, SQLite, MySQL, ecc.)
Esiste anche una version InMemoryDatabase usato per i test

**Esempio**:

```csharp
options.UseSqlServer("connessione");
```

---

### 3. **DbSet<T>**

Ogni `DbSet<T>` rappresenta una **tabella del database** e fornisce metodi per eseguire query, aggiunte, aggiornamenti e cancellazioni.

**Esempio**:

```csharp
context.Clienti.Add(new Cliente { Nome = "Mario" });
```

---

### 4. **Entity Classes**

Le classi entità sono **POCO** che rappresentano righe delle tabelle. Sono mappate automaticamente o manualmente al database.

**Esempio**:

```csharp
public class Cliente
{
    public int Id { get; set; }
    public string Nome { get; set; }
}
```

---

### 5. **Model & Fluent API**

Il modello è la rappresentazione interna dello schema del database. Può essere configurato:

- Implicitamente (convention-based)
- Esplicitamente (Fluent API o Data Annotations)

**Esempio Fluent API**:

```csharp
modelBuilder.Entity<Cliente>()
    .HasKey(c => c.Id);
```

---

### 6. **Change Tracker**

EF tiene traccia delle modifiche alle entità in memoria, e sa **quali operazioni eseguire** al momento del `SaveChanges()`:

- Inserimenti
- Aggiornamenti
- Cancellazioni

# Query e Accesso ai Dati

- AsNoTracking, AsSplitQuery, AsSingleQuery
- Query su vista (DbQuery, ToView)
- Proiezioni con Select, DTO e performance

## Gestione tabelle con dati multipli usando ereditarietà

Vedere ConsoleEF dove c'è una classe base configurazione e vari elementi specializzati memorizzati all'interno

# Persistenza e Tracciamento

- SaveChanges() e SaveChangesAsync()
- Change Tracker e ciclo di vita degli oggetti
- Gestione della concorrenza: Concurrency Token, RowVersion
- Audit Fields (CreatedDate, ModifiedBy, ecc.)
  - Interceptor, override SaveChanges, shadow properties
- Transazioni
- BeginTransaction, UseTransaction, ExecutionStrategy

# Esempio di AuditInterceptor con EF Core

Questo esempio mostra come implementare un `ISaveChangesInterceptor` per aggiornare automaticamente i campi di auditing:

- `CreatedAt`, `UpdatedAt`
- `CreatedBy`, `UpdatedBy` (usando `ILoggedUser`)

---

## Interfaccia ILoggedUser

```csharp
public interface ILoggedUser
{
    string GetUserId();
}

public interface ITimeService
{
    DateTime UtcNow();
}
```

---

## Interceptor di Audit

```csharp
public class AuditInterceptor : SaveChangesInterceptor
{
    private readonly ILoggedUser _user;
    private readonly ITimeService _timeService;

    public AuditInterceptor(ILoggedUser user, ITimeService timeService)
    {
        _user = user;
        _timeService = timeservice;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var context = eventData.Context;

        if (context == null)
            return base.SavingChangesAsync(eventData, result, cancellationToken);

        var entries = context.ChangeTracker.Entries()
            .Where(e => e.State == EntityState.Added || e.State == EntityState.Modified);

        var now = _timeService.UtcNow();
        var userId = _user.GetUserId();

        foreach (var entry in entries)
        {
            if (entry.State == EntityState.Added)
            {
                if (entry.Properties.Any(p => p.Metadata.Name == "CreatedAt"))
                    entry.Property("CreatedAt").CurrentValue = now;
                if (entry.Properties.Any(p => p.Metadata.Name == "CreatedBy"))
                    entry.Property("CreatedBy").CurrentValue = userId;
            }

            if (entry.Properties.Any(p => p.Metadata.Name == "UpdatedAt"))
                entry.Property("UpdatedAt").CurrentValue = now;
            if (entry.Properties.Any(p => p.Metadata.Name == "UpdatedBy"))
                entry.Property("UpdatedBy").CurrentValue = userId;
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
```

---

## Registrazione nel Dependency Injection

```csharp
services.AddScoped<ISaveChangesInterceptor, AuditInterceptor>();
services.AddScoped<ILoggedUser, LoggedUser>();
services.AddScoped<ITimeService, TimeService>();
```

## Generazione ID Custom

Mattia ha già implementato la classe
HasValueGenerator / HasValueGeneratorFactory

<https://github.com/karenpayneoregon/ef-core-HasValueGenerator-1/blob/master/EntityOperations/Context/CustomerContext.cs>
