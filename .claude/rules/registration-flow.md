# Registration & check-in flow rules

Source: `admin-guide` and `participant-guide` skills. Preserve these behaviors when changing code.

- New registrations are **Pending**; **no pass is sent** until an admin (or a user with **Can
  confirm registrations**) confirms.
- Confirmation sends the QR pass (and meal stubs, and for online/hybrid the meeting link +
  `invite.ics`) via the registrant's chosen channel (Email / Viber / Both; SMS is text-only).
- **Only confirmed passes can be checked in**; the scanner returns "Not confirmed" otherwise.
- Admins can cancel **pending** registrations only; confirmed or checked-in ones are kept.
  Participants cannot cancel after check-in.
- Each sub-event is its own registration/pass/confirmation/check-in; a sub-event with
  registrations cannot be removed; check-in opens only on its own dates.
- **Online** events: no QR pass, no meal stubs. **Hybrid**: pass + link. The meeting link is never
  shown on public pages — confirmed registrants only. Meeting changes/cancellations must update or
  remove calendar entries automatically.
- Visible in *Browse Events* only when **Published** and public link **on**.
- Check-in scanner is admin-only and opens only between event start and end.
- Meal stubs: redeemable once, on valid dates only; Merchant role sees only the Meal Stub Scanner.
- Roles: Admin (all) · Participant · Participant + Can confirm (Attendance actions only) ·
  Merchant. Grant changes apply at next sign-in.
- Destructive actions (delete user/event, cancel registrations, discard changes) require a
  confirmation dialog with the safe option pre-selected.
- Offline check-ins queue on the device and sync when online; meal-stub scanning needs internet.
- Face check-in requires clear, close, front-facing, multi-frame confirmation; face data is
  optional and consent-based.
