export function StatCardSkeleton() {
  return (
    <div className="animate-pulse border border-slate-200/90 bg-white p-4 shadow-xs" aria-hidden="true">
      <div className="h-3 w-28 rounded bg-slate-200" />
      <div className="mt-3 h-8 w-32 rounded bg-slate-200" />
      <div className="mt-4 h-3 w-full rounded bg-slate-100" />
    </div>
  );
}

export function TableRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-slate-100 animate-pulse" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_100px_82px] gap-4 px-4 py-3">
          <div className="space-y-2">
            <div className="h-3 w-40 rounded bg-slate-200" />
            <div className="h-2.5 w-28 rounded bg-slate-100" />
          </div>
          <div className="h-3 w-20 rounded bg-slate-200" />
          <div className="h-5 w-16 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function LedgerSkeleton({ rows = 6 }: { rows?: number }) {
  return <TableRowsSkeleton rows={rows} />;
}
