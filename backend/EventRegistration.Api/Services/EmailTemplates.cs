using EventRegistration.Api.Models;

namespace EventRegistration.Api.Services;

public static class EmailTemplates
{
    private const string Accent = "#0d9488";

    private static string Shell(string title, string inner) => $@"
<div style=""font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;
     border:1px solid #e0e0e0;border-radius:12px;overflow:hidden"">
  <div style=""background:{Accent};color:#fff;padding:20px 28px"">
    <h1 style=""margin:0;font-size:20px"">{title}</h1>
  </div>
  <div style=""padding:28px;color:#333;font-size:15px;line-height:1.55"">
    {inner}
  </div>
  <div style=""padding:16px 28px;background:#fafafa;color:#999;font-size:12px;border-top:1px solid #eee"">
    Event Registration · this is an automated message
  </div>
</div>";

    public static string Invitation(Event ev, string registerUrl) => Shell(
        "You're invited!",
        $@"<p>You have been invited to:</p>
           <h2 style=""margin:8px 0;color:{Accent}"">{ev.Title}</h2>
           <p style=""margin:4px 0""><strong>When:</strong> {ev.StartsAt:dddd, MMM d yyyy, h:mm tt}</p>
           <p style=""margin:4px 0""><strong>Where:</strong> {ev.Venue}</p>
           <p style=""margin:16px 0 8px"">{ev.Description}</p>
           <p style=""text-align:center;margin:28px 0"">
             <a href=""{registerUrl}"" style=""background:{Accent};color:#fff;text-decoration:none;
                padding:12px 28px;border-radius:8px;display:inline-block;font-weight:600"">
                Register now</a>
           </p>
           <p style=""color:#888;font-size:13px"">Or paste this link: {registerUrl}</p>");

    public static string Verification(User user, string verifyUrl) => Shell(
        "Confirm your email",
        $@"<p>Hi {user.FullName},</p>
           <p>Thanks for signing up. Please confirm your email address to activate your account.</p>
           <p style=""text-align:center;margin:28px 0"">
             <a href=""{verifyUrl}"" style=""background:{Accent};color:#fff;text-decoration:none;
                padding:12px 28px;border-radius:8px;display:inline-block;font-weight:600"">
                Confirm email</a>
           </p>
           <p style=""color:#888;font-size:13px"">Or paste this link: {verifyUrl}</p>");

    public static string Confirmation(string title, DateTime startsAt, string venue, string attendeeName,
        string? editUrl = null) => Shell(
        "Registration confirmed",
        $@"<p>Hi {attendeeName},</p>
           <p>Good news — your registration for <strong>{title}</strong> has been
              <strong>confirmed</strong>. Your entry pass is below; present this QR code at the door
              for check-in.</p>
           <p style=""margin:4px 0""><strong>When:</strong> {startsAt:dddd, MMM d yyyy, h:mm tt}</p>
           <p style=""margin:4px 0""><strong>Where:</strong> {venue}</p>
           <div style=""text-align:center;margin:24px 0"">
             <img src=""cid:qrcode"" alt=""Your entry QR code"" width=""220"" height=""220""
                  style=""border:8px solid #fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.12)"" />
           </div>
           {(string.IsNullOrWhiteSpace(editUrl) ? "" : $@"<p style=""text-align:center;margin:8px 0 0"">
             Need to update your details? <a href=""{editUrl}"" style=""color:{Accent};font-weight:600"">Edit your response</a>.</p>")}
           <p style=""text-align:center;color:#888;font-size:13px"">Keep this email handy on event day.</p>");

    // "Here's your edit link" email (the public-page recovery / re-send flow).
    public static string EditLink(string eventTitle, string attendeeName, string editUrl) => Shell(
        "Edit your registration",
        $@"<p>Hi {attendeeName},</p>
           <p>Use the link below to review or update your response for
              <strong>{eventTitle}</strong>.</p>
           <p style=""text-align:center;margin:24px 0"">
             <a href=""{editUrl}"" style=""background:{Accent};color:#fff;text-decoration:none;
                padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block"">Edit your response</a>
           </p>
           <p style=""color:#888;font-size:13px"">If you didn't request this, you can ignore this email.</p>");

    // Kit-claimed notice. When claimedBy is null the kit was self-claimed (generic wording);
    // otherwise it names the person who collected it on the registrant's behalf.
    public static string KitClaimed(string eventTitle, string attendeeName, string? claimedBy) => Shell(
        "Event kit claimed",
        $@"<p>Hi {attendeeName},</p>
           {(string.IsNullOrWhiteSpace(claimedBy)
              ? $@"<p>This is to confirm that your kit for <strong>{eventTitle}</strong> has already been
                     <strong>claimed</strong>.</p>"
              : $@"<p>This is to let you know that your kit for <strong>{eventTitle}</strong> has been
                     <strong>claimed by {claimedBy}</strong>.</p>")}
           <p style=""color:#888;font-size:13px"">If this wasn't expected, please contact the event organizer.</p>");

    // One meal-stub ticket, following the printed design: the whole ticket is the stub colour, a
    // white body holds the event banner + QR (with control number) + "MEAL STUB" and a coloured
    // "VALID ON …" bar; the tear-off tab shows the denomination vertically. validityText is the
    // upper-cased date (e.g. "OCTOBER 09, 2026").
    public static string MealStubCard(
        string? bannerCid, string eventTitle, string validityText, decimal denomination,
        string color, string qrCid, string controlShort)
    {
        var banner = bannerCid is not null
            ? $@"<img src=""cid:{bannerCid}"" alt=""{eventTitle}"" width=""150""
                   style=""max-height:60px;object-fit:contain;display:block"" />"
            : $@"<div style=""font-weight:800;font-size:15px;color:#111;line-height:1.2"">{eventTitle}</div>";
        return $@"
<table role=""presentation"" cellpadding=""0"" cellspacing=""0""
       style=""border-collapse:separate;margin:14px auto;width:420px;background:{color};border-radius:16px"">
  <tr>
    <!-- Main body -->
    <td style=""padding:12px;vertical-align:middle"">
      <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0""
             style=""background:#ffffff;border-radius:12px"">
        <tr>
          <td style=""padding:14px 16px 0 16px"">
            <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0""><tr>
              <td style=""vertical-align:middle"">{banner}</td>
              <td style=""text-align:center;vertical-align:middle;width:120px"">
                <img src=""cid:{qrCid}"" alt=""Meal stub QR"" width=""96"" height=""96"" style=""display:block;margin:0 auto"" />
                <div style=""font-size:11px;color:#333;letter-spacing:1px;margin-top:2px"">{controlShort}</div>
              </td>
            </tr></table>
            <div style=""font-weight:900;font-size:30px;letter-spacing:1px;color:#111;margin:6px 0 12px"">MEAL STUB</div>
          </td>
        </tr>
        <tr>
          <td style=""padding:0"">
            <div style=""background:{color};color:#ffffff;font-weight:800;font-size:15px;
                        padding:9px 16px;border-radius:0 0 12px 12px"">VALID ON {validityText}</div>
          </td>
        </tr>
      </table>
    </td>
    <!-- Tear-off tab: denomination, vertical -->
    <td style=""width:72px;color:#ffffff;text-align:center;vertical-align:middle;border-left:2px dashed rgba(255,255,255,0.85)"">
      <div style=""display:inline-block;transform:rotate(-90deg);white-space:nowrap;font-weight:900;font-size:24px"">
        &#8369; {denomination:0.00}
      </div>
    </td>
  </tr>
</table>";
    }

    public static string Pass(Event ev, string attendeeName) => Shell(
        "Your Event Pass",
        $@"<p>Hi {attendeeName},</p>
           <p>You're registered for <strong>{ev.Title}</strong>. Present this QR code at the door for check-in.</p>
           <p style=""margin:4px 0""><strong>When:</strong> {ev.StartsAt:dddd, MMM d yyyy, h:mm tt}</p>
           <p style=""margin:4px 0""><strong>Where:</strong> {ev.Venue}</p>
           <div style=""text-align:center;margin:24px 0"">
             <img src=""cid:qrcode"" alt=""Your entry QR code"" width=""220"" height=""220""
                  style=""border:8px solid #fff;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.12)"" />
           </div>
           <p style=""text-align:center;color:#888;font-size:13px"">Keep this email handy on event day.</p>");
}
