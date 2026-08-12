/** GitHub-style hover preview for links to NodeBook issues. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { CircleCheck, CircleDot, GitBranch, Link2 } from "lucide-react";
import type { IssueDto } from "../../shared/contracts/issues";
import { api } from "../api";
import { Link } from "../router";
import { LabelChip, TypeBadge } from "./ui";
import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 150;
const CACHE_TTL_MS = 30_000;
const CARD_GUTTER = 12;
const VIEWPORT_GUTTER = 8;

type CachedIssue = { promise: Promise<IssueDto>; expiresAt: number };
const issueCache = new Map<string, CachedIssue>();

function loadIssue(ref: string): Promise<IssueDto> {
  const cached = issueCache.get(ref);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = api.getIssue(ref).catch((error) => {
    issueCache.delete(ref);
    throw error;
  });
  issueCache.set(ref, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}

function issueRefFromAnchor(anchor: HTMLAnchorElement): string | null {
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const match = /^\/issues\/([^/]+)\/?$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]!) : null;
  } catch {
    return null;
  }
}

function issueAnchorAt(target: EventTarget | null, root: HTMLDivElement | null): HTMLAnchorElement | null {
  if (!(target instanceof Element) || !root) return null;
  const anchor = target.closest("a");
  if (!(anchor instanceof HTMLAnchorElement) || !root.contains(anchor)) return null;
  return issueRefFromAnchor(anchor) ? anchor : null;
}

function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cardDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

interface Position {
  left: number;
  top: number;
  side: "top" | "bottom";
  arrowLeft: number;
}

/**
 * Wraps rendered Markdown and adds a lazily-loaded preview to same-origin
 * `/issues/:ref` links. The delay and pointer grace period keep the card from
 * flashing while the pointer crosses prose.
 */
export function IssueLinkPreview({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [target, setTarget] = useState<{ anchor: HTMLAnchorElement; ref: string } | null>(null);
  const [issue, setIssue] = useState<IssueDto | null>(null);
  const [error, setError] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);
  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const openFor = useCallback(
    (anchor: HTMLAnchorElement, immediately = false) => {
      const ref = issueRefFromAnchor(anchor);
      if (!ref) return;
      clearCloseTimer();
      clearOpenTimer();
      if (target?.anchor === anchor) return;
      openTimer.current = setTimeout(
        () => {
          setIssue(null);
          setError(false);
          setPosition(null);
          setTarget({ anchor, ref });
        },
        immediately ? 0 : OPEN_DELAY_MS,
      );
    },
    [clearCloseTimer, clearOpenTimer, target],
  );

  const closeSoon = useCallback(() => {
    clearOpenTimer();
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setTarget(null), CLOSE_DELAY_MS);
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    return () => {
      clearOpenTimer();
      clearCloseTimer();
    };
  }, [clearCloseTimer, clearOpenTimer]);

  useEffect(() => {
    if (!target) {
      setIssue(null);
      setError(false);
      setPosition(null);
      return;
    }

    let current = true;
    setIssue(null);
    setError(false);
    void loadIssue(target.ref)
      .then((nextIssue) => {
        if (current) setIssue(nextIssue);
      })
      .catch(() => {
        if (current) setError(true);
      });
    return () => {
      current = false;
    };
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const anchor = target.anchor;
    const previous = anchor.getAttribute("aria-describedby");
    anchor.setAttribute("aria-describedby", cardId);
    return () => {
      if (previous === null) anchor.removeAttribute("aria-describedby");
      else anchor.setAttribute("aria-describedby", previous);
    };
  }, [cardId, target]);

  const updatePosition = useCallback(() => {
    if (!target || !cardRef.current || !target.anchor.isConnected) return;
    const trigger = target.anchor.getBoundingClientRect();
    const card = cardRef.current.getBoundingClientRect();
    const fitsBelow = trigger.bottom + CARD_GUTTER + card.height <= window.innerHeight - VIEWPORT_GUTTER;
    const side = fitsBelow ? "bottom" : "top";
    const desiredLeft = trigger.left + trigger.width / 2 - card.width / 2;
    const left = Math.max(
      VIEWPORT_GUTTER,
      Math.min(desiredLeft, window.innerWidth - card.width - VIEWPORT_GUTTER),
    );
    const top = side === "bottom" ? trigger.bottom + CARD_GUTTER : trigger.top - card.height - CARD_GUTTER;
    setPosition({
      left,
      top: Math.max(VIEWPORT_GUTTER, top),
      side,
      arrowLeft: Math.max(16, Math.min(trigger.left + trigger.width / 2 - left, card.width - 16)),
    });
  }, [target]);

  useLayoutEffect(updatePosition, [updatePosition, issue, error]);
  useEffect(() => {
    if (!target) return;
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTarget(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [target, updatePosition]);

  const preview = target
    ? createPortal(
        <IssuePreviewCard
          ref={cardRef}
          id={cardId}
          issue={issue}
          error={error}
          position={position}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={closeSoon}
        />,
        document.body,
      )
    : null;

  return (
    <>
      <div
        {...props}
        ref={rootRef}
        className={className}
        onMouseOver={(event) => {
          props.onMouseOver?.(event);
          const anchor = issueAnchorAt(event.target, rootRef.current);
          if (anchor) openFor(anchor);
        }}
        onMouseOut={(event) => {
          props.onMouseOut?.(event);
          const anchor = issueAnchorAt(event.target, rootRef.current);
          const next = event.relatedTarget;
          if (anchor && (!(next instanceof Node) || !anchor.contains(next))) closeSoon();
        }}
        onFocus={(event) => {
          props.onFocus?.(event);
          const anchor = issueAnchorAt(event.target, rootRef.current);
          if (anchor) openFor(anchor, true);
        }}
        onBlur={(event) => {
          props.onBlur?.(event);
          if (issueAnchorAt(event.target, rootRef.current)) closeSoon();
        }}
      />
      {preview}
    </>
  );
}

interface CardProps {
  id: string;
  issue: IssueDto | null;
  error: boolean;
  position: Position | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

// The preview measures itself after each loading/content state so it can flip
// above the link when there is not enough room below.
const IssuePreviewCard = forwardRef<HTMLDivElement, CardProps>(function IssuePreviewCard(
  { id, issue, error, position, onMouseEnter, onMouseLeave },
  ref,
) {
  const summary = useMemo(() => (issue ? plainText(issue.body) : ""), [issue]);

  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      aria-label={issue ? `Issue #${issue.number} preview` : "Issue preview"}
      className="issue-hover-card fixed z-50 w-[min(22.5rem,calc(100vw-1rem))] rounded-lg border border-border bg-popover text-popover-foreground shadow-xl"
      style={{
        left: position?.left ?? VIEWPORT_GUTTER,
        top: position?.top ?? VIEWPORT_GUTTER,
        visibility: position ? "visible" : "hidden",
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {position && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute z-10 size-3 -translate-x-1/2 rotate-45 border bg-popover",
            position.side === "bottom"
              ? "-top-1.5 border-b-0 border-r-0"
              : "-bottom-1.5 border-l-0 border-t-0",
          )}
          style={{ left: position.arrowLeft }}
        />
      )}

      {error ? (
        <div className="p-4">
          <p className="font-medium">Issue unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">This issue may have been removed or you may not have access.</p>
        </div>
      ) : !issue ? (
        <div className="space-y-3 p-4" role="status" aria-label="Loading issue preview">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <>
          <div className="p-4">
            <p className="mb-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{issue.created_by}</span> opened on {cardDate(issue.created_at)}
            </p>
            <Link
              to={`/issues/${issue.number}`}
              className="block text-base font-semibold leading-snug text-foreground hover:underline"
            >
              {issue.title} <span className="font-normal text-muted-foreground">#{issue.number}</span>
            </Link>
            <span
              className={cn(
                "mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-card",
                issue.status === "open" ? "bg-success" : "bg-muted-foreground",
              )}
            >
              {issue.status === "open" ? <CircleDot className="size-3.5" /> : <CircleCheck className="size-3.5" />}
              <span className="capitalize">{issue.status}</span>
            </span>
          </div>

          {(summary || issue.labels.length > 0) && (
            <div className="border-t border-border px-4 py-3">
              {summary && <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{summary}</p>}
              {issue.labels.length > 0 && (
                <div className={cn("flex flex-wrap gap-1.5", summary && "mt-2.5")}>
                  {issue.labels.slice(0, 5).map((label) => (
                    <LabelChip key={label} name={label} />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
            <TypeBadge type={issue.type} />
            {issue.priority && <span className="capitalize">{issue.priority} priority</span>}
            {issue.child_count > 0 && (
              <span className="inline-flex items-center gap-1" title="Sub-issues">
                <GitBranch className="size-3.5" /> {issue.child_count}
              </span>
            )}
            {issue.backlink_count > 0 && (
              <span className="inline-flex items-center gap-1" title="Backlinks">
                <Link2 className="size-3.5" /> {issue.backlink_count}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
});
