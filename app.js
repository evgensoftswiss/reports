"use strict";

const API_BASE_URL = String(window.WP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "weeklyPlanner.accessToken";
const USER_KEY = "weeklyPlanner.user";

function setMessage(text, type = "") {
  const node = document.querySelector("#authMessage");
  if (!node) return;
  node.textContent = text || "";
  node.className = `message ${type}`.trim();
}

async function authenticate(credential) {
  setMessage("Проверяю доступ…");
  const response = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ credential })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Не удалось выполнить вход");
  sessionStorage.setItem(TOKEN_KEY, payload.access_token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  renderRoutes(payload.user);
}

function renderRoutes(user) {
  document.querySelector("#welcomeTitle").textContent = user.role === "manager" ? "Планирование" : "Добро пожаловать";
  document.querySelector("#welcomeEmail").textContent = user.email;
  document.querySelector("#routeView").classList.remove("hidden");
  document.querySelector("#authView").classList.add("hidden");
  document.querySelector("#managerRoute").classList.toggle("hidden", user.role !== "manager");
}

window.initGoogleSignIn = function initGoogleSignIn() {
  if (!window.google?.accounts?.id) return;
  const clientId = String(window.WP_CONFIG?.GOOGLE_CLIENT_ID || "");
  if (!clientId || clientId.startsWith("REPLACE_")) {
    setMessage("Укажи GOOGLE_CLIENT_ID в config.js", "error");
    return;
  }
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => authenticate(response.credential).catch((error) => setMessage(error.message, "error"))
  });
  google.accounts.id.renderButton(document.querySelector("#googleButton"), {
    theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 280
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const storedUser = sessionStorage.getItem(USER_KEY);
  if (storedUser && sessionStorage.getItem(TOKEN_KEY)) {
    try { renderRoutes(JSON.parse(storedUser)); } catch (_) { sessionStorage.clear(); }
  }
  document.querySelector("#logoutBtn").addEventListener("click", () => {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    document.querySelector("#routeView").classList.add("hidden");
    document.querySelector("#authView").classList.remove("hidden");
  });
  if (window.google?.accounts?.id) window.initGoogleSignIn();
});
