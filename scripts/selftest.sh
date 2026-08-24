#!/usr/bin/env bash
# الفحص الذاتي داخل `Luma.app` مبنية — **بوابة تسقط، لا تقرير يُقرأ**.
#
# لا WebDriver لـWKWebView على macOS، فالفحص يعمل داخل التطبيق ويكتب
# نتيجته إلى ملف. هذا السكربت يشغّله ويقرأ الملف ويخرج بحالة غير صفرية
# إن سقط بند واحد — وهو ما يجعل ميزانيات §١٤ «محقَّقة» لا «مثبَّتة» فقط
# (معيار اكتمال المرحلة ٧).
#
#   ./scripts/selftest.sh            # يشغّل ويحكم
#   LUMA_PHASE=7 ./scripts/selftest.sh
#
# **النافذة يجب أن تصل المقدمة:** macOS يعلّق `requestAnimationFrame`
# للنوافذ المحجوبة. الفحص لا يتوقف إن حُجبت (فيه مهلة احتياطية) لكن
# أرقام الأداء لا تكون ذات معنى. السكربت يُفعّلها بنفسه.

set -uo pipefail

APP="./src-tauri/target/release/bundle/macos/Luma.app/Contents/MacOS/luma"
REPORT="$HOME/Library/Application Support/Luma/selftest-report.json"
PHASE="${LUMA_PHASE:-7}"

if [ ! -x "$APP" ]; then
  echo "لا توجد نسخة مبنية: $APP"
  echo "ابنِ أولًا:  npm run app:build"
  exit 2
fi

rm -f "$REPORT"

LUMA_SELFTEST=1 LUMA_PHASE="$PHASE" "$APP" &
APP_PID=$!

# التفعيل بعد أن تظهر النافذة، ثم انتظار التقرير بمهلة
( sleep 3; osascript -e 'tell application "Luma" to activate' >/dev/null 2>&1 ) &

for _ in $(seq 1 90); do
  [ -f "$REPORT" ] && break
  sleep 1
done

kill "$APP_PID" 2>/dev/null
wait "$APP_PID" 2>/dev/null

if [ ! -f "$REPORT" ]; then
  echo "لم يُكتب تقرير الفحص خلال ٩٠ ثانية — تعليقٌ أو انهيار."
  exit 1
fi

REPORT="$REPORT" node -e '
const r = require(process.env.REPORT);
if (r.error) {
  console.error("سقط الفحص قبل أن يكتمل:", r.error);
  process.exit(1);
}
const failed = r.checks.filter(c => !c.passed);
for (const c of r.checks) {
  console.log((c.passed ? "  ✓ " : "  ✗ ") + c.name + " — " + c.detail);
}
console.log("");
console.log("المرحلة " + r.phase + ": " + (r.checks.length - failed.length) + "/" + r.checks.length + " مرّ");
if (failed.length) {
  console.error("سقط " + failed.length + " بندًا:");
  for (const c of failed) console.error("  ✗ " + c.id + " — " + c.detail);
  process.exit(1);
}
'
