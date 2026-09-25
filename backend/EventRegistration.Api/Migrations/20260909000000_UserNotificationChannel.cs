using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class UserNotificationChannel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "NotificationChannel",
                table: "Users",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "Email");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "NotificationChannel",
                table: "Users");
        }
    }
}
