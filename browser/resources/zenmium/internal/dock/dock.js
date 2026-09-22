// Agent dock — chat stream + approval cards, rendered from normalized
// daemon chat events. One OpenCode loop lives daemon-side; this file is
// UI only. Credentials never render (daemon redacts before it forwards).

const stream = document.getElementById("stream");
const input = document.getElementById("input");
const send = document.getElementById("send");
const statusEl = document.getElementById("status");
const approvalHost = document.getElementById("approval-host");

let convId = null;
let currentAssistant = null;

// Long-lived runtime port back to the service worker.
const port = chrome.runtime.connect({ name: "dock" });
port.onMessage.addListener(onEvent);
port.onDisconnect.addListener(() => setStatus("offline"));

chrome.runtime.sendMessage({ type: "dock.query" }, (res) => {
  if (res?.bound) setStatus("idle");
});
chrome.runtime.sendMessage({ type: "dock.state", payload: { open: true } }, () => {});

function setStatus(s) {
  statusEl.textContent = s;
  statusEl.dataset.state = s;
}

function bubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  stream.appendChild(div);
  stream.scrollTop = stream.scrollHeight;
  return div;
}

function onEvent(msg) {
  if (msg.type !== "chat.event") return;
  const m = msg.payload || {};
  switch (m.kind) {
    case "status":
      setStatus(m.status);
      break;
    case "text": {
      // Streaming deltas append to the live assistant bubble.
      if (!currentAssistant) currentAssistant = bubble("assistant", "");
      currentAssistant.textContent += m.text || "";
      stream.scrollTop = stream.scrollHeight;
      break;
    }
    case "message":
      if (m.role === "assistant") {
        bubble("assistant", m.text || "");
        currentAssistant = null;
      }
      break;
    case "activity": {
      const div = document.createElement("div");
      div.className = "msg activity";
      div.textContent = m.text || "…";
      stream.appendChild(div);
      break;
    }
    case "approval":
      showApproval(m);
      break;
    case "remove": {
      const el = document.getElementById(m.id);
      if (el) el.remove();
      break;
    }
  }
}

function showApproval(m) {
  const card = document.createElement("div");
  card.className = "approval card";
  card.id = m.id;
  const tool = m.part?.tool || "tool";
  const title = m.part?.title || "wants to run";
  card.innerHTML = `
    <div class="title"><img class="icon" src="../icons/key.svg" alt="">
      <span>${escapeHtml(tool)} — ${escapeHtml(title)}</span></div>
    ${m.part?.metadata ? `<div class="meta">${escapeHtml(JSON.stringify(m.part.metadata).slice(0, 400))}</div>` : ""}
    <div class="actions">
      <button class="btn secondary" data-r="reject">Deny</button>
      <button class="btn" data-r="once">Allow once</button>
      <button class="btn secondary" data-r="always">Always</button>
    </div>`;
  card.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "chat.approve",
        payload: { convId, approvalId: m.id, response: b.dataset.r },
      });
      card.remove();
    }));
  approvalHost.appendChild(card);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function submit() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  bubble("user", text);
  currentAssistant = null;
  chrome.runtime.sendMessage({
    type: "chat.send",
    payload: { convId, requestId: crypto.randomUUID(), text },
  });
}

send.addEventListener("click", submit);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submit();
  }
});

// Auto-size the composer.
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 140) + "px";
});
