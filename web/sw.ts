// sw.ts — Service Worker for Family Scheduler PWA
// Handles: push notifications, notificationclick events
// TypeScript source, compiled by Vite

// Tell TypeScript this is a service worker context
declare const self: ServiceWorkerGlobalScope;

// Push event: show a notification when a push message arrives
self.addEventListener("push", (event: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; item_id?: string } = {};

  if (event.data) {
    try {
      data = event.data.json() as typeof data;
    } catch {
      data = { title: "Family Scheduler", body: event.data.text() };
    }
  }

  const title = data.title ?? "Family Scheduler";
  const options: NotificationOptions = {
    body: data.body ?? "You have a reminder",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: data.url ?? "/", item_id: data.item_id },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// notificationclick: focus the app window or open a new tab pointing to the item
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const data = event.notification.data as { url?: string; item_id?: string } | undefined;
  // Primary: the absolute deep link (${APP_URL}/?item=<id>) built server-side and forwarded
  // as-is. Fallback: reconstruct a RELATIVE "/?item=<id>" from item_id if url is somehow
  // absent — relative is correct here because navigate()/openWindow() resolve it against the
  // SW's own scope (same origin as the app), so no absolute APP_URL is needed. This is a
  // one-line hardening only; zero change to the push-receive path or crypto (the shared
  // deepLink module is intentionally NOT imported here — the SW bundle is compiled
  // separately, so a tiny inline fallback avoids a build-graph change).
  const targetUrl: string =
    data?.url ?? (data?.item_id ? `/?item=${encodeURIComponent(data.item_id)}` : "/");

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Try to focus an existing window
      for (const client of clients) {
        if ("focus" in client) {
          await (client as WindowClient).navigate(targetUrl);
          await client.focus();
          return;
        }
      }

      // No existing window — open a new one
      await self.clients.openWindow(targetUrl);
    })()
  );
});

// Install / activate lifecycle — use network-first for the API calls
self.addEventListener("install", () => {
  // Skip waiting so the new SW activates immediately
  void self.skipWaiting();
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});
