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

function emit() {
  for (const listener of listeners) listener();
}

/** Navigate programmatically; updates every subscriber (pushState fires no popstate). */
export function navigate(to: string) {
  window.history.pushState(null, "", to);
  currentPath = window.location.pathname + window.location.search;
  emit();
  window.scrollTo(0, 0);
}

/** Navigate without adding a history entry (compatibility redirects). */
export function navigateReplace(to: string) {
  window.history.replaceState(null, "", to);
  currentPath = window.location.pathname + window.location.search;
  emit();
  window.scrollTo(0, 0);
}

export function useRouter(): RouterState {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    const onChange = () => setPath(currentPath);
    const onPop = () => {
      currentPath = window.location.pathname + window.location.search;
      setPath(currentPath);
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
