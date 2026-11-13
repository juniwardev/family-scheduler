import { useEffect, useState } from "react";

// Single-instance responsive hook (plan Decision 5, option 1): drives which surface
// (Dialog vs Sheet, sidebar vs bottom-tabs) renders via a CSS-media-query check rather than
// duplicating layout state or remounting on resize. Under the jsdom `matchMedia` stub
// (tests/setup/jsdom.setup.ts), `matches` defaults to false, so tests exercise the mobile/Sheet
// path — both surfaces expose the same accessible text/roles (see plan §8.2), so this does not
// change test outcomes.
export function useMediaQuery(query: string): boolean {
  const getMatches = () => (typeof window !== "undefined" ? window.matchMedia(query).matches : false);

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = () => setMatches(mql.matches);
    // Sync immediately in case the query result differs from the initial render (e.g. SSR-less
    // client mount timing) and subscribe for future changes.
    listener();
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
