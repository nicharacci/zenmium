// Synthetic, isolated-profile proof setup. Never attach this to a user's profile.
import WebSocket from "ws";

const list = await fetch("http://127.0.0.1:9551/json").then((r) => r.json());
const target = list.find((t) => /index.html$/.test(t.url));
if (!target)
  throw new Error("Launch the isolated verifier on port 9551 first.");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});
let sequence = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const value = JSON.parse(raw);
  const entry = pending.get(value.id);
  if (!entry) return;
  pending.delete(value.id);
  value.error ? entry.reject(value.error) : entry.resolve(value.result);
});
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { reject, resolve });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const invoke = (channel, payload) =>
  evaluate(
    `window.zenmium.invoke(${JSON.stringify(channel)},${JSON.stringify(payload) ?? "undefined"})`
  );
try {
  const mode = process.argv[2] ?? "measure";
  if (mode !== "measure") {
    const state = await invoke("arc:snapshot");
    for (const tab of state.tabs.filter(
      (tab) => tab.url === "about:blank" && tab.kind === "today"
    ))
      await invoke("arc:closeTab", tab.id);
    if (mode === "expanded") {
      // These exact local-fixture routes belong to verify-browser.mjs. This
      // helper is permitted only on its generated verification profile.
      for (const tab of state.tabs.filter((tab) =>
        /^http:\/\/127\.0\.0\.1:\d+\/(first|second)$/.test(tab.url)
      )) {
        await invoke("arc:unpinTab", tab.id);
        await invoke("arc:closeTab", tab.id);
      }
      const neutral = (await invoke("arc:snapshot")).tabs.find(
        (tab) => tab.url === "https://example.com/"
      );
      if (neutral) await invoke("arc:activateTab", neutral.id);
      else await invoke("arc:newTab", { url: "https://example.com" });
    }
    await invoke("chrome:close");
    await invoke("arc:closePeek");
    await invoke("chrome:preferences", {
      newTabAtTop: true,
      side: "left",
      sidebarMode: "expanded",
      theme: "dark",
      width: 230,
    });
    await invoke("chrome:sidebar", {
      dragging: false,
      focused: false,
      hovered: false,
    });
    if (mode === "compact" || mode === "hover") {
      await invoke("chrome:preferences", { sidebarMode: "compact" });
      if (mode === "hover") await invoke("chrome:sidebar", { hovered: true });
    } else if (mode === "right")
      await invoke("chrome:preferences", {
        side: "right",
        sidebarMode: "collapsed",
      });
    else if (mode === "glance")
      await invoke("arc:openPeek", "https://example.com");
    else if (["address", "menu", "settings", "downloads"].includes(mode))
      await invoke("chrome:open", { kind: mode });
    else if (mode !== "expanded") throw new Error("Unknown proof state");
  }
  console.log(
    JSON.stringify(
      {
        tabs: (await invoke("arc:snapshot")).tabs.map(({ id, title, url }) => ({
          id,
          title,
          url,
        })),
        ui: await invoke("chrome:snapshot"),
        viewport: await evaluate(
          "({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})"
        ),
      },
      null,
      2
    )
  );
} finally {
  ws.close();
}
