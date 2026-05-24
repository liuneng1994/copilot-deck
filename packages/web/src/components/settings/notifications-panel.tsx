import { useState } from "react";
import { ensureNotificationPermission, notify } from "../../lib/notifications";
import { useUserPrefs } from "../../stores/user-prefs-store";
import { Button } from "../ui/button";

export function NotificationsPanel() {
  const notificationsEnabled = useUserPrefs((s) => s.notificationsEnabled);
  const setNotificationsEnabled = useUserPrefs((s) => s.setNotificationsEnabled);
  const [warning, setWarning] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const toggleNotifications = async (enabled: boolean) => {
    setWarning(null);
    if (!enabled) {
      setNotificationsEnabled(false);
      return;
    }

    setRequesting(true);
    try {
      const permission = await ensureNotificationPermission();
      if (permission === "granted") {
        setNotificationsEnabled(true);
      } else {
        setNotificationsEnabled(false);
        setWarning("Permission denied — enable in browser site settings.");
      }
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="rounded-lg border border-border bg-panel p-3">
        <h2 className="text-base font-semibold">Notifications</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Notifications appear only when this tab is in the background.
        </p>
      </div>

      {warning ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {warning}
        </div>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border bg-panel p-3">
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={notificationsEnabled}
            disabled={requesting}
            onChange={(event) => void toggleNotifications(event.target.checked)}
            className="mt-0.5"
          />
          <span>Enable browser notifications</span>
        </label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!notificationsEnabled}
          onClick={() =>
            notify("prompt_done", { title: "Copilot Deck", body: "Test notification" })
          }
        >
          Test notification
        </Button>
      </section>
    </div>
  );
}
