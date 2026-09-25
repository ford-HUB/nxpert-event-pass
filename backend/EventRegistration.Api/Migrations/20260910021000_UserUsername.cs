using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventRegistration.Api.Migrations
{
    /// <inheritdoc />
    public partial class UserUsername : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Username",
                table: "Users",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            // Backfill: username = first letter of first name + last name (lower-case), made unique
            // by appending 2, 3, … to collisions. Falls back to the full name / "user" when needed.
            migrationBuilder.Sql(@"
;WITH base AS (
    SELECT Id,
        LOWER(
            LEFT(COALESCE(NULLIF(LTRIM(RTRIM([FirstName])), ''), NULLIF(LTRIM(RTRIM([FullName])), ''), 'user'), 1)
            + REPLACE(COALESCE([LastName], ''), ' ', '')
        ) AS b
    FROM [Users]
),
norm AS (
    SELECT Id, CASE WHEN b IS NULL OR b = '' THEN 'user' ELSE b END AS b FROM base
),
ranked AS (
    SELECT Id, b, ROW_NUMBER() OVER (PARTITION BY b ORDER BY Id) AS rn FROM norm
)
UPDATE u SET [Username] = CASE WHEN r.rn = 1 THEN r.b ELSE r.b + CAST(r.rn AS varchar(10)) END
FROM [Users] u INNER JOIN ranked r ON r.Id = u.Id;");

            migrationBuilder.CreateIndex(
                name: "IX_Users_Username",
                table: "Users",
                column: "Username",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(name: "IX_Users_Username", table: "Users");
            migrationBuilder.DropColumn(name: "Username", table: "Users");
        }
    }
}
