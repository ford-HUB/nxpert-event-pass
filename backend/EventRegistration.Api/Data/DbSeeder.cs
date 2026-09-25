using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Data;

public static class DbSeeder
{
    public static async Task SeedAsync(AppDbContext db)
    {
        // Migrations are applied in Program.cs (gated by Database:AutoMigrate); the seeder assumes
        // the schema already exists and only inserts demo data into an empty database.
        if (!await db.Users.AnyAsync())
        {
            db.Users.Add(new User
            {
                FullName = "Demo Admin",
                Email = "admin@demo.com",
                Username = "admin",
                PasswordHash = PasswordHasher.Hash("Admin123!"),
                Role = Roles.Admin,
                Organization = "N-Pax",
                CompanyId = 1,
                EmailVerified = true,
            });

            var contacts = new (string name, string email, string org)[]
            {
                ("Alice Nguyen",   "alice@example.com",   "Contoso"),
                ("Bob Martinez",   "bob@example.com",     "Fabrikam"),
                ("Carla Silva",    "carla@example.com",   "Northwind"),
                ("David Okoro",    "david@example.com",   "Contoso"),
                ("Emma Johansson", "emma@example.com",    "Adventure Works"),
            };
            foreach (var (name, email, org) in contacts)
            {
                var parts = name.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                var first = parts.Length > 0 ? parts[0] : name;
                var last = parts.Length > 1 ? parts[^1] : "";
                db.Users.Add(new User
                {
                    FullName = name,
                    FirstName = first,
                    LastName = last,
                    Email = email,
                    Username = UsernameHelper.Base(first, last, name),
                    PasswordHash = PasswordHasher.Hash("Passw0rd!"),
                    Role = Roles.Participant,
                    Organization = org,
                    CompanyId = 1,
                    EmailVerified = true,
                });
            }
            await db.SaveChangesAsync();
        }

        if (!await db.Events.AnyAsync())
        {
            var admin = await db.Users.FirstAsync(u => u.Role == Roles.Admin);
            db.Events.Add(new Event
            {
                Title = "Q3 Product Seminar",
                Description = "Join us for a hands-on look at our Q3 product roadmap, live demos, and networking.",
                StartsAt = DateTime.Today.AddDays(7).AddHours(9),
                EndsAt = DateTime.Today.AddDays(7).AddHours(12),
                Venue = "N-Pax HQ, Auditorium A",
                IsPublicLinkEnabled = true,
                Status = EventStatus.Published,
                CreatedByUserId = admin.Id,
                CompanyId = 1,
                PublicSlug = "q3-product-seminar-demo01",
            });
            await db.SaveChangesAsync();
        }
    }
}
