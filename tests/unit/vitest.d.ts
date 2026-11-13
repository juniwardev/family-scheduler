/// <reference types="@cloudflare/vitest-pool-workers" />

// Tell the cloudflare:test env about our D1 + R2 bindings
declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    ATTACHMENTS: R2Bucket;
  }
}
