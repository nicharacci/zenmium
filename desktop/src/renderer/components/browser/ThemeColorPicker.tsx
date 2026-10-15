import { Check, ChevronDown } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";

/** The Workspace palette uses the same gradient rows as the Workspace menu. */
export function ThemeColorPicker({ value, options, disabled, onChange }: {
  value: string; options: { color: string; label: string }[]; disabled?: boolean; onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const selected = options.find((option) => option.color === value);
  useEffect(() => {
    if (!open) return;
    const first = root.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ?? root.current?.querySelector<HTMLButtonElement>('[role="option"]');
    first?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div className="zen-color-picker" data-escape-boundary={open ? "true" : undefined} ref={root} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (!open && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); return; }
    if (open && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }}>
    <button ref={trigger} aria-label="Theme color" aria-controls={id} aria-haspopup="listbox" aria-expanded={open} className="zen-color-select" disabled={disabled} type="button" onClick={() => setOpen(!open)} style={{"--zen-space-color": value} as CSSProperties}>
      <span>{selected?.label ?? "Custom color"}</span><ChevronDown aria-hidden="true" size={14}/>
    </button>
    {open && <div id={id} role="listbox" aria-label="Theme colors" className="zen-color-menu">{options.map((option) => <button key={option.color} role="option" type="button" aria-selected={option.color === value} className="zen-color-option" disabled={disabled} tabIndex={option.color === value ? 0 : -1} style={{"--zen-space-color": option.color} as CSSProperties} onClick={() => { onChange(option.color); setOpen(false); trigger.current?.focus(); }}><span>{option.label}</span>{option.color === value && <Check aria-hidden="true" size={14}/>}</button>)}</div>}
  </div>;
}
