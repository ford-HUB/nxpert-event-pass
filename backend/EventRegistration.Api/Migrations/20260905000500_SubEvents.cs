using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class SubEvents : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SessionId",
                table: "Registrations",
                type: "int",
                nullable: true);

            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations");

            migrationBuilder.CreateTable(
                name: "Sessions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    EventId = table.Column<int>(type: "int", nullable: false),
                    Title = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: false),
                    Description = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    StartsAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    EndsAt = table.Column<DateTime>(type: "datetime2", nullable: false),
                    Venue = table.Column<string>(type: "nvarchar(300)", maxLength: 300, nullable: true),
                    Capacity = table.Column<int>(type: "int", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sessions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Sessions_Events_EventId",
                        column: x => x.EventId,
                        principalTable: "Events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "SessionId", "UserId" },
                unique: true,
                filter: "[UserId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_SessionId",
                table: "Registrations",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_EventId",
                table: "Sessions",
                column: "EventId");

            migrationBuilder.AddForeignKey(
                name: "FK_Registrations_Sessions_SessionId",
                table: "Registrations",
                column: "SessionId",
                principalTable: "Sessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.NoAction);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Registrations_Sessions_SessionId",
                table: "Registrations");

            migrationBuilder.DropTable(
                name: "Sessions");

            migrationBuilder.DropIndex(
                name: "IX_Registrations_SessionId",
                table: "Registrations");

            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_SessionId_UserId",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "SessionId",
                table: "Registrations");

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "UserId" },
                unique: true,
                filter: "[UserId] IS NOT NULL");
        }
    }
}
