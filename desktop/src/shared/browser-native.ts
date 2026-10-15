import { z } from "zod";

/** Trusted browser-chrome only. Web pages never receive this bridge. */
export const NATIVE_IPC = {
  snapshot: "native:snapshot",
  bookmark: "native:bookmark",
  utility: "native:utility",
  permission: "native:permission",
  onboarding: "native:onboarding",
  event: "native:state",
  findResult: "native:find-result",
  protection: "native:protection",
} as const;

export interface Bookmark {
  id: string;
  profileId: string;
  parentId: string | null;
  kind: "bookmark" | "folder";
  title: string;
  url?: string;
  createdAt: number;
}
export interface SitePermission {
  profileId: string;
  origin: string;
  permission: string;
  decision: "allow" | "deny";
}
export interface NativeBrowserState {
  bookmarks: Bookmark[];
  permissions: SitePermission[];
  onboarding: {
    version: 1;
    completed: boolean;
    agentEnabled: boolean;
    serviceTokenConfigured: boolean;
    secureTokenStorageAvailable: boolean;
    chromeProfiles: ChromeProfileCandidate[];
    chromeImports: ChromeImportRecord[];
  };
  defaultBrowser: { http: boolean; https: boolean; packaged: boolean };
  zoomFactor: number;
  protection: ProtectionState;
}
export interface ChromeProfileCandidate {
  id: string;
  directoryName: string;
  name: string;
  emailDomain: string | null;
  avatarInitials: string | null;
  isLastUsed: boolean;
  hasBookmarks: boolean;
  extensionCount: number;
  hasEncryptedCredentials: boolean;
  hasCookies: boolean;
  hasSavedPasswords: boolean;
  credentialAvailability: "available" | "protected-by-chrome" | "not-found";
}
export interface ChromeImportRecord {
  version: 1 | 2;
  sourceId: string;
  spaceId: string;
  spaceName: string;
  importedAt: number;
  bookmarks: number;
  extensions: { imported: number; skipped: number; onePasswordDetected: boolean };
  cookies?: { imported: number; skipped: number; status: "imported" | "partial" | "protected-by-chrome" | "unavailable" | "not-found" };
  passwords?: { imported: number; skipped: number; status: "imported" | "partial" | "protected-by-chrome" | "unavailable" | "not-found" };
  /** Backward-compatible summary for v1 records. */
  passwordStatus?: "protected-1password-handoff" | "imported" | "partial" | "protected-by-chrome" | "unavailable" | "not-found";
  notes: string[];
}
export interface ProtectionState {
  enabled: boolean;
  status: "loading" | "active" | "cached" | "disabled" | "unavailable";
  blockedCount: number;
  exceptionOrigins: string[];
  reason?: string;
  updatedAt?: number;
}
export interface FindResult {
  tabId: string;
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}
export const bookmarkCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), title: z.string().trim().min(1).max(500), url: z.string().max(16384), parentId: z.string().nullable().optional() }),
  z.object({ action: z.literal("folder"), title: z.string().trim().min(1).max(500), parentId: z.string().nullable().optional() }),
  z.object({ action: z.literal("update"), id: z.string(), title: z.string().trim().min(1).max(500).optional(), url: z.string().max(16384).optional(), parentId: z.string().nullable().optional() }),
  z.object({ action: z.literal("remove"), id: z.string() }),
  z.object({ action: z.literal("open"), id: z.string(), background: z.boolean().optional() }),
  z.object({ action: z.literal("import") }),
  z.object({ action: z.literal("export") }),
  z.object({ action: z.literal("add-current") }),
]);
export const utilityCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("find"), query: z.string().min(1).max(2000), forward: z.boolean().optional(), findNext: z.boolean().optional(), matchCase: z.boolean().optional() }),
  z.object({ action: z.literal("stop-find") }),
  z.object({ action: z.enum(["zoom-in", "zoom-out", "zoom-reset", "print", "save-pdf", "save-page", "set-default-browser"]) }),
]);
export const permissionCommandSchema = z.object({
  action: z.literal("reset"),
  origin: z.string().max(2048),
  permission: z.string().max(100).optional(),
});
export const onboardingCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), agentEnabled: z.boolean(), serviceToken: z.string().max(4096).optional() }),
  z.object({ action: z.literal("preferences"), agentEnabled: z.boolean() }),
  z.object({ action: z.literal("set-service-token"), token: z.string().max(4096) }),
  z.object({ action: z.literal("scan-chrome") }),
  z.object({ action: z.literal("import-chrome"), profileIds: z.array(z.string().min(1).max(200)).min(1).max(20) }),
]);
export type OnboardingCommand = z.infer<typeof onboardingCommandSchema>;
export type BookmarkCommand = z.infer<typeof bookmarkCommandSchema>;
export type UtilityCommand = z.infer<typeof utilityCommandSchema>;
export const protectionCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("toggle"), enabled: z.boolean() }),
  z.object({ action: z.literal("site-exception"), origin: z.string().url().max(2048), allow: z.boolean() }),
]);
