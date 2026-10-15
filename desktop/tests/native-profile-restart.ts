/** Run `write` then `read` in two separate Electron processes with the same
 * temporary directory argument. This proves disk persistence, not session reuse
 * inside one Chromium process. Never point this fixture at actual userData. */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { app, BrowserWindow } from "electron";
import { ArcCore } from "../src/main/arc-core.ts";

const [stage, directory] = process.argv.slice(2);
if (!["write", "read"].includes(stage!) || !directory || !isAbsolute(directory) || !directory.includes("zenmium-profile-restart-"))
  throw new Error("Use write/read and an absolute mkdtemp zenmium-profile-restart-* fixture directory.");
mkdirSync(join(directory, "chromium"), { recursive: true });
app.setPath("userData", directory);
app.setPath("sessionData", join(directory, "chromium"));
app.commandLine.appendSwitch("disable-background-networking");
app.on("window-all-closed", () => {});

interface Fixture { port: number; spaces: string[]; profiles: string[]; tabs: string[] }
const fixturePath = join(directory, "restart-fixture.json");
const saved: Fixture | undefined = stage === "read" ? JSON.parse(readFileSync(fixturePath, "utf8")) : undefined;
const server = createServer((_req, response) => {
  response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  response.end("<!doctype html><title>Profile restart fixture</title><h1>Profile restart fixture</h1>");
});

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert.ok(Date.now() < deadline, label);
    await delay(20);
  }
}

void app.whenReady().then(async () => {
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  let core: ArcCore | undefined;
  let win: BrowserWindow | undefined;
  let failed = false;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(saved?.port ?? 0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/fixture`;
    win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    core = new ArcCore(win, directory);
    core.boot();
    if (stage === "write") {
      const spaces = [core.snapshot().activeSpaceId, core.createSpace("Second profile").id];
      const tabs: string[] = [];
      for (const [index, spaceId] of spaces.entries()) {
        const tab = core.newTab({ spaceId, url });
        tabs.push(tab.id);
        const wc = core.getWebContentsForTab(tab.id)!;
        await waitFor(() => wc.getURL() === url && !wc.isLoading(), "write fixture page load");
        await wc.executeJavaScript(`localStorage.setItem('restart_fixture', ${JSON.stringify(`profile-${index}`)})`);
        await wc.session.cookies.set({ url, name: "restart_fixture", value: `profile-${index}`, expirationDate: Date.now() / 1000 + 3600, sameSite: "lax" });
        await wc.session.cookies.flushStore();
        wc.session.flushStorageData();
      }
      core.activateSpace(spaces[0]!);
      writeFileSync(fixturePath, JSON.stringify({ port: address.port, spaces, profiles: spaces.map((id) => core!.getProfileId(id)), tabs } satisfies Fixture));
    } else {
      assert.ok(saved);
      assert.deepEqual(saved.spaces.map((id) => core!.getProfileId(id)), saved.profiles);
      for (const [index, spaceId] of saved.spaces.entries()) {
        core.activateSpace(spaceId);
        const wc = core.getWebContentsForTab(saved.tabs[index]!)!;
        await waitFor(() => wc.getURL() === url && !wc.isLoading(), "read fixture page load");
        assert.equal(await wc.executeJavaScript("localStorage.getItem('restart_fixture')"), `profile-${index}`);
        const cookies = await wc.session.cookies.get({ url, name: "restart_fixture" });
        assert.equal(cookies.length, 1);
        assert.equal(cookies[0]!.value, `profile-${index}`);
        assert.ok(core.getHistoryForSpace(spaceId).every((entry) => entry.spaceId === spaceId));
      }
    }
    assert.equal(win.isVisible(), false);
    console.log(`[native-profile-restart] PASS ${stage}: separate persistent Workspace cookies/localStorage and stable profile IDs`);
  } catch (error) {
    failed = true;
    console.error(`[native-profile-restart] FAIL ${stage}`, error);
  } finally {
    core?.dispose();
    win?.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    app.exit(failed ? 1 : 0);
  }
});
