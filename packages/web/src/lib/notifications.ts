export type NotifyKind = "permission_request" | "prompt_done";

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (window.Notification.permission !== "default") return window.Notification.permission;

  const requestPermission = window.Notification.requestPermission as unknown as {
    (): Promise<NotificationPermission> | undefined;
    (callback: NotificationPermissionCallback): void;
  };
  const permission = requestPermission();
  if (permission) return await permission;
  return new Promise((resolve) => requestPermission(resolve));
}

export function notify(
  kind: NotifyKind,
  opts: {
    title: string;
    body?: string;
    sessionId?: string;
    onClick?: () => void;
  },
): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (!("Notification" in window)) return false;
  if (window.Notification.permission !== "granted") return false;
  if (document.visibilityState === "visible") return false;

  const options: NotificationOptions = {
    body: opts.body,
    tag: opts.sessionId ? `${kind}:${opts.sessionId}` : kind,
  };
  const notification = new window.Notification(opts.title, options);
  notification.onclick = () => {
    window.focus();
    opts.onClick?.();
    notification.close();
  };
  return true;
}
