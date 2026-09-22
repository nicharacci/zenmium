// Pairing consent — renders the pending request, posts the decision to the
// service worker over chrome.runtime messaging (which relays pair.respond to
// the daemon). Shows the grant token once on approval for manual copy.

const params = new URLSearchParams(location.search);
const pairId = params.get("pairId") || "";
const label = params.get("label") || "This product";
const caps = (params.get("caps") || "").split(",").filter(Boolean);
const ttl = parseInt(params.get("ttl") || "0", 10);

const CAP_LABELS = {
  observe: "Observe pages",
  navigate: "Navigate",
  interact: "Click, fill, and type",
  tabs: "Manage tabs",
  downloads: "Downloads",
  authenticate: "Sign-in assist",
  cdp: "Low-level control (restricted)",
};

document.getElementById("label").textContent = label;
document.getElementById("ttl").textContent =
  ttl >= 3600 ? `${Math.round(ttl / 3600)}h` : `${Math.round(ttl / 60)}m`;

const ul = document.getElementById("caps");
for (const c of caps) {
  const li = document.createElement("li");
  if (c === "cdp" || c === "authenticate") li.classList.add("danger");
  li.textContent = CAP_LABELS[c] || c;
  ul.appendChild(li);
}

function respond(approve) {
  chrome.runtime.sendMessage({ type: "pair.respond", pairId, approve }, () => {
    window.close();
  });
}

document.getElementById("approve").addEventListener("click", () => respond(true));
document.getElementById("deny").addEventListener("click", () => respond(false));
