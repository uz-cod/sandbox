using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.EF
{
    public class Scimmia
    {
        public int Id { get; set; }
        public string Nome { get; set; }
        public string Specie { get; set; }
        public string Pelliccia { get; set; }

        public int ZooId { get; set; }

        public Zoo Zoo { get; set; }
    }
}
