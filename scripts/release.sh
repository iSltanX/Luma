#!/usr/bin/env bash
# بناء Luma.app وتوقيعها وتصديقها — المرحلة ٨.
#
#   ./scripts/release.sh --adhoc    # توقيع محلي للتحقق، بلا شهادة توزيع
#   ./scripts/release.sh            # توقيع Developer ID ثم تصديق
#
# **الوضعان يختلفان في الشهادة لا في القيود.** `--adhoc` يوقّع بهوية
# محلية (`-`) وبـHardened Runtime والاستحقاقات نفسها، فيثبت أن التطبيق
# يعمل تحت قيود التصديق قبل أن توجد شهادة توزيع. لا يجتاز Gatekeeper
# ولا يُغني عن التصديق — يكشف عطبًا مبكرًا فقط.
#
# ما يحتاجه الوضع الكامل:
#   عضوية في برنامج مطوّري Apple، وشهادة `Developer ID Application`،
#   وبيانات اعتماد مخزَّنة:
#     xcrun notarytool store-credentials luma \
#       --apple-id "بريدك" --team-id "معرّف الفريق" --password "كلمة خاصة بالتطبيق"

set -euo pipefail

APP="src-tauri/target/release/bundle/macos/Luma.app"
DMG_DIR="src-tauri/target/release/bundle/dmg"
ENTITLEMENTS="src-tauri/entitlements.plist"
PROFILE="${LUMA_NOTARY_PROFILE:-luma}"
ADHOC=0
[ "${1:-}" = "--adhoc" ] && ADHOC=1

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# ── الهوية ────────────────────────────────────────────────────
if [ "$ADHOC" -eq 1 ]; then
  IDENTITY="-"
  say "وضع محلي: توقيع بهوية عابرة، وبقيود التصديق نفسها"
else
  IDENTITY="$(security find-identity -v -p codesigning \
    | grep "Developer ID Application" | head -1 \
    | sed -E 's/.*"(.*)"/\1/')" || true
  if [ -z "${IDENTITY:-}" ]; then
    die "لا شهادة «Developer ID Application» في السلسلة.

هي وحدها التي توزّع خارج المتجر، وتحتاج عضوية مدفوعة في برنامج مطوّري
Apple. الشهادة الموجودة «Apple Development» للتشغيل المحلي لا للتوزيع.

الخطوات:
  ١. developer.apple.com/programs — الاشتراك
  ٢. Certificates ← + ← Developer ID Application ← نزّلها وافتحها
  ٣. xcrun notarytool store-credentials $PROFILE \\
       --apple-id \"بريدك\" --team-id \"معرّف فريقك\" \\
       --password \"كلمة مرور خاصة بالتطبيق من appleid.apple.com\"

وللتحقق قبل ذلك:  ./scripts/release.sh --adhoc"
  fi
  say "الهوية: $IDENTITY"
fi

# ── البناء ────────────────────────────────────────────────────
say "١ · البناء"
npm run app:build
[ -d "$APP" ] || die "لم تُبنَ $APP"

# ── التوقيع ───────────────────────────────────────────────────
# `--deep` مهجورة وغير موثوقة: تُوقّع من الداخل إلى الخارج بترتيب لا
# يضمنه أحد. الأطر تُوقَّع أولًا صراحةً ثم الحزمة.
say "٢ · التوقيع بـHardened Runtime"
while IFS= read -r -d '' item; do
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$item"
done < <(find "$APP/Contents" \( -name "*.dylib" -o -name "*.framework" \) -print0)

codesign --force --timestamp --options runtime \
  --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$APP"

say "٣ · التحقق من التوقيع"
codesign --verify --deep --strict --verbose=2 "$APP"
echo "— الاستحقاقات المُثبَّتة فعلًا:"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | head -20 || echo "  (لا استحقاقات — كما هو مقصود)"

if [ "$ADHOC" -eq 1 ]; then
  say "٤ · التشغيل تحت القيود"
  "$APP/Contents/MacOS/luma" &
  PID=$!
  sleep 4
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    echo "✓ التطبيق يعمل تحت Hardened Runtime بلا استحقاق واحد"
  else
    die "التطبيق سقط تحت Hardened Runtime — يحتاج استحقاقًا، وسببه يُسجَّل في ADR"
  fi
  say "انتهى الوضع المحلي. Gatekeeper يحتاج شهادة توزيع وتصديقًا."
  exit 0
fi

# ── التصديق ───────────────────────────────────────────────────
say "٤ · التصديق"
ZIP="$(mktemp -d)/Luma.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait

say "٥ · تثبيت التصديق على الحزمة"
# التثبيت يجعلها تعمل بلا اتصال: بدونه يسأل Gatekeeper خوادم Apple
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

say "٦ · DMG"
DMG="$(find "$DMG_DIR" -name "*.dmg" | head -1)"
[ -n "$DMG" ] || die "لم يُبنَ DMG"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"

say "٧ · حكم Gatekeeper"
spctl --assess --type execute --verbose=4 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"

say "تمّ: $DMG"
echo "يبقى بند لا تفعله الآلة: التثبيت على **حساب macOS نظيف** ودورة"
echo "كتابة وحفظ وإغلاق وإعادة فتح واستئناف — docs/release-checklist.md"
