"use strict";

(() => {
  const UI_VERSION = "0.4.9";
  let healthPromise = null;

  function readApiVersion() {
    if (healthPromise) return healthPromise;
    healthPromise = (async () => {
      const apiBase = String(window.WP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
      if (!apiBase) return "—";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`${apiBase}/health`, {cache: "no-store", signal: controller.signal});
        if (!response.ok) return "—";
        const payload = await response.json().catch(() => ({}));
        return String(payload.version || "—");
      } catch (_) {
        return "—";
      } finally {
        clearTimeout(timer);
      }
    })();
    return healthPromise;
  }

  window.updateVersionFooter = async function updateVersionFooter() {
    const footer = document.querySelector(".app-version");
    if (!footer) return;
    footer.textContent = `Интерфейс v${UI_VERSION}. API v…`;
    footer.textContent = `Интерфейс v${UI_VERSION}. API v${await readApiVersion()}`;
  };

  document.addEventListener("DOMContentLoaded", window.updateVersionFooter);
})();
