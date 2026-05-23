import { AlertTriangle } from "lucide-react";
import { create } from "zustand";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export type ConfirmTone = "default" | "danger";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolver: ((v: boolean) => void) | null;
  show: (opts: ConfirmOptions) => Promise<boolean>;
  resolve: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolver: null,
  show: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ open: true, options: opts, resolver: resolve });
    }),
  resolve: (v) => {
    const r = get().resolver;
    set({ open: false, resolver: null });
    r?.(v);
  },
}));

/** Imperative API — returns a promise resolving to user's choice. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().show(opts);
}

export function ConfirmDialogHost() {
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const resolve = useConfirmStore((s) => s.resolve);

  if (!options) return null;
  const tone = options.tone ?? "default";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resolve(false);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {tone === "danger" && <AlertTriangle className="h-4 w-4 text-destructive" />}
            {options.title}
          </DialogTitle>
          {options.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => resolve(false)}>
            {options.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            variant={tone === "danger" ? "destructive" : "default"}
            size="sm"
            onClick={() => resolve(true)}
            autoFocus
          >
            {options.confirmLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
