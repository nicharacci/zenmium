import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import type { BrowserObservation, BrowserControlCommand } from "../shared/browser-control";

export class BrowserControlError extends Error {
  readonly code: string;
  readonly uncertain: boolean;
  constructor(code: string, message: string, uncertain = false) {
    super(message);
    this.name = "BrowserControlError";
    this.code = code;
    this.uncertain = uncertain;
  }
}

/** Query strings/fragments/userinfo may contain authorization codes or credentials. */
export function safeControlUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "about:blank";
    return `${url.origin}${url.pathname.replace(/[^/]{48,}/g, "[redacted]")}`;
  } catch { return "about:blank"; }
}
export function redactControlText(value: string): string {
  return value
    .replace(/\b(?:bearer\s+)?(?:sk[-_][\w-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/gi, "[redacted]")
    .replace(/\b(?:password|secret|token|otp|verification code|security code|recovery code)\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/\b(?:\d[ -]?){6,19}\b/g, "[redacted]")
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => safeControlUrl(url));
}

export interface ControlExecutionContext {
  signal: AbortSignal;
  assertCurrent(): void;
  documentId?: string;
}
export interface NativeActionResult {
  status: "observed" | "accepted" | "uncertain";
  result: Record<string, unknown>;
}
export interface BrowserControlDriver {
  observe(wc: WebContents, tabId: string, context: ControlExecutionContext): Promise<Omit<BrowserObservation, "revision">>;
  perform(wc: WebContents, command: BrowserControlCommand, context: ControlExecutionContext): Promise<NativeActionResult>;
}

/** This function is serialized into an isolated world. No caller-supplied JS is evaluated. */
function domControl(input: { action: string; documentId?: string; ref?: string; text?: string; key?: string; deltaX?: number; deltaY?: number }) {
  type State = { id: string; revision: number; refs: Map<string, Element>; sequence: number; observer: MutationObserver };
  const world = globalThis as typeof globalThis & { __zenmiumControl?: State };
  let state = world.__zenmiumControl;
  if (!state) {
    const observer = new MutationObserver(() => { if (world.__zenmiumControl) world.__zenmiumControl.revision++; });
    state = { id: crypto.randomUUID(), revision: 0, refs: new Map(), sequence: 0, observer };
    observer.observe(document, { subtree: true, attributes: true, characterData: true, childList: true });
    document.addEventListener("input", () => { if (world.__zenmiumControl) world.__zenmiumControl.revision++; }, true);
    world.__zenmiumControl = state;
  }
  if (state.observer.takeRecords().length) state.revision++;
  const documentId = `${state.id}:${state.revision}`;
  const sensitive = (element: Element) => /password|one-time-code|cc-|credit.?card|cvc|cvv|totp|\botp\b|secret|token|verification.?code|recovery.?code/i.test([
    element.getAttribute("type"), element.getAttribute("autocomplete"), element.getAttribute("name"), element.id,
    element.getAttribute("aria-label"), element.getAttribute("placeholder"),
  ].join(" "));
  const visible = (element: Element) => {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.visibility !== "hidden" && style.display !== "none";
  };
  const authFields = [...document.querySelectorAll("input,textarea,[contenteditable]")].some((el) => visible(el) && sensitive(el));
  const authenticationRequired = authFields || /\/(?:login|sign[-_]?in|auth|oauth|otp|totp|mfa|two[-_]?factor|password)(?:\/|$)/i.test(location.pathname);
  if (input.action === "observe") {
    // Login/challenge pages have no content/element capture. The auth broker owns them.
    if (authenticationRequired) return { documentId, title: "Authentication page", text: "Authentication requires the scoped authentication broker.", elements: [], authenticationRequired: true, redacted: true, unsupportedFrames: false };
    state.refs.clear();
    const elements: { ref: string; role: string; name: string; disabled: boolean; editable: boolean }[] = [];
    const candidates = document.querySelectorAll("a[href],button,input:not([type=hidden]),textarea,select,[role=button],[contenteditable=true],summary");
    for (const el of candidates) {
      if (!visible(el) || sensitive(el) || elements.length >= 120) continue;
      const ref = `el_${++state.sequence}`;
      state.refs.set(ref, el);
      const editable = el.matches("input,textarea,[contenteditable=true]");
      // Never return field values or contenteditable text, even for apparently ordinary inputs.
      const name = el.getAttribute("aria-label") || el.getAttribute("placeholder") || (editable ? el.tagName.toLowerCase() : el.textContent || el.tagName.toLowerCase());
      elements.push({ ref, role: el.getAttribute("role") || el.tagName.toLowerCase(), name: name.slice(0, 160), disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true", editable });
    }
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest("script,style,noscript,textarea,input,select,[contenteditable],form,[hidden],[aria-hidden=true]")) return NodeFilter.FILTER_REJECT;
        return visible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let text = "", next: Node | null;
    while (text.length < 16000 && (next = walker.nextNode())) text += `${next.textContent?.trim() || ""} `;
    return { documentId, title: document.title.slice(0, 240), text: text.slice(0, 16000), elements, authenticationRequired: false, redacted: true, unsupportedFrames: document.querySelectorAll("iframe").length > 0 };
  }
  if (authenticationRequired) return { error: "AUTHENTICATION_REQUIRED" };
  if (!input.documentId || documentId !== input.documentId) return { error: "STALE_DOCUMENT" };
  if (input.action === "scroll") {
    const before = { x: scrollX, y: scrollY };
    scrollBy({ left: input.deltaX || 0, top: input.deltaY || 0, behavior: "instant" });
    state.revision++;
    return { evidence: { x: scrollX, y: scrollY, changed: before.x !== scrollX || before.y !== scrollY }, observed: true };
  }
  const el = state.refs.get(input.ref || "");
  if (!el || !el.isConnected || !visible(el)) return { error: "STALE_ELEMENT" };
  if (sensitive(el)) return { error: "SENSITIVE_FIELD" };
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return { error: "DISABLED_ELEMENT" };
  if (input.action === "fill") {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { error: "UNSUPPORTED_FIELD" };
    if (el instanceof HTMLInputElement && ["file", "hidden", "password", "checkbox", "radio"].includes(el.type)) return { error: "UNSUPPORTED_FIELD" };
    if (el.readOnly) return { error: "DISABLED_ELEMENT" };
    const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, input.text || "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    state.revision++;
    return { observed: el.value === input.text, evidence: { fieldUpdated: el.value === input.text } };
  }
  if (input.action === "click") {
    if (!(el instanceof HTMLElement)) return { error: "UNSUPPORTED_ELEMENT" };
    // Native DOM click does not focus the macOS window. Page handlers may still decline synthetic input.
    const before = { checked: el instanceof HTMLInputElement ? el.checked : undefined, expanded: el.getAttribute("aria-expanded"), url: location.href };
    el.click();
    const changed = state.observer.takeRecords().length > 0 || before.url !== location.href || before.expanded !== el.getAttribute("aria-expanded") || (el instanceof HTMLInputElement && before.checked !== el.checked);
    state.revision++;
    return { observed: changed, evidence: { dispatched: true, stateChanged: changed } };
  }
  if (input.action === "press") {
    if (!(el instanceof HTMLElement)) return { error: "UNSUPPORTED_ELEMENT" };
    // No native keyboard focus is changed. Sites requiring trusted key events report acceptance only.
    const key = input.key === "Space" ? " " : input.key || "";
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
    const changed = state.observer.takeRecords().length > 0;
    state.revision++;
    return { observed: changed, evidence: { dispatched: true, stateChanged: changed } };
  }
  return { error: "UNSUPPORTED_ACTION" };
}

async function bounded<T>(promise: Promise<T>, context: ControlExecutionContext, timeoutMs = 15000): Promise<T> {
  context.assertCurrent();
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new BrowserControlError("CONTROL_INTERRUPTED", "Control was interrupted; observe before continuing.", true));
    context.signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new BrowserControlError("ACTION_TIMEOUT", "The native result was not observed before the deadline.", true)), timeoutMs);
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { clearTimeout(timer!); context.signal.removeEventListener("abort", abort!); }
}

export class NativeBrowserControlDriver implements BrowserControlDriver {
  private async dom(wc: WebContents, input: Parameters<typeof domControl>[0], context: ControlExecutionContext) {
    context.assertCurrent();
    return bounded(wc.executeJavaScriptInIsolatedWorld(998, [{ code: `(${domControl.toString()})(${JSON.stringify(input)})` }], false), context);
  }
  async observe(wc: WebContents, tabId: string, context: ControlExecutionContext): Promise<Omit<BrowserObservation, "revision">> {
    const result = await this.dom(wc, { action: "observe" }, context);
    context.assertCurrent();
    return {
      ...result,
      tabId,
      url: safeControlUrl(wc.getURL()),
      title: redactControlText(String(result.title || "")),
      text: redactControlText(String(result.text || "")),
      elements: (result.elements || []).map((element: { name: string }) => ({ ...element, name: redactControlText(element.name) })),
    };
  }
  async perform(wc: WebContents, command: BrowserControlCommand, context: ControlExecutionContext): Promise<NativeActionResult> {
    context.assertCurrent();
    if (command.action === "navigate" || command.action === "cdp") {
      const url = command.action === "navigate" ? command.url : command.params.url;
      await bounded(wc.loadURL(url), context);
      context.assertCurrent();
      return { status: "observed", result: { url: safeControlUrl(wc.getURL()), navigationCompleted: true } };
    }
    if (command.action === "cdp.target") return { status: "observed", result: { targetInfo: { targetId: command.tabId, type: "page", url: safeControlUrl(wc.getURL()) } } };
    if (command.action === "download") {
      const downloadId = `download_${randomUUID()}`;
      const result = new Promise<NativeActionResult>((resolve, reject) => {
        const cleanup = () => { wc.session.removeListener("will-download", listener); context.signal.removeEventListener("abort", abort); clearTimeout(timer); };
        const abort = () => { cleanup(); reject(new BrowserControlError("CONTROL_INTERRUPTED", "Download dispatch was interrupted; do not retry automatically.", true)); };
        const listener = (_event: Electron.Event, item: Electron.DownloadItem, source: WebContents) => {
          if (source?.id !== wc.id || !item.getURLChain().includes(command.url)) return;
          cleanup();
          resolve({ status: "observed", result: { downloadId, state: "started", url: safeControlUrl(item.getURL()), completed: false } });
        };
        const timer = setTimeout(() => { cleanup(); reject(new BrowserControlError("ACTION_TIMEOUT", "Download start was not observed; do not retry automatically.", true)); }, 15000);
        context.signal.addEventListener("abort", abort, { once: true });
        wc.session.on("will-download", listener);
        try { context.assertCurrent(); wc.downloadURL(command.url); } catch (error) { cleanup(); reject(error); }
      });
      return result;
    }
    if (["click", "fill", "press", "scroll"].includes(command.action)) {
      const result = await this.dom(wc, { ...command, documentId: context.documentId }, context);
      context.assertCurrent();
      if (result.error) throw new BrowserControlError(result.error, "Refresh observation or use the appropriate browser capability.");
      return { status: result.observed ? "observed" : "accepted", result: result.evidence || { dispatched: true } };
    }
    throw new BrowserControlError("UNAVAILABLE", "This native action is not supported.");
  }
}
