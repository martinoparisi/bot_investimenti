import type { Metadata } from "next";

import { Portfolio } from "@/components/Portfolio";

export const metadata: Metadata = {
  title: "Il mio conto — plusvalenze e segnali",
};

export default function ContoPage() {
  return <Portfolio />;
}
