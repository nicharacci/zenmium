import { CHROME_IPC } from "@shared/browser-ui";
import { NATIVE_IPC } from "@shared/browser-native";
import { ARC_IPC, SPACE_COLORS } from "@shared/ipc";
import { ArrowLeft, ArrowRight, Check, ExternalLink, MessageCircle, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Input } from "../motion/input";
import { useNativeBrowserState } from "./BrowserNativePanels";
import { ActionStatus, checkedInvoke, SurfaceButton, type UtilityProps, useSurfaceAction } from "./SurfacePrimitives";
import { ThemeColorPicker } from "./ThemeColorPicker";

const logo = new URL("../../../../../docs/zenmium/brand/zenmium-canonical.png", import.meta.url).href;

export function GoalpostOnboarding({ state, ui, invoke, close }: UtilityProps) {
  const {native, error, refresh} = useNativeBrowserState(invoke, state.activeSpaceId);
  const action = useSurfaceAction();
  const space = state.spaces.find((item) => item.id === state.activeSpaceId);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(space?.name ?? "Workspace 1");
  const [agentEnabled, setAgentEnabled] = useState<boolean | null>(null);
  const enabled = agentEnabled ?? native?.onboarding.agentEnabled ?? false;
  const isDefault = native?.defaultBrowser.http && native.defaultBrowser.https;
  const busy = !native || !!action.busy;
  const options = SPACE_COLORS.map((color, index) => ({color, label: ["Goalpost mint", "Sky", "Rose", "Amber", "Lilac", "Lagoon", "Coral"][index] ?? `Color ${index + 1}`}));
  const run = (label: string, task: () => Promise<unknown>, success?: () => void) => void action.run(label, task, success);
  const next = () => {
    if (step === 1 && space) run("Saving your Workspace", () => checkedInvoke(invoke, ARC_IPC.updateSpace, {id: space.id, patch: {name: name.trim() || "Workspace 1"}}), () => setStep(2));
    else setStep((current) => current + 1);
  };
  const finish = () => run("Finishing setup", () => checkedInvoke(invoke, NATIVE_IPC.onboarding, {action: "complete", agentEnabled: enabled}), close);
  return <div className="zen-onboarding">
    <div className="zen-onboarding-brand"><img src={logo} alt="Zenmium" width={76} height={76}/><span>ZENMIUM <small>by Goalpost</small></span></div>
    <ol className="zen-onboarding-steps" aria-label="Setup progress">{["Welcome", "Your space", "Your control", "Ready"].map((label, index) => <li aria-current={step === index ? "step" : undefined} key={label}>{index < step ? <Check size={12}/> : <span>{index + 1}</span>}{label}</li>)}</ol>
    {step === 0 && <section><h1>A little space.<br/>A lot of possibility.</h1><p>A browser that keeps the web in focus. Your pages sit above a quiet glass frame, with useful tools close at hand.</p><div className="zen-onboarding-note"><ShieldCheck size={20}/><p>Each Workspace has its own browser profile. Work and personal accounts stay separate.</p></div></section>}
    {step === 1 && <section><h1>Make room for your world.</h1><p>Start with a name and a color. Add more Workspaces whenever you need a fresh context.</p><Input label="Workspace name" value={name} onChange={setName} maxLength={80} disabled={busy}/><div className="zen-overlay-setting"><span>Workspace color</span><ThemeColorPicker value={space?.color ?? SPACE_COLORS[0]} options={options} disabled={busy || !space} onChange={(color) => space && run("Setting your color", () => checkedInvoke(invoke, ARC_IPC.updateSpace, {id: space.id, patch: {color}}))}/></div><label className="zen-overlay-setting"><span>Glass tint</span><input aria-label="Glass tint" type="range" min={0} max={100} defaultValue={ui.preferences.glassTint} onChange={(event) => document.documentElement.style.setProperty("--zen-glass-tint-amount", `${event.target.value}%`)} onPointerUp={(event) => run("Saving glass tint", () => checkedInvoke(invoke, CHROME_IPC.preferences, {glassTint: event.currentTarget.valueAsNumber}))} onKeyUp={(event) => { const glassTint = event.currentTarget.valueAsNumber; run("Saving glass tint", () => checkedInvoke(invoke, CHROME_IPC.preferences, {glassTint})); }} disabled={busy}/></label></section>}
    {step === 2 && <section><h1>Help when you want it.<br/>Control when you need it.</h1><p>Chat beside the page while you browse. Agents use a task-owned tab in this window, without taking over your screen.</p><label className="zen-onboarding-choice"><MessageCircle size={20}/><span><strong>Enable agent features</strong><small>Optional. A configured provider or paired host is still required.</small></span><input type="checkbox" role="switch" checked={enabled} disabled={busy} onChange={(event) => setAgentEnabled(event.target.checked)}/></label><p className="zen-overlay-help">You decide which Workspace and tabs an agent may use. Take over or stop a session at any time. Pairing never happens automatically.</p><div className="zen-onboarding-note"><ShieldCheck size={20}/><p>Use 1Password’s browser extension for logins and one-time codes. Its own unlock and permission checks still apply.</p></div><SurfaceButton icon={ExternalLink} onClick={() => run("Opening 1Password setup", () => checkedInvoke(invoke, ARC_IPC.newTab, {spaceId: state.activeSpaceId, url: "https://support.1password.com/additional-browsers/"}))}>1Password setup instructions</SurfaceButton><p className="zen-overlay-help">Setup instructions are not a connection check. Availability is reported by the native authentication service.</p></section>}
    {step === 3 && <section><h1>Your next page starts here.</h1><p>Web links can open in Zenmium, using your current Workspace. macOS always leaves that choice with you.</p><SurfaceButton variant="primary" disabled={busy || !!isDefault || !native?.defaultBrowser.packaged} icon={isDefault ? Check : ExternalLink} onClick={() => run("Setting your default browser", async () => { await checkedInvoke(invoke, NATIVE_IPC.utility, {action: "set-default-browser"}); await refresh(); })}>{isDefault ? "Zenmium is your default" : "Make Zenmium the default"}</SurfaceButton>{!native?.defaultBrowser.packaged && <p className="zen-overlay-help">Default-browser setup is available from the installed Zenmium app.</p>}<div className="zen-onboarding-note"><p>⌘L for an address · ⌘T for a new tab · ⌘K for commands. Hover the window gutter to reveal a hidden sidebar.</p></div></section>}
    <ActionStatus busy={action.busy ?? (!native && !error ? "Loading browser setup" : null)} error={action.error ?? error}/>
    <footer className="zen-onboarding-footer">{step > 0 ? <SurfaceButton icon={ArrowLeft} disabled={busy} onClick={() => setStep(step - 1)}>Back</SurfaceButton> : <SurfaceButton disabled={busy} onClick={finish}>Use defaults</SurfaceButton>}<SurfaceButton variant="primary" disabled={busy || (step === 1 && !name.trim())} icon={step === 3 ? Check : ArrowRight} onClick={step === 3 ? finish : next}>{step === 3 ? "Start browsing" : "Continue"}</SurfaceButton></footer>
  </div>;
}
