import type { SalesDateRange } from "./types";

export type SalesDateFilterProps = {
  from: string;
  to: string;
  appliedRange: SalesDateRange | null;
  canApply: boolean;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onApply: () => void;
};

export function SalesDateFilter({
  from,
  to,
  appliedRange,
  canApply,
  onFromChange,
  onToChange,
  onApply,
}: SalesDateFilterProps) {
  return (
    <div className="sales-date-range">
      <label>
        <span>От</span>
        <input
          type="date"
          value={from}
          onChange={(event) => onFromChange(event.target.value)}
        />
      </label>
      <label>
        <span>До</span>
        <input
          type="date"
          min={from || undefined}
          value={to}
          onChange={(event) => onToChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        className={appliedRange ? "active" : ""}
        disabled={!canApply}
        onClick={onApply}
      >
        Применить
      </button>
    </div>
  );
}
