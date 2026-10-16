# PocketCam Studio — account-based, code-free device pairing

PocketCam is a static frontend for GitHub Pages. Sign-in and device discovery are real when configured with your own Supabase project. The app uses Supabase Auth for accounts, private Realtime Presence/Broadcast for same-account device discovery and WebRTC signaling, and peer-to-peer WebRTC for media whenever the network permits.

## What's included

- Distinctive dark studio UI with sliding page transitions and animated visual details.
- Email/password sign-up, sign-in, persistent Supabase session, sign-out, password-reset email, and password update flow.
- Private account-scoped presence: devices signed in with the same account discover each other without room codes or QR pairing.
- Automatic connection when a ready receiver and a ready sender appear on the same account. Camera permission is still explicitly started by the sender; a receiver must enable receiving.
- Phone/PC, PC/phone, phone/phone, and PC/PC browser combinations.
- Capture requests for 480p, 720p, 1080p, 1440p, and 2160p; landscape, portrait and square capture; requested 24/30/60 FPS; camera selection; optional microphone; continuous autofocus where exposed by the browser.
- Preview framing controls: landscape, portrait, square, fit/fill, mirror, fullscreen, mute, snapshot download, clip recording, and picture-in-picture where supported.
- Optional TURN server configuration for networks where direct WebRTC paths fail.
- USB-tethering instructions.

## 1. Create and configure Supabase

1. Create a Supabase project at https://supabase.com/.
2. In **Project Settings → API Keys** (or the **Connect** dialog), copy the **Project URL** and the **publishable key** (`sb_publishable_...`). A legacy `anon` key can work as a public client key too. Never use `service_role` or `sb_secret_...` in the frontend.
3. Open `config.js` and replace `https://YOUR_PROJECT_REF.supabase.co` and `YOUR_SUPABASE_PUBLISHABLE_KEY` with your real values.
4. In Supabase **SQL Editor**, run all of `supabase/schema.sql`. These policies limit the private Realtime topic to the authenticated user's own account ID, so devices on different accounts cannot subscribe to the same account topic.
5. In Supabase **Authentication → URL Configuration**, set **Site URL** to the published GitHub Pages URL and add that exact URL (including the repository path, when applicable) to **Redirect URLs**. Also add the local development URL if you use one.
6. In **Authentication → Providers**, make sure Email is enabled. You can keep email confirmation enabled; new users will then need to verify their address before logging in.
7. In **Realtime Settings**, leave private-channel authorization enabled and ensure public access is not enabled for this feature.
8. Commit `index.html`, `app.js`, `config.js`, and `supabase/schema.sql` to the repository. Enable GitHub Pages on the correct branch/folder and open the HTTPS URL.

`config.js` contains only public project identifiers. Account security is enforced by Supabase Auth and the Realtime RLS policies, not by hiding those public values. Do not add a service-role key.

## 2. Use code-free pairing

1. Open PocketCam on your phone and computer.
2. Sign in to the **same account** on both devices. Create one account with Sign up first if needed.
3. On the sending device, choose **Send camera** and tap **Go live & discover devices**. Allow camera/microphone permissions.
4. On the receiving device, choose **View stream** and tap **Enable receiver & auto-connect**.
5. The receiver asks the available sender on that account to connect. With one sender and one receiver, pairing is automatic—no room code, QR code, or copied link is needed. The device list also offers a manual connect action when multiple devices are online.
6. Keep the browser tab open while streaming. Mobile browsers may pause the camera in the background or when the screen locks.

The website cannot activate the camera without the device user's browser permission. If multiple senders/receivers are online, use the device list to choose the intended device; automatic pairing selects an available sender when a receiver is enabled.

## 3. USB: what's possible

USB tethering can carry the network connection between phone and PC. Enable USB tethering in the phone's network settings (where supported), open PocketCam on both devices, and sign in with the same account. The site still uses WebRTC over the available network route; it does not speak a universal direct USB video protocol.

If the phone or operating system exposes a standard UVC camera over USB, it may appear in PocketCam’s Camera Device selector. Support depends on the device and OS. A website hosted on GitHub Pages cannot install a system-wide webcam or microphone driver for Zoom/Discord. For a universal direct USB camera bridge or system-wide webcam access, a separate native companion app and/or virtual camera driver would be required. OBS can often capture the receiver browser as a Browser Source.

## 4. Network and security limitations

- Supabase Realtime carries signaling data; it does not relay the video itself. WebRTC attempts a direct media connection using the configured STUN servers. Some NATs, mobile carriers, firewalls, or VPNs require a TURN relay.
- If needed, configure a trusted TURN provider and add its `iceServers` array in `config.js`. Use time-limited TURN credentials where possible; do not publish long-lived private credentials in a public repository.
- Same-account devices can signal each other because they share that account. Sign out of shared computers when finished.
- Video is peer-to-peer when ICE establishes a direct path, but may travel through a TURN relay if configured/required. Avoid streaming sensitive content unless your network and deployment setup are appropriate for it.
- Capture resolution, frame rate, autofocus, portrait sensor behavior, snapshot, recording and Picture-in-Picture depend on browser and hardware support. Resolution options are requests, not guarantees.
- History remains local to each browser in this build. A separate database table and RLS policies would be needed for synced history.
- Contact is still a frontend form; it does not transmit messages.

## Files

- `index.html` — responsive frontend and studio interface.
- `app.js` — Supabase Auth, private presence/signaling, WebRTC, camera controls, preview tools.
- `config.js` — public Supabase URL/key plus optional ICE/TURN settings.
- `supabase/schema.sql` — private-channel authorization policies.

## Local development

Serve the folder with any static HTTP server, or use GitHub Pages. Camera access generally requires HTTPS or `localhost`; opening `index.html` directly using a `file://` URL will not work reliably. Configure the URL used for development in Supabase Redirect URLs.


## Messenger + pairing + admin upgrade

This version adds a pairing-code workflow, direct-message inbox, and admin overview. After replacing `config.js` values, run the complete `supabase/schema.sql` in Supabase SQL Editor. Existing private account-based camera discovery remains available. Pairing codes currently establish a trusted user pairing record; cross-account WebRTC camera signaling is a separate feature and is not falsely advertised as enabled by code redemption alone.

### Grant admin access safely

After creating your own account and confirming its email, open Supabase SQL Editor and run this statement with your account email: `update public.user_profiles set role = 'admin' where email = 'you@example.com';` Only do this for accounts you control. The dashboard checks the database role and policies; hiding the navigation item is not the security boundary. Admin overview shows basic account metadata and aggregate counts, not message contents.

### Important setup

- Enable Realtime for the `messages` table if your project does not automatically have it enabled.
- Keep the Supabase publishable key in `config.js`; never put a service-role/secret key in the website.
- The SQL includes row-level security for pairing codes, links, conversations, messages and admin-only directory access.
- Static GitHub Pages cannot keep a private server secret; privileged operations must remain inside Supabase policies/functions.
