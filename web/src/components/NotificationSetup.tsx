// NotificationSetup — request notification permission on user gesture,
// subscribe via pushManager, POST to /api/subscriptions
import React, { useState, useEffect } from "react";
import type { User } from "../types";
import { getVapidPublicKey, registerSubscription, updateMapsProvider, ApiError } from "../apiClient";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

function b64urlToUint8Array(base64url: string): Uint8Array {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

// push-enable-persistence (M1 mitigation): `navigator.serviceWorker.ready` resolves ONLY once a
// service worker becomes active for the page — it never rejects and never times out on its own.
// A bare `await ...ready` can hang indefinitely (SW registration failed, private mode, first
// paint before `load` fires, or a slow-activating Safari SW), which would silently make the
// on-mount detection effect below never fire. This helper avoids ever awaiting a hanging promise:
// (1) getRegistration() resolves (to a registration OR `undefined`) rather than hanging, so the
//     common "no active SW yet" case short-circuits without touching `.ready` at all;
// (2) if a registration exists, `.ready` is raced against a timeout that RESOLVES to null (never
//     rejects) so a slow/never-activating SW degrades gracefully instead of hanging the effect.
const READY_TIMEOUT_MS = 3000;

async function getSubscriptionSafely(): Promise<PushSubscription | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) return null; // no active/registered SW -> nothing to reflect yet

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout]);
    if (!reg || !("pushManager" in reg)) return null; // timed out, or no pushManager
    return await reg.pushManager.getSubscription();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

interface Props {
  // Optional: when supplied, the "Maps app for addresses" select is rendered and wired to
  // PATCH /api/me. Optional so existing call sites without a user context still compile;
  // the push-enable UI below is unaffected either way (Decision 6 — the maps-provider
  // preference does NOT touch the push-enable/subscription logic in this component).
  user?: User;
  onUserChange?: (user: User) => void;
}

export function NotificationSetup({ user, onUserChange }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [subscribed, setSubscribed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [mapsSaving, setMapsSaving] = useState(false);

  // push-enable-persistence: on mount, reflect an already-active push subscription so the UI
  // does not force the user to re-click "Enable" on every load (root cause: `subscribed` always
  // initialized to `false` and was only ever set by the click handler). Declared UNCONDITIONALLY,
  // above the early returns below (iOS/standalone gate, push-unsupported message), because the
  // Rules of Hooks require every hook to run in the same order on every render — all
  // conditionality lives inside the effect body, not around the hook call.
  useEffect(() => {
    let mounted = true;

    // Feature-detect INSIDE the body (not around the hook). In jsdom and on unsupported browsers
    // these globals are absent; bail cleanly without throwing.
    if (
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      typeof Notification === "undefined"
    ) {
      return;
    }

    void (async () => {
      try {
        // getSubscriptionSafely() resolves the registration WITHOUT hanging (see its comment
        // above): getRegistration() first, then `.ready` raced against a timeout. Never await
        // `navigator.serviceWorker.ready` directly here.
        const sub = await getSubscriptionSafely();
        if (!mounted) return; // unmounted while awaiting -> do nothing
        if (!sub || Notification.permission !== "granted") return; // keep showing the button

        // Reflect the already-enabled state (render gate below is permission==="granted" && subscribed).
        setPermission("granted");
        setSubscribed(true);

        // Defense-in-depth: best-effort re-register so the server row is guaranteed present.
        // This is NOT a gate on the UI state above — the local subscription is authoritative and
        // push delivery already works via the browser; the POST is hardening in case the server
        // row was somehow lost. A failure here must not undo the enabled state we just set.
        const json = sub.toJSON();
        const keys = json.keys as { p256dh: string; auth: string } | undefined;
        if (json.endpoint && keys) {
          try {
            await registerSubscription({
              endpoint: json.endpoint,
              p256dh: keys.p256dh,
              auth: keys.auth,
              user_agent: navigator.userAgent,
            });
          } catch (err) {
            // Warn (not silent) so a persistently-broken server row is observable, per the
            // project's explicit-error-handling convention — but do not flip the UI, since the
            // browser-side subscription is what actually matters for delivery.
            console.warn("push re-register on mount failed:", err);
          }
        }
      } catch (err) {
        // Registration/getSubscription resolution failed — leave state at defaults so the Enable
        // button remains. Warn (not silent); never throw out of an effect.
        console.warn("push subscription check on mount failed:", err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []); // run once on mount; no reactive deps

  const mapsProviderControl = user ? (
    <div className="mt-3">
      <Label className="mb-1 block">Maps app for addresses</Label>
      <Select
        value={user.maps_provider ?? "apple"}
        disabled={mapsSaving}
        onValueChange={(value) => void handleMapsProviderChange(value as "apple" | "google")}
      >
        <SelectTrigger className="w-full max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="apple">Apple Maps (default)</SelectItem>
          <SelectItem value="google">Google Maps</SelectItem>
        </SelectContent>
      </Select>
      {mapsError && <p className="mt-1 text-xs text-destructive">{mapsError}</p>}
    </div>
  ) : null;

  const handleMapsProviderChange = async (provider: "apple" | "google") => {
    setMapsSaving(true);
    setMapsError(null);
    try {
      const { user: updated } = await updateMapsProvider(provider);
      onUserChange?.(updated);
    } catch (err) {
      setMapsError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setMapsSaving(false);
    }
  };

  // Only show the push-enable UI in standalone mode (spec §7 — iOS requirement). The
  // maps-provider preference above is independent of push support and always renders.
  if (!isStandalone() && /iphone|ipad|ipod/i.test(navigator.userAgent)) {
    return <div>{mapsProviderControl}</div>;
  }

  if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Push not supported on this device.</p>
        {mapsProviderControl}
      </div>
    );
  }

  const subscribe = async () => {
    try {
      const { publicKey } = await getVapidPublicKey();
      const reg = await navigator.serviceWorker.ready;
      const appServerKey = b64urlToUint8Array(publicKey);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to avoid TS strict ArrayBufferLike vs ArrayBuffer mismatch
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });

      const json = sub.toJSON();
      const keys = json.keys as { p256dh: string; auth: string } | undefined;
      if (!json.endpoint || !keys) throw new Error("Subscription missing keys");

      await registerSubscription({
        endpoint: json.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: navigator.userAgent,
      });

      setSubscribed(true);
      setPermission("granted");
    } catch (err) {
      setError(String(err));
    }
  };

  const requestPermissionAndSubscribe = async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      await subscribe();
    }
  };

  if (permission === "granted" && subscribed) {
    return (
      <div>
        <p className="text-sm text-primary">Push notifications enabled.</p>
        {mapsProviderControl}
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div>
        <p className="text-sm text-muted-foreground">
          Notifications blocked. Allow them in browser settings to receive push reminders.
        </p>
        {mapsProviderControl}
      </div>
    );
  }

  return (
    <div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" size="sm" onClick={() => void requestPermissionAndSubscribe()}>
        Enable Push Notifications
      </Button>
      {mapsProviderControl}
    </div>
  );
}
