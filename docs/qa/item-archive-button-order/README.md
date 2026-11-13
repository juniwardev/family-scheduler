# Modal footer button order — 390px

Captured 2026-09-21 for the owner-requested reorder (View, Close, Archive, Duplicate).

| File | Shape |
| --- | --- |
| `active-footer.png` / `-page.png` | active, archivable item |
| `archived-footer.png` / `-page.png` | archived item |

Read live out of the DOM by the capturing spec:

```
active   => ["Close","Edit","Archive"]
archived => ["Close","Restore","Duplicate"]
```

## Why only two shapes

The gates in `ItemDetails.tsx` are mutually exclusive, so several orderings the request
implies are unreachable:

```
canEdit      = canWrite && !isArchived
canArchive   = canWrite && !isArchived && isArchivable(...)
canRestore   = canWrite &&  isArchived
canDuplicate = canWrite &&  isArchived
```

`canArchive ∧ canDuplicate` is unsatisfiable, and so is `canEdit ∧ canRestore`. **Archive and
Duplicate can never appear side by side**, so their relative order is not observable.
`View` lives on the list row, never in this footer, so it never co-occurs with `Close` either.

The list row is unchanged and already led with View: `View` · `Edit` · `Delete`
(pinned by `ItemListView.test.tsx`'s requirement-4 test).

## Reproducing

Captured by a throwaway spec under `e2e/`, deleted after use (same convention as
`calendar-toggle-wrap-fix-screenshots/`). It route-mocked via `installArchiveApiMocks` with one
active and one archived item and screenshotted `[data-testid="item-details-actions"]`.

One trap hit while writing it: `getByRole("button", { name: "Close" })` is **not** unique —
Radix's own dialog dismiss also matches, a strict-mode violation. Scope to the footer testid.
This is the same hazard already recorded at `App.deeplink.test.tsx:142`.

## Not changed

On the archived shape all three buttons are `variant="outline"`, so `Restore` carries no primary
emphasis (the active shape still has `Edit` filled). Noted, not acted on.
