using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Domain.Models;
using Ingenium.Framework.Core.Data;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using DataModels = Ingenium.Framework.Core.Data.Models;

namespace Ingenium.Framework.Catalog.Infrastructure.Services
{
    public class ProductService : IProductService
    {
        private readonly EcommerceContext _context;

        public ProductService(EcommerceContext context)
        {
            _context = context;
        }

        public async Task<Product> CreateProductAsync(Product product)
        {
            var entity = new DataModels.Product { Code = product.Code, Name = product.Name };
            _context.Product.Add(entity);
            await _context.SaveChangesAsync();
            product.Id = entity.Id;
            return product;
        }

        public async Task<bool> DeleteProductAsync(int id)
        {
            var entity = await _context.Product.SingleOrDefaultAsync(c => c.Id == id);
            if (entity == null)
            {
                return false;
            }

            try
            {
                _context.Product.Remove(entity);
                await _context.SaveChangesAsync();
                return true;
            }
            catch (Exception ex)
            {
                return false;
            }
        }

        public async Task<IEnumerable<Product>> GetProductsAsync()
        {
            return await _context.Product.Select(c => new Product { Id = c.Id, Code = c.Code, Name = c.Name, Description=c.Description, CategoryId = c.CategoryId, Price=c.Price }).ToListAsync();
        }

        public async Task<Product> GetProductAsync(int id)
        {
            return await _context.Product.Where(c => c.Id == id).Select(c => new Product { Id = c.Id, Code = c.Code, Name = c.Name, Description = c.Description, CategoryId = c.CategoryId, Price = c.Price }).SingleOrDefaultAsync();

        }

        public async Task<Product> UpdateProductAsync(Product category)
        {
            var entity = await _context.Product.SingleOrDefaultAsync(c => c.Id == category.Id);
            if (entity == null)
            {
                return null;
            }

            try
            {
                entity.Code = category.Code;
                entity.Name = category.Name;
                await _context.SaveChangesAsync();
                return category;
            }
            catch (Exception ex)
            {
                return null;
            }
        }
    }
}
