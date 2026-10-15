import { CHROME_IPC, type BrowserSurfaceProps, type Invoke } from "@shared/browser-ui";
import { NATIVE_IPC, type Bookmark, type BookmarkCommand, type FindResult, type NativeBrowserState, type UtilityCommand } from "@shared/browser-native";
import { ArrowLeft, Bookmark as BookmarkIcon, ChevronDown, ChevronUp, Download, Folder, Minus, Pencil, Plus, Printer, RotateCcw, Search, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "../motion/input";
import { ActionStatus, checkedInvoke, displayHost, EmptyState, PanelHeader, SurfaceButton, type UtilityProps, useSurfaceAction } from "./SurfacePrimitives";
import { ChromeImportPicker } from "./ChromeImportPicker";

export function useNativeBrowserState(invoke: Invoke, workspaceId?: string) {
  const [native, setNative] = useState<NativeBrowserState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try {
      const next = await checkedInvoke<NativeBrowserState>(invoke, NATIVE_IPC.snapshot);
      if (!next?.onboarding || !Array.isArray(next.bookmarks)) throw new Error("Native browser services are unavailable in this build.");
      if (version === generation.current) { setNative(next); setError(null); }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "Native browser services are unavailable.");
    }
  }, [invoke]);
  useEffect(() => {
    setNative(null);
    void refresh();
    const off = window.zenmium.on(NATIVE_IPC.event, () => void refresh());
    return () => { generation.current++; off(); };
  }, [refresh, workspaceId]);
  return { native, error, refresh };
}

export function BookmarksPanel({ state, invoke, close }: UtilityProps) {
  const remote = useNativeBrowserState(invoke, state.activeSpaceId);
  const action = useSurfaceAction();
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Bookmark | "bookmark" | "folder" | null>(null);
  const [deleting, setDeleting] = useState<Bookmark | null>(null);
  const entries = remote.native?.bookmarks ?? [];
  const folder = entries.find((entry) => entry.id === folderId);
  const currentSpace = state.spaces.find((space) => space.id === state.activeSpaceId);
  const busy = !!action.busy || !remote.native;
  const run = (label: string, command: BookmarkCommand, success?: () => void) =>
    void action.run(label, async () => { await checkedInvoke(invoke, NATIVE_IPC.bookmark, command); await remote.refresh(); }, success);
  const search = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => search ? `${entry.title} ${entry.url ?? ""}`.toLocaleLowerCase().includes(search) : entry.parentId === folderId);
  useEffect(() => { setFolderId(null); setQuery(""); setEditor(null); setDeleting(null); }, [state.activeSpaceId]);
  useEffect(() => { if (folderId && remote.native && !folder) setFolderId(null); }, [folderId, folder, remote.native]);
  return <>
    <PanelHeader close={close} title="Bookmarks" subtitle={currentSpace?.name} />
    <div className="zen-native-panel-body">
      <Input aria-label="Search bookmarks" placeholder="Search bookmarks" leftIcon={<Search size={14} />} value={query} onChange={setQuery} />
      <div className="zen-native-toolbar">
        <SurfaceButton disabled={busy || !state.activeTabId} icon={Plus} onClick={() => run("Bookmarking page", { action: "add-current" })}>Current page</SurfaceButton>
        <SurfaceButton disabled={busy} icon={Folder} onClick={() => setEditor("folder")}>New folder</SurfaceButton>
        <SurfaceButton aria-label="Add bookmark by URL" disabled={busy} icon={BookmarkIcon} onClick={() => setEditor("bookmark")} />
      </div>
      {!search && folder && <SurfaceButton icon={ArrowLeft} onClick={() => setFolderId(folder.parentId)}>Back from {folder.title}</SurfaceButton>}
      {editor && <BookmarkEditor key={typeof editor === "string" ? editor : editor.id} entry={editor} parentId={folderId} entries={entries} busy={busy}
        save={(command) => run("Saving bookmark", command, () => setEditor(null))} cancel={() => setEditor(null)} />}
      {deleting && <section className="zen-overlay-confirm" role="alert">
        <p>Remove “{deleting.title}”{deleting.kind === "folder" ? " and its saved bookmarks" : ""}?</p>
        <div className="zen-overlay-actions"><SurfaceButton disabled={busy} variant="danger" onClick={() => run("Removing bookmark", {action: "remove", id: deleting.id}, () => setDeleting(null))}>Remove</SurfaceButton><SurfaceButton disabled={busy} onClick={() => setDeleting(null)}>Cancel</SurfaceButton></div>
      </section>}
      <ActionStatus busy={action.busy ?? (!remote.native && !remote.error ? "Loading bookmarks" : null)} error={action.error ?? remote.error} />
      <div className="zen-native-bookmark-list">
        {visible.map((entry) => <div className="zen-native-bookmark-row" key={entry.id}>
          <button className="zen-native-bookmark-open" type="button" title={entry.url ?? entry.title} onClick={() => entry.kind === "folder" ? (setFolderId(entry.id), setQuery("")) : run("Opening bookmark", {action: "open", id: entry.id})}>
            {entry.kind === "folder" ? <Folder size={16} /> : <BookmarkIcon size={16} />}
            <span><strong>{entry.title}</strong>{entry.url && <small>{displayHost(entry.url)}</small>}</span>
          </button>
          <SurfaceButton aria-label={`Edit ${entry.title}`} className="zen-overlay-icon-button" disabled={busy} icon={Pencil} onClick={() => setEditor(entry)} />
          <SurfaceButton aria-label={`Remove ${entry.title}`} className="zen-overlay-icon-button" disabled={busy} icon={Trash2} onClick={() => setDeleting(entry)} />
        </div>)}
        {remote.native && !visible.length && <EmptyState icon={BookmarkIcon} title={search ? "No matching bookmarks" : "Keep useful pages here"}>{search ? "Try another title or address." : "Save the current page or import a bookmarks HTML file."}</EmptyState>}
      </div>
      <div className="zen-native-toolbar zen-native-bookmark-footer">
        <SurfaceButton disabled={busy} icon={Upload} onClick={() => run("Importing bookmarks", {action: "import"})}>Import HTML</SurfaceButton>
        <SurfaceButton disabled={busy || !entries.length} icon={Download} onClick={() => run("Exporting bookmarks", {action: "export"})}>Export HTML</SurfaceButton>
        <SurfaceButton aria-label="Refresh bookmarks" disabled={!!action.busy} icon={RotateCcw} onClick={() => void remote.refresh()} />
      </div>
    </div>
  </>;
}

function BookmarkEditor({ entry, parentId, entries, busy, save, cancel }: {
  entry: Bookmark | "bookmark" | "folder"; parentId: string | null; entries: Bookmark[]; busy: boolean; save: (command: BookmarkCommand) => void; cancel: () => void;
}) {
  const existing = typeof entry === "object" ? entry : null;
  const kind = existing?.kind ?? entry;
  const [title, setTitle] = useState(existing?.title ?? "");
  const [url, setUrl] = useState(existing?.url ?? "https://");
  const [parent, setParent] = useState(existing?.parentId ?? parentId);
  const disallowed = new Set(existing ? [existing.id] : []);
  for (let previous = -1; previous !== disallowed.size;) {
    previous = disallowed.size;
    for (const candidate of entries) if (candidate.parentId && disallowed.has(candidate.parentId)) disallowed.add(candidate.id);
  }
  return <form className="zen-native-editor" onSubmit={(event) => {
    event.preventDefault();
    const fields = { title: title.trim(), parentId: parent, ...(kind === "bookmark" ? {url: url.trim()} : {}) };
    save(existing ? {action: "update", id: existing.id, ...fields} : kind === "folder" ? {action: "folder", ...fields} : {action: "add", ...fields, url: url.trim()});
  }}>
    <Input label={kind === "folder" ? "Folder name" : "Bookmark title"} value={title} onChange={setTitle} required maxLength={500} disabled={busy} />
    {kind === "bookmark" && <Input label="Address" type="url" value={url} onChange={setUrl} required maxLength={16384} disabled={busy} />}
    <label>Folder<select aria-label="Bookmark folder" value={parent ?? ""} disabled={busy} onChange={(event) => setParent(event.target.value || null)}><option value="">All bookmarks</option>{entries.filter((item) => item.kind === "folder" && !disallowed.has(item.id)).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
    <div className="zen-overlay-actions"><SurfaceButton type="submit" variant="primary" disabled={busy || !title.trim()}>Save</SurfaceButton><SurfaceButton disabled={busy} onClick={cancel}>Cancel</SurfaceButton></div>
  </form>;
}

export function NativePageActions({ state, invoke, openFind }: Pick<BrowserSurfaceProps, "state" | "invoke"> & {openFind: () => void}) {
  const {native, error, refresh} = useNativeBrowserState(invoke, state.activeSpaceId);
  const action = useSurfaceAction();
  const run = (command: UtilityCommand) => void action.run("Updating page", async () => { await checkedInvoke(invoke, NATIVE_IPC.utility, command); await refresh(); });
  const disabled = !native || !state.activeTabId || !!action.busy;
  return <div className="zen-native-page-actions">
    <div className="zen-native-zoom" role="group" aria-label="Page zoom">
      <span>Zoom</span><SurfaceButton aria-label="Zoom out" disabled={disabled} icon={Minus} onClick={() => run({action: "zoom-out"})} />
      <SurfaceButton aria-label="Reset zoom" disabled={disabled} onClick={() => run({action: "zoom-reset"})}>{native ? `${Math.round(native.zoomFactor * 100)}%` : "—"}</SurfaceButton>
      <SurfaceButton aria-label="Zoom in" disabled={disabled} icon={Plus} onClick={() => run({action: "zoom-in"})} />
    </div>
    <div className="zen-native-toolbar">
      <SurfaceButton disabled={disabled} icon={Search} onClick={openFind}>Find in page</SurfaceButton>
      <SurfaceButton disabled={disabled} icon={Printer} onClick={() => run({action: "print"})}>Print</SurfaceButton>
      <SurfaceButton disabled={disabled} icon={Download} onClick={() => run({action: "save-pdf"})}>Save PDF</SurfaceButton>
      <SurfaceButton disabled={disabled} onClick={() => run({action: "save-page"})}>Save page</SurfaceButton>
    </div>
    <ActionStatus busy={action.busy} error={action.error ?? error} />
  </div>;
}

export function FindPanel({ state, invoke, close }: UtilityProps) {
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queryVersion = useRef(0);
  const request = useRef(0);
  const find = useCallback(async (text: string, forward = true, findNext = false) => {
    const version = ++queryVersion.current;
    try {
      if (!text) { await checkedInvoke(invoke, NATIVE_IPC.utility, {action: "stop-find"}); setResult(null); return; }
      const value = await checkedInvoke<{requestId: number}>(invoke, NATIVE_IPC.utility, {action: "find", query: text, forward, findNext, matchCase});
      if (queryVersion.current === version) { request.current = value?.requestId ?? 0; setError(null); }
    } catch (cause) { if (queryVersion.current === version) setError(cause instanceof Error ? cause.message : "Find is unavailable."); }
  }, [invoke, matchCase]);
  useEffect(() => {
    setResult(null);
    const timer = window.setTimeout(() => void find(query), 180);
    return () => window.clearTimeout(timer);
  }, [query, find, state.activeTabId]);
  useEffect(() => window.zenmium.on(NATIVE_IPC.findResult, (value) => {
    const next = value as FindResult;
    if (next.tabId === state.activeTabId && next.requestId >= request.current) setResult(next);
  }), [state.activeTabId]);
  useEffect(() => () => { void invoke(NATIVE_IPC.utility, { action: "stop-find" }).catch(() => {}); }, [invoke]);
  return <>
    <PanelHeader title="Find in page" close={close} />
    <form className="zen-native-find" onSubmit={(event) => { event.preventDefault(); void find(query, true, true); }}>
      <Input aria-label="Find in page" placeholder="Find in page" value={query} onChange={setQuery} maxLength={2000} autoFocus />
      <div className="zen-native-toolbar"><output aria-live="polite">{result && query ? `${result.activeMatchOrdinal} of ${result.matches}` : ""}</output>
        <SurfaceButton aria-label="Previous match" disabled={!query} icon={ChevronUp} onClick={() => void find(query, false, true)} />
        <SurfaceButton aria-label="Next match" disabled={!query} icon={ChevronDown} type="submit" />
        <label><input type="checkbox" checked={matchCase} onChange={(event) => setMatchCase(event.target.checked)} /> Match case</label>
      </div>
      <ActionStatus error={error} />
    </form>
  </>;
}

export function NativeSettings({ state, ui, invoke }: BrowserSurfaceProps) {
  const {native, error, refresh} = useNativeBrowserState(invoke, state.activeSpaceId);
  const action = useSurfaceAction();
  const [selectedChrome, setSelectedChrome] = useState<string[]>([]);
  const chromeSelectionInitialized = useRef(false);
  const disabled = !native || !!action.busy;
  const isDefault = native?.defaultBrowser.http && native.defaultBrowser.https;
  let siteOrigin: string | undefined;
  try { const url = new URL(state.tabs.find((tab) => tab.id === state.activeTabId)?.url ?? ""); if (["http:", "https:"].includes(url.protocol)) siteOrigin = url.origin; } catch { /* No web origin. */ }
  const protection = native?.protection;
  const excepted = !!siteOrigin && !!protection?.exceptionOrigins.includes(siteOrigin);
  const run = (label: string, channel: string, command: unknown) => void action.run(label, async () => { await checkedInvoke(invoke, channel, command); await refresh(); });
  useEffect(() => {
    if (!native || chromeSelectionInitialized.current) return;
    const imported = new Set(native.onboarding.chromeImports.map((entry) => entry.sourceId));
    setSelectedChrome(native.onboarding.chromeProfiles.filter((profile) => !imported.has(profile.id)).map((profile) => profile.id));
    chromeSelectionInitialized.current = true;
  }, [native]);
  const refreshChrome = () => {
    chromeSelectionInitialized.current = false;
    run("Scanning Chrome profiles", NATIVE_IPC.onboarding, {action: "scan-chrome"});
  };
  const importChrome = () => void action.run("Importing selected Chrome profiles", async () => {
    await checkedInvoke(invoke, NATIVE_IPC.onboarding, {action: "import-chrome", profileIds: selectedChrome});
    setSelectedChrome([]);
    chromeSelectionInitialized.current = false;
    await refresh();
  });
  return <>
    <h2>Zenmium</h2>
    <div className="zen-overlay-setting"><span>Default browser<small>{isDefault ? "Zenmium opens web links" : native?.defaultBrowser.packaged ? "Choose Zenmium for web links in macOS" : "Available in the installed Zenmium app"}</small></span><SurfaceButton disabled={disabled || isDefault || !native?.defaultBrowser.packaged} onClick={() => run("Setting default browser", NATIVE_IPC.utility, {action: "set-default-browser"})}>{isDefault ? "Default" : "Set default"}</SurfaceButton></div>
    <SurfaceButton onClick={() => void invoke(CHROME_IPC.open, {kind: "onboarding"})}>Welcome to Zenmium</SurfaceButton>
    <h2>Import your settings</h2>
    <p className="zen-overlay-help">Choose Chrome profiles to create or refresh isolated Zenmium Spaces. The one-click import includes bookmarks, supported extensions, cookies, and saved passwords when Chrome allows the source to be decrypted.</p>
    <ChromeImportPicker profiles={native?.onboarding.chromeProfiles ?? []} imports={native?.onboarding.chromeImports ?? []} selected={selectedChrome} setSelected={setSelectedChrome} disabled={disabled} busy={!!action.busy} onRefresh={refreshChrome} onImport={importChrome} />
    <h2>Privacy and agent control</h2>
    <label className="zen-overlay-setting"><span>Block ads and trackers<small>Ghostery protection for this Workspace</small></span><span className="zen-overlay-switch"><input type="checkbox" role="switch" aria-checked={protection?.enabled ?? false} checked={protection?.enabled ?? false} disabled={disabled || !protection} onChange={(event) => run("Updating protection", NATIVE_IPC.protection, {action: "toggle", enabled: event.target.checked})}/><span aria-hidden="true"/></span></label>
    {protection && <p className="zen-native-protection-status" role="status" data-active={protection.status === "active" || protection.status === "cached"}><ShieldCheck size={16}/>{protection.status === "active" ? "Protection active" : protection.status === "cached" ? "Protection active using cached rules" : protection.status === "loading" ? "Loading protection rules" : protection.status === "disabled" ? "Protection is off" : "Protection unavailable"}{(protection.status === "active" || protection.status === "cached") && ` · ${protection.blockedCount} blocked`}{protection.reason && <small>{protection.reason}</small>}</p>}
    {siteOrigin && protection && <label className="zen-overlay-setting"><span>Allow ads on this site<small>{siteOrigin}</small></span><span className="zen-overlay-switch"><input type="checkbox" role="switch" checked={excepted} disabled={disabled} onChange={(event) => run("Updating site exception", NATIVE_IPC.protection, {action: "site-exception", origin: siteOrigin, allow: event.target.checked})}/><span aria-hidden="true"/></span></label>}
    {protection?.exceptionOrigins.filter((origin) => origin !== siteOrigin).map((origin) => <div className="zen-native-permission" key={origin}><span><strong>{origin}</strong><small>Ads and trackers allowed</small></span><SurfaceButton disabled={disabled} onClick={() => run("Removing site exception", NATIVE_IPC.protection, {action: "site-exception", origin, allow: false})}>Remove exception</SurfaceButton></div>)}
    <label className="zen-overlay-setting"><span>Enable agent features<small>Optional. Browsing works without an agent provider.</small></span><span className="zen-overlay-switch"><input type="checkbox" role="switch" aria-checked={native?.onboarding.agentEnabled ?? false} checked={native?.onboarding.agentEnabled ?? false} disabled={disabled} onChange={(event) => run("Saving agent preference", NATIVE_IPC.onboarding, {action: "preferences", agentEnabled: event.target.checked})}/><span aria-hidden="true"/></span></label>
    <h2>Site permissions</h2>
    <p className="zen-overlay-help">Permissions belong to this Workspace’s browser profile. Reset a decision to ask again.</p>
    {native?.permissions.map((permission) => <div className="zen-native-permission" key={`${permission.origin}:${permission.permission}`}><ShieldCheck size={16}/><span><strong>{permission.origin}</strong><small>{permission.permission} · {permission.decision === "allow" ? "Allowed" : "Blocked"}</small></span><SurfaceButton disabled={disabled} onClick={() => run("Resetting site permission", NATIVE_IPC.permission, {action: "reset", origin: permission.origin, permission: permission.permission})}>Reset</SurfaceButton></div>)}
    {native && !native.permissions.length && <p className="zen-overlay-help">No saved permission decisions in this Workspace.</p>}
    <ActionStatus busy={action.busy} error={action.error ?? error} />
  </>;
}
