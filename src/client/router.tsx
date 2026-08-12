/** Tiny path router (history API + popstate). */
import { useEffect, useState, useCallback } from "react";

export interface RouterState {
  path: string;
  navigate: (to: string) => void;
}

export function useRouter(): RouterState {
  const [path, setPath] = useState(() => window.location.pathname + window.location.search);

  const navigate = useCallback((to: string) => {
    window.history.pushState(null, "", to);
    setPath(window.location.pathname + window.location.search);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return { path, navigate };
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

export function Link({
  to,
  className,
  children,
  title,
  onClick,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      className={className}
      title={title}
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
}
