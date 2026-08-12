/** Typed relationships panel with inverse display semantics. */
import { useEffect, useState } from "react";
import { api } from "../api";
import { Link } from "../router";
import type { RelationshipDto } from "../../shared/contracts/issues";
import { RELATIONSHIP_TYPES } from "../../shared/limits";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Loading, ErrorState, EmptyState } from "./ui";
import { cn } from "@/lib/utils";

const nativeSelectClass =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function RelationshipsPanel({
  issueRef,
  issueId,
  embedded = false,
}: {
  issueRef: string;
  issueId: string;
  /** Compact sidebar presentation: no outer card/heading, stacked controls. */
  embedded?: boolean;
}) {
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
    <section className={cn("flex flex-col gap-3", !embedded && "rounded-lg border border-border bg-card p-4")}>
      {!embedded && <h3 className="text-sm font-semibold">Relationships</h3>}
      <form className={cn("flex gap-2", embedded ? "flex-col" : "flex-wrap items-center")} onSubmit={add}>
        <Input
          className={embedded ? "w-full" : "w-48"}
          value={targetRef}
          onChange={(e) => setTargetRef(e.target.value)}
          placeholder="Issue # or UUID"
          aria-label="Target issue"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="Relationship type"
          className={cn(nativeSelectClass, embedded && "w-full")}
        >
          {RELATIONSHIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" disabled={adding || !targetRef.trim()}>
          Link
        </Button>
      </form>
      {error ? <ErrorState error={error} /> : null}
      {!error && !items && <Loading label="Loading relationships…" />}
      {items && items.length === 0 && <EmptyState>No relationships.</EmptyState>}
      {items && items.length > 0 && (
        <ul className="flex flex-col">
          {items.map((r) => {
            const outgoing = r.source_id === issueId;
            const otherNumber = outgoing ? r.target_number : r.source_number;
            const otherTitle = outgoing ? r.target_title : r.source_title;
            return (
              <li key={r.id} className="rel-item flex flex-wrap items-center gap-2 border-b border-border py-1.5 last:border-b-0">
                <Badge variant="outline" className="rel-type border-type-wiki text-type-wiki">
                  {r.type}
                </Badge>
                {!outgoing && <span className="rel-arrow text-muted-foreground">← </span>}
                <Link to={`/issues/${otherNumber}`} className="hover:underline">
                  #{otherNumber} {otherTitle}
                </Link>
                {outgoing && <span className="rel-arrow text-muted-foreground"> →</span>}
                <Button
                  variant="link"
                  size="sm"
                  className="ml-auto h-auto px-0 text-xs text-destructive"
                  onClick={() => void remove(r.id)}
                >
                  remove
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
