import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Run migrations on the local D1 database before tests
          d1Databases: { DB: "local-test-db" },
        },
      },
    },
    include: ["tests/**/*.test.ts"],
  },
});
