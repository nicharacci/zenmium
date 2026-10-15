import { ARC_IPC, ARC_STATE_EVENT, type ArcState } from "@shared/ipc";
import { resolveAddress } from "@shared/navigation";
import { ArrowRight, CornerDownLeft, History, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ActionStatus,
  checkedInvoke,
  displayHost,
  historyEntries,
  SurfaceButton,
  type SurfaceTab,
  TabIcon,
  tabTitle,
  type UtilityProps,
  useSurfaceAction,
} from "./SurfacePrimitives";

type Suggestion = {
  id: string;
  title: string;
  url: string;
  kind: "input" | "tab" | "history";
  tab?: SurfaceTab;
};

const drafts = new Map<
  string,
  { query: string; expiresAt: number; tabId: string | null }
>();
const DRAFT_LIFETIME = 45_000;
let draftUnsubscribe: (() => void) | undefined;
let draftTimer: number | undefined;

export function clearAddressDrafts() {
  drafts.clear();
  draftUnsubscribe?.();
  draftUnsubscribe = undefined;
  window.clearTimeout(draftTimer);
  draftTimer = undefined;
}

export function AddressPalette({ state, ui, invoke, close }: UtilityProps) {
  const newTab = ui.overlay?.kind === "new-tab";
  const active = state.tabs.find(
    (tab) => tab.id === (ui.overlay?.tabId ?? state.activeTabId)
  );
  const draftKey = `${state.activeSpaceId}:${newTab ? "new-tab" : "address"}`;
  const openedTabId = useRef(state.activeTabId);
  const latestTabId = useRef(state.activeTabId);
  const completed = useRef(false);
  const [query, setQuery] = useState(() => {
    const draft = drafts.get(draftKey);
    if (
      draft &&
      draft.expiresAt > Date.now() &&
      draft.tabId === state.activeTabId
    )
      return draft.query;
    return newTab || active?.url === "about:blank" ? "" : (active?.url ?? "");
  });
  const latestQuery = useRef(query);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();
  const action = useSurfaceAction();
  useEffect(() => {
    latestQuery.current = query;
    latestTabId.current = state.activeTabId;
  }, [query, state.activeTabId]);
  useEffect(
    () => () => {
      if (
        !completed.current &&
        latestTabId.current === openedTabId.current &&
        latestQuery.current.trim()
      ) {
        for (const [key, draft] of drafts)
          if (draft.expiresAt <= Date.now()) drafts.delete(key);
        drafts.set(draftKey, {
          expiresAt: Date.now() + DRAFT_LIFETIME,
          query: latestQuery.current,
          tabId: openedTabId.current,
        });
        // Main may unmount the entire overlay. Keep one listener only while a draft lives.
        draftUnsubscribe ??= window.zenmium.on(ARC_STATE_EVENT, (payload) => {
          const next = payload as ArcState;
          if (
            Array.from(drafts.values()).some(
              (draft) => draft.tabId !== next.activeTabId
            )
          )
            clearAddressDrafts();
        });
        window.clearTimeout(draftTimer);
        draftTimer = window.setTimeout(clearAddressDrafts, DRAFT_LIFETIME);
      } else {
        drafts.delete(draftKey);
        if (!drafts.size) clearAddressDrafts();
      }
    },
    [draftKey]
  );
  const suggestions = useMemo<Suggestion[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = (title: string, url: string) =>
      !needle || `${title} ${url}`.toLocaleLowerCase().includes(needle);
    const tabs = state.tabs
      .filter((tab) => matches(tabTitle(tab), tab.url))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, 6);
    const urls = new Set(tabs.map((tab) => tab.url));
    const history = historyEntries(state)
      .filter((entry) => matches(entry.title, entry.url))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .filter((entry) => {
        if (urls.has(entry.url)) return false;
        urls.add(entry.url);
        return true;
      })
      .slice(0, 5);
    let target = "";
    try {
      target = resolveAddress(query, ui.preferences.searchEngine);
    } catch {
      /* Submission presents validation. */
    }
    const isSearch =
      target.startsWith("https://duckduckgo.com/?q=") ||
      target.startsWith("https://www.google.com/search?q=");
    return [
      {
        id: "input",
        kind: "input",
        title: needle
          ? isSearch
            ? `Search ${ui.preferences.searchEngine === "google" ? "Google" : "DuckDuckGo"} for “${query.trim()}”`
            : `Go to ${query.trim()}`
          : newTab
            ? "Open a blank tab"
            : "Go to a blank page",
        url: target,
      },
      ...tabs.map(
        (tab): Suggestion => ({
          id: `tab-${tab.id}`,
          kind: "tab",
          tab,
          title: tabTitle(tab),
          url: tab.url,
        })
      ),
      ...history.map(
        (entry): Suggestion => ({
          id: `history-${entry.id}`,
          kind: "history",
          title: entry.title || entry.url,
          url: entry.url,
        })
      ),
    ];
  }, [query, state, newTab, ui.preferences.searchEngine]);
  const cursor = Math.min(selected, suggestions.length - 1);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => {
    list.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);
  const choose = (suggestion: Suggestion) =>
    void action.run(
      "Opening",
      async () => {
        if (suggestion.kind === "tab" && suggestion.tab)
          return checkedInvoke(invoke, ARC_IPC.activateTab, suggestion.tab.id);
        const url =
          suggestion.kind === "input"
            ? resolveAddress(query, ui.preferences.searchEngine)
            : suggestion.url;
        return checkedInvoke(
          invoke,
          newTab || !active ? ARC_IPC.newTab : ARC_IPC.navigate,
          newTab || !active ? { url } : { id: active.id, url }
        );
      },
      () => {
        completed.current = true;
        clearAddressDrafts();
        close();
      }
    );
  return (
    <div aria-busy={Boolean(action.busy)} className="zen-address-palette">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          choose(suggestions[cursor]!);
        }}
      >
        <div className="zen-address-input-row">
          <Search aria-hidden="true" size={19} />
          <input
            aria-activedescendant={`${uid}-${suggestions[cursor]!.id}`}
            aria-autocomplete="list"
            aria-controls={`${uid}-suggestions`}
            aria-expanded="true"
            aria-label={
              newTab
                ? "Search or enter an address for a new tab"
                : "Search or enter an address"
            }
            autoComplete="off"
            data-zen-address-input
            disabled={Boolean(action.busy)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) {
                if (event.key === "Enter") event.preventDefault();
                return;
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setSelected(
                  (cursor +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    suggestions.length) %
                    suggestions.length
                );
              }
            }}
            placeholder="Search or enter address"
            ref={input}
            role="combobox"
            spellCheck={false}
            value={query}
          />
          <SurfaceButton
            aria-label="Close address bar"
            className="zen-overlay-icon-button"
            icon={X}
            onClick={close}
          />
        </div>
        <div
          aria-label="Address suggestions"
          className="zen-address-suggestions"
          id={`${uid}-suggestions`}
          ref={list}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={cursor === index}
              className={`zen-address-suggestion${cursor === index ? " is-selected" : ""}`}
              disabled={Boolean(action.busy)}
              id={`${uid}-${suggestion.id}`}
              key={suggestion.id}
              onClick={() => choose(suggestion)}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => setSelected(index)}
              role="option"
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true" className="zen-address-suggestion-icon">
                {suggestion.tab ? (
                  <TabIcon tab={suggestion.tab} />
                ) : suggestion.kind === "history" ? (
                  <History size={17} />
                ) : (
                  <ArrowRight size={17} />
                )}
              </span>
              <span className="zen-overlay-text">
                <strong>{suggestion.title}</strong>
                <small>
                  {suggestion.kind === "tab"
                    ? `${displayHost(suggestion.url)} · ${state.spaces.find((space) => space.id === suggestion.tab?.spaceId)?.name ?? "Open tab"}`
                    : suggestion.kind === "history"
                      ? displayHost(suggestion.url)
                      : ""}
                </small>
              </span>
              <span className="zen-address-suggestion-tag">
                {suggestion.kind === "tab" ? (
                  "Switch to tab"
                ) : suggestion.kind === "history" ? (
                  "History"
                ) : (
                  <CornerDownLeft size={14} />
                )}
              </span>
            </button>
          ))}
        </div>
        <ActionStatus {...action} />
        <button
          className="zen-overlay-sr-only"
          disabled={Boolean(action.busy)}
          type="submit"
        >
          Open selected suggestion
        </button>
      </form>
    </div>
  );
}
