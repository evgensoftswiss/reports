"use strict";

const STORAGE_KEY = "jiraWorkload.settings.v1";
const $ = (id) => document.getElementById(id);
let reportUrl = "";

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

function emails() {
  return [...new Set($("emails").value.split(/[\n,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean))];
}

function requestPayload() {
  return {date_from: $("dateFrom").value, date_to: $("dateTo").value, emails: emails()};
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    reportName: $("reportName").value,
    dateFrom: $("dateFrom").value,
    dateTo: $("dateTo").value,
    emails: $("emails").value
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

async function waitForJob(jobId) {
  for (;;) {
    const job = await readResponse(await fetch(`/api/workload/jobs/${encodeURIComponent(jobId)}`, {cache: "no-store"}));
    setStatus(job.message || "Формирование…", job.progress || 0, job.status === "failed");
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || job.message || "Не удалось сформировать отчёт");
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

async function showReport() {
  const payload = {...requestPayload(), report_name: $("reportName").value.trim() || "Отчёт по загруженности"};
  const response = await fetch("/api/workload/report/html", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.detail || `HTTP ${response.status}`);
  }
  if (reportUrl) URL.revokeObjectURL(reportUrl);
  reportUrl = URL.createObjectURL(await response.blob());
  $("reportFrame").src = reportUrl;
  $("reportPanel").classList.remove("hidden");
}

async function start(mode) {
  const payload = requestPayload();
  if (!payload.date_from || !payload.date_to) return setStatus("Укажите даты периода", 0, true);
  if (!payload.emails.length) return setStatus("Добавьте хотя бы один email", 0, true);
  saveSettings();
  setBusy(true);
  setStatus("Запускаю формирование…", 2);
  try {
    const job = await readResponse(await fetch("/api/workload/jobs", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({...payload, mode})
    }));
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

document.addEventListener("DOMContentLoaded", async () => {
  const settings = readSettings();
  $("reportName").value = settings.reportName || "Отчёт по загруженности";
  $("dateFrom").value = settings.dateFrom;
  $("dateTo").value = settings.dateTo;
  $("emails").value = settings.emails || "";
  document.querySelectorAll(".report-button").forEach(button => button.addEventListener("click", () => start(button.dataset.mode)));
  ["reportName", "dateFrom", "dateTo", "emails"].forEach(id => $(id).addEventListener("change", saveSettings));
  if (!$("emails").value.trim()) {
    try {
      const defaults = await readResponse(await fetch("/api/workload/settings", {cache: "no-store"}));
      $("emails").value = (defaults.emails || []).join("\n");
      if (!settings.reportName && defaults.report_name) $("reportName").value = defaults.report_name;
      saveSettings();
    } catch (error) {
      setStatus(error.message, 0, true);
    }
  }
});

window.addEventListener("beforeunload", () => { if (reportUrl) URL.revokeObjectURL(reportUrl); });
