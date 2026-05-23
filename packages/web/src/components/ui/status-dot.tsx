import { cn } from "../../lib/cn";

export function StatusDot({
  status,
  className,
  pulse,
}: {
  status: "ok" | "warn" | "err" | "muted";
  className?: string;
  pulse?: boolean;
}) {
  const color = {
    ok: "bg-success",
    warn: "bg-warning",
    err: "bg-destructive",
    muted: "bg-muted-foreground/50",
  }[status];
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {pulse && (
        <span className={cn("absolute inset-0 rounded-full opacity-60 animate-ping", color)} />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}
