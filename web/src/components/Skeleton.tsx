type SkeletonProps = {
  className?: string;
};

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div className={`animate-pulse rounded-sm bg-line/80 ${className}`} aria-hidden />;
}

export function ProjectCardSkeleton() {
  return (
    <div className="rounded-sm border border-line bg-panel/40 p-4">
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="mt-3 h-3 w-full" />
      <Skeleton className="mt-2 h-3 w-4/5" />
      <div className="mt-4 flex justify-between">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export function ProjectPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-32" />
      <div className="mt-6 grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-sm border border-line p-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="rounded-sm border border-line p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-4 h-full min-h-[200px] w-full" />
        </div>
      </div>
    </div>
  );
}
