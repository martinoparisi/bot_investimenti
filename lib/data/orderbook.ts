/**
 * Portafoglio ordini (book).
 *
 * ONESTÀ SUI DATI: nessuna fonte gratuita espone la profondità del book di
 * Borsa Italiana o del LSE. Quello che si ottiene è al massimo il primo livello
 * (best bid / best ask), e spesso senza i volumi.
 *
 * Qui viene esposto SOLO ciò che l'API restituisce davvero. I campi mancanti
 * valgono `null` e la UI li mostra come "n/d". Non viene stimato, interpolato o
 * simulato nulla: un book inventato sembrerebbe vero e porterebbe a decisioni
 * sbagliate.
 */

import type { QuoteData } from "./yahoo";

export interface OrderBookLevel {
  bidVolume: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  askVolume: number | null;
}

export interface OrderBook {
  symbol: string;
  currency: string | null;
  levels: OrderBookLevel[];
  /** Spread assoluto e in percentuale sul prezzo medio. */
  spread: number | null;
  spreadPercent: number | null;
  source: string;
  /** Motivo per cui i dati sono parziali o assenti. */
  note: string;
  hasData: boolean;
}

const NOTE_NO_DEPTH =
  "Nessuna fonte gratuita fornisce la profondità del book oltre il primo livello: i livelli successivi restano non disponibili.";
const NOTE_NO_SIZES =
  "Prezzi denaro/lettera disponibili, volumi non forniti dalla fonte gratuita.";
const NOTE_NONE =
  "La fonte gratuita non espone denaro/lettera per questo strumento (tipico di indici e titoli non USA fuori orario).";

export function buildOrderBook(quote: QuoteData | null): OrderBook {
  if (!quote) {
    return {
      symbol: "",
      currency: null,
      levels: [],
      spread: null,
      spreadPercent: null,
      source: "Yahoo Finance",
      note: NOTE_NONE,
      hasData: false,
    };
  }

  const bidPrice = quote.bid && quote.bid > 0 ? quote.bid : null;
  const askPrice = quote.ask && quote.ask > 0 ? quote.ask : null;
  // Yahoo restituisce 0 quando il volume non è disponibile, non quando è zero.
  const bidVolume = quote.bidSize && quote.bidSize > 0 ? quote.bidSize : null;
  const askVolume = quote.askSize && quote.askSize > 0 ? quote.askSize : null;

  const hasData = bidPrice !== null || askPrice !== null;
  const spread = bidPrice !== null && askPrice !== null ? askPrice - bidPrice : null;
  const mid = bidPrice !== null && askPrice !== null ? (askPrice + bidPrice) / 2 : null;

  let note = NOTE_NONE;
  if (hasData) note = bidVolume === null && askVolume === null ? NOTE_NO_SIZES : NOTE_NO_DEPTH;

  return {
    symbol: quote.symbol,
    currency: quote.currency,
    levels: hasData ? [{ bidVolume, bidPrice, askPrice, askVolume }] : [],
    spread,
    spreadPercent: spread !== null && mid ? (spread / mid) * 100 : null,
    source: "Yahoo Finance (livello 1)",
    note,
    hasData,
  };
}
