using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace ACME.CartCustom.Domain.Models
{
    public class CustomerDiscount
    {
        public int CustomerId { get; set; }
        public decimal Discount { get; set; }
    }
}
