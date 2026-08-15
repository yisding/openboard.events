import { statusBadgeLabel, type StatusBadgeValue } from "@/shared/ui/status-badge";

/** The options are narrowed to the badge vocabulary so a button reads the same
 * words as the badge for the same state — "Awaiting confirmation", not
 * "unconfirmed" — and adding a status without authoring its label is a type
 * error at the call site rather than a lowercase enum on screen. */
export function SpeakerStatusOptions<T extends StatusBadgeValue>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  options: readonly T[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div className="confirmation-options" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          aria-pressed={value === option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {statusBadgeLabel(option)}
        </button>
      ))}
    </div>
  );
}
