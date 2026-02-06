using ACME.CartCustom.Domain.Models;

namespace ACME.CartCustom.Domain.Interfaces
{
    public interface ICartCustomService
    {
        Task<CustomerDiscount> GetCustomerDiscountAsync(int customerId);
    }
}
