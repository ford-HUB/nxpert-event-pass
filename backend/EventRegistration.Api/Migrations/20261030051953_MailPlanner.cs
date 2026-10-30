using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class MailPlanner : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MailPlanEventNames",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Name = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailPlanEventNames", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "MailPlans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Kind = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    EventId = table.Column<int>(type: "int", nullable: true),
                    EventName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Channel = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: false),
                    Draft = table.Column<bool>(type: "bit", nullable: false),
                    GroupIdsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    EmailsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "int", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailPlans", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MailPlans_Events_EventId",
                        column: x => x.EventId,
                        principalTable: "Events",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateTable(
                name: "MailPlanSends",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    PlanId = table.Column<int>(type: "int", nullable: false),
                    SendAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Subject = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    BodyHtml = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    PreviewText = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: false),
                    ImageCount = table.Column<int>(type: "int", nullable: false),
                    Status = table.Column<string>(type: "nvarchar(20)", maxLength: 20, nullable: false),
                    NextAttemptAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LastAttemptAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    DispatchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    SentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RecipientCount = table.Column<int>(type: "int", nullable: false),
                    LastError = table.Column<string>(type: "nvarchar(1000)", maxLength: 1000, nullable: true),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Version = table.Column<byte[]>(type: "rowversion", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailPlanSends", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MailPlanSends_MailPlans_PlanId",
                        column: x => x.PlanId,
                        principalTable: "MailPlans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MailPlanDeliveries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    SendId = table.Column<int>(type: "int", nullable: false),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    UserId = table.Column<int>(type: "int", nullable: true),
                    Phone = table.Column<string>(type: "nvarchar(40)", maxLength: 40, nullable: true),
                    EmailSentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    ViberSentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RemindAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Snoozed = table.Column<bool>(type: "bit", nullable: false),
                    ReminderSentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DoneAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MailPlanDeliveries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MailPlanDeliveries_MailPlanSends_SendId",
                        column: x => x.SendId,
                        principalTable: "MailPlanSends",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanDeliveries_Email",
                table: "MailPlanDeliveries",
                column: "Email");

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanDeliveries_RemindAt",
                table: "MailPlanDeliveries",
                column: "RemindAt",
                filter: "[RemindAt] IS NOT NULL AND [ReminderSentAt] IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanDeliveries_SendId_Email",
                table: "MailPlanDeliveries",
                columns: new[] { "SendId", "Email" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanEventNames_Name",
                table: "MailPlanEventNames",
                column: "Name",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MailPlans_EventId",
                table: "MailPlans",
                column: "EventId");

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanSends_PlanId",
                table: "MailPlanSends",
                column: "PlanId");

            migrationBuilder.CreateIndex(
                name: "IX_MailPlanSends_Status_NextAttemptAt",
                table: "MailPlanSends",
                columns: new[] { "Status", "NextAttemptAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MailPlanDeliveries");

            migrationBuilder.DropTable(
                name: "MailPlanEventNames");

            migrationBuilder.DropTable(
                name: "MailPlanSends");

            migrationBuilder.DropTable(
                name: "MailPlans");
        }
    }
}
