// biome-ignore-all lint/performance/noJsxPropsBind: These small native controls use current render state; callback identity is not a memoization boundary.
import { CHROME_IPC, type Invoke } from "@shared/browser-ui";
import { ARC_IPC, type Space } from "@shared/ipc";
import { ChevronDown, Layers, MoreHorizontal } from "lucide-react";
import type { CSSProperties } from "react";
import { SidebarButton } from "./SidebarChrome";
import type { SidebarDrag } from "./SidebarDrag";

function WorkspaceIcon({ space }: { space?: Space }) {
  return (
    <span aria-hidden="true" className="zen-workspace-icon">
      {space?.icon || <Layers size={16} />}
    </span>
  );
}

export function SidebarWorkspaceIndicator({
  space,
  pinnedOpen,
  onTogglePinned,
  invoke,
}: {
  space?: Space;
  pinnedOpen: boolean;
  onTogglePinned: () => void;
  invoke: Invoke;
}) {
  return (
    <div className="zen-workspace-indicator">
      <button
        aria-haspopup="menu"
        className="zen-workspace-current"
        onClick={() =>
          invoke(CHROME_IPC.open, {
            kind: "workspace",
            spaceId: space?.id,
          })
        }
        title="Switch workspace"
        type="button"
      >
        <WorkspaceIcon space={space} />
        <span className="zen-workspace-name">{space?.name || "Workspace"}</span>
      </button>
      <SidebarButton
        className="zen-workspace-action"
        disabled={!space}
        label="Edit workspace"
        onClick={() =>
          invoke(CHROME_IPC.open, {
            kind: "workspace-edit",
            spaceId: space?.id,
          })
        }
      >
        <MoreHorizontal size={15} />
      </SidebarButton>
      <SidebarButton
        aria-controls="zen-sidebar-pinned"
        aria-expanded={pinnedOpen}
        className="zen-pinned-toggle"
        label={pinnedOpen ? "Collapse pinned tabs" : "Expand pinned tabs"}
        onClick={onTogglePinned}
      >
        <ChevronDown
          className={pinnedOpen ? "" : "zen-chevron-closed"}
          size={14}
        />
      </SidebarButton>
    </div>
  );
}

export function SidebarWorkspaceSwitcher({
  spaces,
  activeSpaceId,
  drag,
  invoke,
}: {
  spaces: Space[];
  activeSpaceId: string;
  drag: SidebarDrag;
  invoke: Invoke;
}) {
  return (
    <nav aria-label="Workspaces" className="zen-workspace-switcher">
      {spaces.map((space) => (
        <button
          aria-current={space.id === activeSpaceId ? "true" : undefined}
          aria-label={space.name}
          className="zen-workspace-button"
          key={space.id}
          style={{ "--zen-space-color": space.color } as CSSProperties}
          title={space.name}
          type="button"
          {...drag.zone(`space:${space.id}`, { spaceId: space.id })}
          onClick={() => invoke(ARC_IPC.activateSpace, space.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            invoke(CHROME_IPC.open, {
              kind: "workspace-edit",
              spaceId: space.id,
            });
          }}
        >
          <WorkspaceIcon space={space} />
        </button>
      ))}
    </nav>
  );
}
