import type { BrowserSurfaceProps, Invoke } from "@shared/browser-ui";
import type { ArcState, HistoryEntry, Tab } from "@shared/ipc";
import {
  AlertCircle,
  Globe2,
  LoaderCircle,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type SurfaceTab = Tab;
export type SurfaceHistoryEntry = HistoryEntry;
export type UtilityProps = BrowserSurfaceProps & { close: () => void };

export function historyEntries(state: ArcState): SurfaceHistoryEntry[] {
  return state.history ?? [];
}

export function tabTitle(tab: SurfaceTab): string {
  return tab.customTitle || tab.title || tab.url || "Untitled tab";
}

export function displayHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Accept both throwing IPC handlers and the existing Result error envelope. */
export async function checkedInvoke<T = unknown>(
  invoke: Invoke,
  channel: string,
  payload?: unknown
): Promise<T> {
  const result = await invoke<T>(channel, payload);
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === false
  ) {
    throw new Error(
      "reason" in result
        ? String(result.reason)
        : "The action could not be completed."
    );
  }
  return result;
}

export function useSurfaceAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(
    async (
      label: string,
      action: () => Promise<unknown>,
      success?: () => void
    ) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(label);
      setError(null);
      try {
        await action();
        if (mounted.current) success?.();
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause));
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(null);
      }
    },
    []
  );
  return { busy, error, pending, run, setError };
}

export function ActionStatus({
  busy,
  error,
}: {
  busy?: string | null;
  error?: string | null;
}) {
  return (
    <>
      {busy && (
        <p className="zen-overlay-status" role="status">
          <LoaderCircle
            aria-hidden="true"
            className="zen-overlay-spin"
            size={14}
          />
          {busy}…
        </p>
      )}
      {error && (
        <p className="zen-overlay-error" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          <span>{error}</span>
        </p>
      )}
    </>
  );
}

export function SurfaceButton({
  children,
  icon: Icon,
  variant = "default",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  variant?: "default" | "primary" | "danger";
}) {
  return (
    <button
      type="button"
      {...props}
      className={`zen-overlay-button zen-overlay-button--${variant} ${className}`}
    >
      {Icon && <Icon aria-hidden="true" size={16} />}
      {children}
    </button>
  );
}

export function PanelHeader({
  title,
  subtitle,
  close,
}: {
  title: string;
  subtitle?: string;
  close: () => void;
}) {
  return (
    <header className="zen-overlay-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <SurfaceButton
        aria-label={`Close ${title}`}
        className="zen-overlay-icon-button"
        icon={X}
        onClick={close}
        title="Close (Escape)"
      />
    </header>
  );
}

export function EmptyState({
  icon: Icon = Globe2,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="zen-overlay-empty">
      <Icon aria-hidden="true" size={28} strokeWidth={1.4} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

export function TabIcon({ tab }: { tab: SurfaceTab }) {
  const source = tab.iconUrl || tab.faviconUrl;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  if (tab.iconUrl && !/^[a-z][a-z\d+.-]*:/i.test(tab.iconUrl))
    return (
      <span aria-hidden="true" className="zen-overlay-tab-icon">
        {tab.iconUrl.slice(0, 8)}
      </span>
    );
  return source && /^(https?:|data:image\/)/i.test(source) && !failed ? (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Image load failure is a resource event, not a user interaction.
    <img
      alt=""
      className="zen-overlay-tab-icon"
      height={16}
      onError={() => setFailed(true)}
      referrerPolicy="no-referrer"
      src={source}
      width={16}
    />
  ) : (
    <Globe2 aria-hidden="true" className="zen-overlay-tab-icon" />
  );
}

export function RovingMenu({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ at: 0, text: "" });
  const items = () =>
    Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled)'
      ) ?? []
    );
  useEffect(() => {
    const update = () => {
      const buttons = items();
      const active =
        buttons.find((button) => button === document.activeElement) ??
        buttons[0];
      for (const button of buttons)
        button.tabIndex = button === active ? 0 : -1;
    };
    update();
    const observer = new MutationObserver(update);
    if (ref.current)
      observer.observe(ref.current, {
        attributeFilter: ["disabled"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    return () => observer.disconnect();
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea, select"))
      return;
    const buttons = items();
    if (!buttons.length) return;
    const index = buttons.findIndex(
      (button) => button === document.activeElement
    );
    let next = index;
    if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key !== " "
    ) {
      const now = Date.now();
      typeahead.current = {
        at: now,
        text:
          (now - typeahead.current.at < 600 ? typeahead.current.text : "") +
          event.key.toLowerCase(),
      };
      next = buttons.findIndex((_, offset) =>
        buttons[(index + 1 + offset) % buttons.length]?.textContent
          ?.trim()
          .toLowerCase()
          .startsWith(typeahead.current.text)
      );
      if (next >= 0) next = (index + 1 + next) % buttons.length;
    } else return;
    event.preventDefault();
    if (next >= 0) {
      for (const button of buttons) button.tabIndex = -1;
      buttons[next]!.tabIndex = 0;
      buttons[next]!.focus();
    }
  };
  return (
    <div
      aria-label={label}
      className="zen-overlay-menu"
      onFocus={(event) => {
        if ((event.target as HTMLElement).getAttribute("role") !== "menuitem")
          return;
        for (const button of items())
          button.tabIndex = button === (event.target as HTMLElement) ? 0 : -1;
      }}
      onKeyDown={onKeyDown}
      ref={ref}
      role="menu"
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  hint,
  danger,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: LucideIcon;
  hint?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      role="menuitem"
      tabIndex={-1}
      type="button"
      {...props}
      className={`zen-overlay-menu-item${danger ? " zen-overlay-danger" : ""}`}
    >
      {Icon && <Icon aria-hidden="true" size={16} />}
      <span>{children}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}
