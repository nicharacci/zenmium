/** Isolated native extension probe. No real profile, vault, network credential, or visible window. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow, ipcMain, session, WebContentsView } from "electron";
import { ExtensionHost } from "../src/main/extension-host.ts";

const root = await mkdtemp(join(tmpdir(), "zenmium-native-extensions-"));
app.setPath("userData", join(root, "userData"));
app.setPath("sessionData", join(root, "sessionData"));
app.commandLine.appendSwitch("disable-background-networking");
const watchdog = setTimeout(() => { console.error("native-extension-timeout"); app.exit(1); }, 25_000);
const preloads: Array<{ type: string; authenticatedType: string; bridged: boolean }> = [];
ipcMain.on("fixture:extension-preload", (event, detail) => {
  preloads.push({ type: String(detail.type), authenticatedType: event.type, bridged: detail.bridged === true });
});
const server = createServer((_req, response) => {
  response.writeHead(200, { "Content-Type": "text/html" }); response.end("<!doctype html><title>Extension fixture</title><h1>Fixture</h1>");
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address(); assert.ok(address && typeof address !== "string");
const origin = "http://127.0.0.1:" + address.port;
await app.whenReady();
let window: BrowserWindow | undefined;
try {
  const ses = session.fromPartition("persist:extension-fixture-a"), other = session.fromPartition("persist:extension-fixture-b");
  const preloadPath = join(root, "probe-preload.cjs");
  await writeFile(preloadPath, `const {contextBridge,ipcRenderer}=require('electron');
    let bridged=false;
    try { contextBridge.executeInMainWorld({func:()=>{globalThis.__zenmiumNativeProbe=true;}}); bridged=true; } catch {}
    ipcRenderer.send('fixture:extension-preload',{type:process.type,bridged});`);
  ses.registerPreloadScript({ type: "frame", filePath: preloadPath });
  ses.registerPreloadScript({ type: "service-worker", filePath: preloadPath });
  window = new BrowserWindow({ show: false, width: 900, height: 600, webPreferences: { sandbox: true, contextIsolation: true } });
  const page = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true } });
  const isolated = new WebContentsView({ webPreferences: { session: other, sandbox: true, contextIsolation: true } });
  window.contentView.addChildView(page); window.contentView.addChildView(isolated);
  for (const mv of [2, 3]) {
    const directory = join(root, "extension-mv" + mv); await mkdir(directory);
    await writeFile(join(directory, "manifest.json"), JSON.stringify({ name: "Zennium isolated fixture", version: "1.0", manifest_version: mv,
      permissions: ["storage", "nativeMessaging", ...(mv === 2 ? [origin + "/*"] : [])],
      ...(mv === 3 ? { host_permissions: [origin + "/*"], background: { service_worker: "background.js" }, action: { default_popup: "popup.html" } }
        : { background: { scripts: ["background.js"] }, browser_action: { default_popup: "popup.html" } }),
      content_scripts: [{ matches: [origin + "/*"], js: ["content.js"] }],
    }));
    await writeFile(join(directory, "content.js"), "document.documentElement.dataset.zenmiumExtension='loaded';");
    await writeFile(join(directory, "background.js"), "chrome.runtime.onMessage.addListener((m,s,r)=>{if(m==='probe')r({worker:true,preload:globalThis.__zenmiumNativeProbe===true,native:typeof chrome.runtime.connectNative});});");
    await writeFile(join(directory, "popup.html"), "<!doctype html><title>Fixture popup</title><p>Fixture popup</p>");
    const host = new ExtensionHost({ events: new EventEmitter(), session: ses, profileId: "a", registryPath: join(root, "registry-mv" + mv + ".json") });
    const loaded = await host.load({ id: directory, path: directory, name: "fixture", version: "1.0", enabled: true });
    assert.equal(loaded.ok, true); if (!loaded.ok) throw new Error("fixture load failed");
    assert.match(loaded.value.id, /^[a-p]{32}$/);
    await page.webContents.loadURL(origin); await isolated.webContents.loadURL(origin);
    await delay(350);
    assert.equal(await page.webContents.executeJavaScript("document.documentElement.dataset.zenmiumExtension"), "loaded");
    assert.equal(await isolated.webContents.executeJavaScript("document.documentElement.dataset.zenmiumExtension"), undefined);
    const popup = host.actionPopup(loaded.value.id); assert.equal(popup.ok, true); if (!popup.ok) throw new Error("fixture popup missing");
    await page.webContents.loadURL(popup.value.url);
    const capability = await page.webContents.executeJavaScript(`(async()=>({
      native:typeof chrome.runtime.connectNative, sendNative:typeof chrome.runtime.sendNativeMessage,
      framePreload:globalThis.__zenmiumNativeProbe===true,
      background:await Promise.race([new Promise(resolve=>chrome.runtime.sendMessage('probe',r=>resolve(r || {error:!!chrome.runtime.lastError}))),new Promise(resolve=>setTimeout(()=>resolve({timeout:true}),1800))])
    }))()`);
    console.log(JSON.stringify({ electron: process.versions.electron, mv, contentScript: true, profileIsolation: true, popup: true, capability }));
    assert.equal((await host.setEnabled(loaded.value.id, false)).ok, true);
    assert.deepEqual(host.loadedIds(), []);
    const reboot = new ExtensionHost({ events: new EventEmitter(), session: ses, profileId: "a", registryPath: host.registryPath });
    assert.deepEqual(await reboot.boot(), { ok: true, value: { loaded: [], failed: [] } });
    assert.equal((await reboot.setEnabled(loaded.value.id, true)).ok, true);
    assert.equal((await reboot.remove(loaded.value.id)).ok, true);
  }
  console.log(JSON.stringify({ preloads, retainedFixture: root }));
  window.destroy(); server.close(); clearTimeout(watchdog); app.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : "native-extension-failure");
  window?.destroy(); server.close(); clearTimeout(watchdog); app.exit(1);
}
