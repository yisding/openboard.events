"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

type AuthPasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  autoComplete: "current-password" | "new-password";
  minLength: number;
  hint?: string;
  disabled?: boolean;
};

export function AuthPasswordField({
  id,
  name,
  label,
  autoComplete,
  minLength,
  hint,
  disabled = false,
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const hintId = hint ? `${id}-help` : undefined;
  const fieldName = label.toLowerCase();

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <div className="auth-password-input">
      <input
        id={id}
        name={name}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        disabled={disabled}
        type={visible ? "text" : "password"}
        aria-describedby={hintId}
      />
      <button
        type="button"
        className="auth-password-toggle"
        disabled={disabled}
        aria-controls={id}
        aria-label={`${visible ? "Hide" : "Show"} ${fieldName}`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >{visible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}</button>
    </div>
    {hint && <small id={hintId}>{hint}</small>}
  </div>;
}
