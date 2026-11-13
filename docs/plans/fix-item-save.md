# Fix Plan: Partial Item Persists When Adding a Reminder During Create

Slug: `fix-item-save`
Type: Defect fix (frontend form-flow bug + one server validation path) + test-harness provisioning. **No schema migration.**
Locked areas untouched: reminder engine (materialize/send/dispatch), auth, notification/push path.

---

## Amendment log (READ FIRST)

- **v1 (superseded):** Diagnosed this as a server-side *validation-gate* bug and concluded the
  load-bearing hole was on `PATCH /api/items/:id` (create was "already gated"). That framing was
  wrong for the reported symptom.
- **v2 (superseded):** The owner reproduced the actual defect: **an incomplete item is persisted
  the moment the user clicks "Add reminder" during item CREATION.** The root cause is a **frontend
  form-flow bug**, not a server gate. This plan is reframed around that.
  - **One further correction to the owner's hypothesis (evidence-based):** the owner suspected the
    form "creates the item EARLY (POSTs it to get an item ID so the reminder can be attached)".
    Reading the code, that early-POST-for-ID flow **does not exist**. Reminders are already held in
    local form state and already submitted inline in a single `POST /api/items`. The real mechanism
    is narrower and simpler: the **"Add reminder" / "×" buttons in `ReminderEditor` have no `type`
    attribute, so inside the `<form>` they default to `type="submit"`** and fire the form's submit
    handler prematurely. See §3.2: the single-call create payload the owner wanted already exists, so
    **no server change is needed for create.**
  - The v1 PATCH empty-title validation hole is real and is folded in here (§4.3) as a small,
    same-class hardening, not the primary fix.
- **v3 (this revision — folds in Plan-Review "APPROVE WITH CHANGES", `docs/reviews/fix-item-save-review.md`):**
  The reviewer confirmed the whole diagnosis (missing-`type` root cause, complete button sweep,
  create-is-frontend-only, the real edit-flow dropped-reminders bug, the real PATCH blank-title
  hole). Four amendments were required and are folded in here without disturbing the confirmed parts:
  1. **Test harness (was Major):** DC1/DC3 (the load-bearing frontend regression) had **no runnable
     harness** — the only Vitest config is the workers-runtime pool (no DOM), there is no
     `@testing-library/react`/`jsdom`, and no `playwright.config.*`. The API-layer "assert no rows"
     fallback **cannot fail on pre-fix code**, so it does not prove the fix. **Owner decision: "jsdom
     now, Playwright later."** This revision provisions a jsdom component-test harness as the
     load-bearing regression guard **in this fix** (§8.1) and marks Playwright E2E as an explicit
     **deferred follow-up** (§8.4), out of scope here.
  2. **PATCH `type` third hole (Minor 1):** §4.3's old claim that PATCH `type` was "already
     enum-guarded" was **FALSE** — `routes/items.ts:157` casts an arbitrary string straight through
     (`{type:"bogus"}` currently persists). `validateItemPatch` now closes this **third** write hole
     (title, plus type; start_at defensive). §4.3 corrected.
  3. **Edit-flow reminder merge (Minor 2):** `updateItem` returns **stale** reminders (`db.ts:643`
     reads reminders *before* the PUT replaces them). The edit save must compose the updated item
     with the **fresh** reminders returned by `replaceReminders` so the UI reflects persisted state:
     `onSave({ ...saved, reminders: <replaceReminders result> })`. §4.2 corrected.
  4. **Atomic-wording correction (Minor 3):** create is a **single API call guarded by pre-write
     validation**, **NOT a DB transaction** (`_upsertReminders` runs sequential `.run()`s in the same
     handler, not wrapped in `db.batch()`/transaction). Wording fixed in §3.2/§4.1/§7/§8 so the
     Coder/QA do not assume transactional rollback semantics. An OPTIONAL (non-required) note on
     wrapping create in a D1 transaction is added to §7 — not in scope, no engine/data-model change.

---

## 1. Problem statement and goals

**Symptom (owner-confirmed):** While creating an item, clicking **"Add reminder"** persists a
half-finished item to the DB before the user has finished the form and pressed Create. The editor
then closes (the save handler runs), leaving a partial item the user must reopen and fix.

**Goals:**
1. No item (and no reminder) is written to the DB until the user commits the form with the final
   **Create/Save** button. Configuring reminders/recurrence mid-form must persist nothing.
2. On final submit, a create writes the item **and** its N reminders in the single existing
   `POST /api/items` call.
3. The **edit** flow behaves the same way: reminder edits are held in local state and persisted only
   on final Save (and are actually persisted — today they are silently dropped; see §4.2), and the
   saved item returned to the UI reflects the freshly-persisted reminders (§4.2 merge).
4. Close the related `PATCH /api/items/:id` validation holes (same class: a write path missing
   validation) — **blank title** and **invalid `type`** (§4.3).
5. Provision a jsdom component-test harness so the load-bearing frontend regression (DC1/DC3) is
   actually runnable and fails on pre-fix code (§8.1).

## 2. Non-goals

- No schema migration; the `item_reminders` table already exists and is unchanged.
- No changes to the reminder engine (materialize/send/dispatch), auth, or push/notification path.
- No new `Result` code (reuse `VALIDATION` → `400`).
- No IANA-timezone validity enforcement (server defaults `timezone`; out of scope — see §7).
- No redesign of the reminder/recurrence sub-form UX beyond the button-type fix.
- **No Playwright E2E in this change** — provisioning `playwright.config.*` + a dev server + a
  Cloudflare Access bypass is a deferred follow-up (§8.4), not this fix.
- No DB transaction wrapping of create (`_upsertReminders`) — optional consideration only (§7).

---

## 3. Root cause (with file:line evidence)

### 3.1 The premature-persistence trigger — a default-submit button

`ReminderEditor` renders its two action buttons **without a `type` attribute**:

- `web/src/components/ReminderEditor.tsx:104` — `<button className="btn btn-sm btn-danger" onClick={() => remove(i)}>×</button>`
- `web/src/components/ReminderEditor.tsx:107` — `<button className="btn btn-sm btn-outline" onClick={add}>+ Add reminder</button>`

`ReminderEditor` is rendered **inside** the `ItemEditor` `<form>`
(`web/src/components/ItemEditor.tsx:221-224`, form opens at `:83`). Per the HTML spec, a `<button>`
with no `type` inside a form defaults to **`type="submit"`**. So clicking "+ Add reminder" (or "×")
does two things:

1. Runs the React `onClick` → `add()`/`remove()` → `onChange` → `setField("reminders", …)`
   (`ItemEditor.tsx:224`). This is a **batched** state update; `draft` is not updated synchronously.
2. Fires the form's native submit → `ItemEditor.handleSubmit` (`ItemEditor.tsx:53`), which calls
   `createItem(draft)` (`:72`) in create mode using the **current** `draft` (title/start already
   filled, minus the not-yet-committed reminder).

Result: if the user has already typed a title and start (the common case), the server accepts the
create and a **partial item is persisted early**; `onSave(saved)` (`:73`) then closes the editor.
This exactly matches the owner's reproduction.

**Contrast (proves the diagnosis):** `RecurrenceEditor`'s weekday buttons **do** set
`type="button"` (`web/src/components/RecurrenceEditor.tsx:131-134`), which is why interacting with
recurrence does **not** trigger the premature save. `ItemEditor`'s own submit button correctly uses
`type="submit"` (`:228`) and Cancel uses `type="button"` (`:231`). The only offenders are the two
`ReminderEditor` buttons.

### 3.2 Verdict: does `POST /api/items` already accept reminders in a single call? — YES

The owner asked to verify this before assuming a server change is needed. It is **not** needed:

- **Client already batches:** reminders live in `draft.reminders` local state
  (`ItemEditor.tsx:43`, wired to `ReminderEditor` at `:221-224`). On final submit in create mode,
  `createItem(draft)` posts the whole draft — reminders included — in one request
  (`ItemEditor.tsx:72` → `apiClient.ts:108-112`, `POST /items` with the draft body).
- **Route accepts reminders inline:** `POST /api/items` reads `reminders`
  (`src/worker/routes/items.ts:122`, `reminders: Array.isArray(b.reminders) ? b.reminders : []`) and
  validates each entry in `validateItemInput` (`items.ts:234-244`).
- **DB writes item + reminders in one handler/function:** `createItem` INSERTs the item then calls
  `_upsertReminders(db, id, input.reminders ?? [])` (`src/worker/db.ts:572`, helper at `:790-815`)
  — the reminders are written against the new item id **in the same function**, no early client
  round-trip to obtain an id.
- **Design intent matches:** design §2.3 `POST /api/items` shows `reminders` inline in the request
  body and returns `201 { item: ItemWithReminders }` (`docs/plans/family-scheduler-design.md:407-412`).
- **The separate reminders path is unused by the form:** `PUT /api/items/:id/reminders`
  (`src/worker/routes/reminders.ts:12`, → `replaceReminders` `db.ts:768`) and the client helper
  `replaceReminders` (`apiClient.ts:148-153`) exist, but **no component calls the client helper**
  (grep: only defined, never imported by a component). The create flow does not use it.

**Precision on "single call" (per Plan-Review Minor 3 — do NOT read this as transactional):** the
create is **one HTTP request** handled by **one DB function** (`createItem`), but that function issues
**sequential `.run()` calls** (item INSERT, then the DELETE + N reminder INSERTs inside
`_upsertReminders`) with **no `db.batch()` / DB transaction**. A failure partway through
`_upsertReminders` could in principle leave an item persisted without its reminders. In practice this
path is **not reachable via the API for bad input**, because `validateItemInput` (`items.ts:234-244`)
rejects malformed reminders **before any write** — the safety here comes from **pre-write validation,
not from rollback**. So describe create as "single API call, guarded by pre-write validation," never
as "atomic/transactional."

**Conclusion:** the create-side fix is **frontend-only**. There is no early create, and no server
change is required to make create single-call — it already is. This *reduces* scope versus the
kickoff's contingency. (No blocker, no schema change.)

---

## 4. The fix

### 4.1 Create flow — stop the premature submit (primary fix)

In `web/src/components/ReminderEditor.tsx`, add `type="button"` to both buttons so they never submit
the enclosing form:

- `:104` — the remove (`×`) button → add `type="button"`.
- `:107` — the "+ Add reminder" button → add `type="button"`.

After this, clicking either button only mutates `draft.reminders` in local state. Nothing is
persisted until the user presses **Create**, at which point the existing single-call
`POST /api/items` writes the item and all reminders together (§3.2 — single call guarded by pre-write
validation, not a transaction). No other create-flow change is required.

> Defense-in-depth (recommended, low cost): audit any other `<button>` inside the `ItemEditor` form
> subtree for a missing `type`. Current audit result (reviewer-confirmed): only
> `ReminderEditor:104,107` are missing it; `RecurrenceEditor` buttons and `ItemEditor`'s own buttons
> are already correct. Coder should re-confirm during implementation and set `type="button"` on any
> non-submit button found.

> Not a defect (reviewer note): the text inputs (`ItemEditor.tsx:125`, `:207`) still allow the
> standard "press Enter to submit" behavior. That is intended and out of scope — do not suppress it.

### 4.2 Edit flow — same deferral, actually persist reminders, and merge the fresh set into `onSave`

Two issues on the edit path share the same form:

1. **Same premature-submit trigger.** The §4.1 button-type fix resolves this for edit too (in edit
   mode the stray submit calls `updateItem` at `ItemEditor.tsx:59` and closes the editor early).
2. **Edit silently drops reminder changes.** In edit mode `handleSubmit` calls `updateItem(item.id,
   {...})` with **no reminders** (`ItemEditor.tsx:58-70`); `ItemUpdatePatch` has no `reminders`
   field (`apiClient.ts:114-124`) and `PATCH /api/items/:id` does not touch reminders
   (`routes/items.ts:156-166`; `db.updateItem` `:582-645` has no reminder write). So editing a
   reminder in the form today changes local state but is **never saved**. (Reviewer: this is a
   genuine pre-existing bug, and folding its fix in here **widens blast radius** by newly activating
   the previously-unused `PUT` path — acknowledged explicitly, with its own regression test DC3.)

**Fix (deferred-until-submit, reuse the existing PUT path):** in `ItemEditor.handleSubmit`, edit
branch, after `updateItem(...)` resolves, persist the reminder set via the existing
`replaceReminders(item.id, draft.reminders)` client helper (`apiClient.ts:148-153` →
`PUT /api/items/:id/reminders` → `db.replaceReminders`, which also runs the D7 dispatch purge).

**Merge the fresh reminder set into `onSave` (Plan-Review Minor 2 — REQUIRED):** `updateItem` returns
an `ItemWithReminders` whose `reminders` reflect the **OLD** set, because `db.updateItem` reads
reminders **before** the PUT replaces them (`db.ts:643` — `const reminders = await
getItemReminders(db, id)` runs inside `updateItem`, prior to any `replaceReminders` call).
`replaceReminders` returns the **NEW** set (`apiClient.ts:151`, `{ reminders: ItemReminder[] }`). If
the Coder passes the raw `updateItem` result to `onSave`, the UI shows **stale reminders**. So the
edit save MUST compose them:

```
const { item: saved } = await updateItem(item.id, { /* metadata, no reminders */ });
const { reminders } = await replaceReminders(item.id, draft.reminders);
onSave({ ...saved, reminders });
```

Ordering and failure handling (call out explicitly):
- The item already exists, so there is **no orphan risk** — this is why two requests are acceptable
  here (unlike create, which stays single-call). Order: `updateItem` first (metadata), then
  `replaceReminders` (reminder set). `replaceReminders` requires the item to exist; it does.
- If `updateItem` fails: abort, surface the error, do not call `replaceReminders`, do not call
  `onSave` (both awaits precede `onSave` inside the `try`, so a throw correctly skips it and the
  editor stays open).
- If `replaceReminders` fails **after** a successful `updateItem`: surface a **distinct** error to
  the user (item metadata is saved but the reminder set is unchanged and the user can retry). Do not
  call `onSave`. Document this as a known, recoverable partial-failure boundary — do not add a
  transaction across two HTTP calls in this fix.
- Abandoning the edit (Cancel) persists nothing — Cancel is already `type="button"` (`:231`).

> Alternative considered and rejected for now: extend `PATCH /api/items/:id` to accept an optional
> `reminders` array so edit is also single-call. That is a larger server change than the defect
> warrants and is **not** required to fix the reported bug. Reviewer concurs: keep the reuse-PUT
> approach (minimal, no route/`db` change; partial-failure window is recoverable and surfaced), and
> log single-call PATCH as a documented follow-up, not scope.

### 4.3 Server hardening — `PATCH /api/items/:id` blank-title AND invalid-`type` holes (fold-in from v1; corrected per Minor 1)

Independent of the form flow, `PATCH /api/items/:id` has **two** live write holes plus one defensive case:

**(a) Blank title (title hole).**
- The route sets `title: typeof b.title === "string" ? b.title.trim() : undefined`
  (`src/worker/routes/items.ts:158`) — an empty/whitespace title trims to `""`, which is a string,
  so it is passed through (not `undefined`).
- `updateItem` binds `patch.title ?? null` into `title = COALESCE(?, title)`
  (`src/worker/db.ts:620` binding, `:607` SQL). `??` only catches `null`/`undefined`, so `""`
  survives and `COALESCE('', title)` writes the empty string. `title TEXT NOT NULL` is satisfied by
  `''`, so **an item can be edited to a blank title.**

**(b) Invalid `type` (THIRD hole — corrected from v2's false "already enum-guarded" claim).**
- The route does `type: typeof b.type === "string" ? (b.type as "event" | "task") : undefined`
  (`src/worker/routes/items.ts:157`). This casts **any** string straight through with **no enum
  validation**. So `PATCH {type:"bogus"}` currently persists `"bogus"` via `COALESCE('bogus', type)`.
  **This is a live, currently-open hole — NOT already guarded.** The `validateItemPatch` `type` branch
  below is therefore load-bearing, not redundant; do **not** drop it as "redundant."

**Fix:** add a small partial-input validator in `routes/items.ts` and call it in the PATCH handler
**before** `updateItem` runs (before any SQL write), returning `400 { code: "VALIDATION" }`:

```
// Validates a PATCH body: only fields PRESENT are checked; a present required field must be valid.
function validateItemPatch(b: Record<string, unknown>): string | null {
  if ("title" in b) {
    const t = typeof b.title === "string" ? b.title.trim() : "";
    if (typeof b.title !== "string" || t.length === 0 || t.length > 200) {
      return "title must be 1–200 chars";
    }
  }
  if ("start_at" in b) {
    if (typeof b.start_at !== "number" || Number.isNaN(b.start_at)) {
      return "start_at (EpochMs) must be a number";
    }
  }
  if ("type" in b && b.type !== "event" && b.type !== "task") {
    return "type must be 'event' or 'task'";
  }
  return null;
}
```

Wire it immediately after `const b = body as Record<...>` (`items.ts:143`), before the existing
`rrule`/`end_at` checks and before `updateItem`:

```
const patchErr = validateItemPatch(b);
if (patchErr) return c.json({ error: { code: "VALIDATION", message: patchErr } }, 400);
```

Scope note (corrected): the PATCH path now closes **two** live holes — **`title`** (the
`?? … COALESCE` empty-string hole) and **`type`** (the arbitrary-string cast at `items.ts:157`).
`start_at` shares the `COALESCE(?, start_at)` pattern (`db.ts:610`, bind `:623`) but is guarded at
the route by `typeof b.start_at === "number"` (`items.ts:161`), and JSON cannot carry `NaN`
(`JSON.stringify(NaN) === "null"` → treated as absent), so the `start_at` branch above is
**defensive only**. Do not broaden beyond these three fields.

### 4.4 Client-side surfacing (small, optional but recommended)

`handleSubmit`'s catch does `setError(String(err))` (`ItemEditor.tsx:76`). Since the server now
returns field-named `VALIDATION` messages and thrown errors are `ApiError` (`apiClient.ts:15`),
replace with `setError(err instanceof ApiError ? err.message : String(err))` (import `ApiError` from
`../apiClient`) so a backstop `400` shows a clean message. This is a display nicety, not load-bearing.

---

## 5. Affected files and modules

| File | Change |
|------|--------|
| `web/src/components/ReminderEditor.tsx` | Add `type="button"` to both buttons (`:104`, `:107`). **Primary fix.** |
| `web/src/components/ItemEditor.tsx` | Edit branch of `handleSubmit`: after `updateItem`, call `replaceReminders(item.id, draft.reminders)` and `onSave({ ...saved, reminders })` (merge fresh set); distinct error if the PUT fails after a successful PATCH; use `ApiError.message` for the error banner. |
| `web/src/apiClient.ts` | No change needed (`replaceReminders` already exists, `:148-153`); it just becomes used by `ItemEditor`. |
| `src/worker/routes/items.ts` | Add `validateItemPatch` (title + type + defensive start_at); call before `updateItem` in the PATCH handler. Create path unchanged. |
| `src/worker/db.ts` | No change required (route rejects bad input before `updateItem`). |
| `package.json` | Add devDependencies: `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` (§8.1). No script change required if using a single Vitest workspace/root config; see §8.1. |
| `vitest.config.ts` (or new `vitest.workspace.ts`) | Split into two Vitest projects: existing `defineWorkersConfig` (worker/`tests/**/*.test.ts`) + a new jsdom project for `web/**/*.test.tsx`. Existing `npm test` must still run both cleanly (§8.1). |
| `web/src/components/ItemEditor.test.tsx` (new) | jsdom component test — the DC1/DC3 load-bearing regression that fails on pre-fix code (§8.1). |
| `tests/setup/jsdom.setup.ts` (new, optional) | `@testing-library/jest-dom` matchers import for the jsdom project. |
| `docs/plans/fix-item-save.md` | This plan. |

## 6. Data model and API changes

**None.** No migration. `POST /api/items` already accepts `reminders` inline (§3.2); `PATCH`
response shapes are unchanged — PATCH now returns `400 VALIDATION` for a blank title or invalid
`type` instead of silently writing them. Edit-flow reminder persistence reuses the existing
`PUT /api/items/:id/reminders`. Harness changes are devDependencies + test config only (allowed and
expected — not an engine/schema change).

---

## 7. Risks, edge cases, and open questions

- **Batched-state timing (why the bug persisted "silently"):** because `setField` is batched, the
  stray submit posts `draft` *without* the reminder just added — a subtly incomplete item. The fix
  removes the stray submit entirely, so ordering no longer matters.
- **Create is single-call, not transactional (Minor 3):** `createItem` runs sequential `.run()`s
  (`db.ts:547-572`) with no `db.batch()`/transaction. It is safe **only because** `validateItemInput`
  rejects bad input before any write. Do not assume rollback. **OPTIONAL consideration (NOT scope,
  no engine/data-model change):** create could later be wrapped in a D1 `db.batch()` for true
  all-or-nothing writes; this is a hardening nicety, deliberately excluded here to keep the fix
  minimal and because pre-write validation already closes the reachable failure path.
- **Edit two-call boundary:** §4.2 is not transactional across the `PATCH` + `PUT`. Documented as a
  recoverable partial-failure (item saved, reminders retryable), surfaced with a distinct error. If
  the reviewer wants strict atomicity, escalate to the §4.2 "alternative" (single-call PATCH with
  reminders) — additive server change, still no schema change, logged as follow-up.
- **Edit blast-radius (Minor):** the reminder-persist fix newly activates the previously-unused `PUT`
  path. Acknowledged as a distinct fix from the reported create bug; covered by its own regression
  (DC3) and by the merge assertion.
- **`replaceReminders` D7 side effect:** it purges pending dispatch for the item (`db.ts:784`), which
  is the intended behavior when a reminder set changes (design §2.4). Editing an item's reminders
  will correctly trigger a materialize rebuild. No engine change; P2-N1 (purge-before-cascade) is
  untouched.
- **Regression risk — recurrence/other buttons:** confirm no other in-form `<button>` lost its
  `type` (audit says only the two in `ReminderEditor`). Adding `type="button"` cannot regress the
  submit button (unchanged `type="submit"`).
- **Open question (out of scope unless owner says otherwise):** should edit be made single-call
  (§4.2 alternative) for true atomicity, or is the reuse-PUT approach acceptable? This plan (and the
  reviewer) assume reuse-PUT (minimal).
- **Open question (deferred, pre-existing):** `timezone` is never validated as a real IANA zone on
  create/update though design §2.3 says it should be. Not part of this defect; flagging only.

---

## 8. Tests (mapped to done-conditions)

Server cases use the existing `tests/unit/routing.test.ts` harness (Hono app + local D1 via
`@cloudflare/vitest-pool-workers`). The load-bearing **frontend** regression (DC1/DC3) uses the new
jsdom component-test harness provisioned in §8.1 (behavioral assertion that FAILS on pre-fix code).
The prior "assert no rows at the API layer" fallback is **removed as the DC1 proof** — it cannot fail
on pre-fix code (pre-fix, the extra POST is triggered by a DOM click, not by an API-layer test), so
it does not prove the frontend fix.

### 8.1 Harness provisioning (jsdom now — REQUIRED in this fix)

**Dependencies (devDependencies; Coder installs):**
- `@testing-library/react`
- `@testing-library/user-event`
- `@testing-library/jest-dom`
- `jsdom`

(`@vitejs/plugin-react`, `react`, `react-dom`, `@types/react*`, `vitest` are already present in
`package.json`.)

**Dual Vitest project config (do NOT break the existing workers pool):** the current
`vitest.config.ts` is a single `defineWorkersConfig` with `include: ["tests/**/*.test.ts"]` (workers
runtime, no DOM, `.test.ts` only). Split into **two projects** so worker tests and DOM component
tests coexist and a single `npm test` runs both. Recommended mechanism — a Vitest workspace:

- Add `vitest.workspace.ts` at repo root listing two projects:
  1. **worker project** — the existing `defineWorkersConfig` (keep `wrangler`/`miniflare` D1 setup),
     scoped to `include: ["tests/**/*.test.ts", "src/worker/**/*.test.ts"]` (workers pool).
  2. **web project** — `environment: 'jsdom'`, `plugins: [react()]`, scoped to
     `include: ["web/**/*.test.tsx"]`, with `setupFiles: ["tests/setup/jsdom.setup.ts"]` importing
     `@testing-library/jest-dom`.
- **Glob discipline so the two never collide:** worker tests stay `*.test.ts` under `tests/` and
  `src/worker/`; component tests are `*.test.tsx` under `web/`. The workers project must NOT include
  `.tsx`, and the jsdom project must NOT include the worker `tests/**/*.test.ts`. (If a workspace
  proves awkward, a separate `vitest.web.config.ts` invoked as a second project is acceptable, as
  long as `npm test` runs both — e.g. `vitest run` picks up the workspace, or the `test` script runs
  both configs. Prefer the workspace to keep `"test": "vitest run"` unchanged.)
- **Acceptance:** `npm test` runs the worker suite AND the jsdom suite, both green after the fix; the
  worker suite behavior is unchanged from today.

**The component test (`web/src/components/ItemEditor.test.tsx`):**
- Render `<ItemEditor>` in **create mode** (no `item` prop), with a **mocked create path** —
  `vi.mock('../apiClient')` (or inject a spy) so `createItem` and `onSave` are spies.
- Fill `Title` and `Start`, then `userEvent.click` the **"+ Add reminder"** button.
- **Behavioral assertion (the real regression):** `expect(createItem).not.toHaveBeenCalled()` and
  `expect(onSave).not.toHaveBeenCalled()`. This **FAILS on pre-fix code** (the default-submit button
  fires `handleSubmit` → `createItem`) and **PASSES after** `type="button"` is added.
- **Optional cheap static backstop:** also assert the buttons carry `type="button"`
  (`expect(screen.getByRole('button', { name: /add reminder/i })).toHaveAttribute('type', 'button')`).
  This is a guard, not the load-bearing proof — the "no submit fired" assertion is.

### 8.2 Done-conditions — frontend (jsdom, §8.1 harness)

- **DC1 — mid-form "Add reminder" during CREATE persists nothing (load-bearing regression):**
  render `ItemEditor` create mode, fill title + start, click "+ Add reminder". Assert `createItem`
  and `onSave` were **not** called. MUST fail pre-fix, pass post-fix. (Optional static backstop:
  buttons are `type="button"`.)
- **DC3 — EDIT holds reminder changes until submit, then persists + merges:** render `ItemEditor`
  edit mode for an existing item; add/modify a reminder and click "+ Add reminder" → assert neither
  `updateItem` nor `replaceReminders` fired (mid-form). Then click **Save** → assert `updateItem`
  fired, then `replaceReminders` fired with the edited set, and `onSave` was called with an item
  whose `reminders` equal the **`replaceReminders` result** (the merge — proves stale reminders are
  not surfaced). Cancel mid-edit → assert neither API call fired.

### 8.3 Done-conditions — server (existing workers-pool harness)

- **DC2 — final submit creates item + N reminders in one call:** POST a complete body (title, start,
  2 reminders) → exactly one item row and 2 reminder rows. If the create is rejected (e.g., missing
  required field), assert **zero** items and **zero** reminders persisted. Note: this rests on
  **pre-write validation** (`validateItemInput`), not on a DB transaction — the assertion is "bad
  input writes nothing because it is rejected before any write," not "a mid-write failure rolled
  back."
- **DC4 — PATCH validation, nothing written:** `PATCH /api/items/:id` with `{title:""}` → `400`,
  `error.code === "VALIDATION"` naming `title`; with `{title:"   "}` → same; with `{type:"bogus"}`
  → `400 VALIDATION` naming `type` (the third hole). After each, re-`SELECT` the row and assert the
  field is the **old** value (holes closed). These FAIL on pre-fix code.
- **DC5 — happy paths preserved:** a fully-completed create still returns `201`; a create missing a
  required field still returns `400 VALIDATION` (existing behavior); `PATCH {title:"New"}` → `200`
  with title updated; `PATCH {type:"task"}` → `200`; editing `location`/`notes` to `null` still
  succeeds (optional fields unaffected).

### 8.4 Deferred follow-up — Playwright E2E (NOT in this change)

A full-stack E2E (real dev server, real DOM, real DB) that reproduces the create-flow bug end-to-end
is valuable but **out of scope here**. It requires provisioning `playwright.config.*`, a dev server,
and a Cloudflare Access bypass (the app is Access-JWT gated), none of which exist today
(`package.json:24` lists `@playwright/test` and `test:e2e` is scripted, but there is no
`playwright.config.*` and zero e2e tests). **Deferred:** fold this into the broader live-deploy QA
checklist as a separate item. The Coder should **not** provision Playwright now.

Supporting context kept from v1 (required-field set, for the single-call-create payload validation,
not as "the fix"): create requires `{list_id, type, title, start_at}` for **both** `event` and
`task` (single set — `start_at` is `INTEGER NOT NULL` for both and drives reminders; `end_at`
optional). This is already enforced by `validateItemInput` (`items.ts:223-246`) and stays as-is.

---

## 9. Implementation checklist (for the Coder)

1. `web/src/components/ReminderEditor.tsx`: add `type="button"` to the buttons at `:104` and `:107`.
   Run `npm run typecheck` and `npm run lint`.
2. `web/src/components/ItemEditor.tsx`: in `handleSubmit`'s edit branch, after `updateItem` resolves,
   call `replaceReminders(item.id, draft.reminders)` (import from `../apiClient`); call
   `onSave({ ...saved, reminders })` using the **fresh** reminders from `replaceReminders` (merge —
   §4.2, Minor 2). Surface a **distinct** error if `replaceReminders` fails after a successful
   `updateItem`, and do not call `onSave` in that case. Swap the error banner to
   `err instanceof ApiError ? err.message : String(err)`. Lint + typecheck.
3. Audit the `ItemEditor` form subtree for any other `<button>` missing `type`; set `type="button"`
   where it is not a submit. (Expected: none beyond step 1.)
4. `src/worker/routes/items.ts`: add `validateItemPatch` (checks **title**, **type**, and defensive
   **start_at** — §4.3) and call it in the PATCH handler right after parsing `b`, before the
   `rrule`/`end_at` checks and `updateItem`. Return `400 VALIDATION`. Keep the `type` check — it
   closes the live third hole (`items.ts:157` casts any string). Do not change the create path.
   Lint + typecheck.
5. **Provision the jsdom harness (§8.1):** install `@testing-library/react`,
   `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom` as devDependencies; add the
   dual-project Vitest config (workspace or second config) with the `.test.ts` (workers) vs
   `.test.tsx` (jsdom/`web`) glob split; add the jsdom setup file. Confirm `npm test` runs BOTH
   suites cleanly.
6. Add the DC1/DC3 component test (`web/src/components/ItemEditor.test.tsx`, §8.1/§8.2). **Verify DC1
   fails on the pre-fix code** (revert step 1 locally to confirm the "no submit fired" assertion goes
   red), then re-apply the fix and confirm green. Do NOT provision Playwright (§8.4 deferred).
7. Add the server tests DC2/DC4/DC5 (§8.3) to the workers-pool harness; DC4 must fail on pre-fix code.
8. Run `npm test` (both projects), `npm run typecheck`, `npm run lint`. Do not run `npm run test:e2e`
   (no Playwright config in this change).

Flow: this plan → Plan-Reviewer → Coder → QA. **No data-model/schema change.** Create is already
single-call (§3.2 — guarded by pre-write validation, not a transaction), so the create fix is
frontend-only; server changes are the scoped PATCH title+type validation guard (§4.3); the harness is
devDependencies + test config only (jsdom now, Playwright deferred §8.4).
