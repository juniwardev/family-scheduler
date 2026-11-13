#!/usr/bin/env node
// e2e/preflight-port.mjs — the 8787 dev-server collision probe (plan §3.4.1a).
//
// This is the FIRST element of playwright.config.ts's webServer.command, chained with `&&`
// BEFORE `npm run build`. That placement is load-bearing, not cosmetic: `npm run build` is
// `vite build` with `emptyOutDir: true` (vite.config.ts), and both `npm run dev` and this e2e
// harness serve the same shared `./dist` (wrangler.toml `[assets] directory = "./dist"`). An
// earlier design ran this probe in Playwright's globalSetup, which executes AFTER
// webServer.command — so by the time it printed "stop `npm run dev` first", the build had
// already emptied and rebuilt the shared dist/ and broken the dev session it was warning
// about. Running it here, before `npm run build`, means a non-zero exit short-circuits the
// `&&` chain and `dist/` is never touched. It also means this guard does not depend on
// Playwright's globalSetup/webServer ordering, which has changed across Playwright versions.
//
// This is a PORT probe, not a `dist/` probe — say so plainly rather than overclaiming. A
// developer running the dev watcher on a non-default port produces a false negative; an
// unrelated service on 8787 produces a false positive. Acceptable: it catches the
// overwhelmingly common case (a plain `npm run dev` left running) at near-zero cost.
import net from "node:net";

const PORT = 8787;
const HOST = "127.0.0.1";
const CONNECT_TIMEOUT_MS = 500;

function isPortInUse(port, host) {
  return new Promise((resolvePromise) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolvePromise(inUse);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

const inUse = await isPortInUse(PORT, HOST);

if (inUse) {
  console.error(
    "Port 8787 is in use — `npm run dev` appears to be running. E2E rebuilds the shared ./dist\n" +
      "(vite.config.ts emptyOutDir: true), so the two cannot run together: the e2e build would break\n" +
      "your dev session, and your dev watcher could rebuild dist mid-suite. Stop `npm run dev` and\n" +
      "re-run `npm run test:e2e`."
  );
  process.exit(1);
}

process.exit(0);
