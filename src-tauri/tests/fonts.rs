//! خدمة الخطوط على ملفات ونظام حقيقيين — يحسم المسألة ٨ في §١٨.
//!
//! هذه اختبارات تكامل لا وحدات: تسأل CoreText نفسها. تعدادُ خطوط
//! النظام وتغطيتها وتسجيلُ ملف مستورد لا معنى لمحاكاتها — السؤال كله
//! هل تعمل الطريقة على المنصّة.

use luma_lib::fonts::{self, Coverage, ImportError};
use std::path::{Path, PathBuf};

fn workspace() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// خطوط الحزمة — ملفات TTF حقيقية بتغطية عربية معروفة.
fn bundled_file(name: &str) -> PathBuf {
    workspace().join("../public/fonts").join(name)
}

fn scratch(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("luma-fonts-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

// ── خطوط النظام ──────────────────────────────────────────────

#[test]
fn system_families_are_enumerated_by_their_real_names() {
    let all = fonts::available(&scratch("list"));
    let system: Vec<_> = all.iter().filter(|f| f.source == "system").collect();

    // macOS يشحن مئات العائلات؛ عددٌ ضئيل يعني أن التعداد فشل صامتًا
    assert!(
        system.len() > 20,
        "عدد عائلات النظام {} — التعداد لم يعمل",
        system.len()
    );
    // بأسمائها الصحيحة لا بمعرّفات — `Luma.md` §١١ **ثابت**
    assert!(system.iter().any(|f| f.family_name == "Helvetica Neue"));
    // لا عائلات نظام مخفية تبدأ بنقطة
    assert!(!system.iter().any(|f| f.family_name.starts_with('.')));
}

#[test]
fn arabic_coverage_is_read_from_the_font_not_guessed_from_its_name() {
    let all = fonts::available(&scratch("coverage"));
    let of = |name: &str| {
        all.iter()
            .find(|f| f.family_name == name)
            .map(|f| f.arabic_coverage)
    };

    // خطوط عربية تشحنها Apple
    for arabic in ["Geeza Pro", "Damascus", "Al Nile", "Baghdad"] {
        assert_eq!(
            of(arabic),
            Some(Coverage::Full),
            "{arabic} يجب أن يغطي العربية"
        );
    }
    // وخطوط لاتينية خالصة — **تُعرض ولا تُخفى**، والتغطية معلومة لا مرشِّح
    for latin in ["Helvetica Neue", "Menlo"] {
        assert_eq!(of(latin), Some(Coverage::None), "{latin} لا يغطي العربية");
    }
}

#[test]
fn the_bundled_editor_font_is_offered_and_covers_arabic() {
    let all = fonts::available(&scratch("bundled"));
    let almarai = all
        .iter()
        .find(|f| f.family_name == "Almarai")
        .expect("Almarai مدمج");
    assert_eq!(almarai.source, "bundled");
    assert_eq!(almarai.arabic_coverage, Coverage::Full);

    // Cairo خط الواجهة ولا يُعرض للاختيار — §١١ **ثابت**
    assert!(
        !all.iter()
            .any(|f| f.family_name == "Cairo" && f.source == "bundled"),
        "Cairo لا يُعرض كخط كتابة"
    );
}

// ── الاستيراد ────────────────────────────────────────────────

#[test]
fn importing_a_real_font_copies_it_and_makes_it_available() {
    let root = scratch("import");
    let file = bundled_file("Almarai-Regular.ttf");
    assert!(file.exists(), "ملف الاختبار مفقود: {file:?}");

    let font = fonts::import(&root, &file).expect("استيراد خط سليم");
    assert_eq!(font.source, "imported");
    assert_eq!(font.arabic_coverage, Coverage::Full);

    // نُسخ إلى مجلد بيانات Luma — لا يُقرأ من مكانه الأصلي
    let copied = font.local_reference.as_ref().expect("مسار محلي");
    assert!(Path::new(copied).exists());
    assert!(copied.starts_with(fonts::fonts_dir(&root).to_str().unwrap()));

    // ويظهر في التعداد بعده
    assert!(fonts::imported(&root)
        .iter()
        .any(|f| f.family_name == font.family_name));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn imported_fonts_are_made_available_again_on_every_launch() {
    let root = scratch("relaunch");
    fonts::import(&root, &bundled_file("Almarai-Bold.ttf")).expect("استيراد");

    // إقلاع جديد: العملية لا تحمل تسجيلات سابقة
    let count = fonts::register_all(&root);
    assert_eq!(count, 1, "الخط المستورد يُعاد تسجيله عند الإقلاع");

    let _ = std::fs::remove_dir_all(&root);
}

// ── الحالات الإلزامية في §٨ ──────────────────────────────────

#[test]
fn a_corrupt_file_is_refused_and_nothing_is_copied() {
    let root = scratch("corrupt");
    let bad = std::env::temp_dir().join(format!("luma-bad-{}.ttf", std::process::id()));
    std::fs::write(&bad, "هذا ليس خطًّا".as_bytes()).unwrap();

    let err = fonts::import(&root, &bad).unwrap_err();
    assert!(
        matches!(err, ImportError::Corrupt),
        "توقّعنا Corrupt، جاء {err:?}"
    );
    // «لا يؤثر في المستند» يبدأ بألّا يترك أثرًا في مجلد البيانات
    assert!(fonts::imported(&root).is_empty());

    let _ = std::fs::remove_file(&bad);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn an_unsupported_format_is_named_in_the_message() {
    let root = scratch("format");
    let woff = std::env::temp_dir().join(format!("luma-x-{}.woff2", std::process::id()));
    std::fs::write(&woff, b"wOF2").unwrap();

    let err = fonts::import(&root, &woff).unwrap_err();
    assert!(matches!(err, ImportError::UnsupportedFormat(_)));
    // الرسالة تقول ما المقبول لا «فشل» — `Luma.md` §٣
    assert!(err.to_string().contains("OTF"));

    let _ = std::fs::remove_file(&woff);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_missing_file_is_reported_not_panicked() {
    let root = scratch("missing");
    let err = fonts::import(&root, Path::new("/tmp/لا-يوجد.ttf")).unwrap_err();
    assert!(matches!(err, ImportError::Unreadable(_)));
}

#[test]
fn a_damaged_font_among_imported_ones_does_not_hide_the_rest() {
    let root = scratch("mixed");
    fonts::import(&root, &bundled_file("Almarai-Light.ttf")).expect("استيراد سليم");
    // ملف تالف يهبط في المجلد بعد ذلك
    std::fs::write(
        fonts::fonts_dir(&root).join("broken.ttf"),
        "تالف".as_bytes(),
    )
    .unwrap();

    // «كل خدمة تفشل بمعزل» — §٢
    assert_eq!(fonts::imported(&root).len(), 1);

    let _ = std::fs::remove_dir_all(&root);
}
