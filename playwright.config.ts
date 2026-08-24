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
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    /**
     * الاجتياز بلوحة المفاتيح — على Chromium عمدًا.
     *
     * WebKit يتبع «التنقل بلوحة المفاتيح» في macOS، وهو **مطفأ
     * افتراضيًا**: عندها لا يصل `Tab` إلا الحقول النصية، في Luma وفي
     * كل تطبيق macOS أصلي. فاختبار ترتيب التركيز على WebKit يقيس
     * إعداد النظام لا بنية الصفحة.
     *
     * Chromium يمنح التركيز لكل عنصر تفاعلي دائمًا، فيقيس ما نريد
     * قياسه: هل الترتيب منطقي في RTL، وهل يصل كل عنصر، وهل تخرج
     * الشجرة المعطَّلة من المسار.
     *
     * **وهذا لا يغني عن التجربة داخل `Luma.app`** والتنقل بلوحة
     * المفاتيح مفعَّل — بندٌ في `docs/release-checklist.md`.
     */
    {
      name: "chromium-keyboard",
      testMatch: /access\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
  },
});
