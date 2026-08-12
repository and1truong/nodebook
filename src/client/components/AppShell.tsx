/** Application shell: navigation, header, quick create, notification inbox, theme control. */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api } from "../api";
import { Link } from "../router";
import { useTheme } from "../theme";
import type { Theme } from "../theme";
import { NotificationInbox } from "./NotificationInbox";
import { ISSUE_TYPES } from "../../shared/limits";
import { Button, buttonVariants } from "./ui/button";
import { Input } from "./ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";

function ThemeControl() {
  const { theme, setTheme } = useTheme();
  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;
  const options: { value: Theme; label: string; icon: ReactNode }[] = [
    { value: "light", label: "Light", icon: <Sun className="size-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="size-4" /> },
    { value: "system", label: "System", icon: <Monitor className="size-4" /> },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme">
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => setTheme(o.value)}>
            {o.icon}
            {o.label}
            {theme === o.value && <Check className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  email,
  path,
  navigate,
  children,
}: {
  email: string;
  path: string;
  navigate: (to: string) => void;
  children: ReactNode;
}) {
  const [quickTitle, setQuickTitle] = useState("");
  const [quickType, setQuickType] = useState<string>("task");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navItems = [
    { to: "/inbox", label: "Inbox", icon: "📥" },
    { to: "/today", label: "Today", icon: "☀️" },
    { to: "/upcoming", label: "Upcoming", icon: "📅" },
    { to: "/issues", label: "Issues", icon: "🗂️" },
    { to: "/wiki", label: "Wiki", icon: "📖" },
    { to: "/search", label: "Search", icon: "🔍" },
  ];

  const submitQuick = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setCreating(true);
    setError(null);
    try {
      const issue = await api.createIssue({ title, type: quickType });
      setQuickTitle("");
      navigate(`/issues/${issue.number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create issue");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if (e.key === "n" || e.key === "N") {
        document.getElementById("quick-create-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 flex h-[52px] items-center gap-4 border-b border-border bg-card px-4">
        <Link to="/inbox" className="flex-none text-[15px] font-bold text-foreground hover:no-underline">
          <span className="text-primary">◈</span> NodeBook
        </Link>
        <form className="flex max-w-[560px] flex-1 gap-1.5" onSubmit={submitQuick}>
          <Select value={quickType} onValueChange={setQuickType}>
            <SelectTrigger className="h-8 w-[110px] shrink-0" aria-label="Issue type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISSUE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id="quick-create-input"
            placeholder="Quick add… press N (title, then Enter)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            aria-label="Quick create title"
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={creating || !quickTitle.trim()}>
            Add
          </Button>
        </form>
        {error && <span className="error-inline">{error}</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <NotificationInbox />
          <Link
            to="/settings/tokens"
            title="MCP tokens"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "hover:no-underline",
              path.startsWith("/settings") && "bg-accent text-accent-foreground",
            )}
          >
            <Settings className="size-4" />
          </Link>
          <ThemeControl />
          <span className="identity ml-1 max-w-[200px] truncate text-xs text-muted-foreground" title="Signed-in identity">
            {email || "…"}
          </span>
        </div>
      </header>
      <div className="grid grid-cols-[190px_1fr]">
        <nav
          className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-border p-2"
          aria-label="Primary"
        >
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={path.startsWith(item.to) ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-2 text-foreground hover:bg-accent hover:no-underline",
                path.startsWith(item.to) && "bg-accent font-semibold text-primary",
              )}
            >
              <span className="w-[18px] text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <main className="w-full max-w-[980px] px-7 pb-20 pt-6">{children}</main>
      </div>
    </div>
  );
}
