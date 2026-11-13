// ItemModal — single shared modal (Dialog on desktop, Sheet on mobile), rendered in view,
// edit, or create mode (item-view-mode plan Decision 1). Mounted separately in ItemListView
// and CalendarView, each owning its OWN useItemModal() state — see HC1 below.
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { EpochMs, Item, ItemDraft, List, User } from "../types";
import { ItemEditor } from "./ItemEditor";
import { ItemDetails } from "./ItemDetails";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { canWriteList } from "../lib/permissions";
import { setItemArchived } from "../apiClient";
import { buildDuplicateDraft } from "../lib/duplicateItem";

export type ItemModalState =
  | {
      mode: "create";
      // Duplicate's prefill (plan Decision 7/9). `sourceId` is a fresh id minted per
      // openDuplicate() call (NOT the source item's id) — it exists solely so the ItemEditor
      // `key` below changes on every duplicate invocation, including two consecutive
      // Duplicates of the SAME source item inside Radix's ~300ms close-animation window
      // (ItemEditor's draft is an initialiser-only useState; a same key would reuse stale
      // values).
      draft?: ItemDraft;
      sourceId?: string;
    }
  | {
      mode: "view";
      item: Item;
      // Calendar only. BOTH are per-occurrence values computed by the server
      // (src/worker/routes/items.ts:77-81); item.start_at/item.end_at describe the FIRST
      // occurrence only. Omitting occurrenceEndAt renders a backwards range — Decision 9.
      occurrenceAt?: EpochMs;
      occurrenceEndAt?: EpochMs;
    }
  | { mode: "edit"; item: Item };
// `null` (outside this union, in the hook's state type below) = closed.

// HC1 — HARD CONSTRAINT: plain per-instance useState and nothing else. No module-scoped
// variable, no React Context, no useSyncExternalStore, no external store, no singleton.
// "Shared hook" means shared CODE, not shared STATE. ItemListView and CalendarView each call
// this hook independently and get their OWN state cell; App.tsx renders those two components in
// mutually exclusive branches (never mounted at the same time), so there is no sync problem to
// solve. The moment this state escapes the component instance, unmount-on-view-switch stops
// discarding it and the B1/NEW-1 invariant (ItemListView.tsx:48-53) dies silently.
export function useItemModal() {
  const [state, setState] = useState<ItemModalState | null>(null);

  // Focus-restore fix (QA nit 1): the element that had focus when the modal was opened, so
  // ItemModal can return focus to it on close (Radix's automatic return-focus only fires for a
  // real DialogTrigger/SheetTrigger ref, which this controlled modal doesn't have). A ref is
  // per-instance state exactly like `state` above, so HC1 (no Context, no module scope, no
  // external store) holds — this does NOT introduce a shared store.
  const triggerRef = useRef<HTMLElement | null>(null);

  // useCallback with an empty dep array (only setState/triggerRef are captured, both of which
  // React guarantees stable identity for) so callers can list these in an effect's dep array
  // (e.g. ItemListView's createRequestToken effect) without triggering react-hooks/exhaustive-deps.
  const openCreate = useCallback(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setState({ mode: "create" });
  }, []);
  const openView = useCallback(
    (item: Item, occurrenceAt?: EpochMs, occurrenceEndAt?: EpochMs) => {
      triggerRef.current = document.activeElement as HTMLElement | null;
      setState({ mode: "view", item, occurrenceAt, occurrenceEndAt });
    },
    []
  );
  const openEdit = useCallback((item: Item) => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    setState({ mode: "edit", item });
  }, []);
  // Duplicate's modal transition (plan Decision 6/7/9): view -> create-with-draft, in one
  // local state update. No network call here — POST /api/items happens only when the user
  // saves the resulting create-mode form (ItemEditor, unchanged).
  const openDuplicate = useCallback((item: Item) => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const draft = buildDuplicateDraft(item, Date.now());
    setState({ mode: "create", draft, sourceId: crypto.randomUUID() });
  }, []);
  const close = useCallback(() => setState(null), []);

  return { state, openCreate, openView, openEdit, openDuplicate, close, triggerRef };
}

interface ItemModalProps {
  state: ItemModalState | null; // null = closed
  lists: List[];
  user: User;
  defaultListId?: string; // create mode only
  // Focus-restore fix (QA nit 1): the triggering element, from useItemModal()'s triggerRef.
  // Optional so a direct <ItemModal> usage that doesn't go through useItemModal() (e.g. a test)
  // keeps compiling — omitting it just falls back to Radix's default close-focus behavior.
  triggerRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  onEditRequested: (item: Item) => void;
  onSaved: (saved: Item) => void; // parent closes + refreshes
  // Duplicate's modal transition (Decision 9/N5.3): raises intent up to the host, which owns
  // the useItemModal() instance this modal's `state` prop is controlled by; the host wires this
  // to itemModal.openDuplicate(item). Mirrors onEditRequested's existing shape exactly.
  onDuplicateRequested: (item: Item) => void;
  // REQUIRED, not optional (plan N3/Decision 9): fired only after a successful
  // archive/restore call, separate from onSaved (which CalendarView now uses to navigate the
  // grid on save — reusing it for archive would be a state transition riding a callback named
  // for a different one). An omitted callback would leave a successful server-side write with
  // no surface refresh — a silent DB/UI divergence, which is worse than a compile error.
  onArchiveChanged: () => void;
}

export function ItemModal({
  state,
  lists,
  user,
  defaultListId,
  triggerRef,
  onClose,
  onEditRequested,
  onSaved,
  onDuplicateRequested,
  onArchiveChanged,
}: ItemModalProps) {
  // Archive/Restore call errors (network failure, a CONFLICT raced by another tab, etc.) have
  // nowhere else to surface — ItemDetails is a bare presentational component with no error
  // state of its own (mirrors ItemEditor's own local `error` state one level up).
  const [actionError, setActionError] = useState<string | null>(null);
  // Single-instance responsive surface, copied verbatim from ItemListView.tsx:64's original
  // editor shell (plan Decision 5/§8 step 6): a Dialog on desktop, a full-screen Sheet on
  // mobile. Under the jsdom matchMedia stub, isDesktop is false, so most tests exercise the
  // Sheet path; ItemModal.desktop.test.tsx covers the Dialog branch (R11).
  const isDesktop = useMediaQuery("(min-width: 768px)");

  // Decision 7 — retain the last non-null state while the modal animates closed. Deriving
  // directly from `state` would blank the title/body mid-close-animation (Radix keeps the
  // portal content mounted for the animation duration). Write point: a useEffect keyed on
  // `state`, so the ref only ever lags by one state transition (closed -> still-showing-old).
  const lastStateRef = useRef<ItemModalState | null>(null);
  useEffect(() => {
    if (state !== null) lastStateRef.current = state;
  }, [state]);

  // Clear a stale archive/restore error when the modal moves to a different item or mode —
  // otherwise a failed Archive on item A would still show while viewing item B.
  useEffect(() => {
    setActionError(null);
  }, [state]);

  // ALL hooks (useMediaQuery, useRef, this useEffect) must sit above this early return, or
  // react-hooks/rules-of-hooks fires.
  const effective = state ?? lastStateRef.current;
  if (effective === null) return null;

  // Derived from `state`, NOT from `effective` — this is what lets the close animation play:
  // `open` goes false (triggering Radix's data-[state=closed] animation) while `effective`
  // keeps rendering the outgoing content until the portal actually unmounts.
  const open = state !== null;

  // Focus-restore fix (QA nit 1): Radix's onCloseAutoFocus fires at close time with the event
  // that would otherwise move focus to <body>. Restore it to the triggering element instead —
  // but only if that element is still attached (it may have been removed from the DOM, e.g. the
  // item was deleted or the list re-rendered while the modal was open). When there is nothing
  // valid to restore to, do NOT preventDefault(): fall back to Radix's default behavior.
  const handleCloseAutoFocus = (event: Event) => {
    const trigger = triggerRef?.current;
    if (trigger && document.contains(trigger)) {
      event.preventDefault();
      trigger.focus();
    }
  };

  const title =
    effective.mode === "view"
      ? effective.item.title
      : effective.mode === "edit"
        ? "Edit Item"
        : "New Item";

  const canWrite =
    effective.mode === "view" ? canWriteList(lists.find((l) => l.id === effective.item.list_id), user) : false;

  // ItemModal owns the setItemArchived() HTTP call (N5.3) — ItemDetails' onArchive/onRestore
  // raise intent only. Fires onArchiveChanged (required) ONLY on success, so a host never
  // refreshes/closes over a failed write; a failure surfaces via actionError instead.
  //
  // Confirmation (plan §9.2): matches the repo's existing bare-confirm() idiom
  // (ItemListView.tsx's handleDelete, ListSidebar.tsx) rather than inventing a new dismissal
  // pattern. A9.2 — cancelling is a true no-op: no request, no optimistic UI, no scope change.
  // Copy names the item AND the direction, since Archive and Restore occupy the same control
  // position and "Archive/Restore this item?" alone would not distinguish them.
  const handleSetArchived = async (item: Item, archived: boolean) => {
    const verb = archived ? "Archive" : "Restore";
    if (!confirm(`${verb} "${item.title}"?`)) return;
    setActionError(null);
    try {
      await setItemArchived(item.id, archived);
      onArchiveChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const body = (
    <>
      {actionError && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {actionError}
        </div>
      )}
      {effective.mode === "view" && (
        <ItemDetails
          item={effective.item}
          occurrenceAt={effective.occurrenceAt}
          occurrenceEndAt={effective.occurrenceEndAt}
          lists={lists}
          user={user}
          canWrite={canWrite}
          onEdit={() => onEditRequested(effective.item)}
          onClose={onClose}
          onArchive={() => void handleSetArchived(effective.item, true)}
          onRestore={() => void handleSetArchived(effective.item, false)}
          onDuplicate={() => onDuplicateRequested(effective.item)}
        />
      )}
      {(effective.mode === "edit" || effective.mode === "create") && (
        <ItemEditor
          // Decision 7 / R12: key by item id (edit) or a fresh per-invocation id (create via
          // Duplicate) so Radix's 300ms close-animation mount window cannot show stale form
          // values — including two consecutive Duplicates of the SAME source item, which a
          // constant "create" key would not distinguish. state.item?.id does NOT typecheck —
          // the "create" arm has no `item` property at all.
          key={
            effective.mode === "edit"
              ? effective.item.id
              : "create:" + (effective.sourceId ?? "blank")
          }
          lists={lists}
          item={effective.mode === "edit" ? effective.item : undefined}
          defaultListId={defaultListId}
          initialDraft={effective.mode === "create" ? effective.draft : undefined}
          onSave={onSaved}
          onCancel={onClose}
        />
      )}
    </>
  );

  return isDesktop ? (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl" onCloseAutoFocus={handleCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle className="break-words">{title}</DialogTitle>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  ) : (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent side="bottom" className="h-full w-full sm:max-w-full" onCloseAutoFocus={handleCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle className="break-words">{title}</SheetTitle>
        </SheetHeader>
        {body}
      </SheetContent>
    </Sheet>
  );
}
