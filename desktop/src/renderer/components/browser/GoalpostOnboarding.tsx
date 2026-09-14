import { CHROME_IPC } from "@shared/browser-ui";
import { NATIVE_IPC } from "@shared/browser-native";
import { ARC_IPC, SPACE_COLORS } from "@shared/ipc";
import { ArrowLeft, ArrowRight, Check, ExternalLink, KeyRound, LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "../motion/input";
import { useNativeBrowserState } from "./BrowserNativePanels";
import { ActionStatus, checkedInvoke, SurfaceButton, type UtilityProps, useSurfaceAction } from "./SurfacePrimitives";
import { ThemeColorPicker } from "./ThemeColorPicker";
import { ChromeImportPicker } from "./ChromeImportPicker";

const logo = new URL("../../../../../docs/zenmium/brand/zenmium-canonical.png", import.meta.url).href;
const STEP_LABELS = ["Welcome", "Your space", "Agent access", "Import Chrome", "Ready"];

export function GoalpostOnboarding({ state, ui, invoke, close }: UtilityProps) {
  const { native, error, refresh } = useNativeBrowserState(invoke, state.activeSpaceId);
  const action = useSurfaceAction();
  const space = state.spaces.find((item) => item.id === state.activeSpaceId);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(space?.name ?? "Workspace 1");
  const [agentEnabled, setAgentEnabled] = useState<boolean | null>(null);
  const [serviceToken, setServiceToken] = useState("");
  const [selectedChrome, setSelectedChrome] = useState<string[]>([]);
  const scanned = useRef(false);
  const selectionInitialized = useRef(false);
  const enabled = agentEnabled ?? native?.onboarding.agentEnabled ?? false;
  const isDefault = native?.defaultBrowser.http && native.defaultBrowser.https;
  const busy = !native || !!action.busy;
  const options = SPACE_COLORS.map((color, index) => ({ color, label: ["Goalpost mint", "Sky", "Rose", "Amber", "Lilac", "Lagoon", "Coral"][index] ?? `Color ${index + 1}` }));
  const profiles = native?.onboarding.chromeProfiles ?? [];

  useEffect(() => {
    if (step !== 3) {
      selectionInitialized.current = false;
      return;
    }
    if (!native || scanned.current) return;
    scanned.current = true;
    void action.run("Finding Chrome profiles", async () => {
      await checkedInvoke(invoke, NATIVE_IPC.onboarding, { action: "scan-chrome" });
      await refresh();
    });
  }, [action, invoke, native, refresh, step]);

  useEffect(() => {
    if (step !== 3 || !native || selectionInitialized.current) return;
    const importedIds = new Set(native.onboarding.chromeImports.map((entry) => entry.sourceId));
    setSelectedChrome(native.onboarding.chromeProfiles.filter((profile) => !importedIds.has(profile.id)).map((profile) => profile.id));
    selectionInitialized.current = true;
  }, [native, step]);

  const run = (label: string, task: () => Promise<unknown>, success?: () => void) => void action.run(label, task, success);

  const next = () => {
    if (step === 1 && space) {
      run("Saving your Workspace", () => checkedInvoke(invoke, ARC_IPC.updateSpace, { id: space.id, patch: { name: name.trim() || "Workspace 1" } }), () => setStep(2));
      return;
    }
    if (step === 2) {
      const saveToken = serviceToken.trim();
      if (saveToken) {
        run("Securing your service token", () => checkedInvoke(invoke, NATIVE_IPC.onboarding, { action: "set-service-token", token: saveToken }), () => { setServiceToken(""); setStep(3); });
      } else setStep(3);
      return;
    }
    if (step === 3) {
      if (!selectedChrome.length) { setStep(4); return; }
      run("Importing selected Chrome profiles", () => checkedInvoke(invoke, NATIVE_IPC.onboarding, { action: "import-chrome", profileIds: selectedChrome }), () => { setSelectedChrome([]); setStep(4); });
      return;
    }
    setStep((current) => current + 1);
  };

  const finish = () => run("Finishing setup", () => checkedInvoke(invoke, NATIVE_IPC.onboarding, { action: "complete", agentEnabled: enabled }), close);

  return <div className="zen-onboarding">
    <div className="zen-onboarding-brand"><img src={logo} alt="Zenmium" width={76} height={76} /><span>ZENMIUM <small>by Goalpost</small></span></div>
    <ol className="zen-onboarding-steps" aria-label="Setup progress">{STEP_LABELS.map((label, index) => <li aria-current={step === index ? "step" : undefined} key={label}>{index < step ? <Check size={12} /> : <span>{index + 1}</span>}{label}</li>)}</ol>

    {step === 0 && <section><h1>A little space.<br />A lot of possibility.</h1><p>A browser that keeps the web in focus. Your pages sit above a quiet glass frame, with useful tools close at hand.</p><div className="zen-onboarding-note"><ShieldCheck size={20} /><p>Each Workspace has its own browser profile. Work and personal accounts stay separate.</p></div></section>}

    {step === 1 && <section><h1>Make room for your world.</h1><p>Start with a name and a color. Add more Workspaces whenever you need a fresh context.</p><Input label="Workspace name" value={name} onChange={setName} maxLength={80} disabled={busy} /><div className="zen-overlay-setting"><span>Workspace color</span><ThemeColorPicker value={space?.color ?? SPACE_COLORS[0]} options={options} disabled={busy || !space} onChange={(color) => space && run("Setting your color", () => checkedInvoke(invoke, ARC_IPC.updateSpace, { id: space.id, patch: { color } }))} /></div><label className="zen-overlay-setting"><span>Glass tint</span><input aria-label="Glass tint" type="range" min={0} max={100} defaultValue={ui.preferences.glassTint} onChange={(event) => document.documentElement.style.setProperty("--zen-glass-tint-amount", `${event.target.value}%`)} onPointerUp={(event) => run("Saving glass tint", () => checkedInvoke(invoke, CHROME_IPC.preferences, { glassTint: event.currentTarget.valueAsNumber }))} onKeyUp={(event) => { const glassTint = event.currentTarget.valueAsNumber; run("Saving glass tint", () => checkedInvoke(invoke, CHROME_IPC.preferences, { glassTint })); }} disabled={busy} /></label></section>}

    {step === 2 && <section><h1>Keep the agent on your side.</h1><p>Chat beside the page while you browse. Agents use a task-owned tab in this window, without taking over your screen.</p><label className="zen-onboarding-choice"><MessageCircle size={20} /><span><strong>Enable agent features</strong><small>Optional. A configured provider or paired host is still required.</small></span><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={(event) => setAgentEnabled(event.target.checked)} /></label><div className="zen-onboarding-token"><Input label="Service token" type="password" autoComplete="off" placeholder={native?.onboarding.serviceTokenConfigured ? "Stored securely · enter a new token to replace it" : "Paste a service token"} value={serviceToken} onChange={setServiceToken} disabled={busy || !native?.onboarding.secureTokenStorageAvailable} leftIcon={<KeyRound size={15} />} /><p className="zen-overlay-help"><LockKeyhole size={13} /> {native?.onboarding.secureTokenStorageAvailable ? "Saved only through macOS safeStorage; the token is never returned to the renderer." : "Secure token storage is unavailable in this environment."}</p></div><div className="zen-onboarding-note"><ShieldCheck size={20} /><p>1Password remains the credential authority. Agents request a scoped fill and TOTP acknowledgement; they never receive passwords or one-time codes.</p></div><SurfaceButton icon={ExternalLink} onClick={() => run("Opening 1Password setup", () => checkedInvoke(invoke, ARC_IPC.newTab, { spaceId: state.activeSpaceId, url: "https://support.1password.com/additional-browsers/" }))}>1Password setup instructions</SurfaceButton></section>}

    {step === 3 && <section><h1>Import your Chrome settings.</h1><p>Choose the profiles to turn into isolated Zenmium Spaces. One click brings over bookmarks, supported extensions, available cookies, and saved passwords.</p><div className="zen-onboarding-note"><ShieldCheck size={20} /><p>Credential migration runs only in the main process. Cookies go to the selected Workspace session and passwords go into encrypted Workspace storage; app-bound Chrome data is reported as protected instead of being guessed at.</p></div><ChromeImportPicker profiles={profiles} imports={native?.onboarding.chromeImports ?? []} selected={selectedChrome} setSelected={setSelectedChrome} disabled={busy} busy={!!action.busy} disableImported showImportButton={false} onRefresh={() => { scanned.current = true; void action.run("Refreshing Chrome profiles", async () => { await checkedInvoke(invoke, NATIVE_IPC.onboarding, { action: "scan-chrome" }); await refresh(); }); }} onImport={next} /></section>}

    {step === 4 && <section><h1>Your next page starts here.</h1><p>Web links can open in Zenmium, using your current Workspace. macOS always leaves that choice with you.</p><SurfaceButton variant="primary" disabled={busy || !!isDefault || !native?.defaultBrowser.packaged} icon={isDefault ? Check : ExternalLink} onClick={() => run("Setting your default browser", async () => { await checkedInvoke(invoke, NATIVE_IPC.utility, { action: "set-default-browser" }); await refresh(); })}>{isDefault ? "Zenmium is your default" : "Make Zenmium the default"}</SurfaceButton>{!native?.defaultBrowser.packaged && <p className="zen-overlay-help">Default-browser setup is available from the installed Zenmium app.</p>}<div className="zen-onboarding-note"><p>⌘L for an address · ⌘T for a new tab · ⌘K for commands. Hover the window gutter to reveal a hidden sidebar.</p></div></section>}

    <ActionStatus busy={action.busy ?? (!native && !error ? "Loading browser setup" : null)} error={action.error ?? error} />
    <footer className="zen-onboarding-footer">{step > 0 ? <SurfaceButton icon={ArrowLeft} disabled={busy} onClick={() => setStep(step - 1)}>Back</SurfaceButton> : <SurfaceButton disabled={busy} onClick={finish}>Use defaults</SurfaceButton>}<SurfaceButton variant="primary" disabled={busy || (step === 1 && !name.trim()) || (step === 3 && !!action.busy)} icon={step === 4 ? Check : ArrowRight} onClick={step === 4 ? finish : next}>{step === 4 ? "Start browsing" : step === 3 ? (selectedChrome.length ? `Import ${selectedChrome.length}` : "Skip import") : "Continue"}</SurfaceButton></footer>
  </div>;
}
