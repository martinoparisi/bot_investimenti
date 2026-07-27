"use client";

import { PERIODS, PERIOD_IDS, type PeriodId } from "@/lib/analytics/periods";
import { INDEXES, INDEX_IDS, type IndexId } from "@/lib/data/universe";

interface PeriodSelectorProps {
  value: PeriodId;
  onChange: (value: PeriodId) => void;
  compact?: boolean;
}

export function PeriodSelector({ value, onChange, compact = false }: PeriodSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-base-700 bg-base-900/60 p-1">
      {PERIOD_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          title={`Analizza gli ultimi ${PERIODS[id].label.toLowerCase()} e stima i prossimi`}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:px-2.5 sm:py-1 ${
            value === id
              ? "bg-accent-500 text-white"
              : "text-base-300 hover:bg-base-800 hover:text-base-100"
          }`}
        >
          {compact ? id.toUpperCase() : PERIODS[id].label}
        </button>
      ))}
    </div>
  );
}

interface IndexSelectorProps {
  value: IndexId | null;
  onChange: (value: IndexId | null) => void;
  allowAll?: boolean;
}

export function IndexSelector({ value, onChange, allowAll = true }: IndexSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl border border-base-700 bg-base-900/60 p-1">
      {allowAll && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:py-1 ${
            value === null
              ? "bg-base-100 text-base-950"
              : "text-base-300 hover:bg-base-800 hover:text-base-100"
          }`}
        >
          Tutti
        </button>
      )}
      {INDEX_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:py-1 ${
            value === id
              ? "bg-base-100 text-base-950"
              : "text-base-300 hover:bg-base-800 hover:text-base-100"
          }`}
        >
          {INDEXES[id].label}
        </button>
      ))}
    </div>
  );
}
