/** Issues: filterable list of all issues. */
import { useEffect, useState } from "react";
import { api } from "../api";
import type { IssueDto } from "../../shared/contracts/issues";
import { ISSUE_TYPES } from "../../shared/limits";
import { PageHeader, IssueRow, Loading, ErrorState, EmptyState } from "../components/ui";
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
          <Link to="/issues/new" className="btn primary small">
            + New issue
          </Link>
        }
      />
      <div className="filters">
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {ISSUE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="open">open</option>
          <option value="closed">closed</option>
        </select>
        <select value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Filter by label">
          <option value="">All labels</option>
          {allLabels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {error ? <ErrorState error={error} /> : null}
      {!error && !issues && <Loading />}
      {issues && issues.length === 0 && <EmptyState>No issues match these filters.</EmptyState>}
      {issues && issues.length > 0 && (
        <ul className="issue-list">
          {issues.map((i) => (
            <IssueRow key={i.id} issue={i} />
          ))}
        </ul>
      )}
    </>
  );
}
