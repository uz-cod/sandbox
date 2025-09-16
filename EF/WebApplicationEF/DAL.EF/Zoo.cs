namespace DAL.EF
{
    public class Zoo
    {
        public int Id { get; set; }

        public string Nome { get; set; }

        public string Citta { get; set; }

        public string Nazione { get; set; }

        public List<Scimmia> Scimmie { get; set; }
    }
}