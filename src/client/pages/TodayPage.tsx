/** Today: work due/scheduled in the owner's local day, plus overdue. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { PlanningItemDto } from "../../shared/contracts/issues";
import { PageHeader, PlanningList, Loading, ErrorState } from "../components/ui";

export function TodayPage() {
  const [items, setItems] = useState<PlanningItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  useEffect(() => {
    setItems(null);
    setError(null);
    api
      .today(tz)
      .then(setItems)
      .catch(setError);
  }, [tz]);

  const overdue = items?.filter((i) => i.matched_kind === "overdue") ?? [];
  const due = items?.filter((i) => i.matched_kind !== "overdue") ?? [];

  return (
    <>
      <PageHeader title="Today" />
      <p className="mb-4 text-sm text-muted-foreground">
        Open work due or scheduled today in <code>{tz}</code>, with overdue work on top.
      </p>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading />}
      {items && (
        <>
          {overdue.length > 0 && (
            <>
              <h2 className="overdue-title mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-[var(--danger)]">
                Overdue
              </h2>
              <PlanningList items={overdue} empty={null} />
            </>
          )}
          <h2 className="section-title mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Due today
          </h2>
          <PlanningList
            items={due}
            empty={<>Nothing due today. Enjoy the calm — or plan something in Calendar.</>}
          />
        </>
      )}
    </>
  );
}
