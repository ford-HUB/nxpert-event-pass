"use strict";

const API = "/api/v1";
const POLL_MS = 500;
const REPLAY_RECENT_SECONDS = 30;
const QUEUE_SLOTS = 3;

const tv = {
  sessionId: null,
  lastSequence: 0,
  displaySeconds: 3,
  items: [],
  current: null,
  isPolling: false,
};

const $ = (id) => document.getElementById(id);

async function fetchJson(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = response.statusText;
    try { detail = (await response.json()).detail || detail; } catch { /* non-JSON error body */ }
    throw new Error(detail);
  }
  return response.status === 204 ? null : response.json();
}

function formatTime(seconds) {
  return new Date(seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(text) {
  const span = document.createElement("span");
  span.textContent = text;
  return span.innerHTML;
}

async function pollCheckIns() {
  if (tv.isPolling) return;
  tv.isPolling = true;
  try {
    const data = await fetchJson(`${API}/check-ins?after_sequence=${tv.lastSequence}`);
    const isFirstLoad = tv.sessionId === null;
    if (data.session_id !== tv.sessionId) {
      tv.sessionId = data.session_id;
      tv.items = [];
      tv.current = null;
      tv.lastSequence = 0;
      if (!isFirstLoad) {
        tv.isPolling = false;
        return pollCheckIns();
      }
    }
    tv.displaySeconds = data.display_seconds;
    tv.lastSequence = data.last_sequence;
    // On first load, only check-ins from the last few seconds are replayed, so a refresh
    // doesn't replay the whole session but someone who just arrived is still shown.
    const replayAfter = Date.now() / 1000 - REPLAY_RECENT_SECONDS;
    for (const checkIn of data.check_ins) {
      const isOld = isFirstLoad && checkIn.checked_in_at < replayAfter;
      tv.items.push({ checkIn, state: isOld ? "done" : "waiting" });
    }
    if (data.check_ins.length || isFirstLoad) renderQueue();
    showNext();
  } catch {
    /* engine restarting; keep the current screen and retry */
  } finally {
    tv.isPolling = false;
  }
}

function showNext() {
  if (tv.current) return;
  const next = tv.items.find((item) => item.state === "waiting");
  if (!next) {
    renderIdle();
    return;
  }
  next.state = "showing";
  tv.current = next;
  renderSpotlight(next);
  renderQueue();
  setTimeout(() => {
    if (tv.current !== next) return;
    next.state = "done";
    tv.current = null;
    renderQueue();
    showNext();
  }, tv.displaySeconds * 1000);
}

function renderSpotlight(item) {
  const { person, checked_in_at: checkedInAt } = item.checkIn;
  $("idle").hidden = true;
  const spotlight = $("spotlight");
  spotlight.hidden = false;
  spotlight.style.animation = "none";
  void spotlight.offsetWidth;
  spotlight.style.animation = "";
  $("spotlight-photo").src = person.photo_url;
  $("spotlight-photo").alt = `Photo of ${person.name}`;
  $("spotlight-name").textContent = person.name;
  $("spotlight-time").textContent = `Checked in at ${formatTime(checkedInAt)}`;
  const fill = $("progress-fill");
  fill.classList.remove("running");
  void fill.offsetWidth;
  fill.style.animationDuration = `${tv.displaySeconds}s`;
  fill.classList.add("running");
}

function renderIdle() {
  $("spotlight").hidden = true;
  $("idle").hidden = false;
}

/**
 * The queue only exists when the camera caught several people at once. It is a small tray in the
 * corner listing the next few people (the one on screen is not repeated); one person gets nothing.
 */
function renderQueue() {
  const waiting = tv.items
    .filter((item) => item.state === "waiting")
    .sort((a, b) => a.checkIn.sequence - b.checkIn.sequence);
  $("queue").replaceChildren(...waiting.slice(0, QUEUE_SLOTS).map(renderQueueItem));
  const overflow = waiting.length - QUEUE_SLOTS;
  $("queue-more").hidden = overflow <= 0;
  $("queue-more").textContent = `+${overflow} more`;
  $("queue-tray").hidden = waiting.length === 0;
}

function renderQueueItem(item) {
  const { person } = item.checkIn;
  const element = document.createElement("li");
  element.className = "queue-item";
  element.innerHTML = `
    <img src="${person.photo_url}" alt="">
    <div>
      <div class="name">${escapeHtml(person.name)}</div>
      <span class="chip checked">✓ Checked in</span>
    </div>`;
  return element;
}

function tickClock() {
  $("clock").textContent = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function connectCamera() {
  const preview = $("camera-preview");
  preview.onerror = () => setTimeout(connectCamera, 3000);
  preview.src = `${API}/stream/video?t=${Date.now()}`;
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

$("fullscreen-button").addEventListener("click", toggleFullscreen);
document.addEventListener("keydown", (event) => {
  if (event.key === "f" || event.key === "F") toggleFullscreen();
});

$("reset-button").addEventListener("click", async () => {
  if (!confirm("Start a new session? The queue is cleared and everyone can check in again.")) return;
  await fetchJson(`${API}/check-ins`, { method: "DELETE" }).catch(() => {});
  pollCheckIns();
});

tickClock();
setInterval(tickClock, 1000);
connectCamera();
pollCheckIns();
setInterval(pollCheckIns, POLL_MS);
