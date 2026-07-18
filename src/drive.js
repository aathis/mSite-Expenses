import { GOOGLE_CLIENT_ID, DRIVE_SCOPE, DRIVE_BACKUP_FILENAME } from "./config.js";

const CONNECTED_KEY = "msite-drive-connected";
const FILE_ID_KEY = "msite-drive-backup-file-id";
const LAST_BACKUP_KEY = "msite-drive-last-backup";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

function gisReady() {
  return typeof window !== "undefined" && window.google?.accounts?.oauth2;
}

function waitForGis(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (gisReady()) return resolve();
    const start = Date.now();
    const iv = setInterval(() => {
      if (gisReady()) {
        clearInterval(iv);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        reject(new Error("Google sign-in did not load. Check your internet connection."));
      }
    }, 100);
  });
}

function getTokenClient() {
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {},
    });
  }
  return tokenClient;
}

function requestToken(promptMode) {
  return new Promise((resolve, reject) => {
    const client = getTokenClient();
    client.callback = (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 30000;
        resolve(accessToken);
      } else {
        reject(new Error(resp?.error || "Google did not grant access."));
      }
    };
    client.error_callback = (err) => {
      reject(new Error(err?.type || "Google sign-in was cancelled or failed."));
    };
    client.requestAccessToken({ prompt: promptMode });
  });
}

export function isDriveConnected() {
  return localStorage.getItem(CONNECTED_KEY) === "1";
}

export function getLastBackupTime() {
  return localStorage.getItem(LAST_BACKUP_KEY) || null;
}

export async function connectDrive() {
  await waitForGis();
  await requestToken("consent");
  localStorage.setItem(CONNECTED_KEY, "1");
  return true;
}

export function disconnectDrive() {
  if (accessToken && gisReady()) {
    try {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    } catch (e) {
      // best-effort revoke only
    }
  }
  accessToken = null;
  tokenExpiresAt = 0;
  localStorage.removeItem(CONNECTED_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
  // Deliberately keep FILE_ID_KEY: it points at the same Drive file across
  // reconnects, so a future name-based re-search (which can't distinguish
  // duplicates well) is never needed unless the file is actually gone.
}

async function ensureToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  await waitForGis();
  return requestToken(""); // silent renewal; rejects if interactive consent is needed again
}

async function googleApiError(res, fallback) {
  try {
    const body = await res.json();
    const msg = body?.error?.message;
    return new Error(msg ? `${fallback} (${res.status}: ${msg})` : `${fallback} (HTTP ${res.status})`);
  } catch (e) {
    return new Error(`${fallback} (HTTP ${res.status})`);
  }
}

async function findExistingFileId(token) {
  const cached = localStorage.getItem(FILE_ID_KEY);
  if (cached) return cached;
  const url =
    "https://www.googleapis.com/drive/v3/files" +
    "?spaces=appDataFolder&fields=files(id,name,modifiedTime,size)" +
    "&orderBy=modifiedTime desc" +
    "&q=" + encodeURIComponent(`name='${DRIVE_BACKUP_FILENAME}'`);
  const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  if (!res.ok) throw await googleApiError(res, "Could not check Google Drive for an existing backup.");
  const data = await res.json();
  // If more than one file with this name exists (e.g. from an earlier bug
  // creating duplicates), always prefer the most recently modified one.
  return data.files?.[0]?.id || null;
}

async function createBackupFile(token, content) {
  const boundary = "msite-boundary-" + Date.now();
  const metadata = { name: DRIVE_BACKUP_FILENAME, parents: ["appDataFolder"] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    content + `\r\n` +
    `--${boundary}--`;
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!res.ok) throw await googleApiError(res, "Could not create the Drive backup file.");
  const data = await res.json();
  return data.id;
}

async function updateBackupFile(token, fileId, content) {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: content,
    }
  );
  if (!res.ok) {
    if (res.status === 404) localStorage.removeItem(FILE_ID_KEY);
    throw await googleApiError(res, "Could not update the Drive backup file.");
  }
}

// Best-effort: never throws. Callers get back a status object instead.
export async function restoreFromDrive() {
  if (!isDriveConnected()) return { ok: false, error: "Connect Google Drive first." };
  try {
    const token = await ensureToken();
    const fileId = await findExistingFileId(token);
    if (!fileId) return { ok: false, notFound: true, error: "No backup found in Drive yet." };
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: "Bearer " + token } }
    );
    if (!res.ok) {
      if (res.status === 404) {
        localStorage.removeItem(FILE_ID_KEY);
        return { ok: false, notFound: true, error: "No backup found in Drive yet." };
      }
      throw await googleApiError(res, "Could not read the Drive backup file.");
    }
    const data = await res.json();
    return {
      ok: true,
      expenses: Array.isArray(data.expenses) ? data.expenses : [],
      savedAt: data.savedAt || null,
    };
  } catch (e) {
    return { ok: false, error: e.message || "Restore from Drive failed." };
  }
}

// Best-effort: never throws. Callers get back a status object instead.
export async function backupExpensesToDrive(expenses) {
  if (!isDriveConnected()) return { ok: false, skipped: true };
  try {
    const token = await ensureToken();
    const content = JSON.stringify({ savedAt: new Date().toISOString(), expenses });
    let fileId = await findExistingFileId(token);
    if (!fileId) {
      fileId = await createBackupFile(token, content);
    } else {
      await updateBackupFile(token, fileId, content);
    }
    localStorage.setItem(FILE_ID_KEY, fileId);
    const now = new Date().toISOString();
    localStorage.setItem(LAST_BACKUP_KEY, now);
    return { ok: true, at: now };
  } catch (e) {
    return { ok: false, error: e.message || "Backup to Drive failed." };
  }
}
