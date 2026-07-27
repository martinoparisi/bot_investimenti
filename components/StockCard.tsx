import Link from "next/link";

import type { RankedStock } from "@/lib/analysis";
import { formatPercent, formatPrice, signClass } from "@/lib/format";
import { ConfidenceDots, ProbabilityBar, VerdictBadge } from "./Indicators";
import { Sparkline } from "./Sparkline";

/** Riga compatta usata in Top/Sub, Mercati seguiti e colonne di consiglio. */
export function StockRow({
  stock,
  rank,
  showVerdict = false,
  signalValue,
  action,
}: {
  stock: RankedStock;
  rank?: number;
  showVerdict?: boolean;
  /** Percentuale da evidenziare (buy/sell/keep) nelle colonne di consiglio. */
  signalValue?: number;
  action?: React.ReactNode;
}) {
  return (
    // Su mobile la riga va a capo: nome e barra prendono tutta la larghezza,
    // prezzo e probabilità scendono sotto invece di schiacciarsi.
    <div className="card card-hover group relative flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap">
      {rank !== undefined && (
        <span className="tabular w-5 shrink-0 text-center text-xs text-base-400">{rank}</span>
      )}

      <Link
        href={`/titolo/${encodeURIComponent(stock.symbol)}`}
        className="min-w-0 flex-1 basis-[70%] sm:basis-auto"
      >
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-base-100">{stock.symbol}</span>
          {showVerdict && <VerdictBadge verdict={stock.verdict} />}
        </div>
        <div className="truncate text-xs text-base-400">{stock.name}</div>
        <div className="mt-1.5 sm:max-w-[220px]">
          <ProbabilityBar pUp={stock.pUp} showLabels={false} height="h-1.5" />
        </div>
      </Link>

      <Sparkline values={stock.sparkline} className="hidden shrink-0 sm:block" />

      <div className="ml-auto w-24 shrink-0 text-right">
        <div className="tabular text-sm font-semibold">
          {formatPrice(stock.price, stock.currency)}
        </div>
        <div className={`tabular text-xs ${signClass(stock.changePercent)}`}>
          {formatPercent(stock.changePercent, 2, true)}
        </div>
      </div>

      <div className="w-20 shrink-0 text-right">
        <div className="tabular text-sm font-semibold text-rise-500">
          {formatPercent(signalValue ?? stock.pUp * 100, 1)}
        </div>
        <div className="mt-1 flex justify-end">
          <ConfidenceDots confidence={stock.confidence} />
        </div>
      </div>

      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-base-100">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-base-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-base-700 px-4 py-8 text-center text-sm text-base-400">
      {message}
    </div>
  );
}

export function RowSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton h-[68px] w-full" />
      ))}
    </div>
  );
}
