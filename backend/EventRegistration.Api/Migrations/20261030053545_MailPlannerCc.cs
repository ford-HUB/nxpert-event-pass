using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class MailPlannerCc : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CcJson",
                table: "MailPlans",
                type: "nvarchar(max)",
                nullable: false,
                // Existing plans get an empty CC list, which the API reads as JSON.
                defaultValue: "[]");

            migrationBuilder.AddColumn<bool>(
                name: "IsCc",
                table: "MailPlanDeliveries",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "MailPlanSavedCcs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailPlanSavedCcs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanSavedCcs_Email",
                table: "MailPlanSavedCcs",
                column: "Email",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MailPlanSavedCcs");

            migrationBuilder.DropColumn(
                name: "CcJson",
                table: "MailPlans");

            migrationBuilder.DropColumn(
                name: "IsCc",
                table: "MailPlanDeliveries");
        }
    }
}
