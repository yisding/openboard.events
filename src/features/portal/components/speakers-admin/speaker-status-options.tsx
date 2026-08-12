export function SpeakerStatusOptions<T extends string>({
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
          {option.replaceAll("_", " ")}
        </button>
      ))}
    </div>
  );
}
