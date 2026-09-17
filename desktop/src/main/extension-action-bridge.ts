/** Dispatch toolbar action clicks to no-popup MV3 extensions (e.g. Wonder Capture).
 * Wonder Capture ships a `zenmium-action-bridge` shim that captures
 * action.onClicked listeners and invokes them when an extension page sends a
 * `zenmium:extension-action` runtime message. A hidden window (never shown, no
 * focus steal, no monitor placement) hosts the bridge page in the extension's
 * origin so the message carries the extension identity with sender.tab unset.
 * No credentials cross this boundary; only extension id and numeric tab id.
 */

export const BRIDGE_PAGE = "zenmium-action-bridge.html";
export const BRIDGE_MESSAGE = "zenmium:extension-action";
const EXTENSION_ID_PATTERN = /^[a-z]{32}$/;

export function bridgeUrl(extensionId: string): string {
  if (!EXTENSION_ID_PATTERN.test(extensionId)) {
    throw new Error("Invalid extension id.");
  }
  return `chrome-extension://${extensionId}/${BRIDGE_PAGE}`;
}

export function bridgeScript(tabId?: number): string {
  const tab = Number.isInteger(tabId) ? `, tabId: ${tabId}` : "";
  return `(() => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: ${JSON.stringify(BRIDGE_MESSAGE)}${tab} }, (response) => {
        resolve({ ok: !(chrome.runtime.lastError), response: response ?? null, error: chrome.runtime.lastError?.message ?? null });
      });
      setTimeout(() => resolve({ ok: false, error: "bridge-timeout" }), 8000);
    } catch (error) { resolve({ ok: false, error: String(error) }); }
  }))()`;
}

export interface BridgeResult {
  ok: boolean;
  reason: string;
}

/** Validate the bridge response without forwarding provider text. */
export function interpretBridgeResult(raw: unknown): BridgeResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, reason: "The extension did not respond." };
  }
  const candidate = raw as {
    ok?: unknown;
    response?: { ok?: unknown; error?: unknown };
    error?: unknown;
  };
  if (candidate.ok === true) {
    const inner = candidate.response as {
      ok?: unknown;
      error?: unknown;
    } | null;
    if (inner?.ok !== true) {
      return {
        ok: false,
        reason: "The extension reported its action handler is unavailable.",
      };
    }
    return { ok: true, reason: "ok" };
  }
  return { ok: false, reason: "The extension action could not be triggered." };
}
