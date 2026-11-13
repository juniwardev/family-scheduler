// InstallBanner.test.tsx — regression guard for the localStorage guard added in
// fix-list-selection-view-state (§5.6/§8.2). InstallBanner renders on every App load with no
// error boundary above it, so an unguarded localStorage.getItem/setItem throw white-screens the
// whole app (Safari Private Browsing, storage disabled, quota). This test protects the guard so
// a future refactor cannot silently reintroduce the unguarded access.
//
// Case 1 (load-bearing): mounting InstallBanner must NOT throw when localStorage.getItem throws.
// This mirrors the exact throw that tore down <App/> before the §5.6 guard was added — it FAILS
// without the guard and PASSES with it.
// Case 2: Dismiss must degrade gracefully (not throw, still hide the banner) when
// localStorage.setItem throws.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallBanner } from "./InstallBanner";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InstallBanner — localStorage guard (§5.6)", () => {
  it("does not throw when localStorage.getItem throws on mount (load-bearing)", () => {
    const throwingStorage: Storage = {
      getItem: () => {
        throw new Error("blocked: storage disabled");
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", throwingStorage);

    // Pre-guard, InstallBanner:21's unguarded `localStorage.getItem` throws inside the mount
    // useEffect; RTL flushes effects within act(), so the throw propagates out of render() and
    // (with no error boundary above it in the real app) tears down the whole <App/> tree.
    // Post-guard, safeGetItem catches the throw and returns null (treated as "not dismissed").
    expect(() => render(<InstallBanner />)).not.toThrow();

    // jsdom's UA is not iOS, so the banner stays hidden regardless — the point of this case is
    // that the unguarded read no longer crashes, not that the banner becomes visible.
    expect(screen.queryByText(/Add to Home Screen/i)).not.toBeInTheDocument();
  });

  it("Dismiss degrades gracefully (does not throw, still hides the banner) when localStorage.setItem throws", async () => {
    const user = userEvent.setup();

    const originalUserAgent = window.navigator.userAgent;
    Object.defineProperty(window.navigator, "userAgent", {
      value:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      configurable: true,
    });

    const setItemSpy = vi.fn(() => {
      throw new Error("blocked: quota exceeded");
    });
    const partiallyThrowingStorage: Storage = {
      getItem: () => null, // not dismissed -> banner should try to show
      setItem: setItemSpy,
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", partiallyThrowingStorage);

    try {
      render(<InstallBanner />);

      const dismissButton = await screen.findByRole("button", { name: /dismiss/i });

      await expect(user.click(dismissButton)).resolves.not.toThrow();

      // setShow(false) still runs after the swallowed write error, so Dismiss always hides the
      // banner for the current session even when persistence fails.
      expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
      expect(setItemSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "userAgent", {
        value: originalUserAgent,
        configurable: true,
      });
    }
  });
});
