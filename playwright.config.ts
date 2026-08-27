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
    /**
     * حزمة الويب الأصلية — كل ما لا يحتاج جسر التخزين.
     *
     * `bridge/` مستثناة: لها مشروعها أدناه، ولو دخلت هنا لعملت
     * مرّتين — مرّةً بلا `installBridge` فتسقط.
     */
    {
      name: "webkit",
      testIgnore: /bridge\//,
      use: { ...devices["Desktop Safari"] },
    },
    /**
     * حزمة الجسر — مسار التخزين كاملًا: المكتبة والسجل والسلّة
     * والمعاينة. الشرح الكامل في `tests/e2e/bridge/mock-bridge.ts`.
     *
     * على WebKit كأختها: الأقرب إلى نافذة العرض الفعلية. أما ترتيب
     * التبويب فيها فعلى Chromium أدناه، للسبب نفسه المشروح هناك.
     */
    {
      name: "webkit-bridge",
      testMatch: /bridge\/(?!keyboard)[\w-]+\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    /**
     * ترتيب التبويب **والأزرار مضاءة** — يحتاج الجسر وChromium معًا.
     *
     * بلا الجسر تبقى «تراجع» و«إعادة» و«حذف» معطَّلةً أبدًا
     * (`candelete` يشترط `currentId !== null`)، والمعطَّل ليس محطة
     * تركيز — فدورةُ التبويب المؤكَّدة في `access.spec.ts` خمسة أسماء
     * لا ثمانية، وترتيب الأزرار الثلاثة لا يُقاس أصلًا.
     */
    {
      name: "chromium-bridge",
      testMatch: /bridge\/keyboard\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
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
