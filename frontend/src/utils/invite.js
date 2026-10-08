// Invite links look like https://syncus.example/?invite=SYNC-AB12. The code is kept until
// the partner has registered or logged in and accepted it, then cleared.
const STORAGE_KEY = "sync-us-invite";
const CODE_PATTERN = /^SYNC-[A-Z0-9]{4}$/;

export function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function isInviteCode(value) {
  return CODE_PATTERN.test(normalizeInviteCode(value));
}

let captured = false;
let memoryCode = "";

function captureFromUrl() {
  if (captured || typeof window === "undefined") return;
  captured = true;
  try {
    const url = new URL(window.location.href);
    const code = normalizeInviteCode(url.searchParams.get("invite"));
    if (!url.searchParams.has("invite")) return;
    if (isInviteCode(code)) {
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        // storage blocked: the code still works for this visit through memory below
        memoryCode = code;
      }
    }
    // Clean the address bar so a refresh or a shared screenshot doesn't carry the code.
    url.searchParams.delete("invite");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // ignore malformed URLs
  }
}

export function readPendingInvite() {
  captureFromUrl();
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || "";
    return isInviteCode(stored) ? stored : memoryCode;
  } catch {
    return memoryCode;
  }
}

export function clearPendingInvite() {
  memoryCode = "";
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function inviteLink(code) {
  return `${window.location.origin}/?invite=${encodeURIComponent(normalizeInviteCode(code))}`;
}
