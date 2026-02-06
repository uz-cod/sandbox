using Ingenium.Framework.Cart.Domain.Interfaces;
using Ingenium.Framework.Cart.Domain.Models;
using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Core.Data;
using Microsoft.EntityFrameworkCore;

namespace Ingenium.Framework.Cart.Infrastructure.Services
{
    public class CartService : ICartService
    {
        private readonly EcommerceContext _context;
        private readonly IProductService _productService;

        public CartService(EcommerceContext context, IProductService productService)
        {
            _context = context;
            _productService = productService;
        }

        /// <summary>
        /// Add a product to the cart
        /// </summary>
        /// <param name="customerId"></param>
        /// <param name="productId"></param>
        /// <returns></returns>
        /// <exception cref="Exception"></exception>
        public async Task<decimal> AddProductToCartAsync(int customerId, int productId, int quantity)
        {
            
            if (quantity <= 0)
            {
                throw new Exception("Quantity must be greater than 0");
            }

            var product = await _productService.GetProductAsync(productId);
            
            await PreAddProductToCart(customerId, product, quantity);

            await AddProductToCartAsync(customerId, product, quantity);
            

            return await GetCartTotalAsync(customerId);
        }
        
        /// <summary>
        /// Performs pre-processing logic before adding a product to a customer's cart. This method can be overridden to
        /// implement custom validation or business rules.
        /// </summary>
        /// <remarks>Override this method in a derived class to implement custom logic that should run
        /// before a product is added to the cart, such as checking inventory or applying business rules. The default
        /// implementation does nothing.</remarks>
        /// <param name="customerId">The unique identifier of the customer for whom the product is being added to the cart.</param>
        /// <param name="product">The product to be added to the cart. Cannot be null.</param>
        /// <param name="quantity">The number of units of the product to add. Must be greater than zero.</param>
        /// <returns>A task that represents the asynchronous operation.</returns>
        public virtual async Task PreAddProductToCart(int customerId, Catalog.Domain.Models.Product product, int quantity)
        {
            //Do nothing
        }

        private async Task AddProductToCartAsync(int customerId, Catalog.Domain.Models.Product product, int quantity)
        {
            if (product == null)
            {
                throw new Exception("Product not found");
            }
            //Check if the product is already in the cart
            var cartProduct = await _context.CartProduct.SingleOrDefaultAsync(c => c.CustomerId == customerId && c.ProductId == product.Id);
            if (cartProduct == null)
            {
                //not found
                cartProduct = new Core.Data.Models.CartProduct { CustomerId = customerId, ProductId = product.Id, Price = product.Price, Quantity = quantity, Total = product.Price * quantity };
                _context.CartProduct.Add(cartProduct);
            }
            else
            {
                //Found, update the quantity, recalculate total
                cartProduct.Quantity += quantity;
                cartProduct.Total = cartProduct.Price * cartProduct.Quantity;
            }

            await _context.SaveChangesAsync();
        }

        public async Task EmptyCartAsync(int customerId)
        {
            _context.CartProduct.RemoveRange(_context.CartProduct.Where(c => c.CustomerId == customerId));
            await _context.SaveChangesAsync();
        }

        public async Task<IEnumerable<CartProduct>> GetCartAsync(int customerId)
        {
            return await _context.CartProduct.Include(cp => cp.Product)
                .Where(c => c.CustomerId == customerId)
                .Select(cp => new CartProduct
                {
                    CustomerId = cp.CustomerId,
                    Id = cp.Id,
                    Price = cp.Price,
                    ProductId = cp.ProductId,
                    ProductName = cp.Product.Name,
                    ProductDescription = cp.Product.Description,
                    Quantity = cp.Quantity,
                    Total = cp.Total
                }).ToListAsync();
        }

        public async Task<decimal> GetCartTotalAsync(int customerId)
        {
            return await _context.CartProduct.Where(c => c.CustomerId == customerId).SumAsync(c => c.Total);
        }
    }
}
