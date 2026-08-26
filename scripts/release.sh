#!/usr/bin/env bash
# بناء Luma.app وتوقيعها وتصديقها — المرحلة ٨.
#
#   ./scripts/release.sh --adhoc    # توقيع محلي للتحقق، بلا شهادة توزيع
#   ./scripts/release.sh            # توقيع Developer ID ثم تصديق
#
# **الترتيب هو كل شيء هنا.** `tauri build` يبني الحزمة ثم يصنع DMG
# **منها**. فلو وُقِّعت الحزمة بعد البناء لبقي داخل الـDMG نسخةٌ غير
# موقَّعة — ويشحن المشروعُ صورةً يرفضها Gatekeeper بينما يبدو كل شيء
# ناجحًا. ولذلك يُمرَّر التوقيع إلى Tauri **أثناء** البناء عبر
# `APPLE_SIGNING_IDENTITY`، فتُوقَّع الحزمة قبل أن تدخل الصورة.
#
# ثم يُتحقَّق من ذلك لا يُفترَض: الصورة تُركَّب ويُفحص ما بداخلها فعلًا.
#
# ما يحتاجه الوضع الكامل:
#   عضوية في برنامج مطوّري Apple، وشهادة `Developer ID Application`،
#   وبيانات اعتماد مخزَّنة:
#     xcrun notarytool store-credentials luma \
#       --apple-id "بريدك" --team-id "معرّف الفريق" --password "كلمة خاصة بالتطبيق"

set -euo pipefail

# **البناء العالمي هو ما يُشحن.** أدنى إصدار مدعوم macOS 13، وهو يعمل
# على أجهزة Intel من ٢٠١٧ فصاعدًا؛ وحزمةٌ arm64 وحدها تُفتح عندهم فتفشل
# فشلًا كاملًا بلا رسالة مفهومة. الثمن ضِعف الحجم (٥٫٢MB بدل ٢٫٧) —
# وهو أرخص من إسقاط نصف الأجهزة المدعومة. ADR ٠٠١٦.
TARGET="universal-apple-darwin"
BUNDLE="src-tauri/target/$TARGET/release/bundle"
APP="$BUNDLE/macos/Luma.app"
DMG_DIR="$BUNDLE/dmg"
ENTITLEMENTS="src-tauri/entitlements.plist"
PROFILE="${LUMA_NOTARY_PROFILE:-luma}"
ADHOC=0
[ "${1:-}" = "--adhoc" ] && ADHOC=1

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
die() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

# ── ٠ · التدارك شرط الحذف لا لاحقُه — أُغلقت (٢٦ أغسطس ٢٠٢٦) ──
# كانت هنا بوابة تمنع شحن `delete_document` قبل أن تُبنى السلّة —
# `Luma.md` §٢٠ مسألة ١٩ **ثابت**. السلّة بُنيت (ADR ٠٠١٩): حقل
# `deleted_at` في `src-tauri/src/storage/model.rs`، والحذف المعتاد
# نقلٌ إلى `Trash/` لا محوًا فوريًا. شرطها تحقّق نهائيًا فأُزيلت —
# إبقاء تحقّقٍ لا يمكن أن يفشل بعد اليوم ضجيجٌ لا حراسة.

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

# ── ١ · البناء والتوقيع معًا ──────────────────────────────────
# Tauri يوقّع الحزمة أثناء البناء حين يجد الهوية في البيئة، فتدخل
# الصورةَ موقَّعةً. و`hardenedRuntime` و`entitlements` من `tauri.conf.json`.
say "١ · البناء والتوقيع"
if [ "$ADHOC" -eq 1 ]; then
  npm run app:build:universal
  # الهوية العابرة لا يقبلها Tauri، فتُوقَّع الحزمة بعد البناء —
  # والصورة في هذا الوضع لا تُشحن أصلًا، فترتيبها لا يضرّ.
  codesign --force --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS" --sign "$IDENTITY" "$APP"
else
  APPLE_SIGNING_IDENTITY="$IDENTITY" npm run app:build:universal
fi
[ -d "$APP" ] || die "لم تُبنَ $APP"

ARCHS="$(lipo -archs "$APP/Contents/MacOS/luma" 2>/dev/null || true)"
echo "المعماريات: $ARCHS"
case "$ARCHS" in
  *x86_64*arm64*|*arm64*x86_64*) echo "✓ حزمة عالمية" ;;
  *) die "الحزمة ليست عالمية ($ARCHS) — أجهزة Intel المدعومة لن تفتحها" ;;
esac

# ── ٢ · التحقق من التوقيع ─────────────────────────────────────
say "٢ · التحقق من توقيع الحزمة"
codesign --verify --deep --strict --verbose=2 "$APP"
FLAGS="$(codesign -d --verbose=2 "$APP" 2>&1 | grep -o 'flags=[^ ]*' || true)"
echo "الأعلام: $FLAGS"
case "$FLAGS" in
  *runtime*) echo "✓ Hardened Runtime مثبَّت" ;;
  *) die "Hardened Runtime غير مثبَّت — التصديق سيرفضها" ;;
esac
echo "الاستحقاقات المُثبَّتة فعلًا:"
codesign -d --entitlements - --xml "$APP" 2>/dev/null | head -5 || echo "  (لا استحقاقات — كما هو مقصود)"

# ── ٣ · التشغيل تحت القيود ────────────────────────────────────
say "٣ · التشغيل تحت القيود"
"$APP/Contents/MacOS/luma" &
PID=$!
sleep 4
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  echo "✓ يعمل تحت Hardened Runtime"
else
  die "التطبيق سقط تحت Hardened Runtime — يحتاج استحقاقًا، وسببه يُسجَّل في ADR"
fi

if [ "$ADHOC" -eq 1 ]; then
  say "انتهى الوضع المحلي. Gatekeeper يحتاج شهادة توزيع وتصديقًا."
  exit 0
fi

# ── ٤ · تصديق الحزمة وتثبيته ──────────────────────────────────
say "٤ · تصديق الحزمة"
WORK="$(mktemp -d)"
ZIP="$WORK/Luma.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
if ! xcrun notarytool submit "$ZIP" --keychain-profile "$PROFILE" --wait; then
  # سبب الرفض لا يظهر في مخرَج `submit` — يُطلب صراحةً
  ID="$(xcrun notarytool history --keychain-profile "$PROFILE" --output-format json \
        | /usr/bin/python3 -c 'import json,sys;print(json.load(sys.stdin)["history"][0]["id"])' 2>/dev/null || true)"
  [ -n "$ID" ] && xcrun notarytool log "$ID" --keychain-profile "$PROFILE" || true
  die "فشل التصديق — السبب أعلاه"
fi

say "٥ · تثبيت التصديق على الحزمة"
# التثبيت يجعلها تعمل بلا اتصال: بدونه يسأل Gatekeeper خوادم Apple
xcrun stapler staple "$APP"
xcrun stapler validate "$APP"

# ── ٦ · الصورة ────────────────────────────────────────────────
say "٦ · الصورة"
DMG_COUNT="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg' | wc -l | tr -d ' ')"
[ "$DMG_COUNT" = "1" ] || die "وُجدت $DMG_COUNT صورة في $DMG_DIR — احذف القديم أولًا حتى لا تُوقَّع الخطأ"
DMG="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg')"

# **يُفحص ما بداخلها لا يُفترض.** الصورة صُنعت أثناء البناء؛ وهذا يثبت
# أن الحزمة التي دخلتها هي الموقَّعة، لا نسخة سابقة.
say "٦أ · فحص الحزمة داخل الصورة"
MNT="$WORK/mnt"
mkdir -p "$MNT"
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" >/dev/null
INNER="$(find "$MNT" -maxdepth 1 -name '*.app' | head -1)"
if [ -z "$INNER" ]; then hdiutil detach "$MNT" >/dev/null; die "لا حزمة داخل الصورة"; fi
if ! codesign --verify --deep --strict "$INNER" 2>/dev/null; then
  hdiutil detach "$MNT" >/dev/null
  die "الحزمة داخل الصورة **غير موقَّعة** — بُنيت الصورة قبل التوقيع"
fi
echo "✓ الحزمة داخل الصورة موقَّعة"
hdiutil detach "$MNT" >/dev/null

say "٦ب · توقيع الصورة وتصديقها"
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait || die "فشل تصديق الصورة"
xcrun stapler staple "$DMG"

# ── ٧ · حكم Gatekeeper ────────────────────────────────────────
say "٧ · حكم Gatekeeper"
spctl --assess --type execute --verbose=4 "$APP"
spctl --assess --type open --context context:primary-signature --verbose=4 "$DMG"

rm -rf "$WORK"
say "تمّ: $DMG"
echo "يبقى بند لا تفعله الآلة: التثبيت على **حساب macOS نظيف** ودورة"
echo "كتابة وحفظ وإغلاق وإعادة فتح: مساحة نظيفة والنص في المكتبة — docs/release-checklist.md"
