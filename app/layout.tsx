import type { Metadata } from "next";
import Link from "next/link";

import { SearchBar } from "@/components/SearchBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Analisi Mercati — probabilità di salita e discesa",
  description:
    "Dashboard di analisi quantitativa su FTSE MIB, FTSE 100, NASDAQ 100 e S&P 500: probabilità di rialzo, segnali compra/vendi/mantieni e portafoglio personale.",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="min-h-screen" suppressHydrationWarning>
        <header className="sticky top-0 z-50 border-b border-base-800 bg-base-950/85 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
            <Link href="/" className="flex shrink-0 items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-500/15 text-accent-400">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 17l5-6 4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 6h5v5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Analisi Mercati</span>
            </Link>

            <div className="order-3 w-full md:order-none md:w-auto md:flex-1">
              <SearchBar />
            </div>

            <nav className="ml-auto flex shrink-0 items-center gap-1 text-sm">
              <Link
                href="/"
                className="rounded-lg px-3 py-2 text-base-300 transition-colors hover:bg-base-800 hover:text-base-100 sm:py-1.5"
              >
                Dashboard
              </Link>
              <Link
                href="/conto"
                className="rounded-lg px-3 py-2 text-base-300 transition-colors hover:bg-base-800 hover:text-base-100 sm:py-1.5"
              >
                Il mio conto
              </Link>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-4 sm:py-6">{children}</main>

        <footer className="mx-auto max-w-[1600px] px-3 pb-10 pt-6 text-xs sm:px-4 leading-relaxed text-base-400">
          <p>
            Dati: Yahoo Finance (senza chiave) e, se configurata, Finnhub per i prezzi USA in tempo
            reale. I titoli europei sono tipicamente ritardati di 15 minuti.
          </p>
          <p className="mt-1">
            Le probabilità sono stime statistiche sui prezzi passati, non previsioni.{" "}
            <strong className="text-base-300">Questo strumento non è consulenza finanziaria.</strong>
          </p>
        </footer>
      </body>
    </html>
  );
}
