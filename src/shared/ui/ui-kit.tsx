"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/shared/lib/cn";

export function Button({ variant = "primary", size = "md", type = "button", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  return <button type={type} className={cn("button", `button-${variant}`, size === "sm" && "button-sm", size === "lg" && "button-lg", className)} {...props} />;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
  return <span className={`status-badge status-${normalized}`}><i />{value.replaceAll("_", " ")}</span>;
}

export function Avatar({ initials, color = "#6958d7", size = "md" }: { initials: string; color?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  return <span className={`person-avatar person-avatar-${size}`} style={{ background: color }}>{initials}</span>;
}

export function ProgressBar({ value, tone = "purple" }: { value: number; tone?: "purple" | "green" | "amber" }) {
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

export function Drawer({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title: string }) {
  if (!open) return null;
  return <div className="drawer-layer"><button type="button" className="drawer-backdrop" aria-label="Close" onClick={onClose} /><aside className="drawer"><div className="drawer-title"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close" onClick={onClose}><X size={19} /></button></div>{children}</aside></div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span>{label}{required && <b className="required"> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (value: T) => void; items: Array<{ value: T; label: string }> }) {
  return <div className="segmented">{items.map((item) => <button key={item.value} type="button" className={value === item.value ? "active" : ""} onClick={() => onChange(item.value)}>{item.label}</button>)}</div>;
}
