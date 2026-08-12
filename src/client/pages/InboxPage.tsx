/** Inbox: open items without start, due, or scheduled values. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { PlanningItemDto } from "../../shared/contracts/issues";
import { PageHeader, PlanningList, Loading, ErrorState } from "../components/ui";
import { InboxItemActions } from "../components/InboxItemActions";
import { buttonVariants } from "../components/ui/button";
import { Link } from "../router";

export function InboxPage() {
  const [items, setItems] = useState<PlanningItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  useEffect(() => {
    setItems(null);
    setError(null);
    api
      .inbox()
      .then(setItems)
      .catch(setError);
  }, []);

  return (
    <>
      <PageHeader
        title="Inbox"
        actions={
          <Link to="/issues/new" className={buttonVariants({ size: "sm" })}>
            + New issue
          </Link>
        }
      />
      <p className="mb-4 text-sm text-muted-foreground">
        Open items without a start, due, or scheduled date. The place to capture first, plan later.
      </p>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading />}
      {items && (
        <PlanningList
          items={items}
          showCreated
          renderActions={(issue) => (
            <InboxItemActions
              issue={issue}
              timezone={timezone}
              onUpdated={(updated) =>
                setItems((current) =>
                  current?.map((item) => (item.issue.id === updated.id ? { ...item, issue: updated } : item)) ?? null,
                )
              }
              onRemoved={(issueId) =>
                setItems((current) => current?.filter((item) => item.issue.id !== issueId) ?? null)
              }
            />
          )}
          empty={<>Inbox zero. Capture something new with the quick-add bar above.</>}
        />
      )}
    </>
  );
}
