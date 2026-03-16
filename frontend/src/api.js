const rawBackend = process.env.REACT_APP_BACKEND_URL;

export const API_BASE = rawBackend ? `${rawBackend.replace(/\/$/, "")}/api` : "/api";

export async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = payload.detail;
    } catch {
      // Ignore parse failures and use fallback message.
    }
    throw new Error(detail);
  }

  if (response.status === 204) return null;
  return response.json();
}
