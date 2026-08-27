import React from "react";
import { cn } from "../lib/utils";

// Neutral shimmer block. Compose these to mirror the real layout so the page
// doesn't jump when data arrives.
export function Skeleton({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...rest}
      className={cn(
        "animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-700/40",
        className,
      )}
    />
  );
}

// Loading state for the client dashboard — roughly the shape of the real one.
export function ClientDashboardSkeleton() {
  return (
    <div className="space-y-6 pb-24 px-4 sm:px-6 max-w-7xl mx-auto" aria-busy="true">
      <div className="flex items-center justify-between pt-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="h-10 w-[200px]" />
      </div>
      <Skeleton className="h-28 w-full" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-64 lg:col-span-2" />
        <Skeleton className="h-64" />
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}
