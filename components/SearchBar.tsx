"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Hit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        const json = (await res.json()) as { results?: Hit[] };
        setHits(json.results ?? []);
        setHighlight(0);
        setOpen(true);
      } catch {
        // richiesta annullata dalla digitazione successiva: nessun errore da mostrare
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const go = (symbol: string) => {
    setOpen(false);
    setQuery("");
    router.push(`/titolo/${encodeURIComponent(symbol)}`);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open || hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((h) => (h + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => (h - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(hits[highlight].symbol);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full md:max-w-xl">
      <div className="flex items-center gap-2 rounded-xl border border-base-700 bg-base-900/80 px-3 py-2 focus-within:border-accent-500/60">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-base-400" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Cerca azione, indice o ISIN (es. Intesa, AAPL, IT0000072618)"
          // text-base su mobile: sotto i 16px iOS zooma sul focus.
          className="w-full bg-transparent text-base text-base-100 outline-none placeholder:text-base-400 sm:text-sm"
          aria-label="Cerca un titolo"
        />
        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-base-600 border-t-accent-400" />}
      </div>

      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-96 overflow-y-auto rounded-xl border border-base-700 bg-base-900 py-1 shadow-2xl shadow-black/60">
          {hits.map((hit, i) => (
            <li key={`${hit.symbol}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => go(hit.symbol)}
                className={`flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5 text-left sm:flex-nowrap sm:py-2 ${
                  i === highlight ? "bg-base-800" : ""
                }`}
              >
                <span className="tabular w-24 shrink-0 truncate text-sm font-semibold text-accent-400">
                  {hit.symbol}
                </span>
                <span className="min-w-0 flex-1 basis-full truncate text-sm text-base-100 sm:basis-auto">
                  {hit.name}
                </span>
                <span className="shrink-0 text-xs text-base-400">
                  {hit.exchange} · {hit.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.trim().length >= 2 && hits.length === 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-base-700 bg-base-900 px-3 py-3 text-sm text-base-400">
          Nessun risultato per “{query.trim()}”.
        </div>
      )}
    </div>
  );
}
