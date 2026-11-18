# JAX Fitness Studio

This project has three separate parts:

| Part | Folder | What it is |
|---|---|---|
| Website | `index.html`, `css/`, `js/site.js` | The public site with the X intro and a free trial booking form |
| Studio Desk | `admin/` | Staff tool for leads, members, renewals, payments, attendance and WhatsApp follow-ups |
| WhatsApp server | `server/` | Optional. Sends follow-ups automatically through the WhatsApp Business Cloud API |

Everything is plain HTML, CSS and JavaScript. There is no build step and nothing to install for the website or the dashboard.

## Open it in VS Code

1. Unzip the folder and open it in VS Code (File > Open Folder).
2. Install the **Live Server** extension. VS Code will suggest it when the folder opens.
3. Right-click `index.html` and choose **Open with Live Server**.
   - Website: `http://127.0.0.1:5500/`
   - Studio Desk: `http://127.0.0.1:5500/admin/` (also linked as "Staff login" in the website footer)

Use Live Server, not a double-click on the file. The website and the dashboard share data only when they are opened from the same address.

## First things to edit

- `js/config.js`: your studio WhatsApp number and phone number. These power the website's "WhatsApp us" and "Call the studio" buttons.
- Studio Desk > **Settings**: plan names, months and fees, follow-up rules, and the wording of every WhatsApp message.
- `index.html`: the bracketed placeholders such as `[YOUR CITY]`, `[YOUR PRICE]` and `[YOUR STREET ADDRESS, CITY, PIN]`.
- `js/site.js`: the `CLASSES` list is a sample timetable. Replace it with your classes.

To try the dashboard with example clients, open Settings and click **Load sample data**. Sample records start with "Sample:". Delete them with **Delete all data** before going live.

## Studio Desk features

- **Leads & trials**: website trial bookings arrive as New. Move people through Contacted, Trial booked, Trial done, Joined or Lost. "Make member" converts a lead.
- **Members**: plan, start and expiry dates, status pills (Active, Renewal due, Expired, Frozen, Cancelled), balance and last visit. Renew extends from the current expiry, or from today if it has already ended.
- **Payments**: joining and renewal fees are added as charges. Record payments by Cash, UPI, Card or Bank transfer. Dues list with one-tap WhatsApp reminders.
- **Attendance**: type a name and press Enter to check someone in. Shows today's check-ins and members not seen for a set number of days.
- **WhatsApp follow-ups**: a queue built from your rules:
  - Welcome message for new trial bookings
  - Trial follow-up when someone has trialled but not joined
  - Renewal reminder before a membership ends (7 days by default)
  - Expired membership message for the 30 days after it ends
  - Payment due reminder when a member owes money
  - "Not seen lately" when an active member stops coming (10 days by default)

  Each item can be sent, edited first, or skipped. Every message is recorded in the message log. The same reminder is not repeated within 3 days (changeable).

## How data is stored

The website and dashboard save to the browser's local storage on the computer you use. This means:

- Data stays on that one computer and browser. Other staff on other devices will not see it.
- Clearing browser data deletes it. Use **Settings > Export backup** regularly. **Import backup** restores it.
- A trial booked on the public website by a visitor saves in **their** browser, not yours. Until the site has a backend, the form also offers the visitor a "Message us now" WhatsApp button with their booking details, which reaches your studio number directly. Bookings made at the front desk on the studio computer go straight into the dashboard.

Moving to shared data, staff logins and website bookings that reach the dashboard needs a backend and database. The data in `js/store.js` is kept in one place so it can be swapped for API calls later.

## WhatsApp sending

### Click-to-send (default, works now)

Each Send opens WhatsApp Web or the WhatsApp app with the message already written. Staff check it and tap Send. No setup and no cost. Numbers without a country code get the default code from Settings (91).

### Automatic sending (WhatsApp Business Cloud API)

Messages go out with no tap. This needs setup with Meta first:

1. Create a Meta Business account and an app at developers.facebook.com, and add the WhatsApp product.
2. Register the studio's phone number. A number registered with the Cloud API can no longer be used in the normal WhatsApp app, so many businesses use a separate number for this.
3. Create a permanent access token (a System User token) and note the **Phone number ID**.
4. Create message templates in WhatsApp Manager and wait for approval. WhatsApp only delivers business-started messages through approved templates. Free text only works within 24 hours of the person last messaging you.
   - Name them to match `server/templates.json`, or change the names in that file.
   - `params` lists, in order, which values fill the template's `{{1}}`, `{{2}}` and so on.
5. Meta charges for template messages. Check their current WhatsApp pricing for your country.

Then run the server (needs Node.js 18 or newer):

```bash
cd server
cp .env.example .env      # on Windows: copy .env.example .env
# put WA_TOKEN and WA_PHONE_NUMBER_ID into .env
npm start
```

In Studio Desk go to **Settings > WhatsApp**, choose **Automatic**, keep the server address `http://localhost:8787/send`, click **Test server connection**, and save.

To test without sending anything, run `npm run dry-run`. Messages are printed in the terminal instead.

Automatic follow-ups on a timer run only while the dashboard is open in a browser, because the client data lives in that browser. Fully unattended sending, such as at 9am every day, needs the backend version where the server holds the data.

## Folder structure

```
jax-fitness/
├── index.html            website
├── css/site.css
├── js/
│   ├── config.js         studio phone and WhatsApp number
│   ├── store.js          shared data storage
│   ├── whatsapp.js       click-to-send and API sending
│   └── site.js           website interactions
├── admin/                Studio Desk
│   ├── index.html
│   ├── admin.css
│   └── admin.js
├── server/               optional WhatsApp Cloud API server
│   ├── whatsapp-server.js
│   ├── templates.json
│   ├── .env.example
│   └── package.json
└── assets/               logo and photos
```

## Before going public

- Put the dashboard behind a login, or do not upload the `admin/` folder to the public website. As built, anyone who opens `/admin/` sees the dashboard, though only with data from their own browser.
- Replace the placeholder text and sample timetable.
- Get written permission before using member photos or transformation results.
