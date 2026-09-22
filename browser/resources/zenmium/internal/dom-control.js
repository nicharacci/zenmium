// domControl — serialized page executor, ported verbatim from
// desktop/src/main/browser-control-native.ts.
//
// Injected via chrome.scripting.executeScript({world:"ISOLATED", func, args})
// — the same mechanism Electron used with webContents.executeJavaScript in
// an isolated world. State lives on window.__zenmiumControl: a per-document
// id, a revision counter, the ref map, and a MutationObserver that
// invalidates refs on mutation (the staleness contract).
//
// Return shape is always {ok, documentId, revision, ...} or
// {ok:false, code, message, uncertain?, documentId, revision}.

// eslint-disable-next-line no-unused-vars
export function domControl(op, payload, expected) {
  const SENSITIVE_RE = /(password|passwd|pwd|otp|totp|2fa|mfa|cvv|cvc|cc[-_ ]?num|card[-_ ]?num|secret|token|ssn|credential)/i;
  const AUTH_HINT_RE = /(sign\s?in|log\s?in|login|authenticate|sso|oauth|verify|unlock|password)/i;

  const state = (window.__zenmiumControl ||= {
    id: crypto.randomUUID(),
    revision: 0,
    refs: new Map(),
    sequence: 0,
    observer: null,
  });

  if (!state.observer) {
    state.observer = new MutationObserver(() => {
      state.revision++;
      state.refs.clear(); // refs are document-mutation-bound
    });
    state.observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
  }

  const stale = () => {
    if (expected && expected.documentId && expected.documentId !== state.id) {
      return { ok: false, code: "STALE_OBSERVATION", message: "document changed since last observe", documentId: state.id, revision: state.revision };
    }
    return null;
  };

  const isSensitiveField = (el) => {
    const hay = [el.name, el.id, el.type, el.autocomplete, el.placeholder, el.getAttribute && el.getAttribute("aria-label")].join(" ");
    return SENSITIVE_RE.test(hay);
  };

  const isAuthPage = () => {
    const hasPassword = !!document.querySelector('input[type="password"]');
    if (hasPassword) return true;
    const title = `${document.title} ${location.href}`;
    if (AUTH_HINT_RE.test(title)) {
      // Auth hints + any form field = treat as auth surface; the executor
      // refuses to capture element refs on it.
      return !!document.querySelector("input, form");
    }
    return false;
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05;
  };

  const INTERACTIVE = "a[href],button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=combobox],[role=listbox],[role=textbox],[contenteditable=true],[tabindex]";
  const refName = (el) => (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.title || "").trim().slice(0, 120);

  const observe = (opts = {}) => {
    if (isAuthPage()) {
      // Auth pages are never captured — the credential boundary. The caller
      // routes to the authentication broker instead.
      return {
        ok: true, documentId: state.id, revision: state.revision,
        url: location.href, title: document.title,
        authenticationRequired: true, elements: [], text: "",
      };
    }
    state.refs.clear();
    const out = [];
    for (const el of document.querySelectorAll(INTERACTIVE)) {
      if (!visible(el)) continue;
      const ref = ++state.sequence;
      state.refs.set(ref, el);
      const r = el.getBoundingClientRect();
      out.push({
        ref,
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || undefined,
        name: refName(el) || undefined,
        type: el.type || undefined,
        sensitive: isSensitiveField(el) || undefined,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
      if (out.length >= 512) break;
    }
    let text = "";
    if (opts.includeText) {
      text = (document.body?.innerText || "").slice(0, 24000);
    }
    return {
      ok: true, documentId: state.id, revision: state.revision,
      url: location.href, title: document.title,
      elements: out, text,
    };
  };

  const resolve = (ref) => {
    const el = state.refs.get(ref);
    if (!el || !document.contains(el)) {
      return null;
    }
    return el;
  };

  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };

  const click = ({ ref }) => {
    const el = resolve(ref);
    if (!el) return { ok: false, code: "STALE_OBSERVATION", message: `ref ${ref} no longer resolves`, documentId: state.id, revision: state.revision };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, composed: true }));
    el.click();
    return { ok: true, documentId: state.id, revision: state.revision, clicked: refName(el) || el.tagName };
  };

  const fill = ({ ref, value }) => {
    const el = resolve(ref);
    if (!el) return { ok: false, code: "STALE_OBSERVATION", message: `ref ${ref} no longer resolves`, documentId: state.id, revision: state.revision };
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.focus();
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      el.value = value;
    } else if (el.isContentEditable) {
      el.innerText = value;
    } else {
      const proto = tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value); else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    // The filled value never echoes into the receipt — credential boundary.
    return { ok: true, documentId: state.id, revision: state.revision, sensitive: isSensitiveField(el) || undefined };
  };

  const press = ({ key }) => {
    const el = document.activeElement || document.body;
    const init = { key, code: key, bubbles: true, composed: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
    if (key === "Enter" && el instanceof HTMLElement) {
      el.dispatchEvent(new Event("submit", { bubbles: true, composed: true }));
    }
    return { ok: true, documentId: state.id, revision: state.revision };
  };

  const scroll = ({ direction = "down", amount = 600, x, y }) => {
    if (typeof x === "number" && typeof y === "number") {
      window.scrollTo(x, y);
    } else {
      const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
      const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
      window.scrollBy(dx, dy);
    }
    return { ok: true, documentId: state.id, revision: state.revision, scrollX: scrollX, scrollY: scrollY };
  };

  const s = stale();
  if (s) return s;

  switch (op) {
    case "observe": return observe(payload || {});
    case "click":   return click(payload || {});
    case "fill":    return fill(payload || {});
    case "press":   return press(payload || {});
    case "scroll":  return scroll(payload || {});
    default:
      return { ok: false, code: "INVALID_COMMAND", message: `unknown dom op ${op}`, documentId: state.id, revision: state.revision };
  }
}
