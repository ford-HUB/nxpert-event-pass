using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class RegistrationConfirmation : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ConfirmedAt",
                table: "Registrations",
                type: "datetime2",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ConfirmedAt",
                table: "Registrations");
        }
    }
}
