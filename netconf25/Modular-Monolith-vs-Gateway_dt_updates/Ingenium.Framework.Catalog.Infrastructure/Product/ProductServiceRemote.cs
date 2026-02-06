using Ingenium.Framework.Catalog.Domain.Interfaces;
using Ingenium.Framework.Catalog.Domain.Models;
using System.Text.Json;

namespace Ingenium.Framework.Catalog.Infrastructure.Services
{
    public class ProductServiceRemote : IProductService
    {                
        private readonly RemoteCatalogService _remoteCatalogService;

        public ProductServiceRemote(RemoteCatalogService remoteCatalogService)
        {
            _remoteCatalogService = remoteCatalogService;
        }

        public async Task<Product> GetProductAsync(int id)
        {
            return await _remoteCatalogService.GetProductAsync(id);
        }

        #region Not implemented members

        public Task<Domain.Models.Product> CreateProductAsync(Domain.Models.Product product)
        {
            throw new NotImplementedException();
        }

        public Task<bool> DeleteProductAsync(int id)
        {
            throw new NotImplementedException();
        }

        public Task<IEnumerable<Domain.Models.Product>> GetProductsAsync()
        {
            throw new NotImplementedException();
        }

        public Task<Domain.Models.Product> UpdateProductAsync(Domain.Models.Product product)
        {
            throw new NotImplementedException();
        }

        #endregion
    }
}
