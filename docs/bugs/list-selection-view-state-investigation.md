# Investigation: list selection does not switch the main view

**Bug slug:** `list-selection-view-state`

## Root cause statement

The main panel view-selection logic in `web/src/App.tsx:103-115` prioritizes the `showAdmin` flag as the highest-precedence render condition, but `showAdmin` is only ever toggled (never explicitly reset) when the Admin button is clicked. When a user clicks a list in the sidebar or clicks the "List" nav tab, only `selectedListId` or `view` are updated; `showAdmin` is never modified. As a result, if the Admin panel was previously shown (by clicking the Admin button), that panel remains rendered even after attempting to navigate to a different view. A full page reload resets `showAdmin` to `false` (its initial state on line 19), which is why reload fixes the symptom.

**File and line references:**
- `web/src/App.tsx:19` (initial state: `const [showAdmin, setShowAdmin] = useState(false)`)
- `web/src/App.tsx:86` (Admin button handler: `onClick={() => setShowAdmin((v) => !v)}` — toggle only)
- `web/src/App.tsx:97` (list selection handler: `onSelect={setSelectedListId}` — never touches `showAdmin`)
- `web/src/App.tsx:73, 79` ("List" and "Calendar" buttons call `setView()` only, never reset `showAdmin`)
- `web/src/App.tsx:103-115` (render decision: `if (showAdmin && user.role === "admin") { <AdminPanel /> } else if (view === "calendar") { ... } else { <ItemListView> }`)

## Why it occurs

The render decision tree uses a waterfall of conditional checks:

1. **Line 103:** `if (showAdmin && user.role === "admin")` → render AdminPanel
2. **Line 105:** `else if (view === "calendar")` → render CalendarView
3. **Line 108:** `else` → render ItemListView

`showAdmin` has the highest priority in this cascade. Once `showAdmin` is set to `true` (by clicking the Admin button), the subsequent `else if` branches are unreachable, regardless of what `view` or `selectedListId` are set to.

When a user clicks a list in the sidebar:
- `ListSidebar` calls `onSelect(list.id)` (App.tsx:97), which is `setSelectedListId`
- This updates `selectedListId` but leaves `showAdmin` unchanged
- The render re-evaluates App.tsx:103 and finds `showAdmin === true`, so it renders AdminPanel
- ItemListView is never rendered

When a user clicks the "List" nav tab:
- `setView("list")` is called (App.tsx:73)
- `view` becomes `"list"`, but `showAdmin` remains `true`
- The render re-evaluates App.tsx:103 and finds `showAdmin === true`, so it renders AdminPanel
- ItemListView is never rendered (the "List" tab is aesthetically active, but the panel shows Admin)

The "List" and "Calendar" nav tabs correctly update `view` state, and the conditional render would work correctly if `showAdmin` were reset to `false` when those tabs are clicked. But there is no code path that resets `showAdmin` except:
- A full page reload (which reinitializes all state to defaults, including `showAdmin = false`)
- Clicking the Admin button again to toggle `showAdmin` back to `false`

## Suggested fix approach

The root cause is that the Admin panel's toggle pattern and its highest-priority render position create a scenario where the view gets "stuck" on Admin. There are several possible fix approaches, each with different tradeoffs:

**Option A (recommended for simplicity):** Reset `showAdmin` to `false` in the handlers for "List" and "Calendar" nav tabs, and when a list is selected via the sidebar.
- Pro: Minimal change, matches user intent (clicking List/Calendar tabs or a list should exit Admin mode)
- Con: Slightly redundant state updates

**Option B:** Restructure the render logic so that nav-tab-selected `view` takes precedence over `showAdmin`.
- Pro: More semantic (the view-mode selection is the primary UI intent)
- Con: Requires rethinking the Admin panel's interaction model (e.g., admin users accessing admin features while viewing a list simultaneously)

**Option C:** Change Admin from a toggle to a direct view mode (e.g., `view === "admin"` instead of a separate `showAdmin` flag).
- Pro: Unifies all view modes into one state variable, making the precedence clearer
- Con: Larger refactor, requires updating the render logic and all nav handlers

The Architect should weigh these options against the intended UX (e.g., can an admin toggle the Admin panel on/off while in List view, or should entering List view always hide Admin?).

## Regression risk areas

The following code paths and features depend on or interact with `showAdmin` and `view` state, and changes to fix this bug must not break them:

- **`web/src/App.tsx:72-90`** (nav tab buttons): The "List", "Calendar", and "Admin" buttons update `view` and `showAdmin`. Any fix that changes when or how these update must ensure the buttons' visual active state (`className={... view === "X" ? "" : "btn-outline"}` at lines 72, 78) remains correct.

- **`web/src/components/ItemListView.tsx:21-29`** (useEffect on listId): This fetches items when `listId` changes. If the fix resets `showAdmin`, the component must actually render (not be hidden behind AdminPanel) for its effects to be observable. No regression risk here, but the fix must ensure ItemListView is rendered.

- **`web/src/components/AdminPanel.tsx`** (not shown in this investigation, but referenced at App.tsx:104): This component is only rendered when `showAdmin && user.role === "admin"`. The fix must not accidentally render it when it shouldn't (e.g., when a non-admin user clicks Admin, though line 83 gates it by role).

- **`web/src/components/CalendarView.tsx`** (line 106): Similar to ItemListView, this is only rendered when `view === "calendar"` (and `!showAdmin` due to the cascade). The fix must not prevent CalendarView from rendering when Calendar tab is clicked.

- **`web/src/components/ListSidebar.tsx:75`** (list selection click): The sidebar's list click handlers call `onSelect(list.id)`. If the fix resets `showAdmin` here, the sidebar's existing style logic (line 80, `background: selectedListId === list.id ? "#e8f5ee" : "transparent"`) must continue to work correctly.

- **`web/src/App.tsx:42-44`** (initial load useEffect): This calls `loadMe()` and initializes `selectedListId` to the first list if none is selected (lines 26-28). The fix should not interfere with this initialization.

- **Item editor / creation flows** (ItemEditor component, not fully shown): If users can edit/create items while the Admin panel is visible, the fix must not unintentionally close the Admin view mid-workflow.

## Reproduction result

**Status:** Confirmed in-browser via Playwright MCP on `http://localhost:8787` with `DEV_AUTH_IDENTITY="owner"` in `.dev.vars`.

**Steps and observations:**

1. App loads, authenticated as owner/admin. Initial state: `view="list"`, `showAdmin=false`. Main panel renders ItemListView with the selected list.

2. Click "Admin" nav button:
   - `showAdmin` toggles to `true`.
   - Main panel re-renders to AdminPanel (line 103 condition is now true).
   - Observation: "Admin — User Roster" table appears.

3. Click the "QA Dev Auth Shim Test List" item in the sidebar:
   - `setSelectedListId()` is called.
   - `showAdmin` remains `true` (never modified).
   - Main panel remains AdminPanel because line 103 condition is still true.
   - Observation: "Admin — User Roster" table still visible; list view does NOT appear.

4. Click "List" nav button:
   - `view` changes to `"list"`.
   - `showAdmin` remains `true` (never modified).
   - Main panel remains AdminPanel because line 103 condition is still true.
   - Observation: List button is now visually active (no `btn-outline` class), but "Admin — User Roster" still renders. The tab and panel are out of sync.

5. Click "Admin" nav button again (to toggle it):
   - `showAdmin` toggles to `false`.
   - Line 103 condition is now false, so the first `else if` is evaluated.
   - Since `view === "list"` (not "calendar"), the final `else` at line 108 is reached.
   - ItemListView is now rendered.
   - Observation: "QA Dev Auth Shim Test List" heading and items now appear in the main panel, consistent with the sidebar selection. The panel is now correct.

**Screenshots** (in `.playwright-mcp/`):
- `step2-admin.md` — AdminPanel rendered after clicking "Admin" button.
- `step3-after-click-list.md` — Sidebar list clicked, but AdminPanel still rendered (the bug).
- `step4-click-list-button.md` — "List" tab clicked (visually active), but AdminPanel still rendered (the bug).
- `step6-list-after-reload.md` — After page reload, AdminPanel rendered initially (state re-hydrated from default).
- `step7-admin-off.md` — After clicking "Admin" button to toggle it off, ItemListView finally renders correctly.

**Conclusion:** The bug is confirmed. The root cause is the unconditional render priority of `showAdmin` in App.tsx:103, combined with the lack of any code path that resets `showAdmin` when navigating away from the Admin panel via list selection or tab clicks.
