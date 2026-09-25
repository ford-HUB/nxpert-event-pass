using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class MealStubPerDay : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Meal stubs now belong to the event (cascade) and optionally reference a sub-event
            // (NoAction). Event-level stubs add a Day and Colour.
            migrationBuilder.DropForeignKey(
                name: "FK_Meals_Sessions_SessionId",
                table: "Meals");

            migrationBuilder.AlterColumn<int>(
                name: "SessionId",
                table: "Meals",
                type: "int",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "int");

            migrationBuilder.AddColumn<int>(
                name: "EventId",
                table: "Meals",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Day",
                table: "Meals",
                type: "int",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "Color",
                table: "Meals",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: true);

            // Backfill EventId for any existing sub-event stubs from their session.
            migrationBuilder.Sql(
                "UPDATE m SET m.EventId = s.EventId FROM Meals m INNER JOIN Sessions s ON s.Id = m.SessionId;");

            migrationBuilder.CreateIndex(
                name: "IX_Meals_EventId",
                table: "Meals",
                column: "EventId");

            migrationBuilder.AddForeignKey(
                name: "FK_Meals_Events_EventId",
                table: "Meals",
                column: "EventId",
                principalTable: "Events",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Meals_Sessions_SessionId",
                table: "Meals",
                column: "SessionId",
                principalTable: "Sessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.NoAction);

            migrationBuilder.CreateTable(
                name: "MealRedemptions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    RegistrationId = table.Column<int>(type: "int", nullable: false),
                    Day = table.Column<int>(type: "int", nullable: false),
                    RedeemedAt = table.Column<System.DateTime>(type: "datetime2", nullable: false),
                    RedeemedBy = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: true),
                    Method = table.Column<string>(type: "nvarchar(10)", maxLength: 10, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MealRedemptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MealRedemptions_Registrations_RegistrationId",
                        column: x => x.RegistrationId,
                        principalTable: "Registrations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MealRedemptions_RegistrationId_Day",
                table: "MealRedemptions",
                columns: new[] { "RegistrationId", "Day" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MealRedemptions");

            migrationBuilder.DropForeignKey(
                name: "FK_Meals_Events_EventId",
                table: "Meals");

            migrationBuilder.DropForeignKey(
                name: "FK_Meals_Sessions_SessionId",
                table: "Meals");

            migrationBuilder.DropIndex(
                name: "IX_Meals_EventId",
                table: "Meals");

            migrationBuilder.DropColumn(
                name: "EventId",
                table: "Meals");

            migrationBuilder.DropColumn(
                name: "Day",
                table: "Meals");

            migrationBuilder.DropColumn(
                name: "Color",
                table: "Meals");

            migrationBuilder.AlterColumn<int>(
                name: "SessionId",
                table: "Meals",
                type: "int",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "int",
                oldNullable: true);

            migrationBuilder.AddForeignKey(
                name: "FK_Meals_Sessions_SessionId",
                table: "Meals",
                column: "SessionId",
                principalTable: "Sessions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
