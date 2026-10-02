"use strict";

const API_BASE_URL = String(window.WP_CONFIG?.API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_KEY = "weeklyPlanner.accessToken";
const USER_KEY = "weeklyPlanner.user";

let emailChallengeId = "";
let emailChallengeAddress = "";

function setMessage(text, type = "") {
  const node = document.querySelector("#authMessage");
  if (!node) return;
  node.textContent = text || "";
  node.className = `message ${type}`.trim();
}

function saveSession(payload) {
  sessionStorage.setItem(TOKEN_KEY, payload.access_token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  renderRoutes(payload.user);
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
  saveSession(payload);
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
    saveSession(payload);
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
  const storedUser = sessionStorage.getItem(USER_KEY);
  if (storedUser && sessionStorage.getItem(TOKEN_KEY)) {
    try { renderRoutes(JSON.parse(storedUser)); } catch (_) { sessionStorage.clear(); }
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
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    resetEmailLogin();
    setMessage("");
    document.querySelector("#routeView").classList.add("hidden");
    document.querySelector("#authView").classList.remove("hidden");
  });
  if (window.google?.accounts?.id) window.initGoogleSignIn();
});
