# Event Registration — Administrator Guide

For organizers who create events, manage users, confirm registrations, check attendees in,
and review results. (Participants have a separate guide: **PARTICIPANT-GUIDE.md**.)

> **Signing in:** open the app URL and sign in with your administrator account. Admins land
> on the **Dashboard**. The demo admin account is `admin@demo.com` / `Admin123!`.

Admins have four areas in the top navigation bar: **Dashboard**, **Events**, **Users**, and
**Scanner**.

> **Important — how registration works now:** registrations are **not** confirmed
> automatically. When someone registers they are marked **Pending**, and **no entry pass is
> sent yet**. An admin (or a user granted the confirmation permission) reviews the list and
> **confirms** registrations — only then is the **confirmation email with the QR entry pass**
> sent, and only a confirmed pass can be checked in. See *Confirming registrations* below.

---

## 1. Dashboard

Your landing page after signing in. It shows at-a-glance cards:

| Card | Meaning |
|------|---------|
| **Total events** | Every event you've created |
| **Upcoming** | Events whose start date is in the future |
| **Registrations** | Total people registered across all events |
| **Checked in** | Total checked in, plus the overall check-in rate (%) |

Below the cards, **Recent events** lists your latest events with an attendance progress
bar. Click any card to open that event.

---

## 2. Creating an event

1. Go to **Events → New event** (top-right button).
2. Fill in the form:
   - **Event banner** (optional) — click **Upload banner image** to add a picture shown
     across the top of the registration page and on the participant *Browse Events* cards.
     You can **Replace** or **Remove** it later.
   - **Title** and **Description**
   - **Start date / Start time** and **End date / End time** — click the calendar icon to
     pick the date; set the time in the time box. For a multi-day event, make the range span
     all the days (individual days are handled by *sub-events*, below).
   - **Venue**
   - **TV welcome message** (optional) — a custom greeting shown on the check-in **TV/
     presentation screen** when a member's pass is scanned (e.g. *"Welcome, distinguished
     members!"*). Leave blank to use the default "Welcome".
   - **Registration fees** (optional) — free text shown on the registration page and the
     participant *Browse Events* details (e.g. *"Members: ₱1,500 · Non-members: ₱2,500 ·
     includes lunch"*). Leave blank for a free event.
   - **Status** — `Published` (visible/registerable), `Draft`, or `Closed`.
   - **Max participants** — capacity. **Leave blank for unlimited.** (For events with
     sub-events, set capacity per sub-event instead — see below.)
   - **Enable public registration link** — see *Public link vs. invite-only*.
   - **Sub-events (days / sessions)** — optional; see *Sub-events* below.
   - **Schedule of activities** — optional agenda grid; see below.
   - **Registration form** — your own custom questions (see *Registration form*).
3. Click **Create event**. You're taken to the event's detail page.

### Public link vs. invite-only

- **Toggle ON (public):** anyone with the registration link can register, and the event
  appears in the participant **Browse Events** screen.
- **Toggle OFF (invite-only):** only people you've **invited by email** can register, and the
  event is **hidden** from Browse Events. Others who open the link see *"invite-only."*

> **Tip:** if an event you expect to see in Browse Events is missing, check that it is
> **Published** *and* has **Enable public registration link** turned on.

### Sub-events (days / sessions)

Use sub-events when one event spans multiple days or has several sessions that participants
register for **separately** (e.g. *Day 1 — Plenary*, *Day 2 — Workshops*, *Gala Dinner*).

- Under **Sub-events**, click **Add sub-event** and set its **Title**, **start/end date &
  time**, optional **Venue** (defaults to the event venue), and optional **Max participants**.
- Add as many as you need, across as many days as you need.
- Leave this empty for a normal single event.

When an event has sub-events:
- Participants **choose which sub-events** to attend and get a **separate registration and
  QR pass for each** — each confirmed and checked in independently.
- Check-in for a sub-event is only open on **that sub-event's** date.
- The **Attendance** tab gains a **Sub-event** column and a filter.
- You can't delete a sub-event that already has registrations (remove its registrations
  first).

### Schedule of activities

An optional agenda shown to participants. Click **Add row** and fill in **Day**, **Time**,
and **Activity** for each line (Day/Time are free text, e.g. "Day 1", "9:00 AM"). Only rows
with an activity are saved. It appears as a table on the registration page and in the
participant *Browse Events* details.

### Registration form (custom fields)

Beyond the standard name / email / phone, collect any extra information with your own
questions. Under **Registration form**, click **Add field** for each question and set:

- **Field label** — the question shown to the attendee.
- **Type** — **Text field**, **Text area**, **Number**, **Date**, **Time**, **Dropdown**,
  **Multi-select**, **Radio buttons**, or **Checkbox**.
- **Required** — toggle on to make an answer mandatory.
- **Options** — for Dropdown, Multi-select, and Radio buttons, list the choices
  (comma-separated, e.g. `Small, Medium, Large`).
- **Category** (optional) — a section name; fields sharing a category are grouped under that
  heading on the form.

Answers appear as extra columns in the **Attendance** tab and the CSV export.

---

## 3. The event detail page

Opening an event shows its summary and tabs. Action buttons at the top: **Edit**,
**Close/Reopen**, and **Delete**.

**Status badge** — 🟢 *Registration open*, 🔴 *Full*, or 🔴 *Registration closed*.
**Registration counts** — `registered (/capacity)` and `checked in`.
**Public link** — when public registration is on, the shareable link is shown with a
**copy** button.

### Close / reopen registration

Click **Close** to stop new registrations immediately (existing ones are kept); the button
becomes **Reopen**. (Setting **Status = Closed** in the edit form does the same.)

### Tab: Invite

Send email invitations with the registration link.

1. **Pick contacts** — the contact list. Use the **Search** box and the **pager** for long
   lists. Tick people; a **"N selected"** badge tracks your total.
2. **Additional emails** — type extra addresses (comma/space separated).
3. Click **Send invitations**. Each recipient gets a personal link.

> **Smart links:** an invited person with an account is signed in automatically and their
> details pre-filled; others get a guest form with their email filled in.

### Tab: Attendance — and confirming registrations

The live roster. Each row shows name, contact, organization, **sub-event** (if any),
registration time, and a **Status**:

- 🟠 **Pending** — registered but not yet confirmed (no pass issued).
- 🟢 **Confirmed** — approved; the confirmation email + QR pass has been sent.
- 🟢 **Checked in** — confirmed and attended (with the check-in time).

**To confirm registrations (issue passes):**

1. (Optional) If the event has sub-events, use the **Sub-event** filter to narrow the list.
2. Tick the checkbox on each **Pending** row — or use the header checkbox to **select all
   pending**.
3. Click **Confirm selected (N)**. Each selected registration is confirmed and, if it has an
   email on file, the **confirmation email with the QR entry pass** is sent. A summary shows
   how many were confirmed / emailed / had no email.

> Only **confirmed** passes can be checked in. A pass that hasn't been confirmed is refused
> at the scanner ("Not confirmed").

- Custom form fields appear as extra columns.
- **Export CSV** downloads the roster (including sub-event, status, and custom-field columns).

### Tab: Feedback

After the event, participants can rate it (1–5 stars + comment). This tab shows the average
rating, the number of responses, and each individual rating and comment.

---

## 4. Users (User master)

The **Users** menu (admins only) is where you manage accounts.

- **Add user** — create an account directly: First/M.I./Last name, **Senate No.**, **Level**,
  email, an initial **password**, **role** (Participant or Admin), phone, organization, an
  optional **profile photo**, and the **"Can confirm registrations"** grant (below).
  Admin-created accounts are pre-verified.
- **Edit** — change any detail; leave the password blank to keep the current one. You can
  add, change, or remove the user's **profile photo** here.
- **Delete** — removes the account (blocked if the user has event registrations, or if it's
  your own account).
- The list shows **Name, Email, Senate No., Organization, Role, Level**, and each user's
  **confirm-grant** status, with a **search** box.

### The "Can confirm registrations" grant

This lets a **non-admin** user confirm event registrations without full admin access.

- Turn on **Can confirm registrations** when adding/editing a Participant.
- That user signs in and gets a **Confirm Registrations** menu → the events list → an event's
  **Attendance** tab, where they can select and confirm registrations. They **cannot** create/
  edit/delete events, invite, scan, or open the User master.
- **Admins can always confirm**, regardless of this flag.
- If you toggle the grant for someone already signed in, it takes effect at their **next
  sign-in**.

---

## 5. Checking people in (Scanner)

On event day, use a **phone or laptop with a camera**.

1. Go to **Scanner**. Allow camera access; scanning starts automatically.
2. Point the camera at a participant's QR pass. The result banner shows instantly:
   - 🟢 **"Welcome!" / Checked in** with the person's name (and their **Level / Senate No. /
     organization**, and **photo** if on file) → success.
   - 🟠 **Already checked in** → this pass was already used.
   - 🔴 **Invalid pass** → the code isn't recognized.
   - 🟠 **Not confirmed** → the registration hasn't been confirmed yet (confirm it first).
   - 🟠 **Not open yet** / ⚫ **Event ended** → outside the check-in window.
3. The scanner auto-resumes for the next person; a running **checked-in count** is shown.

### TV / presentation mode

Click **TV mode** (top-right of the Scanner) for a full-screen welcome display suited to a
screen at the door. On a valid scan it shows a large **welcome greeting** (the event's custom
message, or "Welcome"), the member's **name**, their **Level / Senate No. / organization**,
and their **photo** if they uploaded one. The camera keeps scanning underneath. Click **Exit
TV mode** to return.

> **Check-in window:** a pass can only be checked in on its event's (or sub-event's) day(s).
> Scanning too early or after it ends is refused.
>
> **Camera requirement:** browsers only allow the camera over **HTTPS** (or `localhost`). If
> you see *"Could not open the camera,"* the page must be served over `https://`.

---

## 6. Editing & deleting

- **Edit** — change any detail, including capacity, status, sub-events, fees, schedule, and
  the registration form. Existing registrations are kept.
- **Delete** — permanently removes the event **and all its registrations**. This cannot be
  undone.

---

## Appendix — Admin quick answers

| Question | Answer |
|----------|--------|
| Someone registered but got no pass | That's expected — passes are sent when you **confirm** the registration. Open the event → **Attendance** → select the pending rows → **Confirm selected**. |
| An event is missing from participants' *Browse Events* | It must be **Published** *and* have **Enable public registration link** on. Invite-only events are hidden there. |
| The scanner says "Not confirmed" | The registration hasn't been confirmed yet. Confirm it on the **Attendance** tab, then re-scan. |
| I want someone to help confirm without being an admin | In **Users**, edit them and turn on **Can confirm registrations**. |
| A participant didn't get the invitation | Ask them to check spam; **re-send** invites, or share the public link. |
| The scanner camera won't open | The site must be served over **HTTPS** (or localhost). |
| I need to stop new sign-ups | Click **Close** on the event (or set Status = Closed). |
| The event filled up but I want more seats | **Edit** and raise **Max participants** (or the sub-event's capacity). |
| How do I get the attendee list? | Event → **Attendance** → **Export CSV** (sub-event, status, and custom answers included). |
| How do I run a multi-day event? | Add **Sub-events** (one per day/session); participants register for each separately. |
| How do I show fees / an agenda? | On the event's **Edit** screen: **Registration fees** (text) and **Schedule of activities** (grid). |
| Where do I set the TV welcome greeting or member photos? | Greeting: event's **TV welcome message**. Photos: members add one at sign-up, or an admin sets one in **Users → Edit**. |
