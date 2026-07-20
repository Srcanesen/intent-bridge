import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@intent-bridge/core": new URL(
        "./packages/core/src/index.ts",
        import.meta.url,
      ).pathname,
      "@intent-bridge/provider-openai-compatible": new URL(
        "./packages/provider-openai-compatible/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    passWithNoTests: true,
  },
});
