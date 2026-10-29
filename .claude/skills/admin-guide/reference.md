# NXPass — Administrator Guide

For organizers who create events, manage users, confirm registrations, check attendees in,
and review results. (Participants have a separate guide: **PARTICIPANT-GUIDE.md**.)

> **Signing in:** open the app URL and sign in with your **username or email** and password.
> Admins land on the **Home** screen. The demo admin account is `admin@demo.com` / `Admin123!`.

> **How registration works:** registrations are **not** confirmed automatically. A new
> registration is **Pending** and **no entry pass is sent yet**. An admin (or a user granted the
> confirmation permission) **confirms** it — only then is the **confirmation with the QR entry
> pass** (and, for online events, the **meeting link + calendar invite**) sent. Only a confirmed
> pass can be checked in.

---

## 1. Getting around

### Home screen

After signing in you see **Home** — a set of module cards. Click a card to open it. The tabs
above the cards (**All**, **Events**, **Operations**, **Admin**, **Account**) filter them.

| Card | Opens |
|------|-------|
| **Dashboard** | Insights & KPIs |
| **Events** | Create and manage events |
| **Browse Events** / **My Events** | The participant view (your own registrations) |
| **Meal Scanner** | The meal-stub scanner |
| **Users** | The User Master (accounts) |
| **Settings** | System configuration |
| **My Account** | Your profile and password |

The **Home** button (top-left of the green header) always brings you back here. On the right
of the header: the **notifications bell** and your **name badge** (click it for **Edit
account**, **Install app**, and **Sign out**).

### Notifications

The bell shows live notices — e.g. **New registration** / **New guest registration** for your
events. Click one to open the event; use **Mark all read** or **Clear** to tidy the list.

### Messages and confirmations

- Results of your actions appear as a small card in the top-right corner (green = success,
  red = error, amber = warning). Hover over it to keep it on screen; click **✕** to close it.
- Anything that can't be undone (deleting a user or event, cancelling registrations,
  discarding unsaved changes) asks first in a confirmation window. **Cancel** / **Keep** is
  pre-selected, so pressing Enter by accident never confirms a delete.

### Install as an app

On phones and tablets a banner offers to **Install NXPass** for quick access and offline
check-in (on iPhone/iPad: tap **Share → Add to Home Screen**). It's also in the name-badge menu
as **Install app**.

---

## 2. Dashboard

| Card | Meaning |
|------|---------|
| **Total events** | Every event you've created |
| **Upcoming** | Events whose start date is in the future |
| **Registrations** | Total people registered across all events |
| **Checked in** | Total checked in, plus the overall check-in rate (%) |

Below the cards, **Recent events** lists your latest events with an attendance bar, and
**Registrations by chapter** breaks registrations down by chapter.

---

## 3. Events list

**Events** shows every event as a card with a date tile, title, status tag (**Open**, **Full**,
**Closed**), an **Online** / **Hybrid** tag when applicable, the time and venue, and two
counters: **Registered** (with a capacity bar) and **Checked in**.

- Click a card to open the event.
- **Start check-in** opens the scanner for that event. It only opens between the event's start
  and end dates; otherwise you're told it isn't open yet / has ended.
- **New event** (top-right) creates an event.

---

## 4. Creating or editing an event

Go to **Events → New event**, or open an event and click **Edit**. On a desktop the form is
centred on the page. Fill in:

- **Event banner** (optional) — **Upload banner image**; shown on the registration page and
  the participant *Browse Events* cards. **Replace** or **Remove** later.
- **Title** and **Description** — the description is shown **exactly as you type it**: line
  breaks, blank lines, indentation and typed bullets (•) are kept on the registration page, the
  event details pop-up, and the invitation email.
- **Start date / time** and **End date / time** — for a multi-day event make the range cover all
  days (individual days are handled by *sub-events*).
- **Format** — **In person**, **Online**, or **Hybrid** (see *Online and hybrid events*):
  - **In person** — enter the **Venue**.
  - **Online** — no venue; paste the **Online meeting link**.
  - **Hybrid** — both the **Venue** and the **Online meeting link**.
- **TV welcome message** (optional) — the greeting on the check-in TV screen (default
  "Welcome").
- **Registration fees** (optional) — free text shown on the registration page.
- **Status** — `Published` (visible/registerable), `Draft`, or `Closed`.
- **Max participants** — capacity; **blank = unlimited** (for sub-events, set it per sub-event).
- **Enable public registration link** — see below.
- **Notify registrants when their kit is claimed** — see *Kit Claiming*.
- **Sub-events**, **Meal stubs**, **Schedule of activities**, **Registration form** — below.

Click **Create event** (or **Save**). Editing keeps all existing registrations.

### Public link vs. invite-only

- **On (public):** anyone with the link can register; the event appears in *Browse Events*.
- **Off (invite-only):** only people you **invite by email** can register; the event is hidden
  from *Browse Events*.

> **Tip:** an event is visible in *Browse Events* only when it is **Published** *and* the public
> registration link is on.

### Sub-events (days / sessions)

For events with several days or sessions that people register for **separately**:

- **Add sub-event** and set its **Title**, **start/end date & time**, optional **Venue**
  (defaults to the event venue), optional **Max participants**, and an optional **Poster /
  image** (shown on participants' *My Events* cards).
- For online / hybrid events each sub-event can have its own **Meeting link** (otherwise the
  event's link is used).
- Participants get a **separate registration and pass per sub-event**, each confirmed and
  checked in independently. Check-in for a sub-event only opens on its own date(s).
- A sub-event that already has registrations can't be removed.

### Meal stubs

Meal stubs are individual QR coupons issued to each registrant when their registration is
**confirmed** (sent with the pass) and redeemed at meal counters.

- **With sub-events:** each sub-event has its own **Meal stubs** block → **Add stub**.
- **Without sub-events:** **Meal stubs (per day)** → **Add day** (Day 1, Day 2, …) → **Add stub**.
- For each stub: **Stub name**, **Denomination** (₱), **Qty** per member, **Valid from / Valid
  to** (within the event dates; defaults to that day / sub-event) and a **colour**.
- A stub can only be redeemed on its valid dates, and only once.

### Schedule of activities

**Add row** and fill **Day**, **Time**, **Activity** (free text). Shown as a table on the
registration page.

### Registration form (custom questions)

Under **Registration form**, **Add field** for each question:

- **Category** (optional — groups fields under a heading), **Field label**, **Type**, **Options**
  (comma-separated, for choice types), **Required**.
- **Types:** Text field, Text area, Number, Date, Time, Dropdown, Multi-select, Radio buttons,
  Checkbox, **Image upload** (participants upload a picture; max 8 MB).
- **Show only when** — make a field appear only when a **Radio buttons** question *above it* has
  a particular answer. Hidden fields are never required and their answers are discarded.

Answers appear as extra columns on the **Attendance** tab and in the CSV export. Participants can
edit their answers until they check in or the event ends.

---

## 5. Online and hybrid events

Set **Format** to **Online** or **Hybrid** and paste the meeting link (e.g. a Microsoft Teams
meeting created in Teams or Outlook — copy its *join* link). The link must start with
`https://`. You can save without a link and add it later; the form warns you in amber.

**What confirmed registrants receive:**

- A confirmation email with a **Join online meeting** button **and a calendar invite**
  (`invite.ics`) that adds the meeting to Outlook, Gmail or their phone calendar, with a 15-minute
  reminder (Teams links also get Outlook's own *Join* button).
- **Online** events: no QR pass and no meal stubs (there's no door check-in).
  **Hybrid** events: the QR pass **plus** the meeting link and invite.
- Viber / SMS users get the join link by text.
- In *My Events* they get a **Join meeting** button.

**The link stays private:** it is never shown on the public registration page or in *Browse
Events* — only confirmed registrants get it.

**Keeping calendars up to date (automatic):**

| You… | Confirmed registrants get… |
|------|-----------------------------|
| change the time, title or link | an **updated invite** that replaces the calendar entry |
| switch the event to Online/Hybrid | the meeting invite |
| switch it back to **In person** | the meeting **removed** from their calendar (their registration stands) |
| delete the event | a cancellation that removes it from their calendar |
| (they) cancel a confirmed registration | a cancellation for their calendar |

> Invite times use the server's time zone (keep the server on Philippine time). The sender of
> the invite is the system's email address.

---

## 6. The event detail page

Open an event to see its summary (status **Registration open / closed / Full**, registered and
checked-in counts, venue and/or **Online meeting link**, and the public link with **Copy**).

**Header buttons:**

- **Viber blast** — send a typed message (up to 1,000 characters) to every registrant who chose
  Viber and has a phone number. The dialog shows how many numbers it will reach.
- **Edit**, **Close / Reopen** (stop or resume new registrations), **Delete** (permanent —
  removes the event and all its registrations).
- **Offline bundle** — downloads the event's data file for offline check-in (see *Offline
  check-in*).

### Tab: Invite

1. **Search contacts** and tick people (a counter shows how many are selected).
2. Add **Additional emails** (comma or space separated).
3. **Send invitations** (up to 200 at a time). Each person gets a personal link; people with an
   account are signed in and pre-filled automatically.

The invitation email shows the full date/time range, the venue (or "Online meeting"), and the
description laid out exactly as you typed it.

### Tab: Attendance

The live roster: **Name, ID No., Mobile No., Email, Sub-event, Registered, Status** and one column
per custom question (image answers show as thumbnails).

- **Status:** 🟠 **Pending** · 🟢 **Confirmed** · 🟢 **Checked in · time** with a method tag —
  **Scan**, **Face** or **Manual**.
- **Filters:** **Search attendees**, **Sub-event**, **Status**, **Chapter**. A pill shows how many
  are **pending confirmation**.
- Tick rows (only rows not yet checked in can be ticked), then:

| Button | What it does |
|--------|--------------|
| **Confirm selected (n)** | Confirms the **pending** rows and sends each one's pass (and stubs, meeting link/invite) by their chosen channel. |
| **Check in selected (n)** | Marks them attended (**Manual**); pending ones are confirmed automatically. |
| **Cancel selected (n)** | Removes **pending** registrations only. Confirmed or checked-in rows in the selection are kept. Asks first; can't be undone. |
| **Export CSV** | Downloads the roster incl. sub-event, status, check-in method, kit and meal columns and custom answers. |

> Only **confirmed** passes can be checked in — an unconfirmed pass is refused at the scanner
> ("Not confirmed").

### Tab: Kit Claiming

Tracks who has collected their event kit.

- Filters: **Search**, **Kit status** (All / Not claimed / Claimed), **Chapter**.
- Tick rows → **Mark kit claimed (n)** → in the dialog either turn on **Self-claimed** (the
  registrant collected it) or enter **Claimed by** (the person collecting on their behalf) →
  **Mark claimed**.
- **Clear claim (n)** undoes a claim.
- If the event has **Notify registrants when their kit is claimed** on, each registrant is
  messaged (email or Viber) and account holders get an in-app notice.

### Tab: Meal Stubs

One row per issued stub (stubs are generated when registrations are confirmed): **Participant,
Stub, Denomination, Control #, Status, Redeemed at**.

- Filters: **Search**, **Status** (Not redeemed / Redeemed), **Redeemed at** (merchant). A pill
  shows the total ₱ redeemed.
- Tick rows → **Redeem (n)** → **Mark redeemed** to redeem manually; **Clear (n)** to undo.

### Tab: Feedback

The average star rating, number of responses, and each rating and comment.

---

## 7. Users (User Master)

**Users** is a two-pane screen: the **user list** on the left, the **user form** on the right.
Click a row to load that user into the form.

**Toolbar:**

| Button | Action |
|--------|--------|
| **New** | Clears the form for a new user |
| **Save** | Saves the form (new or existing user) |
| **Delete** | Deletes the selected user (asks first; not allowed for yourself or users with registrations) |
| **Export** | Downloads the filtered list as CSV |
| **Import** | Bulk-create users from a CSV (below) |
| **↻** | Refresh the list |

- **Search** by name, email, ID No., designation or chapter; **Role** filter (Admin, Participant,
  Merchant, Confirmers). The pager (**← 1 / N →**) is below the list.
- Leaving a user with unsaved changes asks before discarding them.

**Form fields:** **Profile photo**, **First name**, **M.I.**, **Last name** (required), **Email**
(required), **Username** (auto-generated if blank), **Password** (min. 8 characters; when editing,
leave blank to keep), **Role** (Participant / Admin / Merchant), **ID No.**, **Designation**
(free text), **Chapter**, **Send pass via** (Email / Viber / Both), **Phone** (+63 format;
required for Viber/Both), and **Can confirm registrations**. Required fields that are empty show a
red **!**.

**Facial registration:** **Register face** captures the member's face for face check-in
(**Re-capture** / **Remove** later). Only face data is stored — it doesn't change the profile
photo. A face already registered to someone else is rejected. Capture in good light, facing the
camera — a poor capture makes face check-in less reliable.

### Importing users

**Import → Download template**, fill it in, then **Choose CSV file** → check the preview →
**Import N**.

- Required columns: **First Name, Last Name, Email**. Optional: Middle Initial, Username, **ID No**,
  **Designation**, Organization, Phone, Role, Notification Channel. (Old files with "Senate No" /
  "Level" headings still work.)
- Up to 5,000 rows. New accounts get the password **12345**; existing emails are skipped; blank
  role = Participant; Viber/Both needs a phone. A summary shows created / skipped / failed rows.

### Roles and the "Can confirm registrations" grant

| Role | Can do |
|------|--------|
| **Admin** | Everything |
| **Participant** | Browse and register for events, *My Events*, *My Account* |
| **Participant + Can confirm registrations** | Also: open events → **Attendance** to confirm, check in, cancel pending registrations, and send a Viber blast. Cannot create/edit events, invite, scan, or manage users. |
| **Merchant** | Only the **Meal Stub Scanner** |

A grant change takes effect at the user's **next sign-in**.

---

## 8. Settings

- **Email CC recipients** — addresses copied on **every** system email (passes, invitations,
  verification, kit notices). Type an address and press Enter.
- **Mobile notification channel** — **Viber** or **SMS** for registrants who chose a phone
  channel (SMS is text only — no QR image).
- Click **Save settings**.

---

## 9. Checking people in (Scanner)

Open the scanner from **Events → Start check-in** on the event's card (admins only, on the event
dates). Allow camera access when asked.

### Choosing what and how to scan

- **Check-in** or **Meal stubs** — what a scan does. *Meal stubs* redeems a **meal stub's** QR
  code (not the entry pass) and needs an internet connection.
- **Input:**
  - **Auto (QR + Face)** — scans QR passes and recognises registered faces on the same camera;
    a QR code always wins.
  - **QR camera** — QR passes only.
  - **Barcode** — for a USB/Bluetooth barcode scanner (or type the code and press Enter).
  - **Face** — face check-in only, using the front camera.

### Camera controls

- **Preview size** — **Small**, **Medium** or **Large** (remembered on the device). Large makes
  the camera take two-thirds of the screen on a desktop.
- **Front camera / Back camera** — switch cameras (shown when the device has more than one).
  QR scanning starts on the back camera, face check-in on the front; each choice is remembered.
- **Sound on / Sound off** — a short **beep** plays each time a QR code, barcode or face is read.
  Tap the page once after opening it so the browser allows sound.
- **Stop** / **Start scanning**.

### Results

| Banner | Meaning |
|--------|---------|
| 🟢 **Welcome!** | Checked in — with the person's photo, ID No., designation and chapter |
| 🟠 **Already checked in** | The pass was used before |
| 🔴 **Invalid pass** | Code not recognised |
| 🟠 **Not confirmed** | Registration not confirmed yet — confirm it first |
| 🟠 **Not registered** | Face recognised, but the person isn't registered for this event |
| 🔴 **Face not registered** | (Face mode) the face matches no one |
| 🟠 **Not open yet** / ⚫ **Event ended** | Outside the check-in dates |

Each message clears by itself after a few seconds and the scanner is ready again. Holding the
same pass or face in front of the camera shows its message again after a short pause (about
1 second after an error, 4 seconds after a successful check-in) — it never repeats instantly.

### Face check-in tips

To avoid false matches the scanner only accepts a face that is **clear, close enough and facing
the camera**, and only after the **same person is recognised on several frames in a row**
(about 1–2 seconds). If a face is ambiguous it's simply ignored. For best results:

- Ask people to look straight at the camera and step a little closer.
- At a kiosk, use the **front camera** (or **Face** mode) rather than the back QR camera.
- If one particular person is often mis-recognised, **re-capture their face** in **Users**.

### TV / presentation mode

**TV mode** (scanner header) opens the door TV: the face recognition engine's camera checks
people in and the screen shows each person's name, photo and result, with the attendee list on
the right. Choose what the camera checks in with — **QR** (passes), **Face**, or **Auto** (both);
the choice is remembered on that device. **Fullscreen** hides the attendee list and the buttons
(press **Esc** to get them back); **Exit** returns to the scanner.

- The TV and the browser scanner share the webcam: the TV takes it when opened and gives it back
  on **Exit**. Don't run both at once on one computer.
- Check-ins still follow the normal rules: only confirmed passes, only during the event.

### Offline check-in

The scanner keeps working without internet:

- The bar above the camera shows **Online**, or **Offline — check-ins are saved on this device**,
  and how many are **queued**.
- Check-ins made offline are uploaded automatically when the connection returns (or tap **Sync
  now**).
- For a device that can't connect at all, download the **Offline bundle** from the event page
  and load it on the scanner with **Import bundle**.

> **Camera requirement:** browsers only allow the camera over **HTTPS** (or `localhost`). If you
> see *"Could not open the camera,"* the page must be served over `https://`.

---

## 10. Meal Stub Scanner (Merchants)

Merchant accounts see only the **Meal Stub Scanner**:

- Choose **Camera** or **Barcode** (**Stub code** field), then scan each stub.
- Results: **Stub redeemed** (name, colour, ₱ value), **Already redeemed** (by whom), **Invalid
  stub**, or **Not valid today** (shows the valid dates).
- A running total of stubs and ₱ redeemed is shown; **Sound on/off** and the beep work as on the
  check-in scanner.

---

## Appendix — Admin quick answers

| Question | Answer |
|----------|--------|
| Someone registered but got no pass | Expected — passes go out when you **confirm**. Event → **Attendance** → select pending rows → **Confirm selected**. |
| How do I reject / remove a registration? | **Attendance** → tick the **pending** rows → **Cancel selected**. Confirmed or checked-in registrations can't be cancelled by admins. |
| An event is missing from *Browse Events* | It must be **Published** *and* have the public registration link on. |
| The scanner says "Not confirmed" | Confirm the registration on **Attendance**, then scan again. |
| How do I run an online / Teams event? | Set **Format** to **Online** (or **Hybrid**) and paste the Teams join link. Confirmed registrants get the link and a calendar invite automatically. |
| I changed the meeting time — do I need to tell people? | No. Confirmed registrants get an updated calendar invite automatically. |
| Face check-in recognised the wrong person | Ask them to face the camera; use the front camera; re-capture the person's face in **Users**. |
| The scanner doesn't beep | Tap the page once (browsers need a tap before playing sound) and check **Sound on**. |
| The camera preview is too small / big | Use **Preview size**. |
| I want someone to help confirm without being an admin | **Users** → select them → tick **Can confirm registrations** → **Save**. |
| A participant didn't get the invitation | Ask them to check spam; re-send, or share the public link. |
| The scanner camera won't open | The site must be served over **HTTPS** (or localhost). |
| I need to stop new sign-ups | **Close** on the event page (or Status = Closed). |
| How do I get the attendee list? | Event → **Attendance** → **Export CSV**. |
| How do I add many users at once? | **Users** → **Import** → **Download template** → fill in → import. |
| Where do I set the TV greeting or member photos? | Greeting: the event's **TV welcome message**. Photos: members add one in *My Account* or at sign-up; admins in **Users**. |
