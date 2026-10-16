PocketCam Messenger upgrade

Included: one-time 6-character account pairing codes (10-minute expiry), pairing records, direct-message inbox UI, message storage and realtime insert updates, protected admin dashboard overview, and SQL RLS setup.

Important limitation: code redemption links user accounts but does not yet switch the existing WebRTC signaling transport to cross-account sessions. Existing camera discovery/streaming remains same-account only until cross-account signaling is implemented.

After upload: replace config.js placeholders; run supabase/schema.sql in Supabase SQL Editor; grant admin to your own profile using the documented SQL statement; test signup, profile creation, pairing, and two-account messaging.
