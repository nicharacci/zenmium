import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { chromeSpaceName, discoverChromeProfiles, parseChromeBookmarks } from "../src/main/chrome-profile-import.ts";
import { ServiceTokenStore } from "../src/main/service-token.ts";

test("Chrome discovery exposes account domains and never reads password contents", () => {
  const root = mkdtempSync(join(tmpdir(), "zenmium-chrome-discovery-"));
  mkdirSync(join(root, "Default", "Extensions", "abcdefghijklmnopabcdefghijklmnop"), { recursive: true });
  writeFileSync(join(root, "Local State"), JSON.stringify({ profile: { last_active_profiles: ["Default"], info_cache: { Default: { name: "Personal", user_name: "person@example.com" } } } }));
  writeFileSync(join(root, "Default", "Bookmarks"), JSON.stringify({ roots: {} }));
  writeFileSync(join(root, "Default", "Login Data"), "encrypted fixture bytes");
  const [profile] = discoverChromeProfiles(root);
  assert.ok(profile);
  assert.equal(profile.id, "chrome:Default");
  assert.equal(profile.emailDomain, "example.com");
  assert.equal(profile.isLastUsed, true);
  assert.equal(profile.extensionCount, 1);
  assert.equal(profile.hasEncryptedCredentials, true);
  assert.equal(profile.passwordStatus, "protected-1password-handoff");
  assert.equal("profileDirectory" in profile, true, "main-process descriptor may retain its private path");
});

test("Chrome bookmark JSON becomes sanitized nested bookmark rows", () => {
  const rows = parseChromeBookmarks(JSON.stringify({ roots: {
    bookmark_bar: { name: "Bookmarks bar", children: [
      { type: "folder", name: "Work", children: [
        { type: "url", name: "Goalpost", url: "https://goalpost.example/work" },
        { type: "url", name: "Unsafe", url: "javascript:alert(1)" },
      ] },
    ] },
    other: { name: "Other bookmarks", children: [{ type: "url", name: "Docs", url: "https://docs.example" }] },
  } }));
  assert.deepEqual(rows.map(({ title, url, parentKey }) => ({ title, url, parentKey })), [
    { title: "Bookmarks bar", url: undefined, parentKey: null },
    { title: "Work", url: undefined, parentKey: 0 },
    { title: "Goalpost", url: "https://goalpost.example/work", parentKey: 1 },
    { title: "Other bookmarks", url: undefined, parentKey: null },
    { title: "Docs", url: "https://docs.example/", parentKey: 3 },
  ]);
});

test("Chrome-derived Space names follow the domain and remain unique", () => {
  assert.equal(chromeSpaceName({ name: "Personal", emailDomain: "example.com" }, []), "Example.com");
  assert.equal(chromeSpaceName({ name: "Personal", emailDomain: "example.com" }, ["Example.com"]), "Example.com 2");
  assert.equal(chromeSpaceName({ name: "Profile 2", emailDomain: null }, []), "Profile 2");
});

test("service token store refuses plaintext fallback and encrypts bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "zenmium-service-token-"));
  const codec = {
    encrypt: (value: string) => new TextEncoder().encode(`cipher:${value}`),
    decrypt: (value: Uint8Array) => new TextDecoder().decode(value).replace(/^cipher:/, ""),
  };
  const store = new ServiceTokenStore(root, codec);
  store.set("secret-token");
  assert.equal(store.hasToken(), true);
  const noCodec = new ServiceTokenStore(join(root, "no-codec"));
  assert.equal(noCodec.encryptionAvailable, false);
  assert.throws(() => noCodec.set("secret-token"), /Secure token storage/);
});
