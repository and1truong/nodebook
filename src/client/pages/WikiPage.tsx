/** Wiki: hierarchy tree navigation + selected issue view. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { WikiNodeDto } from "../../shared/contracts/issues";
import { HierarchyTree } from "../components/HierarchyTree";
import { PageHeader, Loading, ErrorState, EmptyState } from "../components/ui";
import { Button, buttonVariants } from "../components/ui/button";
import { Link, useRouter } from "../router";

export function WikiPage() {
  const { navigate } = useRouter();
  const [tree, setTree] = useState<WikiNodeDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setTree(null);
    setError(null);
    api
      .wikiTree()
      .then(setTree)
      .catch(setError);
  }, []);

  return (
    <>
      <PageHeader
        title="Wiki"
        actions={
          <Link to="/issues/new" className={buttonVariants({ size: "sm" })}>
            + New wiki page
          </Link>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        The wiki is your issue graph: hierarchy, typed relationships, and #-references. Pick a node to read it; use
        backlinks to discover what points at it.
      </p>
      <div className="wiki-layout grid items-start gap-4 md:grid-cols-[320px_1fr]">
        <nav className="wiki-nav border-r border-border pr-3" aria-label="Wiki tree">
          {error ? <ErrorState error={error} /> : null}
          {!error && !tree && <Loading />}
          {tree && tree.length === 0 && (
            <EmptyState>
              The wiki is empty. Create an issue with type <em>wiki</em> — or any type — and organize children under it.
            </EmptyState>
          )}
          {tree && tree.length > 0 && (
            <>
              <HierarchyTree nodes={tree} />
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                onClick={() => navigate("/issues/new")}
              >
                + New root page
              </Button>
            </>
          )}
        </nav>
        <div className="wiki-content min-h-[300px]">
          <EmptyState>Select a page in the tree to read it.</EmptyState>
        </div>
      </div>
    </>
  );
}
