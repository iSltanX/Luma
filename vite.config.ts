import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// Luma تطبيق سطح مكتب: لا شبكة، ولا أصول خارجية، ولا تجزئة أسماء غير لازمة.
export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // اختبارات الوحدة وحدها هنا؛ tests/e2e لـPlaywright بمشغّل آخر
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  build: {
    target: "safari16",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});
