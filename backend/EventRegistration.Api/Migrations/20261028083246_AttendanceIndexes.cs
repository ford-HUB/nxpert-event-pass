using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class AttendanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Invitations_EventId",
                table: "Invitations");

            migrationBuilder.CreateIndex(
                name: "IX_Registrations_Event_Attendance",
                table: "Registrations",
                columns: new[] { "EventId", "SessionId", "GuestSenateNo" })
                .Annotation("SqlServer:Include", new[] { "ConfirmedAt", "CheckedInAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_EventId_Email",
                table: "Invitations",
                columns: new[] { "EventId", "Email" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Registrations_Event_Attendance",
                table: "Registrations");

            migrationBuilder.DropIndex(
                name: "IX_Invitations_EventId_Email",
                table: "Invitations");

            migrationBuilder.CreateIndex(
                name: "IX_Invitations_EventId",
                table: "Invitations",
                column: "EventId");
        }
    }
}
