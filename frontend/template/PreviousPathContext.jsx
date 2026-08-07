import { createContext, useContext } from 'react';

// Set once per route change by AppShell (frontend/app/src/App.jsx) — the
// pathname the caller was on immediately before the current page, or null
// on a fresh load/refresh with no prior in-app navigation. Settings.jsx and
// Badges.jsx use this to make their "Back to X" link reflect wherever the
// caller actually came from, rather than BackLink's usual fixed
// destination (see BackLink.jsx's own note on why every other page keeps a
// stable target) — Settings/Badges are reachable from almost any page via
// the nav's avatar dropdown, so there's no single natural parent for them.
const PreviousPathContext = createContext(null);

export const PreviousPathProvider = PreviousPathContext.Provider;

export function usePreviousPath() {
  return useContext(PreviousPathContext);
}
