using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.EF
{
    internal class ZooConfiguration : IEntityTypeConfiguration<Zoo>
    {
        public void Configure(EntityTypeBuilder<Zoo> builder)
        {
            builder.HasKey(z => z.Id);
            builder.Property(z => z.Nome).IsRequired().HasMaxLength(80);
            builder.Property(z => z.Citta).IsRequired().HasMaxLength(100);
        }
    }
}
