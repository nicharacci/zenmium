import { contextBridge, ipcRenderer } from "electron";
import type { ZenmiumBridge } from "../shared/ipc";

const bridge: ZenmiumBridge = {
  invoke: <T = unknown>(channel: string, payload?: unknown): Promise<T> =>
    ipcRenderer.invoke(channel, payload) as Promise<T>,
  on: (channel: string, listener: (payload: unknown) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("zenmium", bridge);
