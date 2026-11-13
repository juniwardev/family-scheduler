// NotificationSetup.test.tsx — regression guard for push-enable-persistence.
//
// Root cause (docs/bugs/push-enable-persistence.md): `subscribed` state always initializes to
// `false` and is only ever set `true` inside the click handler. On reload, even though the
// browser still holds a live push subscription and permission is "granted", the component has
// no effect to look for it, so it always falls back to showing "Enable Push Notifications".
//
// DC-a (load-bearing): existing subscription + granted permission -> "enabled" renders on mount
// with NO click. This test MUST FAIL against the pre-fix component (no useEffect exists) and
// MUST PASS once the on-mount detection effect is added.
/// <reference types="@testing-library/jest-dom/vitest" />
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NotificationSetup } from "./NotificationSetup";
import * as apiClient from "../apiClient";

vi.mock("../apiClient", async () => {
  const actual = await vi.importActual<typeof import("../apiClient")>("../apiClient");
  return {
    ...actual,
    registerSubscription: vi.fn(),
  };
});

function makeSub(endpoint = "https://push.example/abc") {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: "P256DH_KEY", auth: "AUTH_KEY" } }),
  } as unknown as PushSubscription;
}

// The container must expose BOTH getRegistration() and ready because getSubscriptionSafely()
// calls getRegistration() first (resolves rather than hangs) before racing .ready.
function stubServiceWorker(
  getSubscription: () => Promise<PushSubscription | null>,
  opts: { readyNeverResolves?: boolean; registrationMissing?: boolean } = {}
) {
  const reg = { pushManager: { getSubscription } } as unknown as ServiceWorkerRegistration;
  const ready = opts.readyNeverResolves
    ? new Promise<ServiceWorkerRegistration>(() => {}) // never resolves -> exercises timeout race
    : Promise.resolve(reg);
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      ready,
      getRegistration: () =>
        opts.registrationMissing ? Promise.resolve(undefined) : Promise.resolve(reg),
    },
    configurable: true,
  });
  // Ensure PushManager feature-detect passes.
  if (!("PushManager" in window)) {
    (window as unknown as { PushManager: unknown }).PushManager = function () {};
  }
}

function setPermission(value: NotificationPermission) {
  (Notification as unknown as { permission: NotificationPermission }).permission = value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setPermission("default");
  // Remove any per-test serviceWorker/PushManager stub so it cannot leak into a later test
  // (n2 test-hygiene note — DC-e/DC-f manipulate these globals).
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
  delete (window as unknown as { PushManager?: unknown }).PushManager;
});

describe("NotificationSetup — on-mount subscription detection (push-enable-persistence)", () => {
  it("DC-a: existing subscription + permission granted -> renders enabled on mount, NO click", async () => {
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(makeSub()));

    render(<NotificationSetup />);

    await waitFor(() => {
      expect(screen.getByText(/Push notifications enabled\./i)).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /enable push notifications/i })
    ).not.toBeInTheDocument();
  });

  it("DC-b: no subscription + permission default -> Enable button shown", async () => {
    setPermission("default");
    stubServiceWorker(() => Promise.resolve(null));

    render(<NotificationSetup />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /enable push notifications/i })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Push notifications enabled\./i)).not.toBeInTheDocument();
  });

  it("DC-b2: permission granted but getSubscription() returns null -> Enable button shown (not false enabled)", async () => {
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(null));

    render(<NotificationSetup />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /enable push notifications/i })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Push notifications enabled\./i)).not.toBeInTheDocument();
  });

  it("DC-c: subscription found -> best-effort re-register POST fires with the sub's endpoint/keys", async () => {
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(makeSub()));

    render(<NotificationSetup />);

    await waitFor(() => {
      expect(vi.mocked(apiClient.registerSubscription)).toHaveBeenCalledWith({
        endpoint: "https://push.example/abc",
        p256dh: "P256DH_KEY",
        auth: "AUTH_KEY",
        user_agent: expect.any(String),
      });
    });
  });

  it("DC-d: re-register failure still shows enabled (best-effort precedence, warned not swallowed)", async () => {
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(makeSub()));
    vi.mocked(apiClient.registerSubscription).mockRejectedValueOnce(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<NotificationSetup />);

    await waitFor(() => {
      expect(screen.getByText(/Push notifications enabled\./i)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    warnSpy.mockRestore();
  });

  it("DC-e: feature-absent (no navigator.serviceWorker) does not throw, shows unsupported message", () => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    delete (window as unknown as { PushManager?: unknown }).PushManager;

    expect(() => render(<NotificationSetup />)).not.toThrow();
    expect(screen.getByText(/push not supported on this device/i)).toBeInTheDocument();
  });

  it("DC-f: serviceWorker.ready never resolves -> no hang, Enable button still shown (M1 guard)", async () => {
    vi.useFakeTimers();
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(makeSub()), { readyNeverResolves: true });

    render(<NotificationSetup />);

    // Advance past READY_TIMEOUT_MS (3000ms) so the race resolves to null instead of hanging.
    // Use runAllTimersAsync (not advanceTimersByTimeAsync + real-timer waitFor) so the fake-timer
    // clock and the microtask queue driving the effect's awaits stay in lockstep — mixing fake
    // timers with RTL's real-timer-polling waitFor is what causes this case to hang.
    await vi.runAllTimersAsync();

    expect(
      screen.getByRole("button", { name: /enable push notifications/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Push notifications enabled\./i)).not.toBeInTheDocument();
  });

  it("DC-f (companion): getRegistration() resolves undefined -> short-circuits without awaiting .ready, Enable button shown", async () => {
    setPermission("granted");
    stubServiceWorker(() => Promise.resolve(makeSub()), {
      readyNeverResolves: true,
      registrationMissing: true,
    });

    render(<NotificationSetup />);

    // No fake-timer advance needed: getRegistration() -> undefined short-circuits before .ready
    // is ever awaited, so this must resolve promptly without a timeout.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /enable push notifications/i })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/Push notifications enabled\./i)).not.toBeInTheDocument();
  });
});
