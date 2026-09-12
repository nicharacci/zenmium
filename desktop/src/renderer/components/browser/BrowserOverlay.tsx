import {
  type BrowserSurfaceProps,
  CHROME_IPC,
  type PanelKind,
} from "@shared/browser-ui";
import { ARC_IPC } from "@shared/ipc";
import {
  Columns2,
  Download,
  History,
  MessageCircle,
  Palette,
  Plus,
  Puzzle,
  Search,
  Settings2,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type CommandItem, CommandPalette } from "../motion/command-palette";
import { AddressPalette, clearAddressDrafts } from "./AddressPalette";
import { BrowserUtilities } from "./BrowserUtilities";
import {
  ActionStatus,
  checkedInvoke,
  tabTitle,
  type UtilityProps,
  useSurfaceAction,
} from "./SurfacePrimitives";
import "../../styles/zen-overlays.css";

const EXIT_MS = 150;
const labels: Record<PanelKind, string> = {
  address: "Address bar",
  agent: "Agent",
  commands: "Commands",
  downloads: "Downloads",
  extensions: "Extensions",
  history: "History and archive",
  menu: "Browser menu",
  "new-tab": "New tab",
  settings: "Settings",
  "site-info": "Site information",
  "tab-menu": "Tab actions",
  workspace: "Workspaces",
  "workspace-edit": "Edit workspace",
};

/** Mounted by App in the dedicated, transparent, full-window native overlay view. */
export function BrowserOverlay(props: BrowserSurfaceProps) {
  const kind = props.ui.overlay?.kind;
  const previousTab = useRef(props.state.activeTabId);
  useEffect(() => {
    if (previousTab.current !== props.state.activeTabId) clearAddressDrafts();
    previousTab.current = props.state.activeTabId;
  }, [props.state.activeTabId]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.zenOverlaySurface = "true";
    return () => {
      delete root.dataset.zenOverlaySurface;
      delete root.dataset.zenOverlayKind;
      delete root.dataset.zenOverlayTheme;
    };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.zenOverlayTheme = props.ui.dark
      ? "dark"
      : "light";
    document.documentElement.dataset.zenOverlayKind = kind ?? "";
  }, [props.ui.dark, kind]);
  if (!props.ui.overlay) return null;
  return (
    <OverlaySession
      key={
        props.ui.overlay.sessionId ??
        `${kind}:${props.ui.overlay.tabId ?? ""}:${props.ui.overlay.spaceId ?? ""}`
      }
      {...props}
    />
  );
}

function OverlaySession(props: BrowserSurfaceProps) {
  const { ui, invoke } = props;
  const overlay = ui.overlay!;
  const [closing, setClosing] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const [closeError, setCloseError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeStarted = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const alive = useRef(true);
  const commands = overlay.kind === "commands";
  const address = overlay.kind === "address" || overlay.kind === "new-tab";
  const anchored =
    overlay.kind === "menu" ||
    overlay.kind === "tab-menu" ||
    overlay.kind === "workspace" ||
    overlay.kind === "site-info";
  const close = useCallback(() => {
    if (closeStarted.current) return;
    closeStarted.current = true;
    setCloseError(null);
    setClosing(true);
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    timer.current = window.setTimeout(
      () => {
        void checkedInvoke(invoke, CHROME_IPC.close, {
          sessionId: overlay.sessionId,
        }).catch((error: unknown) => {
          if (!alive.current) return;
          closeStarted.current = false;
          setClosing(false);
          setCloseError(
            error instanceof Error
              ? error.message
              : "Could not close this panel. Press Escape to retry."
          );
        });
      },
      reduced ? 20 : EXIT_MS
    );
  }, [invoke, overlay.sessionId]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!(anchored || address) || !panel.current) return;
    const element = panel.current;
    const place = () => {
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (address) {
        setPosition({
          left: (window.innerWidth - width) / 2,
          top: Math.max(24, window.innerHeight / 2 - Math.max(333, height) / 2),
        });
        return;
      }
      const gutter = 12;
      const left = ui.preferences.side === "left";
      const x =
        overlay.x ??
        (left
          ? ui.preferences.width + 16
          : window.innerWidth - ui.preferences.width - width - 16);
      const y =
        overlay.y ??
        (overlay.kind === "workspace" ? window.innerHeight - height - 20 : 54);
      setPosition({
        left: Math.max(gutter, Math.min(x, window.innerWidth - width - gutter)),
        top: Math.max(
          gutter,
          Math.min(y, window.innerHeight - height - gutter)
        ),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [
    anchored,
    address,
    overlay.x,
    overlay.y,
    overlay.kind,
    ui.preferences.side,
    ui.preferences.width,
  ]);

  useEffect(() => {
    const getDialog = () =>
      commands
        ? document.querySelector<HTMLElement>(
            '[role="dialog"][aria-label="Command palette"]'
          )
        : panel.current;
    const focusables = (dialog: HTMLElement) =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]"
        )
      ).filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.closest("[inert], [hidden], [aria-hidden='true']") &&
          element.getClientRects().length > 0
      );
    const focusFirst = () => {
      if (closeStarted.current) return;
      const dialog = getDialog();
      if (!dialog || dialog.contains(document.activeElement)) return;
      const first =
        dialog.querySelector<HTMLElement>(
          "[data-autofocus], input:not(:disabled), [role='menuitem']:not(:disabled)"
        ) ??
        focusables(dialog)[0] ??
        dialog;
      first.focus();
    };
    const frame = requestAnimationFrame(focusFirst);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || closeStarted.current) return;
      const dialog = getDialog();
      if (!dialog) return;
      const elements = focusables(dialog);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (
        !dialog.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    // Also contains focus after async content mounts or a focused control becomes disabled.
    const observer = new MutationObserver(() => {
      const dialog = getDialog();
      if (!dialog || closeStarted.current) return;
      const fresh = dialog.querySelector<HTMLElement>(
        "[data-autofocus]:not([data-focus-applied])"
      );
      if (fresh) {
        fresh.dataset.focusApplied = "true";
        fresh.focus();
      } else if (!dialog.contains(document.activeElement)) focusFirst();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", focusFirst);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", focusFirst);
    };
  }, [commands, close]);

  return (
    <div
      className={`zen-overlay-root${closing ? " is-closing" : ""}${anchored ? " is-anchored" : ""}`}
      data-side={ui.preferences.side}
    >
      <button
        aria-label="Dismiss overlay"
        className="zen-overlay-backdrop"
        onPointerDown={(event) => {
          if (event.button === 0) close();
        }}
        tabIndex={-1}
        type="button"
      />
      {commands ? (
        <CommandsOverlay {...props} close={close} closing={closing} />
      ) : (
        <div
          aria-label={labels[overlay.kind]}
          aria-modal="true"
          className={`zen-overlay-panel zen-overlay-panel--${overlay.kind}${address ? " zen-overlay-panel--address" : ""}`}
          inert={closing}
          ref={panel}
          role="dialog"
          style={anchored || address ? position : undefined}
          tabIndex={-1}
        >
          {address ? (
            <AddressPalette {...props} close={close} />
          ) : (
            <BrowserUtilities {...props} close={close} />
          )}
          {closeError && <ActionStatus error={closeError} />}
        </div>
      )}
      {commands && closeError && (
        <div className="zen-overlay-command-status">
          <ActionStatus error={closeError} />
        </div>
      )}
    </div>
  );
}

function CommandsOverlay({
  state,
  invoke,
  close,
  closing,
}: UtilityProps & { closing: boolean }) {
  const action = useSurfaceAction();
  const replacing = useRef(false);
  const open = (kind: PanelKind) => {
    replacing.current = true;
    void action
      .run("Opening", () => checkedInvoke(invoke, CHROME_IPC.open, { kind }))
      .finally(() => {
        replacing.current = false;
      });
  };
  const items: CommandItem[] = [
    {
      group: "Browser",
      hint: "⌘T",
      icon: Plus,
      id: "new-tab",
      label: "New tab",
      onSelect: () => open("new-tab"),
    },
    {
      group: "Browser",
      hint: "⌘L",
      icon: Search,
      id: "address",
      label: "Go to address",
      onSelect: () => open("address"),
    },
    {
      group: "Browser",
      icon: History,
      id: "history",
      label: "History & archive",
      onSelect: () => open("history"),
    },
    {
      group: "Browser",
      icon: Download,
      id: "downloads",
      label: "Downloads",
      onSelect: () => open("downloads"),
    },
    {
      group: "Browser",
      icon: Puzzle,
      id: "extensions",
      label: "Extensions",
      onSelect: () => open("extensions"),
    },
    {
      group: "Browser",
      icon: Palette,
      id: "workspaces",
      label: "Workspaces",
      onSelect: () => open("workspace"),
    },
    {
      group: "Browser",
      icon: Settings2,
      id: "settings",
      label: "Settings",
      onSelect: () => open("settings"),
    },
    {
      group: "Browser",
      icon: MessageCircle,
      id: "agent",
      label: "Agent",
      onSelect: () => open("agent"),
    },
    ...state.tabs.map(
      (tab): CommandItem => ({
        group: "Open tabs",
        icon: Search,
        id: `tab-${tab.id}`,
        keywords: [tab.url],
        label: tabTitle(tab),
        onSelect: () => {
          void action.run(
            "Switching tab",
            () => checkedInvoke(invoke, ARC_IPC.activateTab, tab.id),
            close
          );
        },
      })
    ),
    ...state.tabs
      .filter(
        (tab) =>
          state.activeTabId &&
          tab.id !== state.activeTabId &&
          tab.spaceId === state.activeSpaceId
      )
      .map(
        (tab): CommandItem => ({
          group: "Split view",
          icon: Columns2,
          id: `split-${tab.id}`,
          label: `Split with ${tabTitle(tab)}`,
          onSelect: () => {
            void action.run(
              "Opening split view",
              () => checkedInvoke(invoke, "arc:toggleSplit", tab.id),
              close
            );
          },
        })
      ),
  ];
  return (
    <>
      <CommandPalette
        emptyMessage={action.busy ? "Working…" : "No matching commands or tabs"}
        items={action.busy ? [] : items}
        onOpenChange={(open) => {
          if (!open && !action.pending.current && !replacing.current) close();
        }}
        open={!closing}
        placeholder="Search tabs or run a command…"
        shortcut=""
      />
      {(action.error || action.busy) && (
        <div className="zen-overlay-command-status">
          <ActionStatus {...action} />
        </div>
      )}
    </>
  );
}
