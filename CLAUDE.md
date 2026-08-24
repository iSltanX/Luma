# Luma — نقطة دخول الوكيل

محرر كتابة هادئ للكاتب العربي على macOS. «افتح واكتب، والباقي يختفي.»

## مصادر الحقيقة — بهذا الترتيب

| الوثيقة | ماذا فيها |
|---|---|
| [Luma.md](Luma.md) | المنتج: النطاق والسلوك والمبادئ. **الأعلى عند أي تعارض.** |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | الأساس التقني وقواعده الحاكمة |
| [PLAN.md](PLAN.md) | المراحل واعتمادياتها ومعايير اكتمالها |
| [docs/quality-report.md](docs/quality-report.md) | §١٣ بندًا بندًا · [حالات الخطأ](docs/error-behaviour.md) · [قائمة التحقق](docs/release-checklist.md) |
| [docs/decisions/](docs/decisions/) | ما حُسم فعلًا، بدليله |
| هذا الملف | خريطة وأوامر فقط — **لا قاعدة منتج واحدة** |

عند تعارض هذا الملف مع الوثيقتين الأوليين، **هما الصواب**.

## الحالة

المراحل ١ إلى ٧ مكتملة. الغلاف Tauri، ونواة المحرر `src/editor/` على ProseMirror، والتخزين والحفظ في `src-tauri/src/storage/`، وطبقة الرموز في `src/tokens/`، وإطار المحرر ولوحتاه في `src/components/`، والمحرر المريح بطبقاته الثلاث والإعدادات وخدمة الخطوط (`src-tauri/src/fonts.rs`).
والمرحلة ٧ أضافت ميزانيات أداء **مقيسة ومبوَّبة** (`src/dev/budgets.ts`)،
وحزمة وصول (`tests/e2e/access.spec.ts`)، وثلاث وثائق تحقق في `docs/`.

`src/dev/` أدوات تطوير لا تُشحن (تُستورد ديناميكيًا خلف أعلام بيئة).
طبقة الرموز مولَّدة: `node src/tokens/generate.mjs` بعد أي تغيير في `source.json`.
مخرجاتها (`tokens.css` و`themes.ts`) **لا تُحرَّر يدويًا**.

## الحزمة

Tauri 2 (نواة Rust + WKWebView) · Vite + Svelte 5 + TypeScript · ProseMirror · معرّف مؤقت `dev.luma.app`.

## الأوامر

```bash
npm run app          # تشغيل التطبيق للتطوير
npm run app:build    # بناء Luma.app
npm run verify       # أنواع + clippy + fmt + اختبارات الوحدة + اختبارات Rust
npm run test:e2e     # Playwright — كشف انحدار على طبقة الويب
npm run selftest     # الفحص الذاتي داخل Luma.app — **بوابة تسقط**
npm run site         # توليد صفحة حالة المشروع (docs/site/)
```

`selftest` يشغّل النسخة المبنية ويخرج بحالة غير صفرية عند سقوط أي بند،
ومنها **تسع ميزانيات أداء** مقارَنة بسقوفها —
[ADR ٠٠١١](docs/decisions/0011-performance-budgets.md).

الفحص داخل التطبيق (لا WebDriver لـWKWebView على macOS):

```bash
LUMA_SELFTEST=1 ./src-tauri/target/release/bundle/macos/Luma.app/Contents/MacOS/luma
```

النتيجة → `~/Library/Application Support/Luma/selftest-report.json`.
`LUMA_DEMO=1` يفتح مستندًا طويلًا للتحقق البصري، و`LUMA_STAGE=library|history|preview|count` يفتح مشهدًا بعينه لالتقاط صورته. `npm run test:e2e` لـPlaywright.

## الخريطة

```
src/editor/    نواة المحرر — لا تحفظ ولا تعرف المكتبة (README فيها)
src/lib/       autosave · session · bidi · library · surfaces · preferences · typewriter · fonts
src/dev/       ⚠️ أدوات تطوير لا تُشحن
src/tokens/    ⚠️ مولَّد: source.json → tokens.css + themes.ts
src/components/ مكتبة المكونات + الأيقونات الـ٢٢ — و`EditorShell` إطار كل شاشة
src-tauri/     النواة الأصلية — storage/ والنافذة والقائمة والأوامر
public/fonts/  Cairo وAlmarai مدمجان، بلا شبكة
scripts/       selftest.sh — بوابة الفحص داخل التطبيق
tests/         وحدات + حارس الحدود + الميزانيات + e2e/ لـPlaywright
docs/          MAP.md · decisions/ · evidence/ · arabic-battery.md
docs/site/     ⚠️ مولَّد: صفحة الحالة — `build.mjs` هو المصدر، و`index.html` مخرَج
```

## قواعد لا تُخالَف

المبادئ العشرة في `IMPLEMENTATION.md` §١٧ تُراجَع قبل أي دمج. وأكثرها مساسًا بالكود اليومي:

1. **لا لون مكتوب يدويًا** — كل لون رمز ثيم.
2. **تغيير الخط أو الثيم لا يمسّ المحتوى المخزَّن.**
3. **RTL يُبنى في المكوّن** بخصائص تخطيط منطقية، ولا يُعكس chrome النظام.
4. **التتبّع صفر على كل نص عربي**، وارتفاع السطر مصرَّح به لا تلقائي، ولا نص عربي دون ١٢ نقطة.
5. **لا ميزة خارج `Luma.md`** — ولا كيان بيانات لميزة غير معتمدة.
6. **لا زر حفظ ولا اختصار حفظ يدوي** — الحفظ تلقائي دائم، وكل كتابة ذرّية.
7. **لا يُستبدل ملف سليم بجزئي** — كل كتابة تمرّ بـ`write_atomic`.
8. **كل لون رمز ثيم** — ولا `var(--…)` غير معرَّف: كلاهما يسقط صامتًا ويحرسه اختبار.
9. **فتح لوحة لا يغيّر عرض الورقة** — وهذا وحده ما يحفظ موضع التمرير. ولا لوحة تحبس التركيز، ولكلٍّ مدخل وزر إغلاق و`Esc`.
10. **لا رمز محايد في وقتٍ يُعرض** — «منذ ساعتين» لا «١١:٤٥ م». الصياغة في `src/lib/bidi.ts`.
11. **كل مقطع لاتيني داخل جملة عربية يُعزل** بـ`isolate()` — §٧ **ثابت**، وإلا رُسم في الطرف الخطأ.
12. **لا تُبنى واجهة لميزة غير موجودة** — لا قسم إعدادات للصوت، ولا مدخل سطح لا يفتح شيئًا.
13. **شاشة تغطّي النافذة تُخرج ما تحتها من الشجرة** بـ`inert` — وإلا وصلته الكتابة وهو محجوب، فكُتب في مستند لا يراه.
14. **قياسٌ بلا سقف ليس ميزانية** — كل رقم أداء يُقارَن بسقفه ويُسقِط، ويطابق جدول §١٤.

قبل أي عمل على الوصول أو الأداء: [docs/quality-report.md](docs/quality-report.md).

قبل أي عمل على العربية أو الاتجاه: [docs/arabic-battery.md](docs/arabic-battery.md).
