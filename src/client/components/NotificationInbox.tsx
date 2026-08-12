/** In-app notification inbox (bell + dropdown), polled while open. */
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api, relativeTime } from "../api";
import { Link } from "../router";
import type { NotificationDto } from "../../shared/contracts/issues";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";

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
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="bell relative"
          aria-label={`Notifications (${unread} unread)`}
          onClick={() => {
            if (!open) void refresh();
          }}
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="badge absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="notif-header flex items-center justify-between border-b border-border px-3 py-2.5">
          <strong className="text-sm">Notifications</strong>
          <Button variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => void markAll()}>
            Mark all read
          </Button>
        </div>
        {items.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</div>
        )}
        {items.map((n) => (
          <DropdownMenuItem
            key={n.id}
            asChild
            className={cn(
              "flex flex-col items-start gap-0.5 px-3 py-2",
              n.read_at && "opacity-60",
            )}
          >
            <Link to={n.link ?? "/inbox"} onClick={() => void markRead(n.id)}>
              <span className="notif-title text-sm font-semibold">{n.title}</span>
              <span className="notif-body text-xs text-muted-foreground">{n.body}</span>
              <span className="notif-time text-xs text-muted-foreground">{relativeTime(n.created_at)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
