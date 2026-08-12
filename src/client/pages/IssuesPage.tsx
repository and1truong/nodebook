/** Issues: filterable list of all issues. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import { ISSUE_TYPES } from "../../shared/limits";
import { PageHeader, IssueRow, Loading, ErrorState, EmptyState } from "../components/ui";
import { buttonVariants } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Link } from "../router";

export function IssuesPage() {
  const [issues, setIssues] = useState<IssueDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [label, setLabel] = useState("");
  const [allLabels, setAllLabels] = useState<string[]>([]);

  const load = () => {
    setIssues(null);
    setError(null);
    api
      .listIssues({ type: type || undefined, status: status || undefined, label: label || undefined })
      .then((r) => {
        setIssues(r.issues);
        const labels = new Set<string>();
        for (const i of r.issues) for (const l of i.labels) labels.add(l);
        setAllLabels((prev) => [...new Set([...prev, ...labels])].sort());
      })
      .catch(setError);
  };

  useEffect(load, [type, status, label]);

  return (
    <>
      <PageHeader
        title="Issues"
        actions={
          <Link to="/issues/new" className={buttonVariants({ size: "sm" })}>
            + New issue
          </Link>
        }
      />
      <div className="mb-3.5 flex flex-wrap gap-2">
        <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ISSUE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">open</SelectItem>
            <SelectItem value="closed">closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={label || "all"} onValueChange={(v) => setLabel(v === "all" ? "" : v)}>
          <SelectTrigger className="w-36" aria-label="Filter by label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All labels</SelectItem>
            {allLabels.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? <ErrorState error={error} /> : null}
      {!error && !issues && <Loading />}
      {issues && issues.length === 0 && <EmptyState>No issues match these filters.</EmptyState>}
      {issues && issues.length > 0 && (
        <ul className="divide-y divide-border">
          {issues.map((i) => (
            <IssueRow key={i.id} issue={i} />
          ))}
        </ul>
      )}
    </>
  );
}
