using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DAL.EF
{
    public class ScimmiaConfiguration : IEntityTypeConfiguration<Scimmia>
    {
        public void Configure(EntityTypeBuilder<Scimmia> builder)
        {
            builder.HasKey(s => s.Id);
            builder.Property(s => s.Nome).IsRequired().HasMaxLength(50);
            builder.Property(s => s.Specie).IsRequired().HasMaxLength(50);

            builder
                .HasOne(s => s.Zoo)
                .WithMany(z => z.Scimmie)
                .HasForeignKey(s => s.ZooId);
        }
    }
}
