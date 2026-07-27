import type { Metadata } from "next";

import { StockDetail } from "@/components/StockDetail";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ symbol: string }>;
}): Promise<Metadata> {
  const { symbol } = await params;
  const clean = decodeURIComponent(symbol).toUpperCase();
  return { title: `${clean} — analisi e probabilità` };
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  return <StockDetail symbol={decodeURIComponent(symbol).toUpperCase()} />;
}
