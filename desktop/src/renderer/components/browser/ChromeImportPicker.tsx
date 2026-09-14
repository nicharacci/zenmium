import type { ChromeImportRecord, ChromeProfileCandidate } from "@shared/browser-native";
import { Bookmark, Check, CheckCircle2, Cookie, KeyRound, Puzzle, RefreshCw, ShieldCheck } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { SurfaceButton } from "./SurfacePrimitives";

interface ChromeImportPickerProps {
  profiles: ChromeProfileCandidate[];
  imports: ChromeImportRecord[];
  selected: string[];
  setSelected: Dispatch<SetStateAction<string[]>>;
  disabled?: boolean;
  busy?: boolean;
  disableImported?: boolean;
  onRefresh: () => void;
  onImport: () => void;
  showImportButton?: boolean;
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "imported": return "Imported";
    case "partial": return "Partial import";
    case "protected-by-chrome": return "Chrome-protected";
    case "unavailable": return "Unavailable";
    case "not-found": return "Not present";
    case "protected-1password-handoff": return "1Password handoff";
    default: return "Ready to import";
  }
}

export function ChromeImportPicker({
  profiles,
  imports,
  selected,
  setSelected,
  disabled = false,
  busy = false,
  disableImported = false,
  onRefresh,
  onImport,
  showImportButton = true,
}: ChromeImportPickerProps) {
  const importedBySource = new Map(imports.map((entry) => [entry.sourceId, entry]));
  const selectable = profiles.filter((profile) => !disableImported || !importedBySource.has(profile.id));
  const allSelected = selectable.length > 0 && selectable.every((profile) => selected.includes(profile.id));
  const toggle = (id: string, checked: boolean) => setSelected((current) => checked
    ? [...new Set([...current, id])]
    : current.filter((value) => value !== id));
  const selectAll = () => setSelected((current) => [...new Set([...current, ...selectable.map((profile) => profile.id)])]);
  const clearAll = () => setSelected((current) => current.filter((id) => !selectable.some((profile) => profile.id === id)));

  return <div className="zen-chrome-import-picker">
    <div className="zen-onboarding-chrome-toolbar">
      <span>{profiles.length ? `${profiles.length} Chrome profile${profiles.length === 1 ? "" : "s"} found` : "No Chrome profiles found"}</span>
      <div className="zen-chrome-import-actions">
        {selectable.length > 0 && <SurfaceButton disabled={disabled || busy} onClick={allSelected ? clearAll : selectAll}>{allSelected ? "Clear all" : "Select all"}</SurfaceButton>}
        <SurfaceButton icon={RefreshCw} disabled={disabled || busy} onClick={onRefresh}>Refresh</SurfaceButton>
      </div>
    </div>
    <div className="zen-onboarding-chrome-list" aria-label="Chrome profiles">
      {profiles.map((profile) => {
        const imported = importedBySource.get(profile.id);
        const rowDisabled = disabled || busy || (disableImported && Boolean(imported));
        return <label className="zen-onboarding-chrome-row" data-imported={Boolean(imported)} key={profile.id}>
          <input
            type="checkbox"
            checked={selected.includes(profile.id)}
            disabled={rowDisabled}
            onChange={(event) => toggle(profile.id, event.target.checked)}
          />
          <span>
            <strong>{profile.emailDomain ? profile.emailDomain : profile.name}{profile.isLastUsed && <em>Last used</em>}</strong>
            <small>{profile.name}{imported ? ` · ${statusLabel(imported.passwords?.status ?? imported.passwordStatus)}` : ""}</small>
            <span className="zen-chrome-import-capabilities">
              <span data-present={profile.hasBookmarks}><Bookmark size={11} /> {profile.hasBookmarks ? "Bookmarks" : "No bookmarks"}</span>
              <span data-present={profile.extensionCount > 0}><Puzzle size={11} /> {profile.extensionCount} extension{profile.extensionCount === 1 ? "" : "s"}</span>
              <span data-present={profile.hasCookies}><Cookie size={11} /> {profile.hasCookies ? "Cookies" : "No cookies"}</span>
              <span data-present={profile.hasSavedPasswords}><KeyRound size={11} /> {profile.hasSavedPasswords ? "Passwords" : "No passwords"}</span>
            </span>
            {imported
              ? <small className="zen-onboarding-imported"><CheckCircle2 size={13} /> Imported as {imported.spaceName}{imported.cookies ? ` · ${imported.cookies.imported} cookies` : ""}{imported.passwords ? ` · ${imported.passwords.imported} passwords` : ""}</small>
              : <small className="zen-onboarding-password-note"><ShieldCheck size={12} /> Credentials stay in the main process and are encrypted for this Workspace</small>}
          </span>
          {imported && <Check size={15} aria-hidden="true" />}
        </label>;
      })}
    </div>
    {profiles.length === 0 && <p className="zen-overlay-help">Zenmium scans Google Chrome’s stable macOS profile directory. Close Chrome before importing if a source database is busy.</p>}
    <div className="zen-chrome-import-footer">
      <span>{selected.length ? `${selected.length} selected · one click imports the checked profiles` : "Select profiles to import"}</span>
      {showImportButton && <SurfaceButton variant="primary" disabled={disabled || busy || !selected.length} onClick={onImport}>
        {busy ? "Importing…" : `Import ${selected.length || "selected"}`}
      </SurfaceButton>}
    </div>
  </div>;
}
