using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class MealStubValidity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var seed = new DateTime(2000, 1, 1);

            migrationBuilder.AddColumn<DateTime>(
                name: "ValidFrom", table: "Meals", type: "datetime2", nullable: false, defaultValue: seed);
            migrationBuilder.AddColumn<DateTime>(
                name: "ValidTo", table: "Meals", type: "datetime2", nullable: false, defaultValue: seed);
            migrationBuilder.AddColumn<DateTime>(
                name: "ValidFrom", table: "MealStubs", type: "datetime2", nullable: false, defaultValue: seed);
            migrationBuilder.AddColumn<DateTime>(
                name: "ValidTo", table: "MealStubs", type: "datetime2", nullable: false, defaultValue: seed);

            // Backfill existing rows: default a stub's validity to its event's date range.
            migrationBuilder.Sql(
                "UPDATE m SET m.ValidFrom = CAST(e.StartsAt AS date), m.ValidTo = CAST(e.EndsAt AS date) " +
                "FROM Meals m INNER JOIN Events e ON e.Id = m.EventId;");
            migrationBuilder.Sql(
                "UPDATE ms SET ms.ValidFrom = CAST(e.StartsAt AS date), ms.ValidTo = CAST(e.EndsAt AS date) " +
                "FROM MealStubs ms INNER JOIN Registrations r ON r.Id = ms.RegistrationId " +
                "INNER JOIN Events e ON e.Id = r.EventId;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "ValidFrom", table: "Meals");
            migrationBuilder.DropColumn(name: "ValidTo", table: "Meals");
            migrationBuilder.DropColumn(name: "ValidFrom", table: "MealStubs");
            migrationBuilder.DropColumn(name: "ValidTo", table: "MealStubs");
        }
    }
}
