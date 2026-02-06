using Ingenium.Framework.Catalog.Domain.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace Ingenium.Framework.Catalog.Infrastructure.Services
{
    public class RemoteCatalogService
    {
        private readonly HttpClient _httpClient;

        public RemoteCatalogService(HttpClient httpClient)
        {
            _httpClient = httpClient;
        }

        public async Task<Product> GetProductAsync(int id)
        {
            var response = await _httpClient.GetAsync($"/ing-catalog/v1/Product/{id}");

            response.EnsureSuccessStatusCode(); // Lancia eccezione se status code 4xx/5xx

            var json = await response.Content.ReadAsStringAsync();

            return System.Text.Json.JsonSerializer.Deserialize<Product>(
                json,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
        }
    }
}
