// PocketCam public frontend configuration.
// Paste the Project URL and publishable key from Supabase > Project Settings > API Keys.
// NEVER place a service_role key or sb_secret_* key in this file.
window.POCKETCAM_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  // Optional: add TURN credentials from your TURN provider for restrictive networks.
  // iceServers: [
  //   { urls: "turn:turn.example.com:3478", username: "YOUR_TURN_USERNAME", credential: "YOUR_TURN_CREDENTIAL" }
  // ]
};
