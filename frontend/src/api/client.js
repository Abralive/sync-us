const API = "/api/v1";
const DEFAULT_TIMEOUT_MS = 20000;

export class ApiError extends Error {
  constructor(message, status, code = "") {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 = no answer (offline, timeout)
    this.code = code; // e.g. "user_not_found", "timeout", "network"
  }
}

// Every request gives up after `timeout` ms, so one stuck connection (common on phones
// after switching networks or waking up) can never freeze polling or a pending change.
export async function request(path, options = {}) {
  const { timeout = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      });
    } catch (err) {
      if (err?.name === "AbortError") throw new ApiError("伺服器太久沒有回應，請稍後再試一次。", 0, "timeout");
      throw new ApiError("連不上 Sync-Us 伺服器，請檢查網路後再試一次。", 0, "network");
    }
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(error.detail || `伺服器回應 ${response.status}`, response.status, error.code || "");
    }
    try {
      return await response.json();
    } catch (err) {
      if (err?.name === "AbortError") throw new ApiError("伺服器太久沒有回應，請稍後再試一次。", 0, "timeout");
      throw new ApiError("伺服器回傳的資料無法讀取，請稍後再試一次。", response.status, "bad_response");
    }
  } finally {
    window.clearTimeout(timer);
  }
}
