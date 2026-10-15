// biome-ignore-all lint/performance/noJsxPropsBind: These small native controls use current render state; callback identity is not a memoization boundary.
import { CHROME_IPC, type Invoke } from "@shared/browser-ui";
import type { Space } from "@shared/ipc";
import { ChevronDown } from "lucide-react";
import type { CSSProperties } from "react";
import { SidebarButton } from "./SidebarChrome";
import type { SidebarDrag } from "./SidebarDrag";

export function SidebarWorkspaceSwitcher({
  spaces,
  activeSpaceId,
  drag,
  invoke,
  open = false,
}: {
  spaces: Space[];
  activeSpaceId: string;
  drag: SidebarDrag;
  invoke: Invoke;
  open?: boolean;
}) {
  const space = spaces.find((item) => item.id === activeSpaceId);
  const drop = space
    ? drag.zone(`space:${space.id}`, { spaceId: space.id })
    : {};
  return (
    <nav aria-label="Current workspace" className="zen-workspace-switcher">
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Switch workspace${space ? `: ${space.name}` : ""}`}
        className="zen-workspace-current zen-workspace-current-footer"
        disabled={!space}
        style={
          {
            "--zen-space-color": space?.color ?? "#6ee7a8",
          } as CSSProperties
        }
        title={space ? `Switch workspace: ${space.name}` : "Switch workspace"}
        type="button"
        {...drop}
        onClick={() =>
          void invoke(CHROME_IPC.open, {
            kind: "workspace",
            spaceId: space?.id,
          })
        }
        onContextMenu={(event) => {
          if (!space) return;
          event.preventDefault();
          event.stopPropagation();
          void invoke(CHROME_IPC.open, {
            kind: "workspace-edit",
            spaceId: space.id,
          });
        }}
      >
        {space?.avatar ? (
          <span
            aria-hidden="true"
            className="zen-workspace-avatar"
            title={`${space.avatar.provider} account`}
          >
            {space.avatar.initials}
          </span>
        ) : null}
        <span className="zen-workspace-name">
          {space?.name ?? "Workspace 1"}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={open ? "zen-chevron-open" : ""}
          size={14}
        />
      </button>
    </nav>
  );
}
