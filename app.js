"use strict";

const API_BASE_URL = String(window.WP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "weeklyPlanner.accessToken";
const USER_KEY = "weeklyPlanner.user";
const EXPIRY_KEY = "weeklyPlanner.sessionExpiresAt";

let emailChallengeId = "";
let emailChallengeAddress = "";

function setMessage(text, type = "") {
  const node = document.querySelector("#authMessage");
  if (!node) return;
  node.textContent = text || "";
  node.className = `message ${type}`.trim();
}

function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(EXPIRY_KEY);
}

function saveSession(payload, persistent = false) {
  clearStoredSession();
  const storage = persistent ? localStorage : sessionStorage;
  storage.setItem(TOKEN_KEY, payload.access_token);
  storage.setItem(USER_KEY, JSON.stringify(payload.user));
  if (persistent) {
    const ttlSeconds = Math.max(0, Number(payload.expires_in) || 0);
    localStorage.setItem(EXPIRY_KEY, String(Date.now() + ttlSeconds * 1000));
  }
  renderRoutes(payload.user);
}

function restoreSession() {
  const sessionToken = sessionStorage.getItem(TOKEN_KEY);
  const sessionUser = sessionStorage.getItem(USER_KEY);
  if (sessionToken && sessionUser) return { token: sessionToken, user: sessionUser };

  const persistentToken = localStorage.getItem(TOKEN_KEY);
  const persistentUser = localStorage.getItem(USER_KEY);
  const expiresAt = Number(localStorage.getItem(EXPIRY_KEY) || 0);
  if (persistentToken && persistentUser && expiresAt > Date.now()) {
    return { token: persistentToken, user: persistentUser };
  }
  if (persistentToken || persistentUser || expiresAt) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRY_KEY);
  }
  return null;
}

async function requestJson(path, body) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Не удалось выполнить вход");
  return payload;
}

async function authenticateGoogle(credential) {
  setMessage("Проверяю доступ…");
  const payload = await requestJson("/auth/google", { credential });
  saveSession(payload, false);
}

async function requestEmailCode() {
  const input = document.querySelector("#emailInput");
  const button = document.querySelector("#emailSendBtn");
  const email = String(input?.value || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    setMessage("Введи корректный email", "error");
    input?.focus();
    return;
  }

  button.disabled = true;
  setMessage("Отправляю код…");
  try {
    const payload = await requestJson("/auth/email/request", { email });
    emailChallengeId = String(payload.challenge_id || "");
    emailChallengeAddress = email;
    document.querySelector("#emailRequestStep").classList.add("hidden");
    document.querySelector("#emailVerifyStep").classList.remove("hidden");
    document.querySelector("#emailCodeTarget").textContent = email;
    const codeInput = document.querySelector("#emailCodeInput");
    codeInput.value = "";
    codeInput.focus();
    setMessage("Код отправлен на почту", "success");
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function verifyEmailCode() {
  const codeInput = document.querySelector("#emailCodeInput");
  const button = document.querySelector("#emailVerifyBtn");
  const code = String(codeInput?.value || "").replace(/\D/g, "").slice(0, 6);
  codeInput.value = code;
  if (!emailChallengeId || !emailChallengeAddress) {
    resetEmailLogin();
    setMessage("Запроси новый код", "error");
    return;
  }
  if (code.length !== 6) {
    setMessage("Введи 6-значный код", "error");
    codeInput?.focus();
    return;
  }

  button.disabled = true;
  setMessage("Проверяю код…");
  try {
    const payload = await requestJson("/auth/email/verify", {
      email: emailChallengeAddress,
      challenge_id: emailChallengeId,
      code
    });
    saveSession(payload, true);
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function resetEmailLogin() {
  emailChallengeId = "";
  emailChallengeAddress = "";
  document.querySelector("#emailRequestStep")?.classList.remove("hidden");
  document.querySelector("#emailVerifyStep")?.classList.add("hidden");
  const codeInput = document.querySelector("#emailCodeInput");
  if (codeInput) codeInput.value = "";
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
    callback: (response) => authenticateGoogle(response.credential).catch((error) => setMessage(error.message, "error"))
  });
  google.accounts.id.renderButton(document.querySelector("#googleButton"), {
    theme: "outline", size: "large", text: "signin_with", shape: "rectangular", width: 280
  });
};

document.addEventListener("DOMContentLoaded", () => {
  const restored = restoreSession();
  if (restored) {
    try { renderRoutes(JSON.parse(restored.user)); } catch (_) { clearStoredSession(); }
  }

  document.querySelector("#emailSendBtn")?.addEventListener("click", requestEmailCode);
  document.querySelector("#emailVerifyBtn")?.addEventListener("click", verifyEmailCode);
  document.querySelector("#emailChangeBtn")?.addEventListener("click", () => {
    resetEmailLogin();
    setMessage("");
    document.querySelector("#emailInput")?.focus();
  });
  document.querySelector("#emailInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") requestEmailCode();
  });
  document.querySelector("#emailCodeInput")?.addEventListener("input", (event) => {
    event.target.value = event.target.value.replace(/\D/g, "").slice(0, 6);
  });
  document.querySelector("#emailCodeInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") verifyEmailCode();
  });

  document.querySelector("#logoutBtn").addEventListener("click", () => {
    clearStoredSession();
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    resetEmailLogin();
    setMessage("");
    document.querySelector("#routeView").classList.add("hidden");
    document.querySelector("#authView").classList.remove("hidden");
  });
  if (window.google?.accounts?.id) window.initGoogleSignIn();
});
