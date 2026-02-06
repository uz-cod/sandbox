using ACME.CartCustom.Domain.Interfaces;
using Ingenium.Framework.Cart.Infrastructure.Services;
using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Domain.Models;
using Ingenium.Framework.Core.Data;

namespace ACME.CartCustom.Infrastructure.Services
{
    /// <summary>
    /// Extends the CartService to apply the customer discount
    /// </summary>
    public class CartExtendedService : CartService
    {
        private readonly ICartCustomService _cartCustomService;

        public CartExtendedService(EcommerceContext context, IProductService productService, ICartCustomService cartCustomService) : base(context, productService)
        {
            _cartCustomService = cartCustomService;
        }

        /// <summary>
        /// Override the PreAddProductToCart method to apply the customer discount
        /// </summary>
        /// <param name="customerId"></param>
        /// <param name="product"></param>
        /// <param name="quantity"></param>
        /// <returns></returns>
        public async override Task PreAddProductToCart(int customerId, Product product,int quantity)
        {
            await base.PreAddProductToCart(customerId, product, quantity);
            
            var customerDiscount = await _cartCustomService.GetCustomerDiscountAsync(customerId);

            product.Price = product.Price * ((100m - customerDiscount.Discount)/100m);

        }        
    }
}
