"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function Button({ variant = "primary", size = "md", type = "button", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  return <button type={type} className={cn("button", `button-${variant}`, size === "sm" && "button-sm", size === "lg" && "button-lg", className)} {...props} />;
}

export function Switch({ checked, label, className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-checked" | "aria-label" | "role" | "type"> & { checked: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={cn("switch", checked && "on", className)} {...props}><i /></button>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
  return <span className={`status-badge status-${normalized}`}><i />{value.replaceAll("_", " ")}</span>;
}

export function Avatar({ initials, color = "#007454", size = "md", imageUrl }: { initials: string; color?: string | undefined; size?: "sm" | "md" | "lg" | "xl"; imageUrl?: string | undefined }) {
  const style = imageUrl
    ? { backgroundImage: `url(${imageUrl})`, backgroundPosition: "center", backgroundSize: "cover" }
    : { background: color };
  return <span className={`person-avatar person-avatar-${size}`} style={style}>{imageUrl ? null : initials}</span>;
}

export function ProgressBar({ value, tone = "accent" }: { value: number; tone?: "accent" | "green" | "amber" }) {
  return <div className={`progress-track progress-${tone}`}><i style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="page-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

// Native <dialog> provides focus trapping, Escape-to-close, and focus restore.
function ModalDialog({ onClose, title, className, children }: { onClose: () => void; title: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="modal-shell" aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={className}>{children}</section>
  </dialog>;
}

export function Modal({ open, onClose, title, description, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <ModalDialog onClose={onClose} title={title} className={cn("modal", wide && "modal-wide")}><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button></header><div className="modal-body">{children}</div>{footer && <footer>{footer}</footer>}</ModalDialog>;
}

function DrawerDialog({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="drawer-shell"
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}
    >
      {children}
    </dialog>
  );
}

/**
 * `headerExtra` (M57) sits between the title and the close button — the
 * flow-through drawers' `<FlowNavControls>` "3 of 24" + prev/next live here,
 * so the keyboard shortcut has a visible, clickable equivalent without every
 * caller reimplementing the title row.
 */
export function Drawer({ open, onClose, children, title, headerExtra }: { open: boolean; onClose: () => void; children: ReactNode; title: string; headerExtra?: ReactNode }) {
  if (!open) return null;
  return <DrawerDialog onClose={onClose} title={title}><aside className="drawer"><div className="drawer-title"><h2>{title}</h2>{headerExtra}<button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>{children}</aside></DrawerDialog>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

/**
 * `error` is the server's message for this one input. It replaces the hint so
 * the two never argue, and is announced with `role="alert"` because it appears
 * after the field has already been left.
 */
// `children` is optional so the component can be constructed through
// `createElement(Field, props, child)` — the form the repo's render tests use,
// and the only one `react/no-children-prop` allows. A required `children` in the
// prop type makes that call fail to typecheck, because `createElement` does not
// fold its rest arguments into the props type.
export function Field({ label, hint, hintId, required, error, errorId, group, radioGroup, children }: { label: string; hint?: string; hintId?: string; required?: boolean; error?: string | undefined; errorId?: string; group?: boolean; radioGroup?: boolean; children?: ReactNode }) {
  const inner = <>
    <span>{label}{required && <b className="required"> *</b>}</span>
    {children}
    {error ? <small id={errorId} className="field-error" role="alert">{error}</small> : hint && <small id={hintId}>{hint}</small>}
  </>;
  // `group` for the fields whose control is a *set* of buttons rather than one
  // input. `<button>` is a labelable element, so a `<label>` wrapping a choice
  // grid labels its first button — and the accessible name HTML-AAM computes is
  // the label's whole text content minus that button's own, i.e. every *other*
  // option's text. The first choice ends up named after the ones beside it and
  // no choice can be found by its own name. A named group leaves each button
  // named by its own content, which is what a screen reader and a role-based
  // query both need. Same class name, so the styling is untouched.
  return group
    ? <div role={radioGroup ? "radiogroup" : "group"} aria-label={label} aria-invalid={radioGroup && error ? true : undefined} aria-describedby={error ? errorId : undefined} tabIndex={error ? -1 : undefined} className={error ? "field field-invalid" : "field"}>{inner}</div>
    : <label className={error ? "field field-invalid" : "field"}>{inner}</label>;
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (value: T) => void; items: Array<{ value: T; label: string }> }) {
  return <div className="segmented">{items.map((item) => <button key={item.value} type="button" aria-pressed={value === item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
