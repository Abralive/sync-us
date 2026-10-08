const API = "/api/v1";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
  } catch {
    throw new ApiError("連不上 Sync-Us 伺服器，請檢查網路後再試一次。", 0);
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(error.detail || `伺服器回應 ${response.status}`, response.status);
  }
  return response.json();
}
