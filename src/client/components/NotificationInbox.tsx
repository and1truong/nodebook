/** In-app notification inbox (bell + dropdown), polled while open. */
import { useEffect, useRef, useState } from "react";
import { api, relativeTime } from "../api";
import { Link } from "../router";
import type { NotificationDto } from "../../shared/contracts/issues";

export function NotificationInbox() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const [count, list] = await Promise.all([api.unreadCount(), api.notifications(30)]);
      setUnread(count.count);
      setItems(list);
    } catch {
      /* transient */
    }
  };

  useEffect(() => {
    void refresh();
    pollRef.current = setInterval(() => void refresh(), 30_000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const markRead = async (id: string) => {
    await api.markRead(id).catch(() => undefined);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setUnread((u) => Math.max(0, u - 1));
  };

  const markAll = async () => {
    await api.markAllRead().catch(() => undefined);
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    setUnread(0);
  };

  return (
    <div className="notif-wrap">
      <button
        className="bell"
        aria-label={`Notifications (${unread} unread)`}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
      >
        🔔{unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-header">
            <strong>Notifications</strong>
            <button className="linklike" onClick={() => void markAll()}>
              Mark all read
            </button>
          </div>
          {items.length === 0 && <div className="empty">No notifications yet.</div>}
          <ul className="notif-list">
            {items.map((n) => (
              <li key={n.id} className={n.read_at ? "notif read" : "notif"}>
                <Link to={n.link ?? "/inbox"} onClick={() => void markRead(n.id)}>
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-body">{n.body}</span>
                  <span className="notif-time">{relativeTime(n.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
