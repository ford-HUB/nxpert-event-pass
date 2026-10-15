using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class EventOnlineMeeting : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "MeetingUrl",
                table: "Sessions",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Format",
                table: "Events",
                type: "nvarchar(10)",
                maxLength: 10,
                nullable: false,
                defaultValue: "InPerson");

            migrationBuilder.AddColumn<int>(
                name: "InviteSequence",
                table: "Events",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "MeetingUrl",
                table: "Events",
                type: "nvarchar(1000)",
                maxLength: 1000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "MeetingUrl",
                table: "Sessions");

            migrationBuilder.DropColumn(
                name: "Format",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "InviteSequence",
                table: "Events");

            migrationBuilder.DropColumn(
                name: "MeetingUrl",
                table: "Events");
        }
    }
}
