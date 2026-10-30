using System.Text;
using EventRegistration.Api.Data;
using EventRegistration.Api.Hubs;
using EventRegistration.Api.Models;
using EventRegistration.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);
// Machine-local secrets (gitignored), e.g. appsettings.Development.Local.json.
builder.Configuration.AddJsonFile($"appsettings.{builder.Environment.EnvironmentName}.Local.json", optional: true);

// ---- Database ----
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("Default")));

// ---- Settings + services ----
var jwtSettings = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
builder.Services.AddSingleton(jwtSettings);
builder.Services.AddSingleton<JwtService>();

var emailSettings = builder.Configuration.GetSection("Email").Get<EmailSettings>() ?? new EmailSettings();
builder.Services.AddSingleton(emailSettings);
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<EmailService>();
builder.Services.AddScoped<InvitationEmailDispatcher>();
builder.Services.AddHostedService<InvitationEmailScheduler>();
var viberSettings = builder.Configuration.GetSection("Viber").Get<ViberSettings>() ?? new ViberSettings();
builder.Services.AddSingleton(viberSettings);
builder.Services.AddScoped<ViberService>();
var smsSettings = builder.Configuration.GetSection("Sms").Get<SmsSettings>() ?? new SmsSettings();
builder.Services.AddSingleton(smsSettings);
builder.Services.AddScoped<SmsService>();
// Routes phone notifications to Viber or SMS per the admin-configured provider.
builder.Services.AddScoped<MobileMessenger>();
builder.Services.AddSingleton<QrService>();
builder.Services.AddSingleton<MealStubImageService>();
builder.Services.AddScoped<MealStubService>();
builder.Services.AddScoped<PassService>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddScoped<AttendeeQuery>();
builder.Services.AddScoped<AttendanceSummaryService>();
builder.Services.AddScoped<CalendarInvitationNotifier>();
builder.Services.AddSignalR();

// ---- Auth ----
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key)),
            ClockSkew = TimeSpan.FromMinutes(1),
        };
        // Browsers can't set an Authorization header on a WebSocket, so SignalR sends the JWT
        // as an "access_token" query-string value on the hub connection — read it here.
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var accessToken = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;
                if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments("/hubs"))
                    ctx.Token = accessToken;
                return Task.CompletedTask;
            },
        };
    });
builder.Services.AddAuthorization(o =>
{
    // Allowed for admins/super-admins (always) OR any user carrying the confirm grant claim.
    o.AddPolicy(Permissions.ConfirmRegistrationsPolicy, policy =>
        policy.RequireAssertion(ctx =>
            ctx.User.IsInRole(Roles.Admin) ||
            ctx.User.IsInRole(Roles.SuperAdmin) ||
            ctx.User.HasClaim(Permissions.ConfirmRegistrations, "true")));
});

// ---- CORS: allow-all for the demo (see appsettings note; tighten before real use) ----
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();

var app = builder.Build();

// ---- Migrate + seed on startup ----
// Applying migrations on startup is controlled by the Database:AutoMigrate flag in appsettings
// (default true), so a published/deployed build can bring the schema up to date automatically —
// or leave it to a manual/DBA process by setting the flag to false.
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    if (app.Configuration.GetValue("Database:AutoMigrate", true))
        await db.Database.MigrateAsync();
    await DbSeeder.SeedAsync(db);
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<NotificationHub>("/hubs/notifications");
app.MapGet("/", () => Results.Ok(new { service = "EventRegistration.Api", status = "ok" }));

app.Run();
