import type { ZenmiumBridge } from "@shared/ipc";

declare global {
  interface Window {
    zenmium: ZenmiumBridge;
  }
}

export {};
