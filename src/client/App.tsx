import { useEffect, useState } from "react";
import { api } from "./api";
import { AppShell } from "./components/AppShell";
import { useRouter, matchPath, Link } from "./router";
import { InboxPage } from "./pages/InboxPage";
import { TodayPage } from "./pages/TodayPage";
import { UpcomingPage } from "./pages/UpcomingPage";
import { IssuesPage } from "./pages/IssuesPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { WikiPage } from "./pages/WikiPage";
import { SearchPage } from "./pages/SearchPage";
import { TokenSettingsPage } from "./pages/TokenSettingsPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function App() {
  const { path, navigate } = useRouter();
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    api.me().then((me) => setEmail(me.email)).catch(() => setEmail(""));
  }, []);

  let content: React.ReactNode;
  if (path === "/" || path === "/inbox") content = <InboxPage />;
  else if (path === "/today") content = <TodayPage />;
  else if (path === "/upcoming") content = <UpcomingPage />;
  else if (path === "/issues") content = <IssuesPage />;
  else if (matchPath("/issues/new", path)) content = <IssueDetailPage mode="create" />;
  else if (matchPath("/issues/:ref", path)) {
    const { ref } = matchPath("/issues/:ref", path)!;
    content = <IssueDetailPage mode="view" issueRef={ref} />;
  } else if (path === "/wiki") content = <WikiPage />;
  else if (path === "/wiki/new") content = <IssueDetailPage mode="create" createType="wiki" />;
  else if (matchPath("/wiki/:ref", path)) {
    const { ref } = matchPath("/wiki/:ref", path)!;
    content = <WikiPage selectedRef={ref} />;
  } else if (path === "/search") content = <SearchPage />;
  else if (path === "/settings/tokens") content = <TokenSettingsPage />;
  else content = <NotFoundPage />;

  return (
    <AppShell email={email} path={path} navigate={navigate}>
      <div key={path} className="page">
        {content}
      </div>
    </AppShell>
  );
}

export { Link };
