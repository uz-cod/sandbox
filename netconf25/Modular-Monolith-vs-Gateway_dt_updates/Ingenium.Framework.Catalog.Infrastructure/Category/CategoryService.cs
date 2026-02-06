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
    public class CategoryService : ICategoryService
    {
        private readonly EcommerceContext _context;

        public CategoryService(EcommerceContext context) {
            _context = context;
        }

        public async Task<Category> CreateCategoryAsync(Category category)
        {
            var entity = new DataModels.Category { Code = category.Code, Name = category.Name };
            _context.Category.Add(entity);
            await _context.SaveChangesAsync();
            category.Id = entity.Id;
            return category;
        }

        public async Task<bool> DeleteCategoryAsync(int id)
        {
            var entity = await _context.Category.SingleOrDefaultAsync(c => c.Id == id);
            if (entity == null)
            {
                return false;
            }

            try
            {
                _context.Category.Remove(entity);
                await _context.SaveChangesAsync();
                return true;
            }
            catch (Exception ex)
            {
                return false;                
            }
        }

        public async Task<IEnumerable<Category>> GetCategoriesAsync()
        {
            return await _context.Category.Select(c => new Category { Id = c.Id, Code = c.Code, Name = c.Name }).ToListAsync();
        }

        public async Task<Category> GetCategoryAsync(int id)
        {
            return await _context.Category.Where(c => c.Id == id).Select(c => new Category { Id = c.Id, Code = c.Code, Name = c.Name }).SingleOrDefaultAsync();

        }

        public async Task<Category> UpdateCategoryAsync(Category category)
        {
            var entity = await _context.Category.SingleOrDefaultAsync(c => c.Id == category.Id);
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
