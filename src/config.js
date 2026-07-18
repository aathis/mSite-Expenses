// Public OAuth client ID (not a secret — safe to ship in client-side code).
export const GOOGLE_CLIENT_ID =
  "109186607912-f06q7n0mdtbiq5l71a7f8kn0gniputmi.apps.googleusercontent.com";

// appDataFolder access needs the dedicated appdata scope — drive.file does
// NOT cover the hidden app data folder, only regular files the app creates.
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const DRIVE_BACKUP_FILENAME = "msite-expenses-backup.json";
