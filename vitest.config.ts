import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// The private export contract rejects symlink ancestors. macOS exposes /var
// as a symlink, so use the canonical temporary root in the SDK harness.
process.env.TMPDIR = realpathSync(tmpdir());

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) }, dedupe: ["react", "react-dom"] },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"], restoreMocks: true,
    // The SDK harness uses durable SQLite and filesystem exports. Bound parallel
    // workers and allow disk contention without weakening behavioral assertions.
    maxWorkers: 4, testTimeout: 20_000,
  },
});
