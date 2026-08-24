import { defineConfig, devices } from "@playwright/test";

/**
 * فحص انحدار على طبقة الويب.
 *
 * **ليس بديلًا عن التحقق داخل `Luma.app`** — `PLAN.md`.
 * يُفضَّل محرك WebKit لأنه الأقرب إلى نافذة العرض الفعلية، لكنه
 * ليس WKWebView نفسه: لا WebDriver لها على macOS.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    locale: "ar-SA",
  },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
