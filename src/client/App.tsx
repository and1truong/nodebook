

import { useEffect, useState } from "react";
import { api } from "./api";
import { AppShell } from "./components/AppShell";
import { useRouter, matchPath, Link, navigateReplace } from "./router";
import { InboxPage } from "./pages/InboxPage";
import { TodayPage } from "./pages/TodayPage";
import { CalendarPage } from "./pages/CalendarPage";
import { IssuesPage } from "./pages/IssuesPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { WikiPage } from "./pages/WikiPage";
import { SearchPage } from "./pages/SearchPage";
import { TokenSettingsPage } from "./pages/TokenSettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ChatPage } from "./pages/ChatPage";
import type { AppConfigDto } from "../shared/contracts/config";
import type { CalendarView, IssuePageLimit, WeekStartDay } from "../shared/contracts/config";
import { DEFAULT_ISSUES_PAGE_LIMIT, DEFAULT_WEEK_START_DAY } from "../shared/contracts/config";

export function App() {
  const { path, navigate } = useRouter();
  const queryStart = path.indexOf("?");
  const routePath = queryStart === -1 ? path : path.slice(0, queryStart);
  const searchParams = new URLSearchParams(queryStart === -1 ? "" : path.slice(queryStart + 1));
  const [email, setEmail] = useState<string>("");
  // undefined = still loading; null = config fetch failed (fall back to week).
  const [config, setConfig] = useState<AppConfigDto | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (!cancelled) {
          setEmail(me.email);
          setConfig(me);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEmail("");
          setConfig(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // While the config is still loading the default view is unknown; pass
  // undefined so CalendarPage waits before fetching its first range.
  const calendarDefaultView: CalendarView | undefined =
    config === undefined ? undefined : (config?.calendar_default_view ?? "week");

  // Same gating for the week start: undefined while loading, the deployment
  // value once resolved, and the Sunday default after /api/me failure.
  const weekStartDay: WeekStartDay | undefined =
    config === undefined ? undefined : (config?.week_start_day ?? DEFAULT_WEEK_START_DAY);

  // Delay the Issues list's first request until its deployment default is
  // known, avoiding an unnecessary request with the wrong page size.
  const issuesDefaultLimit: IssuePageLimit | undefined =
    config === undefined ? undefined : (config?.issues_default_limit ?? DEFAULT_ISSUES_PAGE_LIMIT);

  // /upcoming is a compatibility alias: replace the URL in place so the
  // canonical /calendar route is what the address bar and history hold.
  useEffect(() => {
    if (routePath === "/upcoming") navigateReplace("/calendar");
  }, [routePath]);

  let content: React.ReactNode;
  if (routePath === "/" || routePath === "/inbox") content = <InboxPage weekStartDay={weekStartDay} />;
  else if (routePath === "/today") content = <TodayPage />;
  else if (routePath === "/calendar" || routePath === "/upcoming") content = <CalendarPage defaultView={calendarDefaultView} weekStartDay={weekStartDay} />;
  else if (routePath === "/issues") {
    content = <IssuesPage defaultLimit={issuesDefaultLimit} selectedViewId={searchParams.get("view")} />;
  }
  else if (matchPath("/issues/new", routePath)) content = <IssueDetailPage mode="create" weekStartDay={weekStartDay} />;
  else if (matchPath("/issues/:ref", routePath)) {
    const { ref } = matchPath("/issues/:ref", routePath)!;
    content = <IssueDetailPage mode="view" issueRef={ref} weekStartDay={weekStartDay} />;
  } else if (routePath === "/wiki") content = <WikiPage />;
  else if (routePath === "/wiki/new") {
    content = (
      <IssueDetailPage
        mode="create"
        createType="wiki"
        createParentId={searchParams.get("parent_id") ?? undefined}
        weekStartDay={weekStartDay}
      />
    );
  } else if (matchPath("/wiki/:ref", routePath)) {
    const { ref } = matchPath("/wiki/:ref", routePath)!;
    content = <WikiPage selectedRef={ref} />;
  } else if (routePath === "/search") content = <SearchPage />;
  else if (routePath === "/chat") content = <ChatPage navigate={navigate} />;
  else if (matchPath("/chat/:conversationId", routePath)) {
    const { conversationId } = matchPath("/chat/:conversationId", routePath)!;
    content = <ChatPage conversationId={conversationId} navigate={navigate} />;
  }
  else if (routePath === "/settings/tokens") content = <TokenSettingsPage />;
  else content = <NotFoundPage />;

  return (
    <AppShell email={email} path={routePath} navigate={navigate}>
      <div key={path} className="page">
        {content}
      </div>
    </AppShell>
  );
}

export { Link };
