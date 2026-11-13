// InstallBanner — detect iOS + non-standalone; show one-time Add to Home Screen nudge
import React, { useState, useEffect } from "react";
import { Button } from "./ui/button";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return (
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true)
  );
}

// localStorage can be absent or throw on access (Safari Private Browsing,
// storage disabled, quota). InstallBanner renders on every load with no error
// boundary above it, so an unguarded throw here white-screens the whole app.
// Degrade safely: on read failure treat the banner as NOT dismissed; on write
// failure silently skip persisting (the banner may reappear next load — acceptable).
function safeGetItem(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(key, value);
  } catch {
    // best-effort; failure to persist is non-fatal (banner may show again)
  }
}

export function InstallBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissed = safeGetItem("install-banner-dismissed");
    if (!dismissed && isIos() && !isStandalone()) {
      setShow(true);
    }
  }, []);

  if (!show) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[1000] flex items-center justify-between bg-primary p-3 px-5 text-primary-foreground shadow-lg">
      <span className="text-sm">
        To enable push reminders on iPhone: tap <strong>Share</strong>, then{" "}
        <strong>Add to Home Screen</strong>, then open the app from your Home Screen.
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-3 shrink-0 border-primary-foreground/60 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
        onClick={() => {
          safeSetItem("install-banner-dismissed", "1");
          setShow(false);
        }}
      >
        Dismiss
      </Button>
    </div>
  );
}
