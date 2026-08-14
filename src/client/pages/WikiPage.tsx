/** Wiki workspace: persistent page tree, approachable home, and focused reading view. */
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  FilePlus2,
  FileText,
  FolderTree,
  Search,
  Settings2,
} from "lucide-react";
import { api, relativeTime } from "../api";
import type { IssueDto, WikiIssueDto, WikiNodeDto } from "../../shared/contracts/issues";
import { HierarchyTree } from "../components/HierarchyTree";
import { Markdown } from "../components/Markdown";
import { ErrorState, LabelChip, Loading, TypeBadge } from "../components/ui";
import { buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Link } from "../router";
import { cn } from "@/lib/utils";

export function WikiPage({ selectedRef }: { selectedRef?: string }) {
  const [tree, setTree] = useState<WikiNodeDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    setTree(null);
    setError(null);
    api.wikiTree().then(setTree).catch(setError);
  }, []);

  const pages = useMemo(() => (tree ? flattenTree(tree) : []), [tree]);
  const visibleTree = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tree && normalized ? filterTree(tree, normalized) : tree;
  }, [query, tree]);
  const selectedIssue = selectedRef
    ? pages.find((issue) => issue.id === selectedRef || String(issue.number) === selectedRef)
    : undefined;

  return (
    <div className="wiki-workspace flex flex-col gap-5">
      <div
        className={cn(
          "grid items-start gap-5",
          !selectedRef && "min-[1100px]:grid-cols-[minmax(0,1fr)_290px]",
        )}
      >
        {!selectedRef && (
          <aside className="overflow-hidden rounded-xl border border-border bg-card shadow-sm min-[1100px]:sticky min-[1100px]:top-[72px] min-[1100px]:order-2" aria-label="Wiki pages">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2 font-semibold">
              <FolderTree className="size-4 text-primary" aria-hidden="true" />
              Pages
            </div>
            {tree && <span className="text-xs tabular-nums text-muted-foreground">{pages.length}</span>}
          </div>
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter pages…"
                aria-label="Filter wiki pages"
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <nav className="wiki-nav max-h-[calc(100vh-250px)] min-h-28 overflow-y-auto p-2" aria-label="Wiki tree">
            {error ? <ErrorState error={error} /> : null}
            {!error && !tree && <Loading label="Loading pages…" />}
            {tree && tree.length === 0 && (
              <div className="px-3 py-7 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 size-6 opacity-60" aria-hidden="true" />
                No pages yet.
              </div>
            )}
            {tree && tree.length > 0 && visibleTree?.length === 0 && (
              <p className="px-3 py-7 text-center text-sm text-muted-foreground">No pages match “{query.trim()}”.</p>
            )}
            {visibleTree && visibleTree.length > 0 && (
              <HierarchyTree
                nodes={visibleTree}
                selectedId={selectedIssue?.id ?? null}
                expandAll={Boolean(query.trim())}
              />
            )}
          </nav>
          <Link
            to="/wiki/new"
            className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground hover:no-underline"
          >
            <FilePlus2 className="size-3.5" aria-hidden="true" />
            Add a top-level page
          </Link>
          </aside>
        )}

        <section className="min-w-0 min-[1100px]:order-1" aria-label="Wiki content">
          {selectedRef ? (
            <WikiArticle issueRef={selectedRef} tree={tree ?? []} />
          ) : tree ? (
            <WikiHome tree={tree} pages={pages} />
          ) : !error ? (
            <Loading label="Opening your wiki…" />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function WikiHome({ tree, pages }: { tree: WikiNodeDto[]; pages: WikiIssueDto[] }) {
  if (tree.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <BookOpen className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-semibold">Start your knowledge base</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Create a page for a project, process, or idea. Add child pages later to turn it into an easy-to-browse section.
        </p>
        <Link to="/wiki/new" className={cn(buttonVariants({ size: "sm" }), "mt-5")}>
          <FilePlus2 aria-hidden="true" />
          New page
        </Link>
      </section>
    );
  }

  const recentlyUpdated = [...pages].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">Start here</p>
            <h1 className="mt-1 text-xl font-semibold">Browse by topic</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Top-level pages are the main sections of your wiki. Open one to read it and explore its subpages.
            </p>
          </div>
          <Link to="/wiki/new" className={buttonVariants({ size: "sm" })}>
            <FilePlus2 aria-hidden="true" />
            New page
          </Link>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tree.map((node) => (
            <Link
              key={node.issue.id}
              to={`/wiki/${node.issue.number}`}
              className="group rounded-lg border border-border bg-background/50 p-4 text-foreground transition-colors hover:border-primary/40 hover:bg-accent/60 hover:no-underline"
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="truncate">{node.issue.title}</span>
                    <ArrowRight className="size-3.5 flex-none opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {node.children.length === 0
                      ? "No subpages yet"
                      : `${node.children.length} ${node.children.length === 1 ? "subpage" : "subpages"}`}
                  </span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-semibold">Recently updated</h2>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {recentlyUpdated.map((issue) => (
            <Link
              key={issue.id}
              to={`/wiki/${issue.number}`}
              className="flex items-center gap-3 px-4 py-3 text-foreground hover:bg-accent/60 hover:no-underline"
            >
              <FileText className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium">{issue.title}</span>
              <TypeBadge type={issue.type} />
              <span className="hidden text-xs text-muted-foreground sm:inline">{relativeTime(issue.updated_at)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function WikiArticle({ issueRef, tree }: { issueRef: string; tree: WikiNodeDto[] }) {
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [crumbs, setCrumbs] = useState<{ id: string; number: number; title: string }[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setIssue(null);
    setCrumbs([]);
    setError(null);
    Promise.all([api.getIssue(issueRef), api.breadcrumbs(issueRef)])
      .then(([nextIssue, nextCrumbs]) => {
        setIssue(nextIssue);
        setCrumbs(nextCrumbs);
      })
      .catch(setError);
  }, [issueRef]);

  if (error) return <ErrorState error={error} />;
  if (!issue) return <Loading label="Loading page…" />;

  const node = findNode(tree, issue.id);
  const children = node?.children ?? [];

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_220px]">
      <div className="min-w-0">
        {crumbs.length > 1 && (
          <nav className="mb-3 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumbs">
            <Link to="/wiki" className="hover:underline">Wiki</Link>
            {crumbs.map((crumb) => (
              <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                <span aria-hidden="true">/</span>
                <Link to={`/wiki/${crumb.number}`} className="max-w-52 truncate hover:underline" aria-current={crumb.id === issue.id ? "page" : undefined}>
                  {crumb.title}
                </Link>
              </span>
            ))}
          </nav>
        )}

        <article className="rounded-xl border border-border bg-card px-6 py-7 shadow-sm sm:px-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <TypeBadge type={issue.type} />
                <span className="text-xs text-muted-foreground">Page #{issue.number}</span>
              </div>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight">{issue.title}</h1>
              <p className="mt-2 text-xs text-muted-foreground">Updated {relativeTime(issue.updated_at)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/issues/${issue.number}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                <Settings2 aria-hidden="true" />
                Edit &amp; manage
              </Link>
              <Link
                to={`/wiki/new?parent_id=${encodeURIComponent(issue.id)}`}
                className={buttonVariants({ size: "sm" })}
              >
                <FilePlus2 aria-hidden="true" />
                New page
              </Link>
            </div>
          </header>
          <div className="min-h-48 pt-5">
            {issue.body ? (
              <Markdown source={issue.body} className="wiki-article-body" />
            ) : (
              <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
                This page does not have any content yet. Open its issue view to add a description.
              </div>
            )}
          </div>
        </article>

        {children.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <FolderTree className="size-4 text-primary" aria-hidden="true" />
              In this section
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {children.map((child) => (
                <Link
                  key={child.issue.id}
                  to={`/wiki/${child.issue.number}`}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-foreground hover:bg-accent hover:no-underline"
                >
                  <FileText className="size-4 flex-none text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-medium">{child.issue.title}</span>
                  <ArrowRight className="size-3.5 flex-none text-muted-foreground opacity-0 group-hover:opacity-100" aria-hidden="true" />
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="rounded-xl border border-border bg-card p-4 shadow-sm" aria-label="Page details">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">About this page</h3>
        <dl className="mt-3 flex flex-col gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="mt-0.5 capitalize">{issue.status}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Subpages</dt>
            <dd className="mt-0.5">{children.length}</dd>
          </div>
          {issue.labels.length > 0 && (
            <div>
              <dt className="text-xs text-muted-foreground">Labels</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {issue.labels.map((label) => <LabelChip key={label} name={label} />)}
              </dd>
            </div>
          )}
        </dl>
      </aside>
    </div>
  );
}

function flattenTree(nodes: WikiNodeDto[]): WikiIssueDto[] {
  return nodes.flatMap((node) => [node.issue, ...flattenTree(node.children)]);
}

function findNode(nodes: WikiNodeDto[], issueId: string): WikiNodeDto | undefined {
  for (const node of nodes) {
    if (node.issue.id === issueId) return node;
    const child = findNode(node.children, issueId);
    if (child) return child;
  }
  return undefined;
}

function filterTree(nodes: WikiNodeDto[], query: string): WikiNodeDto[] {
  const matches = (issue: WikiIssueDto) =>
    String(issue.number) === query.replace(/^#/, "") ||
    issue.title.toLowerCase().includes(query) ||
    issue.labels.some((label) => label.toLowerCase().includes(query));

  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    if (!matches(node.issue) && children.length === 0) return [];
    return [{ ...node, children: matches(node.issue) ? node.children : children }];
  });
}
