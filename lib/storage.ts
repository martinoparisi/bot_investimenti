"use client";

/**
 * Persistenza lato browser: watchlist e portafoglio vivono in `localStorage`.
 * Nessun account, nessun dato che lascia il dispositivo. Il rovescio della
 * medaglia è che i dati sono legati a browser e dispositivo: per questo la
 * pagina "Il mio conto" espone esportazione e importazione JSON.
 */

const WATCHLIST_KEY = "bi.watchlist.v1";
const PORTFOLIO_KEY = "bi.portfolio.v1";

export interface WatchItem {
  symbol: string;
  name: string;
  addedAt: number;
}

export interface Position {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  /** Prezzo di carico per azione, nella valuta del titolo. */
  buyPrice: number;
  buyDate: string; // ISO yyyy-mm-dd
  fees: number;
  currency: string;
  notes?: string;
  /** Vendita registrata: rende la posizione chiusa e la plusvalenza realizzata. */
  soldPrice?: number;
  soldDate?: string;
  soldQuantity?: number;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Le pagine aperte nello stesso tab non ricevono l'evento `storage`.
    window.dispatchEvent(new CustomEvent("bi:storage", { detail: { key } }));
  } catch (error) {
    console.warn("Salvataggio locale fallito:", (error as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export function getWatchlist(): WatchItem[] {
  return read<WatchItem[]>(WATCHLIST_KEY, []);
}

export function isWatched(symbol: string): boolean {
  return getWatchlist().some((w) => w.symbol === symbol);
}

export function toggleWatch(symbol: string, name: string): boolean {
  const list = getWatchlist();
  const exists = list.some((w) => w.symbol === symbol);
  const next = exists
    ? list.filter((w) => w.symbol !== symbol)
    : [...list, { symbol, name, addedAt: Date.now() }];
  write(WATCHLIST_KEY, next);
  return !exists;
}

export function removeWatch(symbol: string): void {
  write(WATCHLIST_KEY, getWatchlist().filter((w) => w.symbol !== symbol));
}

// ---------------------------------------------------------------------------
// Portafoglio
// ---------------------------------------------------------------------------

export function getPositions(): Position[] {
  return read<Position[]>(PORTFOLIO_KEY, []);
}

export function savePositions(positions: Position[]): void {
  write(PORTFOLIO_KEY, positions);
}

export function addPosition(position: Omit<Position, "id">): Position {
  const created: Position = { ...position, id: crypto.randomUUID() };
  savePositions([...getPositions(), created]);
  return created;
}

export function updatePosition(id: string, patch: Partial<Position>): void {
  savePositions(getPositions().map((p) => (p.id === id ? { ...p, ...patch } : p)));
}

export function removePosition(id: string): void {
  savePositions(getPositions().filter((p) => p.id !== id));
}

export function exportData(): string {
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), watchlist: getWatchlist(), positions: getPositions() },
    null,
    2,
  );
}

/** Importa un backup. Restituisce un messaggio di esito da mostrare all'utente. */
export function importData(json: string): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(json) as { watchlist?: WatchItem[]; positions?: Position[] };
    if (!parsed || (!parsed.watchlist && !parsed.positions)) {
      return { ok: false, message: "File non riconosciuto: nessun dato da importare." };
    }
    if (Array.isArray(parsed.watchlist)) write(WATCHLIST_KEY, parsed.watchlist);
    if (Array.isArray(parsed.positions)) {
      // Gli id vengono rigenerati se mancanti, altrimenti l'interfaccia
      // avrebbe chiavi duplicate.
      write(
        PORTFOLIO_KEY,
        parsed.positions.map((p) => ({ ...p, id: p.id || crypto.randomUUID() })),
      );
    }
    return {
      ok: true,
      message: `Importati ${parsed.positions?.length ?? 0} movimenti e ${parsed.watchlist?.length ?? 0} titoli seguiti.`,
    };
  } catch {
    return { ok: false, message: "JSON non valido." };
  }
}

/** Si sottoscrive ai cambiamenti (stesso tab e altri tab). */
export function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => callback();
  window.addEventListener("bi:storage", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("bi:storage", handler);
    window.removeEventListener("storage", handler);
  };
}
