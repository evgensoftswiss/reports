"use strict";

const STORAGE_KEY = "jiraWorkload.settings.v1";
const $ = (id) => document.getElementById(id);

function isoDate(value) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function defaultDates() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const end = new Date(monday);
  end.setDate(monday.getDate() + 13);
  return {dateFrom: isoDate(monday), dateTo: isoDate(end)};
}

function readSettings() {
  const defaults = defaultDates();
  try { return {...defaults, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")}; }
  catch (_) { return defaults; }
}

function requestPayload() {
  return {date_from: $("dateFrom").value, date_to: $("dateTo").value};
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    dateFrom: $("dateFrom").value,
    dateTo: $("dateTo").value
  }));
}

function setBusy(busy) {
  document.querySelectorAll(".report-button").forEach(button => button.disabled = busy);
}

function setStatus(text, progress = 0, error = false) {
  $("statusText").textContent = text;
  $("statusText").className = `message${error ? " error" : ""}`;
  $("progressBar").style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.detail || `HTTP ${response.status}`);
  return payload;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Сервер слишком долго не отвечает");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForJob(jobId) {
  const startedAt = Date.now();
  const maxWaitMs = 30 * 60 * 1000;
  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new Error("Формирование длится более 30 минут. Проверьте журнал API и повторите запрос");
    }
    const job = await readResponse(await fetchWithTimeout(`/api/workload/jobs/${encodeURIComponent(jobId)}`, {cache: "no-store"}, 20000));
    setStatus(job.message || "Формирование…", job.progress || 0, job.status === "failed");
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || job.message || "Не удалось сформировать отчёт");
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

async function showReport({notFoundIsEmpty = false} = {}) {
  const payload = requestPayload();
  const response = await fetchWithTimeout("/api/workload/report/fragment", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
    cache: "no-store"
  }, 120000);
  if (notFoundIsEmpty && response.status === 404) return false;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.detail || `HTTP ${response.status}`);
  }
  mountReportFragment(await response.text());
  $("reportPanel").classList.remove("hidden");
  return true;
}

function mountReportFragment(fragment) {
  const mount = $("reportMount");
  mount.innerHTML = fragment;
  // Скрипты, добавленные через innerHTML, браузер не запускает. Создаём их
  // заново после вставки фрагмента; JSON-данные отчёта остаются inert-скриптом.
  for (const inertScript of [...mount.querySelectorAll("script")]) {
    const script = document.createElement("script");
    for (const attribute of inertScript.attributes) script.setAttribute(attribute.name, attribute.value);
    script.textContent = inertScript.textContent;
    inertScript.replaceWith(script);
  }
}

async function showLatestReport() {
  setBusy(true);
  setStatus("Загружаю последний отчёт…", 15);
  try {
    const response = await fetchWithTimeout("/api/workload/report/latest", {cache: "no-store"}, 30000);
    if (response.status === 404) {
      const restored = await showReport({notFoundIsEmpty: true});
      setStatus(restored ? "Показан последний отчёт выбранного периода" : "Готово к формированию", restored ? 100 : 0);
      return;
    }
    const latest = await readResponse(response);
    const period = latest.period || {};
    if (period.from && period.to) {
      $("dateFrom").value = period.from;
      $("dateTo").value = period.to;
      saveSettings();
    }
    setStatus("Открываю последний отчёт…", 70);
    await showReport();
    setStatus("Показан последний сформированный отчёт", 100);
  } catch (error) {
    setStatus(error.message, 0, true);
  } finally {
    setBusy(false);
  }
}

async function start(mode) {
  const payload = requestPayload();
  if (!payload.date_from || !payload.date_to) return setStatus("Укажите даты периода", 0, true);
  saveSettings();
  setBusy(true);
  setStatus("Запускаю формирование…", 2);
  try {
    const job = await readResponse(await fetchWithTimeout("/api/workload/jobs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...payload, mode})
    }, 30000));
    await waitForJob(job.job_id);
    setStatus("Строю таблицу…", 100);
    await showReport();
    setStatus("Отчёт готов", 100);
  } catch (error) {
    setStatus(error.message, 0, true);
  } finally {
    setBusy(false);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const settings = readSettings();
  $("dateFrom").value = settings.dateFrom;
  $("dateTo").value = settings.dateTo;
  document.querySelectorAll(".report-button").forEach(button => button.addEventListener("click", () => start(button.dataset.mode)));
  ["dateFrom", "dateTo"].forEach(id => $(id).addEventListener("change", saveSettings));
  showLatestReport();
});
