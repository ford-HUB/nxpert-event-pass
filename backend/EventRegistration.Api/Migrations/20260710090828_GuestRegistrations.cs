using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class GuestRegistrations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations");

            migrationBuilder.AlterColumn<int>(
                name: "UserId",
                table: "Registrations",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<string>(
                name: "GuestEmail",
                table: "Registrations",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GuestFullName",
                table: "Registrations",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GuestPhone",
                table: "Registrations",
                type: "nvarchar(40)",
                maxLength: 40,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "UserId" },
                unique: true,
                filter: "[UserId] IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "GuestEmail",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "GuestFullName",
                table: "Registrations");

            migrationBuilder.DropColumn(
                name: "GuestPhone",
                table: "Registrations");

            migrationBuilder.AlterColumn<int>(
                name: "UserId",
                table: "Registrations",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_EventId_UserId",
                table: "Registrations",
                columns: new[] { "EventId", "UserId" },
                unique: true);
        }
    }
}
