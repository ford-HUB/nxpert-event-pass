using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class RegistrationSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations");

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Registrations",
                type: "datetime2",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DeletedByUserId",
                table: "Registrations",
                type: "int",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "SessionId", "UserId" },
                unique: true,
                filter: "[UserId] IS NOT NULL AND [DeletedAt] IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "Registrations");

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "SessionId", "UserId" },
                unique: true,
                filter: "[UserId] IS NOT NULL");
        }
    }
}
