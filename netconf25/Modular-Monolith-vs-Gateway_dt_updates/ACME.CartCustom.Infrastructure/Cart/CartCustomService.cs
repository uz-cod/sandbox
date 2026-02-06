using ACME.CartCustom.Domain.Interfaces;
using ACME.CartCustom.Domain.Models;

namespace ACME.CartCustom.Infrastructure.Services
{
    public class CartCustomService : ICartCustomService
    {
        public CartCustomService() 
        { 
        
        }

        public async Task<CustomerDiscount> GetCustomerDiscountAsync(int customerId)
        {
            switch (customerId)
            {
                case 1:
                    return await Task.FromResult(new CustomerDiscount { CustomerId = customerId, Discount = 10.0m });
                case 2:
                    return await Task.FromResult(new CustomerDiscount { CustomerId = customerId, Discount = 15.0m });                    
                default:
                    return await Task.FromResult(new CustomerDiscount { CustomerId = customerId, Discount = 0.0m });                    
            }
        }
    }
}
