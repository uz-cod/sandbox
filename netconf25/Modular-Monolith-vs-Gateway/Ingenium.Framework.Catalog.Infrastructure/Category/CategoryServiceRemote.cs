using Ingenium.Framework.Catalog.Domain.Interfaces;

namespace Ingenium.Framework.Catalog.Infrastructure.Services
{
    public class CategoryServiceRemote : ICategoryService
    {
        public Task<Domain.Models.Category> CreateCategoryAsync(Domain.Models.Category category)
        {
            throw new NotImplementedException();
        }

        public Task<bool> DeleteCategoryAsync(int id)
        {
            throw new NotImplementedException();
        }

        public Task<IEnumerable<Domain.Models.Category>> GetCategoriesAsync()
        {
            throw new NotImplementedException();
        }

        public Task<Domain.Models.Category> GetCategoryAsync(int id)
        {
            throw new NotImplementedException();
        }

        public Task<Domain.Models.Category> UpdateCategoryAsync(Domain.Models.Category category)
        {
            throw new NotImplementedException();
        }
    }
}
