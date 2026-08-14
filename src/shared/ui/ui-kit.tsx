"use client";

import { UserRound, X } from "lucide-react";
import Image from "next/image";
import React, { useEffect, useRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode, type RefObject, type SelectHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";
import { STATUS_BADGES, type StatusBadgeValue } from "@/shared/ui/status-badge";

export function Button({ variant = "primary", size = "md", type = "button", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  return <button type={type} className={cn("button", `button-${variant}`, size === "sm" && "button-sm", size === "lg" && "button-lg", className)} {...props} />;
}

export function Switch({ checked, label, className, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-checked" | "aria-label" | "role" | "type"> & { checked: boolean; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={cn("switch", checked && "on", className)} {...props}><i /></button>;
}

/**
 * The kit's dropdown. It *is* a native `<select>` — deliberately, because the
 * native element brings keyboard type-ahead, `Esc` to close, and the platform's
 * own picker on touch devices, and a hand-rolled listbox has to re-earn all
 * three. What the kit adds is the chrome: `.select-control` turns off the OS
 * arrow and draws the kit's chevron, so a dropdown stops being the one control
 * on the page that the operating system designed.
 *
 * Nothing is wrapped around the element. Several rules in the stylesheet reach
 * a select as a *direct child* (`.field-invalid > select`, `.sessions-filters >
 * select`), so a wrapper would silently drop their styling at 75 call sites.
 *
 * `<select multiple>` keeps native rendering: an always-open listbox has no
 * closed state to put a chevron on.
 *
 * Long or searchable option lists (speaker pickers, track selectors on large
 * events) still want a filterable listbox with type-ahead. That is a second
 * primitive, not a change to this one — see #115.
 */
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("select-control", className)} {...props} />;
}

export function StatusBadge({ value }: { value: StatusBadgeValue }) {
  const badge = STATUS_BADGES[value];
  return <span className={`status-badge status-tone-${badge.tone}`} data-status={value}><i aria-hidden="true" />{badge.label}</span>;
}

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const AVATAR_SIZE_PX: Record<AvatarSize, number> = { sm: 27, md: 34, lg: 44, xl: 72 };

export function Avatar({
  initials,
  color = "var(--accent-dark)",
  size = "md",
  imageUrl,
  imageAlt = "",
  onImageError,
}: {
  initials: string;
  color?: string | undefined;
  size?: AvatarSize;
  imageUrl?: string | undefined;
  imageAlt?: string;
  onImageError?: () => void;
}) {
  const label = initials.trim().slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden={imageUrl && imageAlt ? undefined : "true"}
      className={`person-avatar person-avatar-${size} ${imageUrl ? "person-avatar-image" : "person-avatar-placeholder"}`}
      style={imageUrl ? undefined : { "--avatar-accent": color } as CSSProperties}
    >
      {imageUrl
        ? <Image src={imageUrl} alt={imageAlt} width={AVATAR_SIZE_PX[size]} height={AVATAR_SIZE_PX[size]} unoptimized onError={onImageError} />
        : label || <UserRound className="person-avatar-icon" />}
    </span>
  );
}

export function ProgressBar({ value, label, tone = "accent" }: { value: number; label: string; tone?: "accent" | "green" | "amber" }) {
  const normalizedValue = Math.max(0, Math.min(value, 100));
  return <div className={`progress-track progress-${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalizedValue}><i style={{ width: `${normalizedValue}%` }} /></div>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow && <div className="page-eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

// Native <dialog> provides focus trapping and, when dismissible, Escape-to-close.
// Because React unmounts the dialog, cleanup restores the opener explicitly.
function ModalDialog({ onClose, title, className, children, initialFocusRef, dismissible }: { onClose: () => void; title: string; className: string; children: ReactNode; initialFocusRef?: RefObject<HTMLElement | null> | undefined; dismissible: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [initialFocusRef]);
  return <dialog ref={ref} className="modal-shell" aria-label={title} onCancel={(event) => { event.preventDefault(); if (dismissible) onClose(); }} onMouseDown={(event) => { if (dismissible && event.currentTarget === event.target) onClose(); }}>
    <section className={className}>{children}</section>
  </dialog>;
}

export function Modal({ open, onClose, title, description, children, footer, wide = false, initialFocusRef, dismissible = true }: { open: boolean; onClose: () => void; title: string; description?: string; children: ReactNode; footer?: ReactNode; wide?: boolean; initialFocusRef?: RefObject<HTMLElement | null> | undefined; dismissible?: boolean }) {
  if (!open) return null;
  return <ModalDialog onClose={onClose} title={title} className={cn("modal", wide && "modal-wide")} initialFocusRef={initialFocusRef} dismissible={dismissible}><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{dismissible && <button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={18} /></button>}</header><div className="modal-body">{children}</div>{footer && <footer>{footer}</footer>}</ModalDialog>;
}

function DrawerDialog({ onClose, title, children }: { onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus();
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
export function Drawer({ open, onClose, children, title, headerExtra, compact = false }: { open: boolean; onClose: () => void; children: ReactNode; title: string; headerExtra?: ReactNode; compact?: boolean }) {
  if (!open) return null;
  return <DrawerDialog onClose={onClose} title={title}><aside className={cn("drawer", compact && "drawer-compact")}><div className="drawer-title"><h2>{title}</h2>{headerExtra}<button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>{children}</aside></DrawerDialog>;
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

export function Segmented<T extends string>({ label, value, onChange, items }: { label: string; value: T; onChange: (value: T) => void; items: Array<{ value: T; label: string }> }) {
  return <div className="segmented" role="group" aria-label={label}>{items.map((item) => <button key={item.value} type="button" aria-pressed={value === item.value} className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
