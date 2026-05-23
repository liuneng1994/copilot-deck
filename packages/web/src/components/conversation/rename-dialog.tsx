import { useEffect, useState } from "react";
import { sendWs } from "../../lib/ws-client";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";

export function RenameDialog({
  open,
  onOpenChange,
  sessionId,
  initialTitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessionId: string;
  initialTitle: string;
}) {
  const [value, setValue] = useState(initialTitle);

  useEffect(() => {
    if (open) setValue(initialTitle);
  }, [open, initialTitle]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendWs({ type: "rename_session", sessionId, title: trimmed });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
        </DialogHeader>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          maxLength={200}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Session title"
        />
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!value.trim()}>
            Rename
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
