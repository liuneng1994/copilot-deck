import { useCallback, useEffect, useRef } from "react";

interface ResizeHandleProps {
  /** Which panel edge this handle controls. "left" sits between sidebar and main, "right" between main and inspector. */
  side: "left" | "right";
  /** Current width of the controlled panel (px). */
  value: number;
  /** Min / max bounds for the panel width. */
  min: number;
  max: number;
  onChange: (px: number) => void;
  ariaLabel?: string;
  /** Default width restored on double-click. */
  defaultValue?: number;
}

/**
 * Thin vertical drag handle used to resize the sidebar or inspector panel.
 * Renders as a 1px line that widens to a 4px hot zone with cursor-col-resize.
 */
export function ResizeHandle({
  side,
  value,
  min,
  max,
  onChange,
  ariaLabel,
  defaultValue,
}: ResizeHandleProps) {
  const draggingRef = useRef<{ startX: number; startValue: number } | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      draggingRef.current = { startX: e.clientX, startValue: value };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [value],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = draggingRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const next = side === "left" ? drag.startValue + dx : drag.startValue - dx;
      onChange(Math.max(min, Math.min(max, next)));
    },
    [side, min, max, onChange],
  );

  const stop = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  return (
    <div
      // biome-ignore lint/a11y/useSemanticElements: <hr> can't host pointer handlers reliably
      // biome-ignore lint/a11y/useFocusableInteractive: tabIndex provided below for keyboard reachability
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={ariaLabel ?? "Resize panel"}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      className="group relative z-10 -mx-0.5 w-1 shrink-0 cursor-col-resize touch-none outline-none focus-visible:ring-1 focus-visible:ring-primary"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 32 : 8;
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onChange(value + (side === "left" ? -step : step));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          onChange(value + (side === "left" ? step : -step));
        }
      }}
      onDoubleClick={() => {
        if (defaultValue != null) onChange(defaultValue);
      }}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
    </div>
  );
}
