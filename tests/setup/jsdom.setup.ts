// Setup file for the jsdom Vitest project (fix-item-save §8.1).
// Extends `expect` with DOM matchers (toBeInTheDocument, toHaveAttribute, etc.).
import "@testing-library/jest-dom/vitest";

// React Testing Library does not auto-cleanup under Vitest (that behavior is Jest-specific);
// unmount rendered components after each test so DOM queries in one test don't see leftover
// markup from a previous test in the same file.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom does not implement window.matchMedia. Components mounted in jsdom tests
// (e.g. NotificationSetup via isStandalone) call it unguarded, which throws on render.
// Provide a minimal stub so App-level and other component trees can mount.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {}, // deprecated, kept for older consumers
    removeListener: () => {}, // deprecated, kept for older consumers
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

// jsdom (under this Node/Vitest combo) may not provide window.localStorage.
// InstallBanner reads it unguarded on mount, which throws and unmounts the tree.
// Provide a minimal in-memory Storage stub so App-level component trees can mount.
// Gated so it never overrides a real/working localStorage in other environments.
if (typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: localStorageStub,
    configurable: true,
    writable: true,
  });
}

// jsdom does not implement window.Notification (verified empirically: `typeof Notification`
// is "undefined" in this jsdom/Vitest environment — see push-enable-persistence §7.1). Provide a
// minimal, settable stub so NotificationSetup's `useState` initializer (already null-guarded) and
// its on-mount effect have a `Notification.permission` to read/drive from tests. Gated so it
// never overrides a real implementation, matching the matchMedia/localStorage stubs above.
if (typeof Notification === "undefined") {
  class NotificationStub {
    static permission: NotificationPermission = "default";
    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve(NotificationStub.permission);
    }
  }
  (globalThis as unknown as { Notification: unknown }).Notification = NotificationStub;
}

// --- Radix-in-jsdom polyfills (ui-redesign Decision 3 / §8.1) -------------------------------
// shadcn's Dialog/Sheet/Select/Tabs/Tooltip wrap Radix primitives that call browser APIs jsdom
// does not implement. Without these, mounting any of them throws on render. Each stub is gated
// (`if (!...)`) so it never clobbers a real implementation, matching the style above.

// Radix's internal useSize hook (Select/Popover positioning) uses ResizeObserver.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// Radix Select/Dialog pointer-capture handling (used during drag/press interactions).
if (typeof Element.prototype.hasPointerCapture !== "function") {
  Element.prototype.hasPointerCapture = () => false;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
}
if (typeof Element.prototype.releasePointerCapture !== "function") {
  Element.prototype.releasePointerCapture = () => {};
}

// Radix Select scrolls the active option into view on open/navigation.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// Radix Select/ScrollArea + focus-restoration paths call scrollTo on elements and window.
if (typeof Element.prototype.scrollTo !== "function") {
  Element.prototype.scrollTo = () => {};
}
if (typeof window.scrollTo !== "function") {
  window.scrollTo = () => {};
}

// jsdom's getBoundingClientRect/DOMRect return zero-rects already, but ensure the DOMRect
// global exists (some positioning code constructs `new DOMRect(...)`).
if (typeof globalThis.DOMRect === "undefined") {
  class DOMRectStub {
    x = 0;
    y = 0;
    width = 0;
    height = 0;
    top = 0;
    right = 0;
    bottom = 0;
    left = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.left = x;
      this.right = x + width;
      this.bottom = y + height;
    }
    toJSON() {
      return { ...this };
    }
  }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = DOMRectStub;
}

// user-event's pointer sequences inside Radix triggers dispatch PointerEvents; jsdom does not
// implement the constructor. Alias to MouseEvent (carries clientX/clientY/button) so the
// dispatch does not throw. If a future Radix interaction needs a real `pointerId`, replace this
// alias with a minimal PointerEvent polyfill instead (see plan Decision 3 note).
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: unknown }).PointerEvent = window.MouseEvent;
}

// Test-env exit-animation neutralization (plan B2/Decision 3): report
// prefers-reduced-motion:reduce as true so any animation-aware code path in the vendored
// Dialog/Sheet treats the test env as "no animation," belt-and-suspenders alongside the
// (already-verified-by-spike) state-driven Radix unmount. Layered onto the existing matchMedia
// stub above without overriding its other query handling.
if (typeof window.matchMedia === "function") {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query: string) => {
    if (query.includes("prefers-reduced-motion")) {
      return {
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } as unknown as MediaQueryList;
    }
    return originalMatchMedia(query);
  };
}
