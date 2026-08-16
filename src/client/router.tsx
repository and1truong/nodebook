/** Tiny shared path router: module-level state + subscribers so every Link
 * and page observes the same navigation (history API + popstate). */
import { forwardRef, useCallback, useEffect, useState } from "react";

export interface RouterState {
  path: string;
  navigate: (to: string) => void;
}

// Module-level router state shared by every consumer (App, Link, pages).
let currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
const listeners = new Set<() => void>();
type NavigationBlocker = (to: string) => boolean | Promise<boolean>;
let navigationBlocker: NavigationBlocker | null = null;
let transitionPending = false;

function emit() {
  for (const listener of listeners) listener();
}

/** Navigate programmatically; updates every subscriber (pushState fires no popstate). */
export function navigate(to: string, bypassBlocker = false) {
  void transition(to, false, bypassBlocker);
}

/** Navigate without adding a history entry (compatibility redirects). */
export function navigateReplace(to: string, bypassBlocker = false) {
  void transition(to, true, bypassBlocker);
}

/** Register the single active page-level navigation guard. */
export function setNavigationBlocker(blocker: NavigationBlocker): () => void {
  navigationBlocker = blocker;
  return () => {
    if (navigationBlocker === blocker) navigationBlocker = null;
  };
}

async function transition(to: string, replace: boolean, bypassBlocker: boolean): Promise<void> {
  if (transitionPending || to === currentPath) return;
  transitionPending = true;
  try {
    if (!bypassBlocker && navigationBlocker && !(await navigationBlocker(to))) return;
    if (replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    currentPath = window.location.pathname + window.location.search;
    emit();
    window.scrollTo(0, 0);
  } finally {
    transitionPending = false;
  }
}

export function useRouter(): RouterState {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onChange = () => setPath(currentPath);
    const onPop = async () => {
      const previousPath = currentPath;
      const nextPath = window.location.pathname + window.location.search;
      if (navigationBlocker && !(await navigationBlocker(nextPath))) {
        window.history.pushState(null, "", previousPath);
        return;
      }
      currentPath = nextPath;
      setPath(nextPath);
      window.scrollTo(0, 0);
    };
    listeners.add(onChange);
    window.addEventListener("popstate", onPop);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return { path, navigate: useCallback(navigate, []) };
}

/** Match /issues/:id style patterns. Returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    if (pp.startsWith(":")) params[pp.slice(1)] = decodeURIComponent(pathParts[i]!);
    else if (pp !== pathParts[i]) return null;
  }
  return params;
}

export const Link = forwardRef<HTMLAnchorElement, {
  to: string;
  className?: string;
  children: React.ReactNode;
  title?: string;
  "aria-current"?: "page" | "step" | "location" | "date" | "time" | "true" | "false";
  onClick?: () => void;
}>(function Link({ to, className, children, title, onClick, ...rest }, ref) {
  return (
    <a
      href={to}
      className={className}
      title={title}
      ref={ref}
      {...rest}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
});
