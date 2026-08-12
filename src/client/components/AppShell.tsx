/** Application shell: navigation, header, quick create, notification inbox. */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api";
import { Link } from "../router";
import { NotificationInbox } from "./NotificationInbox";
import { ISSUE_TYPES } from "../../shared/limits";

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
    <div className="shell">
      <header className="topbar">
        <Link to="/inbox" className="brand">
          <span className="brand-mark">◈</span> NodeBook
        </Link>
        <form className="quick-create" onSubmit={submitQuick}>
          <select value={quickType} onChange={(e) => setQuickType(e.target.value)} aria-label="Issue type">
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <input
            id="quick-create-input"
            placeholder="Quick add… press N (title, then Enter)"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            aria-label="Quick create title"
          />
          <button type="submit" disabled={creating || !quickTitle.trim()}>
            Add
          </button>
        </form>
        {error && <span className="error-inline">{error}</span>}
        <div className="topbar-right">
          <NotificationInbox />
          <Link to="/settings/tokens" className={`nav-mini ${path.startsWith("/settings") ? "active" : ""}`} title="MCP tokens">
            ⚙
          </Link>
          <span className="identity" title="Signed-in identity">
            {email || "…"}
          </span>
        </div>
      </header>
      <nav className="sidebar" aria-label="Primary">
        {navItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className={`nav-item ${path.startsWith(item.to) ? "active" : ""}`}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}
