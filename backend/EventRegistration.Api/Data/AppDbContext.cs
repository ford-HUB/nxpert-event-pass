using EventRegistration.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace EventRegistration.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Event> Events => Set<Event>();
    public DbSet<Invitation> Invitations => Set<Invitation>();
    public DbSet<InvitationEmail> InvitationEmails => Set<InvitationEmail>();
    public DbSet<Registration> Registrations => Set<Registration>();
    public DbSet<Feedback> Feedbacks => Set<Feedback>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<Meal> Meals => Set<Meal>();
    public DbSet<MealRedemption> MealRedemptions => Set<MealRedemption>();
    public DbSet<MealStub> MealStubs => Set<MealStub>();
    public DbSet<AppSetting> AppSettings => Set<AppSetting>();
    public DbSet<MailPlan> MailPlans => Set<MailPlan>();
    public DbSet<MailPlanSend> MailPlanSends => Set<MailPlanSend>();
    public DbSet<MailPlanDelivery> MailPlanDeliveries => Set<MailPlanDelivery>();
    public DbSet<MailPlanEventName> MailPlanEventNames => Set<MailPlanEventName>();
    public DbSet<MailPlanSavedCc> MailPlanSavedCcs => Set<MailPlanSavedCc>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AppSetting>().HasKey(s => s.Key);

        b.Entity<User>().HasIndex(u => u.Email).IsUnique();
        b.Entity<User>().HasIndex(u => u.Username).IsUnique();

        b.Entity<Event>().HasIndex(e => e.PublicSlug).IsUnique();

        b.Entity<Registration>().HasIndex(r => r.Token).IsUnique();
        // Soft-deleted registrations (and their meal stubs/redemptions) are hidden from every
        // query. Use IgnoreQueryFilters() where history must still count (e.g. delete guards).
        b.Entity<Registration>().HasQueryFilter(r => r.DeletedAt == null);
        b.Entity<MealStub>().HasQueryFilter(s => s.Registration!.DeletedAt == null);
        b.Entity<MealRedemption>().HasQueryFilter(m => m.Registration!.DeletedAt == null);
        // One active account-registration per user per (event, session). SessionId is NULL for
        // event-level registrations; guests (UserId NULL) and deleted rows are exempt via the filter.
        b.Entity<Registration>().HasIndex(r => new { r.EventId, r.SessionId, r.UserId })
            .IsUnique().HasFilter("[UserId] IS NOT NULL AND [DeletedAt] IS NULL");
        // The unique index above is filtered (accounts only), so it can't serve whole-event reads.
        // This one backs the Attendance list / realtime row loads (WHERE EventId), the per-session
        // registered/checked-in counts (covered via the included columns), and the guest de-dup
        // lookup (EventId + SessionId + GuestSenateNo).
        b.Entity<Registration>().HasIndex(r => new { r.EventId, r.SessionId, r.GuestSenateNo })
            .IncludeProperties(r => new { r.ConfirmedAt, r.CheckedInAt })
            .HasDatabaseName("IX_Registrations_Event_Attendance");
        b.Entity<Registration>()
            .HasOne(r => r.Event).WithMany(e => e.Registrations)
            .HasForeignKey(r => r.EventId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Registration>()
            .HasOne(r => r.User).WithMany(u => u.Registrations)
            .HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Restrict);
        // Registration -> Session is NoAction to avoid multiple cascade paths (Event already
        // cascades to Registrations). Removing a session with registrations is handled in code.
        b.Entity<Registration>()
            .HasOne(r => r.Session).WithMany(s => s.Registrations)
            .HasForeignKey(r => r.SessionId).OnDelete(DeleteBehavior.NoAction);

        b.Entity<Session>()
            .HasOne(s => s.Event).WithMany(e => e.Sessions)
            .HasForeignKey(s => s.EventId).OnDelete(DeleteBehavior.Cascade);

        // Meal stubs belong to an event (cascade). They optionally reference a sub-event; that
        // link is NoAction to avoid multiple cascade paths — a session's meals are removed in code.
        b.Entity<Meal>()
            .HasOne(m => m.Event).WithMany(e => e.Meals)
            .HasForeignKey(m => m.EventId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Meal>()
            .HasOne(m => m.Session).WithMany(s => s.Meals)
            .HasForeignKey(m => m.SessionId).OnDelete(DeleteBehavior.NoAction);

        // Per-day meal redemptions (event-level events): one row per registrant per day.
        b.Entity<MealRedemption>()
            .HasOne(mr => mr.Registration).WithMany(r => r.MealRedemptions)
            .HasForeignKey(mr => mr.RegistrationId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MealRedemption>()
            .HasIndex(mr => new { mr.RegistrationId, mr.Day }).IsUnique();

        // Individually-issued meal stubs; each has a unique control number (its QR payload).
        b.Entity<MealStub>()
            .HasOne(ms => ms.Registration).WithMany(r => r.MealStubs)
            .HasForeignKey(ms => ms.RegistrationId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MealStub>()
            .HasIndex(ms => ms.ControlNumber).IsUnique();

        b.Entity<Invitation>().HasIndex(i => i.Token).IsUnique();
        b.Entity<InvitationEmail>().HasIndex(i => new { i.Status, i.NextAttemptAt });
        b.Entity<InvitationEmail>().HasIndex(i => new { i.EventId, i.CreatedAt });
        b.Entity<InvitationEmail>().HasOne(i => i.Event).WithMany()
            .HasForeignKey(i => i.EventId).OnDelete(DeleteBehavior.Cascade);
        // Registration looks up the caller's invite by (event, email) on every submit.
        b.Entity<Invitation>().HasIndex(i => new { i.EventId, i.Email });
        b.Entity<Invitation>()
            .HasOne(i => i.Event).WithMany(e => e.Invitations)
            .HasForeignKey(i => i.EventId).OnDelete(DeleteBehavior.Cascade);

        // Mail planner: a plan outlives a deleted event (it keeps the typed event name).
        b.Entity<MailPlan>().HasOne(p => p.Event).WithMany()
            .HasForeignKey(p => p.EventId).OnDelete(DeleteBehavior.SetNull);
        b.Entity<MailPlanSend>().HasOne(s => s.Plan).WithMany(p => p.Sends)
            .HasForeignKey(s => s.PlanId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<MailPlanSend>().HasIndex(s => new { s.Status, s.NextAttemptAt });
        b.Entity<MailPlanDelivery>().HasOne(d => d.Send).WithMany(s => s.Deliveries)
            .HasForeignKey(d => d.SendId).OnDelete(DeleteBehavior.Cascade);
        // My Reminders reads a user's mails by address; the scheduler looks for due reminders.
        b.Entity<MailPlanDelivery>().HasIndex(d => d.Email);
        b.Entity<MailPlanDelivery>().HasIndex(d => new { d.SendId, d.Email }).IsUnique();
        b.Entity<MailPlanDelivery>().HasIndex(d => d.RemindAt).HasFilter("[RemindAt] IS NOT NULL AND [ReminderSentAt] IS NULL");
        b.Entity<MailPlanEventName>().HasIndex(n => n.Name).IsUnique();
        b.Entity<MailPlanSavedCc>().HasIndex(c => c.Email).IsUnique();

        // One feedback per user per event (updatable).
        b.Entity<Feedback>().HasIndex(f => new { f.EventId, f.UserId }).IsUnique();

        // All timestamps are generated by the database server (GETUTCDATE()) so
        // the DB clock is always the authoritative source — immune to app-server drift.
        b.Entity<Registration>()
            .Property(r => r.RegisteredAt)
            .HasDefaultValueSql("GETUTCDATE()")
            .ValueGeneratedOnAdd();

        b.Entity<User>()
            .Property(u => u.CreatedAt)
            .HasDefaultValueSql("GETUTCDATE()")
            .ValueGeneratedOnAdd();

        b.Entity<Event>()
            .Property(e => e.CreatedAt)
            .HasDefaultValueSql("GETUTCDATE()")
            .ValueGeneratedOnAdd();

        b.Entity<Invitation>()
            .Property(i => i.SentAt)
            .HasDefaultValueSql("GETUTCDATE()")
            .ValueGeneratedOnAdd();

        b.Entity<Feedback>()
            .Property(f => f.CreatedAt)
            .HasDefaultValueSql("GETUTCDATE()")
            .ValueGeneratedOnAdd();
    }
}
