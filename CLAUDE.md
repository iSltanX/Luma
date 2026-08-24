# Luma — نقطة دخول الوكيل

محرر كتابة هادئ للكاتب العربي على macOS. «افتح واكتب، والباقي يختفي.»

## مصادر الحقيقة — بهذا الترتيب

| الوثيقة | ماذا فيها |
|---|---|
| [Luma.md](Luma.md) | المنتج: النطاق والسلوك والمبادئ. **الأعلى عند أي تعارض.** |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | الأساس التقني وقواعده الحاكمة |
| [PLAN.md](PLAN.md) | المراحل واعتمادياتها ومعايير اكتمالها |
| [docs/decisions/](docs/decisions/) | ما حُسم فعلًا، بدليله |
| هذا الملف | خريطة وأوامر فقط — **لا قاعدة منتج واحدة** |

عند تعارض هذا الملف مع الوثيقتين الأوليين، **هما الصواب**.

## الحالة

المراحل ١ و٢ و٣ مكتملة. الغلاف Tauri، ونواة المحرر `src/editor/` على ProseMirror، والتخزين والحفظ التلقائي في `src-tauri/src/storage/`.

`src/dev/` أدوات تطوير لا تُشحن (تُستورد ديناميكيًا خلف أعلام بيئة).
`src/app.css` رموز مؤقتة — المرحلة ٤ تستبدلها بطبقة مولَّدة.

## الحزمة

Tauri 2 (نواة Rust + WKWebView) · Vite + Svelte 5 + TypeScript · ProseMirror · معرّف مؤقت `dev.luma.app`.

## الأوامر

```bash
npm run app          # تشغيل التطبيق للتطوير
npm run app:build    # بناء Luma.app
npm run verify       # فحص الأنواع + clippy + الاختبارات
```

الفحص داخل التطبيق (لا WebDriver لـWKWebView على macOS):

```bash
LUMA_SELFTEST=1 ./src-tauri/target/release/bundle/macos/Luma.app/Contents/MacOS/luma
```

النتيجة → `~/Library/Application Support/Luma/selftest-report.json`.
`LUMA_DEMO=1` يفتح مستندًا طويلًا للتحقق البصري. `npm run test:e2e` لـPlaywright.

## الخريطة

```
src/editor/    نواة المحرر — لا تحفظ ولا تعرف المكتبة (README فيها)
src/lib/       autosave.ts · session.ts · bidi.ts · fonts.css
src/components/ SaveStatus.svelte
src/dev/       ⚠️ أدوات تطوير لا تُشحن
src/app.css    ⚠️ رموز مؤقتة حتى المرحلة ٤
src-tauri/     النواة الأصلية — storage/ والنافذة والقائمة والأوامر
public/fonts/  Cairo وAlmarai مدمجان، بلا شبكة
tests/         وحدات + حارس الحدود + e2e/ لـPlaywright
docs/          MAP.md · decisions/ · evidence/ · arabic-battery.md
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

قبل أي عمل على العربية أو الاتجاه: [docs/arabic-battery.md](docs/arabic-battery.md).
