/** Application shell: navigation, header, quick create, notification inbox, theme control. */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Check, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api } from "../api";
import { Link, matchPath } from "../router";
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-50 border-b border-border bg-card">
        <div className="grid grid-cols-[190px_1fr] items-center">
          <Link to="/inbox" className="flex h-[52px] items-center px-2.5 text-[15px] font-bold text-foreground hover:no-underline">
            <span className="text-primary">◈</span> NodeBook
          </Link>
          <div className="flex h-[52px] items-center gap-4 px-4">
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
          <ThemeControl />
        </div>
          </div>
        </div>
      </header>
      <div className="grid flex-1 grid-cols-[190px_1fr]">
        <nav
          className="sticky top-[52px] h-[calc(100vh-52px)] overflow-y-auto border-r border-border bg-card p-2"
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
        <main
          className={cn(
            "w-full px-7 pb-20 pt-6",
            // Issue/wiki detail routes get a wider shell for the two-column
            // layout; lists and settings stay at the classic narrow width.
            !matchPath("/issues/new", path) &&
              (matchPath("/issues/:ref", path) !== null || matchPath("/wiki/:ref", path) !== null)
              ? "max-w-[1280px]"
              : "max-w-[980px]",
          )}
        >
          {children}
        </main>
      </div>
      {/* A floating status bar keeps global workspace context available without
          consuming document space or duplicating the page-level controls. */}
      <footer
        aria-label="Application status"
        className="fixed inset-x-0 bottom-0 z-40 grid h-7 grid-cols-[190px_1fr] border-t border-border bg-card/95 text-[11px] text-muted-foreground shadow-lg backdrop-blur"
      >
        <div className="flex items-center gap-1.5 border-r border-border px-2.5 font-semibold tracking-wide">
          <span className="text-primary">◈</span>
          <span>NODEBOOK</span>
        </div>
        <div className="flex min-w-0 items-center gap-2.5 px-4">
          <span className="font-semibold text-foreground">WORKSPACE</span>
          <span className="opacity-50">•</span>
          <span className="truncate">Issue-native wiki and planning</span>
          <div className="ml-auto flex min-w-0 items-center gap-2.5">
            <span className="identity max-w-[200px] truncate" title="Signed-in identity">
              {email || "…"}
            </span>
            <span className="opacity-50">•</span>
            <Link
              to="/settings/tokens"
              title="Settings"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "size-6 hover:no-underline",
                path.startsWith("/settings") && "bg-accent text-accent-foreground",
              )}
            >
              <Settings className="size-3.5" />
            </Link>
            <span className="opacity-50">•</span>
            <span>v0.1.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
