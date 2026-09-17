"use strict";

(function installApiBridge() {
  const config = window.WP_CONFIG || {};
  const apiBase = String(config.API_BASE_URL || "").replace(/\/$/, "");
  const token = sessionStorage.getItem("weeklyPlanner.accessToken");
  const user = JSON.parse(sessionStorage.getItem("weeklyPlanner.user") || "null");
  if (!apiBase || !token || !user?.email) {
    window.top.location.replace("index.html");
    return;
  }

  localStorage.setItem("weeklyPlanner.email", user.email);
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function bridgedFetch(input, init = {}) {
    const sourceUrl = typeof input === "string" ? input : input.url;
    const parsed = new URL(sourceUrl, window.location.href);
    const isApiRequest = parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/auth/");
    if (!isApiRequest) return originalFetch(input, init);

    const path = `${parsed.pathname}${parsed.search}`;
    const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined));
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await originalFetch(`${apiBase}${path}`, { ...init, headers });
    if (response.ok) return response;

    try {
      const payload = await response.clone().json();
      if (payload.detail && !payload.error) {
        return new Response(JSON.stringify({ error: payload.detail }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
      }
    } catch (_) { /* preserve the original response */ }
    return response;
  };
})();
