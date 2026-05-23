import { AlertTriangle, Info, X } from "lucide-react";
import { useUIStore } from "../../stores/ui-store";

export function NoticeBanner() {
  const notice = useUIStore((s) => s.notice);
  const setNotice = useUIStore((s) => s.setNotice);
  if (!notice) return null;

  const isWarn = notice.kind === "warn";
  const Icon = isWarn ? AlertTriangle : Info;

  return (
    <div
      className={
        "flex items-center gap-2 border-b px-4 py-2 text-xs " +
        (isWarn
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : "border-sky-500/30 bg-sky-500/10 text-sky-100")
      }
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1">{notice.text}</span>
      <button
        className="rounded p-0.5 text-current/70 hover:bg-white/10"
        onClick={() => setNotice(null)}
        aria-label="Dismiss notice"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
