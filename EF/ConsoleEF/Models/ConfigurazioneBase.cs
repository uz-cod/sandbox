namespace ConfigurazioniDemo.Models;

public abstract class ConfigurazioneBase
{
    public int Id { get; set; }
    public string Nome { get; set; }
}

public class Nazione : ConfigurazioneBase
{
    public string CodiceIso { get; set; }
}

public class Provincia : ConfigurazioneBase
{
    public string CodiceProvincia { get; set; }
    public int NazioneId { get; set; }
}

public class Lingua : ConfigurazioneBase
{
    public string CodiceLingua { get; set; }
}

public class Categoria : ConfigurazioneBase
{
    public string DescrizioneEstesa { get; set; }
}
