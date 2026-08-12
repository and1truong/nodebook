/** Typed relationships panel with inverse display semantics. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Link } from "../router";
import type { RelationshipDto } from "../../shared/contracts/issues";
import { RELATIONSHIP_TYPES } from "../../shared/limits";
import { Loading, ErrorState, EmptyState } from "./ui";

export function RelationshipsPanel({ issueRef, issueId }: { issueRef: string; issueId: string }) {
  const [items, setItems] = useState<RelationshipDto[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [targetRef, setTargetRef] = useState("");
  const [type, setType] = useState<string>("related");
  const [adding, setAdding] = useState(false);

  const load = () => {
    setItems(null);
    setError(null);
    api
      .relationships(issueRef)
      .then(setItems)
      .catch(setError);
  };

  useEffect(load, [issueRef]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetRef.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const target = await api.getIssue(targetRef.trim().replace(/^#/, ""));
      await api.addRelationship(issueRef, target.id, type);
      setTargetRef("");
      load();
    } catch (err) {
      setError(err);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    setError(null);
    try {
      await api.removeRelationship(id);
      load(); // only reflect success
    } catch (err) {
      setError(err);
    }
  };

  return (
    <section className="panel">
      <h3>Relationships</h3>
      <form className="inline-form" onSubmit={add}>
        <input
          value={targetRef}
          onChange={(e) => setTargetRef(e.target.value)}
          placeholder="Issue # or UUID"
          aria-label="Target issue"
        />
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Relationship type">
          {RELATIONSHIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className="btn small" disabled={adding || !targetRef.trim()}>
          Link
        </button>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading label="Loading relationships…" />}
      {items && items.length === 0 && <EmptyState>No relationships.</EmptyState>}
      {items && items.length > 0 && (
        <ul className="rel-list">
          {items.map((r) => {
            const outgoing = r.source_id === issueId;
            const otherNumber = outgoing ? r.target_number : r.source_number;
            const otherTitle = outgoing ? r.target_title : r.source_title;
            return (
              <li key={r.id} className="rel-item">
                <span className="badge rel-type">{r.type}</span>
                {!outgoing && <span className="rel-arrow">← </span>}
                <Link to={`/issues/${otherNumber}`}>
                  #{otherNumber} {otherTitle}
                </Link>
                {outgoing && <span className="rel-arrow"> →</span>}
                <button className="linklike danger" onClick={() => void remove(r.id)}>
                  remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
