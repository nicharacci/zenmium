export interface VerificationRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface VerificationDisplay {
  bounds: VerificationRect;
  id: number;
  label: string;
  rotation: number;
  scaleFactor: number;
  workArea: VerificationRect;
}

interface StartupPorts {
  createTemporaryDirectory: (parent?: string) => string;
  lock: () => boolean;
  setPath: (
    name: "userData" | "sessionData" | "crashDumps",
    path: string
  ) => void;
  useAccessoryActivation: () => void;
}

/** Cancel Electron 42 page alert/confirm callbacks without opening native UI. */
export function cancelVerificationMessageBox(): Promise<{
  checkboxChecked: boolean;
  response: number;
}> {
  // Electron's page-dialog callback treats response === 0 as acceptance.
  return Promise.resolve({ checkboxChecked: false, response: 1 });
}

export function verificationRequested(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (value !== "1") {
    throw new Error("ZENMIUM_VERIFY_SIDE_MONITOR must be 1 or unset.");
  }
  return true;
}

export function prepareVerificationStartup(
  enabled: boolean,
  ports: StartupPorts
): boolean {
  if (enabled) {
    const profile = ports.createTemporaryDirectory();
    ports.setPath("userData", profile);
    ports.setPath("sessionData", ports.createTemporaryDirectory(profile));
    ports.setPath("crashDumps", ports.createTemporaryDirectory(profile));
    ports.useAccessoryActivation();
  }
  return ports.lock();
}

function validRect(rect: VerificationRect): boolean {
  return (
    Object.values(rect).every(Number.isSafeInteger) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isSafeInteger(rect.x + rect.width) &&
    Number.isSafeInteger(rect.y + rect.height)
  );
}

export function containsRect(
  outer: VerificationRect,
  inner: VerificationRect
): boolean {
  return (
    validRect(outer) &&
    validRect(inner) &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlaps(a: VerificationRect, b: VerificationRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function verificationPlacement(
  displays: readonly VerificationDisplay[],
  primaryId: number
) {
  const primary = displays.filter((display) => display.id === primaryId);
  const targets = displays.filter(
    (display) => display.label.trim().toUpperCase() === "DELL P2422H"
  );
  const [target] = targets;
  const [primaryDisplay] = primary;
  if (
    primary.length !== 1 ||
    !primaryDisplay ||
    targets.length !== 1 ||
    !target ||
    target.id === primaryId ||
    new Set(displays.map((display) => display.id)).size !== displays.length ||
    displays.some(
      (display) =>
        !Number.isSafeInteger(display.id) ||
        display.id < 0 ||
        !validRect(display.bounds) ||
        !containsRect(display.bounds, display.workArea) ||
        !Number.isFinite(display.scaleFactor) ||
        display.scaleFactor <= 0 ||
        !Number.isFinite(display.rotation)
    )
  ) {
    throw new Error(
      "Verification requires one explicitly identified non-primary DELL P2422H."
    );
  }
  if (
    target.workArea.width < 800 ||
    target.workArea.height < 560 ||
    overlaps(target.workArea, primaryDisplay.bounds)
  ) {
    throw new Error("Verification display has no safe work area.");
  }
  const width = Math.min(1440, target.workArea.width);
  const height = Math.min(900, target.workArea.height);
  return {
    bounds: {
      height,
      width,
      x: target.workArea.x + Math.floor((target.workArea.width - width) / 2),
      y: target.workArea.y + Math.floor((target.workArea.height - height) / 2),
    },
    displayId: target.id,
    fingerprint: JSON.stringify({
      displays: [...displays].sort((a, b) => a.id - b.id),
      primaryId,
    }),
    workArea: { ...target.workArea },
  };
}

interface VerificationWindow {
  getBounds: () => VerificationRect;
  hide: () => void;
  isDestroyed: () => boolean;
  setBounds: (bounds: VerificationRect) => void;
  showInactive: () => void;
}

interface VerificationPorts {
  displays: () => {
    displays: readonly VerificationDisplay[];
    primaryId: number;
  };
  quit: () => void;
  windows: () => VerificationWindow[];
}

export function createVerificationGuard(ports: VerificationPorts) {
  let stopped = false;
  let selected: ReturnType<typeof verificationPlacement> | undefined;
  let host: VerificationWindow | undefined;
  const hide = (window: VerificationWindow) => {
    try {
      if (window.isDestroyed()) {
        return;
      }
    } catch {
      // An unreadable destruction state must not prevent a hide attempt.
    }
    try {
      window.hide();
    } catch {
      // Continue cleanup of the remaining windows even if Electron refuses.
    }
  };
  const stop = () => {
    if (stopped) {
      return;
    }
    stopped = true;
    try {
      for (const window of ports.windows()) {
        hide(window);
      }
    } catch {
      // Window enumeration can fail during teardown. Still attempt shutdown.
    } finally {
      try {
        ports.quit();
      } catch {
        // Keep the refusal latched without interrupting caller-side cleanup.
      }
    }
  };
  const placement = () => {
    if (stopped) {
      return null;
    }
    try {
      const snapshot = ports.displays();
      const current = verificationPlacement(
        snapshot.displays,
        snapshot.primaryId
      );
      if (selected && selected.fingerprint !== current.fingerprint) {
        throw new Error("Verification display changed.");
      }
      selected ??= current;
      return current;
    } catch {
      stop();
      return null;
    }
  };
  return {
    placement,
    present(window: VerificationWindow) {
      try {
        const current = placement();
        if (!current || host !== window || window.isDestroyed()) {
          stop();
          return;
        }
        window.setBounds(current.bounds);
        if (
          !(placement() && containsRect(current.workArea, window.getBounds()))
        ) {
          stop();
          return;
        }
        window.showInactive();
      } catch {
        stop();
      }
    },
    stop,
    validateWindow(window: VerificationWindow) {
      try {
        const current = placement();
        if (
          !current ||
          window !== host ||
          window.isDestroyed() ||
          !containsRect(current.workArea, window.getBounds())
        ) {
          stop();
        }
      } catch {
        stop();
      }
    },
    windowCreated(window: VerificationWindow, expected: boolean) {
      if (stopped || !expected || host || !placement()) {
        hide(window);
        stop();
        return false;
      }
      host = window;
      return true;
    },
  };
}
