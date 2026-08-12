/** Upcoming: future scheduled/due work. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { PlanningItemDto } from "../../shared/contracts/issues";
import { PageHeader, PlanningList, Loading, ErrorState } from "../components/ui";

export function UpcomingPage() {
  const [items, setItems] = useState<PlanningItemDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  useEffect(() => {
    setItems(null);
    setError(null);
    api
      .upcoming(tz)
      .then(setItems)
      .catch(setError);
  }, [tz]);

  return (
    <>
      <PageHeader title="Upcoming" />
      <p className="page-sub">
        Open work scheduled or due after today in <code>{tz}</code>.
      </p>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading />}
      {items && (
        <PlanningList items={items} empty={<>Nothing on the horizon. Add due dates to issues to see them here.</>} />
      )}
    </>
  );
}
