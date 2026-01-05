using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Ingenium.Framework.Cart.Domain.Models;

namespace Ingenium.Framework.Cart.Domain.Interfaces
{
    public interface ICartService
    {
        Task<decimal> AddProductToCartAsync(int customerId, int productId, int quantity);
        Task EmptyCartAsync(int customerId);
        Task<IEnumerable<CartProduct>> GetCartAsync(int customerId);
        Task<decimal> GetCartTotalAsync(int customerId);
    }
}
