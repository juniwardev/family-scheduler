# Bug: list selection does not switch the main view after in-place navigation

- **Slug:** `list-selection-view-state`
- **Source:** Issue 1 in `docs/qa/dev-auth-shim-report.md` (found during dev-auth-shim QA, 2026-06-30). Pre-existing; unrelated to the auth shim.
- **Severity:** Nit / minor UX. No data loss — all API calls succeed; purely a client-side view-state re-render gap in `web/src/`.
- **Area:** `web/src/` view routing / component state (likely `App.tsx` — the `activeView` vs `selectedList` state).

## Steps to reproduce

1. Enable local auth: set `DEV_AUTH_IDENTITY="owner"` in the gitignored `.dev.vars`, then `npm run dev` (wrangler dev on `http://localhost:8787`).
2. Load the app (authenticates as owner/admin via the dev-auth shim, no JWT needed).
3. Navigate to a view that is NOT the list/item view — e.g. click **Admin** so the main panel shows "Admin — User Roster".
4. Without doing a full page reload, click a **list in the sidebar** (or the **"List"** nav tab) to select/open that list.

## Actual behavior

The main panel stays on the previously rendered view (e.g. remains stuck on "Admin — User Roster") instead of switching to the selected list's item view. The selection does not change what the main panel renders. A full page reload (or full navigation) resolves it and shows the correct list item view.

Observed during QA: creating an item required a page reload first to get the newly selected list's view to render (`docs/qa/dev-auth-shim-report.md`, "Create an item" row + Issue 1).

## Expected behavior

Clicking a list in the sidebar (or the "List" nav tab) should immediately switch the main panel to that list's item view, without a page reload — regardless of which view (Admin, Calendar, etc.) was previously rendered.

## Notes / evidence

- API layer is healthy: `GET /api/lists`, `GET /api/lists/:id/items`, `POST /api/lists`, `POST /api/items` all return 2xx during the repro. No 4xx/5xx. So the defect is purely client-side view state, not data fetching.
- No console errors observed during the repro (per QA).
- Hypothesis to confirm (do NOT assume): selecting a list updates a `selectedList`/`selectedListId` state but does not reset the `activeView`/current-panel state away from `admin` (or whichever view is active), so the render keeps showing the old panel. Confirm against the actual `web/src/` code.
