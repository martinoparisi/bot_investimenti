import { Suspense } from "react";

import { Dashboard } from "@/components/Dashboard";
import { RowSkeleton } from "@/components/StockCard";

export default function HomePage() {
  return (
    <Suspense fallback={<RowSkeleton count={6} />}>
      <Dashboard />
    </Suspense>
  );
}
