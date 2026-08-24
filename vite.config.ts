import { defineConfig } from "vite";
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
  build: {
    target: "safari16",
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: true,
  },
});
