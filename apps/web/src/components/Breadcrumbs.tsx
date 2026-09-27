import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

// Navigation trail shared across pages (one per browser tab). It records the actual
// path you came from, oldest → newest, with the current page always last, so the
// breadcrumbs can take you back to any point instead of a hardcoded "Back to board".
// When you return to a page that is already on the trail, the forward dead-ends are
// dropped, so a path never appears twice (Dashboard → Task 3 → Tags → Task 3 shows
// Dashboard › Task 3, not Dashboard › Task 3 › Tags › Task 3).
let trail: string[] = [];
// Top-bar nav links set this: the next navigation restarts the trail with the
// clicked page as the root (its crumb appears alone, not appended to the old path).
let resetTrailNext = false;

/** Top-bar nav links call this so that navigation starts a fresh trail. */
export function resetTrail() {
  resetTrailNext = true;
}

function record(path: string) {
  if (resetTrailNext) {
    resetTrailNext = false;
    trail = [path];
    return;
  }
  if (trail[trail.length - 1] === path) return; // same page (re-render / HMR)
  const existing = trail.indexOf(path);
  if (existing !== -1) {
    trail = trail.slice(0, existing + 1);
  } else {
    trail = [...trail, path];
  }
  if (trail.length > 20) trail = trail.slice(trail.length - 20);
}

// Pages publish their loaded titles here (task.title, tag.title) so crumbs show
// readable names instead of numeric ids. Titles live in the provider so the trail
// keeps them after a page unmounts; re-registering the same title is a no-op.
const CrumbTitlesContext = createContext<{
  titles: ReadonlyMap<string, string>;
  register: (path: string, title: string) => void;
}>({ titles: new Map(), register: () => {} });

export function CrumbTitleProvider({ children }: { children: ReactNode }) {
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const register = useCallback((path: string, title: string) => {
    setTitles((prev) => {
      if (prev.get(path) === title) return prev;
      const next = new Map(prev);
      next.set(path, title);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ titles, register }), [titles, register]);
  return <CrumbTitlesContext.Provider value={value}>{children}</CrumbTitlesContext.Provider>;
}

/** Pages call this (in an effect, once their title is loaded) to name their own crumb. */
export function useCrumbTitle() {
  return useContext(CrumbTitlesContext).register;
}

function crumbLabel(path: string, titles: ReadonlyMap<string, string>): string {
  const [head, id] = path.split("/").filter(Boolean);
  if (head === undefined) return "Dashboard";
  if (head === "schedule") return "Schedule";
  if (head === "tags") {
    if (!id) return "Tags";
    const title = titles.get(path);
    return title ? `Tag: ${title}` : `Tag ${id}`;
  }
  if (head === "tasks") {
    if (!id) return "Tasks";
    const title = titles.get(path);
    return title ? `Task: ${title}` : `Task ${id}`;
  }
  if (head === "time-blocks") return id ? `Time block ${id}` : "Time blocks";
  return path;
}

export function Breadcrumbs() {
  const location = useLocation();
  const { titles } = useContext(CrumbTitlesContext);
  const [crumbs, setCrumbs] = useState<string[]>(() => [location.pathname]);

  useEffect(() => {
    record(location.pathname);
    setCrumbs(trail.slice());
  }, [location.pathname]);

  // A single crumb is just the current page repeated (e.g. “Schedule” in the top nav) —
  // no trail to navigate back through, so it only eats vertical space. Hide it.
  if (crumbs.length === 1) return null;

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumbs">
      {crumbs.map((path, index) => {
        const last = index === crumbs.length - 1;
        const label = crumbLabel(path, titles);
        return (
          <span className="breadcrumb" key={path}>
            {index > 0 && <span className="breadcrumb-sep" aria-hidden="true">›</span>}
            {last
              ? <span className="breadcrumb-current" title={label}>{label}</span>
              : <Link to={path} title={label}>{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}