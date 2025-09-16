using DAL.EF;

using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

// For more information on enabling Web API for empty projects, visit https://go.microsoft.com/fwlink/?LinkID=397860

namespace WebApplicationEF.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class ZoosController : ControllerBase
    {
        private readonly IDbContextFactory<ExampleDataContext> dbContextFactory;

        public ZoosController(IDbContextFactory<ExampleDataContext> dbContextFactory)
        {
            this.dbContextFactory = dbContextFactory;
        }

        // GET: api/<ZoosController>
        [HttpGet]
        public IResult Get()
        {
            using var context = dbContextFactory.CreateDbContext();
            var result = context.Zoos
                .Include(x => x.Scimmie)
                .Select(z => new
                {
                    z.Id,
                    z.Nome,
                    Scimmie = z.Scimmie.Select(s => new
                    {
                        s.Id,
                        s.Nome,
                        s.Pelliccia
                    })
                })
                .OrderByDescending(x=> x.Nome)
                .ToList();

            return TypedResults.Ok(result);
        }

        // GET api/<ZoosController>/5
        [HttpGet("{id}")]
        public Zoo Get(int id)
        {
            using var context = dbContextFactory.CreateDbContext();
            return context.Zoos.Find(id);
        }

        // POST api/<ZoosController>
        [HttpPost]
        public Zoo Post([FromBody] Zoo value)
        {
            using var context = dbContextFactory.CreateDbContext();
            context.Zoos.Add(value);
            context.SaveChanges();
            return value;
        }

        // PUT api/<ZoosController>/5
        [HttpPut("{id}")]
        public IResult Put(int id, [FromBody] Zoo value)
        {
            using var context = dbContextFactory.CreateDbContext();
            var zoo = context.Zoos.Find(id);
            if (zoo == null)
            {
                return TypedResults.NotFound(new NotFoundObjectResult(id));
            }
            zoo.Nome = value.Nome;
            zoo.Citta = value.Citta;
            zoo.Nazione = value.Nazione;
            context.SaveChanges();
            return TypedResults.NoContent();
        }

        // DELETE api/<ZoosController>/5
        [HttpDelete("{id}")]
        public void Delete(int id)
        {
            using var context = dbContextFactory.CreateDbContext();
            var zoo = context.Zoos.Find(id);
            context.Zoos.Remove(zoo);
            context.SaveChanges();
        }

        [HttpPost("{id}/scimmia")]
        public IResult AddScimmia(int id, [FromBody] ScimmiaDto value)
        {
            using var context = dbContextFactory.CreateDbContext();
            var zoo = context.Zoos.Find(id);
            if (zoo == null)
            {
                return TypedResults.NotFound(new { message = $"ID {id} not found." });
            }
            var created = (context.Scimmie.Add(new Scimmia
            {
                Nome = value.Nome,
                Pelliccia = value.Pelliccia,
                Specie = value.Specie,
                ZooId = id
            })).Entity;
            context.SaveChanges();

            return TypedResults.Ok(new
            {
                created.Id,
                created.Nome,
                created.Pelliccia,
                created.Specie,
                created.ZooId
            });
        }
    }
}
