import { Paperclip, Send, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { sendWs } from "../../lib/ws-client";
import { useUIStore, type SessionState } from "../../stores/ui-store";

export function Composer({ session }: { session: SessionState }) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const appendUser = useUIStore((s) => s.appendUserMessage);

  const streaming = session.status === "streaming";

  // auto-grow up to ~12 rows
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const max = 12 * 20; // ~12 rows at line-height 20
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [text]);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    appendUser(session.id, trimmed);
    setStatus(session.id, "streaming");
    sendWs({ type: "prompt", sessionId: session.id, text: trimmed });
    setText("");
  };

  const cancel = () => {
    sendWs({ type: "cancel", sessionId: session.id });
    setStatus(session.id, "idle");
  };

  return (
    <div className="border-t border-border bg-panel/60 px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="relative rounded-xl border border-border bg-panel-elevated focus-within:ring-2 focus-within:ring-ring">
          <Textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              streaming
                ? "Agent is responding… press Esc to stop"
                : "Type a prompt, /command, or @file. ⌘↵ to send"
            }
            disabled={streaming}
            rows={1}
            className="min-h-[44px] resize-none border-0 bg-transparent px-4 py-3 text-sm shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              } else if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              } else if (e.key === "Escape" && streaming) {
                e.preventDefault();
                cancel();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Attach (todo)">
                <Paperclip className="h-3.5 w-3.5" />
              </Button>
              {session.availableCommands && session.availableCommands.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  /{session.availableCommands.length} commands ready (M1.4 popover)
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">
                {streaming ? "Esc to stop" : "⌘↵ send"}
              </span>
              {streaming ? (
                <Button size="sm" variant="destructive" onClick={cancel} className="h-7 gap-1.5">
                  <Square className="h-3 w-3" />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={send}
                  disabled={!text.trim()}
                  className="h-7 gap-1.5"
                >
                  <Send className="h-3 w-3" />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
