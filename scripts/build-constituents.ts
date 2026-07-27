/**
 * Rigenera `data/constituents/*.json` leggendo le tabelle di Wikipedia.
 *
 * Da lanciare a mano (`npm run constituents`), NON in fase di build: le liste
 * degli indici cambiano poche volte l'anno e non ha senso dipendere da
 * Wikipedia a ogni deploy. I file generati vanno committati.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

interface Constituent {
  symbol: string;
  name: string;
  isin: string | null;
  currency: string;
}

interface Source {
  id: string;
  page: string;
  /** Intestazioni che identificano la tabella giusta (in minuscolo). */
  headerMatch: string[];
  currency: string;
  /** Estrae una riga dalle celle della tabella. */
  parseRow: (cells: string[]) => Constituent | null;
}

const WIKI = "https://en.wikipedia.org/w/api.php";

async function fetchPageHtml(page: string): Promise<string> {
  const url = `${WIKI}?action=parse&page=${page}&prop=text&format=json&formatversion=2`;
  const res = await fetch(url, { headers: { "User-Agent": "bot-investimenti/0.1" } });
  if (!res.ok) throw new Error(`Wikipedia ${page}: HTTP ${res.status}`);
  const json = (await res.json()) as { parse?: { text?: string } };
  const html = json.parse?.text;
  if (!html) throw new Error(`Wikipedia ${page}: risposta senza contenuto`);
  return html;
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#91;\d+&#93;/g, "")
    .replace(/\[\d+\]/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTables(html: string): { headers: string[]; rows: string[][] }[] {
  const tables = html.match(/<table[^>]*>[\s\S]*?<\/table>/g) ?? [];
  return tables.map((table) => {
    const rowsHtml = table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? [];
    const headers = (rowsHtml[0]?.match(/<th[^>]*>[\s\S]*?<\/th>/g) ?? []).map((c) =>
      stripTags(c).toLowerCase(),
    );
    const rows = rowsHtml.slice(1).map((row) =>
      (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) ?? []).map(stripTags),
    );
    return { headers, rows };
  });
}

/** Converte un ticker in punto-notation nel formato Yahoo (BRK.B -> BRK-B). */
function yahooTicker(raw: string, suffix = ""): string {
  return raw.trim().replace(/\./g, "-").toUpperCase() + suffix;
}

const SOURCES: Source[] = [
  {
    id: "ftse-mib",
    page: "FTSE_MIB",
    headerMatch: ["ticker", "company", "isin"],
    currency: "EUR",
    parseRow: (c) => {
      // Il ticker su questa pagina include già il suffisso di borsa (A2A.MI).
      const symbol = c[0]?.toUpperCase();
      if (!symbol || !symbol.endsWith(".MI")) return null;
      return {
        symbol,
        name: c[1] ?? symbol,
        isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(c[2] ?? "") ? c[2] : null,
        currency: "EUR",
      };
    },
  },
  {
    id: "ftse-100",
    page: "FTSE_100_Index",
    headerMatch: ["company", "ticker"],
    currency: "GBp",
    parseRow: (c) => {
      const name = c[0];
      const ticker = c[1];
      if (!name || !ticker || !/^[A-Z0-9.]{2,8}$/i.test(ticker)) return null;
      return { symbol: yahooTicker(ticker, ".L"), name, isin: null, currency: "GBp" };
    },
  },
  {
    id: "nasdaq-100",
    page: "List_of_NASDAQ-100_companies",
    headerMatch: ["ticker", "company"],
    currency: "USD",
    parseRow: (c) => {
      const ticker = c[0];
      if (!ticker || !/^[A-Z.]{1,6}$/.test(ticker)) return null;
      return { symbol: yahooTicker(ticker), name: c[1] ?? ticker, isin: null, currency: "USD" };
    },
  },
  {
    id: "sp-500",
    page: "List_of_S%26P_500_companies",
    headerMatch: ["symbol", "security"],
    currency: "USD",
    parseRow: (c) => {
      const ticker = c[0];
      if (!ticker || !/^[A-Z.]{1,6}$/.test(ticker)) return null;
      return { symbol: yahooTicker(ticker), name: c[1] ?? ticker, isin: null, currency: "USD" };
    },
  },
];

async function build(source: Source): Promise<Constituent[]> {
  const html = await fetchPageHtml(source.page);
  const tables = extractTables(html);
  const table = tables.find((t) => {
    const joined = t.headers.join(" ");
    return source.headerMatch.every((h) => joined.includes(h)) && t.rows.length > 20;
  });
  if (!table) throw new Error(`${source.id}: tabella non trovata su ${source.page}`);

  const seen = new Set<string>();
  const out: Constituent[] = [];
  for (const row of table.rows) {
    const parsed = source.parseRow(row);
    if (!parsed || seen.has(parsed.symbol)) continue;
    seen.add(parsed.symbol);
    out.push(parsed);
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function main() {
  const dir = path.join(process.cwd(), "data", "constituents");
  await mkdir(dir, { recursive: true });

  for (const source of SOURCES) {
    try {
      const list = await build(source);
      if (list.length < 20) throw new Error(`solo ${list.length} titoli estratti`);
      await writeFile(
        path.join(dir, `${source.id}.json`),
        `${JSON.stringify(list, null, 2)}\n`,
        "utf8",
      );
      const conIsin = list.filter((c) => c.isin).length;
      console.log(`${source.id}: ${list.length} titoli (${conIsin} con ISIN)`);
    } catch (error) {
      console.error(`${source.id}: FALLITO —`, (error as Error).message);
      process.exitCode = 1;
    }
  }
}

main();
