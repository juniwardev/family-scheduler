import React, { useState, useEffect, useCallback } from "react";
import { Calendar, List as ListIcon, ShieldCheck, PlusCircle, Menu } from "lucide-react";
import type { User, List, Item, AppView } from "./types";
import { getMe, getItem, ApiError } from "./apiClient";
import { parseItemDeepLink } from "../../src/shared/deepLink";
import { ListSidebar } from "./components/ListSidebar";
import { ItemListView } from "./components/ItemListView";
import { CalendarView } from "./components/CalendarView";
import { InstallBanner } from "./components/InstallBanner";
import { AdminPanel } from "./components/AdminPanel";
import { Button } from "./components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./components/ui/sheet";
import { cn } from "./lib/utils";

interface NavItem {
  view: AppView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [lists, setLists] = useState<List[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<AppView>("list");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deactivated, setDeactivated] = useState(false);
  // Deep-link ("?item=<id>") resolution state. initialOpenItem is handed down to
  // ItemListView to auto-open that item's editor. NEW-1 (round-2 review): App — not the
  // child — owns the one-shot: it clears initialOpenItem back to null the first time
  // ItemListView reports it has consumed it (onInitialOpenItemConsumed below), so
  // switching to Calendar/Admin and back (which unmounts/remounts ItemListView, resetting
  // any component-local ref guard) does NOT reopen the editor a second time.
  const [initialOpenItem, setInitialOpenItem] = useState<Item | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  // Mobile-only "Lists ▾" Sheet (wraps ListSidebar's list picker). Purely presentational UI
  // state — does not touch activeView or the deep-link one-shot.
  const [listsSheetOpen, setListsSheetOpen] = useState(false);
  // Incrementing token so the mobile top-bar "+ New" button can open ItemListView's create
  // flow without lifting showCreate/editingItem out of ItemListView (B1) — see
  // ItemListView's createRequestToken prop doc.
  const [createRequestToken, setCreateRequestToken] = useState(0);

  const loadMe = useCallback(async () => {
    try {
      const data = await getMe();
      setUser(data.user);
      setLists(data.lists);
      if (!selectedListId && data.lists.length > 0) {
        setSelectedListId(data.lists[0].id);
      }

      // Deep-link resolution: parse ?item=<id> and point-read it (GET /api/items/:id) —
      // no N-list fan-out. Runs once, in/after loadMe, same as the initial list selection.
      const deepId = parseItemDeepLink(window.location.search);
      if (deepId) {
        try {
          const { item } = await getItem(deepId);
          setSelectedListId(item.list_id);
          setActiveView("list");
          setInitialOpenItem(item);
        } catch (deepLinkErr) {
          // 403/404 (ApiError) — item deleted or not visible to this recipient. No data
          // leak (server authz already gated it); fall back to the normal load with a
          // subtle notice instead of a hard error.
          if (deepLinkErr instanceof ApiError) {
            setDeepLinkNotice("That item is no longer available.");
          } else {
            throw deepLinkErr;
          }
        }
      }
    } catch (err) {
      // D14: surface DEACTIVATED (403 code) distinctly so App can render the deactivated state
      // rather than a generic error. DEACTIVATED is separate from FORBIDDEN (role denial).
      if (err instanceof ApiError && err.code === "DEACTIVATED") {
        setDeactivated(true);
      } else {
        setError(String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [selectedListId]);

  useEffect(() => {
    void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        Loading Family Scheduler…
      </div>
    );
  }
  // D14: deactivated account — show dedicated screen, not a generic error.
  // Enforcement is server-side in requireAuth; this is purely a UX affordance.
  if (deactivated) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="font-semibold">Account deactivated</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account has been deactivated. Contact the family admin.
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-destructive">
        Error: {error}
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
        Signing in…
      </div>
    );
  }

  const navItems: NavItem[] = [
    { view: "list", label: "List", icon: ListIcon },
    { view: "calendar", label: "Calendar", icon: Calendar },
    ...(user.role === "admin" ? [{ view: "admin" as const, label: "Admin", icon: ShieldCheck }] : []),
  ];

  const goToView = (view: AppView) => {
    setActiveView(view);
    setListsSheetOpen(false);
  };

  const handleSelectList = (id: string) => {
    setSelectedListId(id);
    setActiveView("list");
    setListsSheetOpen(false);
  };

  const requestCreate = () => {
    setActiveView("list");
    setCreateRequestToken((t) => t + 1);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <InstallBanner />

      {/* Desktop sidebar (plan Decision 4). */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card p-4 md:flex">
        <div className="mb-4">
          <div className="font-semibold">Family Scheduler</div>
          <div className="block text-sm text-muted-foreground">
            {user.display_name ?? user.email}
          </div>
        </div>

        <nav className="mb-4 flex flex-col gap-2" aria-label="Primary">
          {navItems.map(({ view, label, icon: Icon }) => (
            <Button
              key={view}
              type="button"
              size="sm"
              variant={activeView === view ? "default" : "outline"}
              aria-current={activeView === view ? "page" : undefined}
              onClick={() => goToView(view)}
              className="w-full justify-start"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>

        <ListSidebar
          lists={lists}
          selectedListId={selectedListId}
          user={user}
          onSelect={handleSelectList}
          onListsChange={(updated) => setLists(updated)}
          onUserChange={setUser}
        />
      </aside>

      {/* Mobile top bar: brand + Lists ▾ Sheet trigger + New action. */}
      <header className="flex items-center justify-between border-b border-border bg-card p-3 md:hidden">
        <div className="font-semibold">Family Scheduler</div>
        <div className="flex items-center gap-2">
          <Sheet open={listsSheetOpen} onOpenChange={setListsSheetOpen}>
            <SheetTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <Menu className="h-4 w-4" />
                Lists
              </Button>
            </SheetTrigger>
            <SheetContent side="left">
              <SheetHeader>
                <SheetTitle>Lists</SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <ListSidebar
                  lists={lists}
                  selectedListId={selectedListId}
                  user={user}
                  onSelect={handleSelectList}
                  onListsChange={(updated) => setLists(updated)}
                  onUserChange={setUser}
                />
              </div>
            </SheetContent>
          </Sheet>
          <Button type="button" size="sm" onClick={requestCreate}>
            <PlusCircle className="h-4 w-4" />
            New
          </Button>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 pb-20 md:p-6 md:pb-6">
        {deepLinkNotice && (
          <div className="mb-3 rounded-md border border-amber-400/50 bg-amber-100 p-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-950 dark:text-amber-200">
            {deepLinkNotice}
          </div>
        )}
        {activeView === "admin" && user.role === "admin" ? (
          <AdminPanel />
        ) : activeView === "calendar" ? (
          <CalendarView lists={lists} user={user} />
        ) : (
          <ItemListView
            listId={selectedListId}
            lists={lists}
            user={user}
            items={items}
            onItemsChange={setItems}
            initialOpenItem={initialOpenItem}
            onInitialOpenItemConsumed={() => setInitialOpenItem(null)}
            createRequestToken={createRequestToken}
          />
        )}
      </main>

      {/* Mobile bottom-tab bar: renders from the same activeView/setActiveView as the desktop
          nav — one state, two presentational renderings (plan Decision 4). Since jsdom tests
          render both the desktop and mobile trees regardless of viewport (no real CSS media
          query evaluation without the compiled stylesheet loaded), this second copy's
          accessible name is distinguished via aria-label ("<Label> (bottom tab)") so it does
          not create an ambiguous getByRole("button", { name: "List" }) match against the
          desktop nav — the VISIBLE label text is unchanged for real users on either surface. */}
      <nav
        className="fixed inset-x-0 bottom-0 flex items-center justify-around border-t border-border bg-card py-2 md:hidden"
        aria-label="Primary (mobile)"
      >
        {navItems.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            type="button"
            aria-current={activeView === view ? "page" : undefined}
            aria-label={`${label} (bottom tab)`}
            onClick={() => goToView(view)}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground",
              activeView === view && "text-primary"
            )}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span aria-hidden="true">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
