//! خدمة الخطوط — `IMPLEMENTATION.md` §٨.
//!
//! ثلاثة مصادر: مدمج في الحزمة، ومثبَّت في النظام، ومستورد من ملف.
//! **بلا أي طلب شبكة** في المصادر الثلاثة — شرطُ المسألة ٨ في §١٨.
//!
//! كيف تصل الخطوط إلى طبقة العرض:
//!
//! | المصدر | الطريقة |
//! |---|---|
//! | مدمج | `@font-face` من داخل الحزمة (`public/fonts/`) |
//! | النظام | تُعدَّد بـCoreText، وتكفي تسميتها في `font-family`: نافذة العرض جزء من العملية فترى خطوط النظام |
//! | مستورد | يُنسخ الملف إلى مجلد البيانات ثم يُسجَّل في **نطاق العملية** عند كل إقلاع |
//!
//! التسجيل في نطاق العملية لا الدائم: Luma لا تثبّت خطوطًا في نظام
//! المستخدم. تعيش داخلها وتموت بإغلاقها.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// حد حجم ملف الخط المستورد.
///
/// أضخم خطوط النظام العربية دون ١٥MB بكثير. الحدّ يمنع أن يشلّ ملفٌ
/// ضخم — أو ملفٌ ليس خطًّا أصلًا — نسخَ الملف والتسجيل.
const MAX_FONT_BYTES: u64 = 20 * 1024 * 1024;

/// الصيغ المدعومة — ما تسجّله CoreText.
///
/// WOFF/WOFF2 صيغتا ويب لا يسجّلهما مدير خطوط النظام، ولا معنى
/// لقبولها ثم الفشل عند العرض.
const SUPPORTED: [&str; 4] = ["ttf", "otf", "ttc", "otc"];

/// عيّنة التغطية العربية — §٨ **ثابت**.
///
/// ثلاث مجموعات لأن نقصها يختلف أثرًا: الحروف نقصها يعني أن الخط لا
/// يكتب العربية أصلًا، والتشكيل نقصه يفسد النص المشكول وحده، والأرقام
/// العربية الهندية نقصها يظهر في الواجهة لا في النص.
const LETTERS: &str = "ابتثجحخدذرزسشصضطظعغفقكلمنهوي";
const HAMZAS: &str = "أإآؤئءةى";
const MARKS: &str = "\u{064B}\u{064C}\u{064D}\u{064E}\u{064F}\u{0650}\u{0651}\u{0652}";
const DIGITS: &str = "٠١٢٣٤٥٦٧٨٩";

/// تغطية الخط للعربية — **معلومة للمستخدم لا فلترة تلقائية** (§٨ **ثابت**).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Coverage {
    /// الحروف والهمزات والتشكيل والأرقام كلها.
    Full,
    /// يكتب العربية، وينقصه التشكيل أو الأرقام العربية الهندية.
    Partial,
    /// لا يكتب العربية.
    None,
}

/// مرجع خط — يقابل `FontReference` في §٣.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontReference {
    /// اسم العائلة — وهو المفتاح، وهو ما يُكتب في `font-family`.
    pub id: String,
    pub family_name: String,
    /// `bundled` أو `system` أو `imported`.
    pub source: &'static str,
    pub arabic_coverage: Coverage,
    /// مسار الملف للمستورد وحده.
    pub local_reference: Option<String>,
}

/// خطأ استيراد — كل حالة برسالة تقول ما العمل، لا «فشل».
#[derive(Debug)]
pub enum ImportError {
    UnsupportedFormat(String),
    TooLarge(u64),
    Unreadable(String),
    /// الملف بصيغة مدعومة لكنه ليس خطًّا سليمًا.
    Corrupt,
    Io(String),
}

impl std::fmt::Display for ImportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFormat(ext) => {
                write!(f, "صيغة غير مدعومة ({ext}). الصيغ المقبولة: OTF وTTF وTTC")
            }
            Self::TooLarge(bytes) => {
                write!(f, "الملف أكبر من الحد ({} ميغابايت)", bytes / 1024 / 1024)
            }
            Self::Unreadable(e) => write!(f, "تعذّرت قراءة الملف: {e}"),
            Self::Corrupt => write!(f, "الملف ليس خط طباعة سليمًا"),
            Self::Io(e) => write!(f, "تعذّر نسخ الخط: {e}"),
        }
    }
}

pub type Result<T> = std::result::Result<T, ImportError>;

/// مجلد الخطوط المستوردة داخل مجلد بيانات Luma.
pub fn fonts_dir(root: &Path) -> PathBuf {
    root.join("fonts")
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

// ── ما تحته منصّة ────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use super::{Coverage, DIGITS, HAMZAS, LETTERS, MARKS};
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::TCFType;
    use core_foundation::error::CFError;
    use core_foundation::url::{CFURLRef, CFURL};
    use core_text::font_descriptor::CTFontDescriptor;
    use std::path::Path;

    /// `kCTFontManagerScopeProcess` — الخط يعيش داخل العملية ولا يُثبَّت
    /// في نظام المستخدم. Luma لا تترك أثرًا خارج مجلد بياناتها.
    const SCOPE_PROCESS: u32 = 1;

    /// `kCTFontManagerErrorAlreadyRegistered` — ليس فشلًا.
    ///
    /// النتيجة المطلوبة «الخط متاح»، وهو متاح. يقع هذا حين يُستورد خط
    /// ثم يُعاد التسجيل في الجلسة نفسها.
    const ALREADY_REGISTERED: isize = 105;

    extern "C" {
        /// غير مُصدَّرة في `core-text`، وهي الطريقة الوحيدة لإتاحة ملف
        /// خط لطبقة العرض بلا تثبيته في نظام المستخدم.
        fn CTFontManagerRegisterFontsForURL(
            font_url: CFURLRef,
            scope: u32,
            error: *mut core_foundation::error::CFErrorRef,
        ) -> bool;
    }

    /// أسماء عائلات الخطوط المثبَّتة، مرتَّبة.
    pub fn system_families() -> Vec<String> {
        let mut names: Vec<String> = core_text::font_manager::copy_available_font_family_names()
            .iter()
            .map(|n| n.to_string())
            .filter(|n| !n.starts_with('.')) // عائلات النظام المخفية
            .collect();
        names.sort_by_key(|a| a.to_lowercase());
        names.dedup();
        names
    }

    /// اسم عائلة الخط داخل الملف، أو `None` إن لم يكن خطًّا سليمًا.
    ///
    /// `CTFontManagerIsSupportedFont` هو حكم النظام نفسه على الملف:
    /// لا تخمين من الامتداد ولا من البايتات الأولى.
    pub fn family_of(path: &Path) -> Option<String> {
        let url = CFURL::from_path(path, false)?;
        // SAFETY: عنوان صالح تملكه CFURL، والدالتان تقرآن منه فقط،
        // والمصفوفة العائدة بقاعدة الإنشاء فنتملّكها هنا
        unsafe {
            if !core_text::font_manager::CTFontManagerIsSupportedFont(url.as_concrete_TypeRef()) {
                return None;
            }
            let raw: CFArrayRef =
                core_text::font_manager::CTFontManagerCreateFontDescriptorsFromURL(
                    url.as_concrete_TypeRef(),
                );
            if raw.is_null() {
                return None;
            }
            let descriptors: CFArray<CTFontDescriptor> = CFArray::wrap_under_create_rule(raw);
            descriptors.get(0).map(|d| d.family_name())
        }
    }

    /// يُتيح ملف خط لطبقة العرض داخل هذه العملية.
    pub fn register(path: &Path) -> std::result::Result<(), String> {
        let Some(url) = CFURL::from_path(path, false) else {
            return Err("مسار غير صالح".into());
        };
        let mut error: core_foundation::error::CFErrorRef = std::ptr::null_mut();
        // SAFETY: عنوان صالح تملكه CFURL أعلاه، والمؤشر يُقرأ فقط عند
        // إرجاع `false` كما تعلن CoreText.
        let ok = unsafe {
            CTFontManagerRegisterFontsForURL(url.as_concrete_TypeRef(), SCOPE_PROCESS, &mut error)
        };
        if ok {
            return Ok(());
        }
        if error.is_null() {
            return Err("تعذّر تسجيل الخط".into());
        }
        // SAFETY: مؤشر خطأ غير فارغ تملكه CoreText، ونتملّكه هنا فيُحرَّر
        let err = unsafe { CFError::wrap_under_create_rule(error) };
        if err.code() == ALREADY_REGISTERED {
            return Ok(());
        }
        Err(err.description().to_string())
    }

    /// تغطية العربية بقراءة محارف الخط نفسه.
    ///
    /// يُسأل الخط عن مِحرف كل رمز: صفرٌ يعني أن الرمز غير موجود في
    /// جدول محارفه. هذه قراءةٌ للجدول عبر المنصّة لا تخمينٌ من الاسم.
    pub fn coverage(family: &str) -> Coverage {
        let Ok(font) = core_text::font::new_from_name(family, 16.0) else {
            return Coverage::None;
        };

        let has = |sample: &str| -> bool {
            let chars: Vec<u16> = sample.encode_utf16().collect();
            let mut glyphs = vec![0u16; chars.len()];
            // SAFETY: المصفوفتان بالطول نفسه ويملكهما هذا النطاق
            unsafe {
                font.get_glyphs_for_characters(
                    chars.as_ptr(),
                    glyphs.as_mut_ptr(),
                    chars.len() as isize,
                );
            }
            glyphs.iter().all(|g| *g != 0)
        };

        if !has(LETTERS) || !has(HAMZAS) {
            return Coverage::None;
        }
        if has(MARKS) && has(DIGITS) {
            Coverage::Full
        } else {
            Coverage::Partial
        }
    }
}

/// خارج macOS: لا تعداد ولا تسجيل. المدمج وحده يعمل.
#[cfg(not(target_os = "macos"))]
mod platform {
    use super::Coverage;
    use std::path::Path;

    pub fn system_families() -> Vec<String> {
        Vec::new()
    }
    pub fn family_of(_path: &Path) -> Option<String> {
        None
    }
    pub fn register(_path: &Path) -> std::result::Result<(), String> {
        Err("تسجيل الخطوط غير مدعوم على هذه المنصّة".into())
    }
    pub fn coverage(_family: &str) -> Coverage {
        Coverage::None
    }
}

// ── الخطوط المدمجة ───────────────────────────────────────────

/// Almarai وحده خطُّ كتابة؛ Cairo خط واجهة **لا يتغيّر بتفضيل
/// المستخدم** (`Luma.md` §١١ **ثابت**)، فلا يُعرض في قائمة الاختيار.
pub const BUNDLED_EDITOR_FAMILY: &str = "Almarai";

fn bundled() -> Vec<FontReference> {
    vec![FontReference {
        id: BUNDLED_EDITOR_FAMILY.to_string(),
        family_name: BUNDLED_EDITOR_FAMILY.to_string(),
        source: "bundled",
        // مدمج في الحزمة ومقيس: أربعة أوزان بتغطية عربية كاملة
        arabic_coverage: Coverage::Full,
        local_reference: None,
    }]
}

// ── الواجهة العامة ───────────────────────────────────────────

/// كل ما يمكن أن يكتب به المستخدم، من المصادر الثلاثة.
///
/// **الخطوط اللاتينية لا تُخفى**: المنتج ثنائي اللغة في الرؤية،
/// والتغطية تُعرض ولا تُستعمل مرشِّحًا — §١١ **ثابت**.
pub fn available(root: &Path) -> Vec<FontReference> {
    let mut out = bundled();

    for f in imported(root) {
        out.push(f);
    }

    for family in platform::system_families() {
        if family == BUNDLED_EDITOR_FAMILY || out.iter().any(|f| f.family_name == family) {
            continue;
        }
        let coverage = platform::coverage(&family);
        out.push(FontReference {
            id: family.clone(),
            family_name: family,
            source: "system",
            arabic_coverage: coverage,
            local_reference: None,
        });
    }

    out
}

/// الخطوط المستوردة المخزَّنة في مجلد البيانات.
pub fn imported(root: &Path) -> Vec<FontReference> {
    let dir = fonts_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !SUPPORTED.contains(&extension_of(&path).as_str()) {
            continue;
        }
        // ملف تالف بين المستوردات لا يُسقط البقية — §٢ «كل خدمة تفشل بمعزل»
        let Some(family) = platform::family_of(&path) else {
            continue;
        };
        out.push(FontReference {
            id: family.clone(),
            arabic_coverage: platform::coverage(&family),
            family_name: family,
            source: "imported",
            local_reference: Some(path.to_string_lossy().into_owned()),
        });
    }
    out.sort_by_key(|a| a.family_name.to_lowercase());
    out
}

/// يُعيد إتاحة كل خط مستورد — يُنادى عند كل إقلاع.
///
/// يعيد عدد ما سُجِّل. فشل خطٍّ لا يمنع البقية.
pub fn register_all(root: &Path) -> usize {
    let dir = fonts_dir(root);
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return 0;
    };
    let mut count = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if SUPPORTED.contains(&extension_of(&path).as_str()) && platform::register(&path).is_ok() {
            count += 1;
        }
    }
    count
}

/// يستورد ملف خط: يتحقّق، ثم ينسخ، ثم يُتيح.
///
/// **الترتيب مقصود**: لا يُنسخ ملف إلى مجلد بيانات المستخدم قبل أن
/// يثبت أنه خط سليم. «ملف خط تالف يُرفض بوضوح ولا يؤثر في المستند»
/// — `Luma.md` §١١ **ثابت**.
pub fn import(root: &Path, source: &Path) -> Result<FontReference> {
    let ext = extension_of(source);
    if !SUPPORTED.contains(&ext.as_str()) {
        return Err(ImportError::UnsupportedFormat(if ext.is_empty() {
            "بلا امتداد".into()
        } else {
            ext
        }));
    }

    let meta = std::fs::metadata(source).map_err(|e| ImportError::Unreadable(e.to_string()))?;
    if meta.len() > MAX_FONT_BYTES {
        return Err(ImportError::TooLarge(meta.len()));
    }

    // التحقّق قبل النسخ
    let family = platform::family_of(source).ok_or(ImportError::Corrupt)?;

    let dir = fonts_dir(root);
    std::fs::create_dir_all(&dir).map_err(|e| ImportError::Io(e.to_string()))?;
    let name = source
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("{family}.{ext}"));
    let target = dir.join(sanitize_file_name(&name));
    std::fs::copy(source, &target).map_err(|e| ImportError::Io(e.to_string()))?;

    platform::register(&target).map_err(|e| {
        // لا يبقى ملف غير قابل للاستعمال في مجلد المستخدم
        let _ = std::fs::remove_file(&target);
        ImportError::Unreadable(e)
    })?;

    Ok(FontReference {
        id: family.clone(),
        arabic_coverage: platform::coverage(&family),
        family_name: family,
        source: "imported",
        local_reference: Some(target.to_string_lossy().into_owned()),
    })
}

/// يمنع اسم ملف من الخروج من مجلد الخطوط.
fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c == '/' || c == '\\' || c == ':' {
                '_'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim_start_matches('.').trim();
    if trimmed.is_empty() {
        "font".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_font_extensions_are_accepted() {
        for good in ["a.ttf", "a.OTF", "a.ttc", "a.otc"] {
            assert!(
                SUPPORTED.contains(&extension_of(Path::new(good)).as_str()),
                "{good}"
            );
        }
        for bad in ["a.woff2", "a.woff", "a.png", "a"] {
            assert!(
                !SUPPORTED.contains(&extension_of(Path::new(bad)).as_str()),
                "{bad}"
            );
        }
    }

    #[test]
    fn import_refuses_unsupported_before_touching_disk() {
        let root = std::env::temp_dir().join(format!("luma-fonts-{}", std::process::id()));
        let err = import(&root, Path::new("/tmp/x.woff2")).unwrap_err();
        assert!(matches!(err, ImportError::UnsupportedFormat(_)));
        // لم يُنشأ مجلد ولم يُنسخ شيء
        assert!(!fonts_dir(&root).exists());
    }

    #[test]
    fn file_names_cannot_escape_the_fonts_dir() {
        // الخاصية المطلوبة لا سلسلة بعينها: لا فاصل مسار، ولا بداية
        // بنقطة تُخفي الملف، ولا اسم فارغ.
        for hostile in [
            "../../evil.ttf",
            "/etc/passwd",
            "a:b/c\\d",
            ".hidden.ttf",
            "   ",
            "",
        ] {
            let safe = sanitize_file_name(hostile);
            assert!(!safe.is_empty(), "{hostile}");
            assert!(!safe.contains('/'), "{hostile} → {safe}");
            assert!(!safe.contains('\\'), "{hostile} → {safe}");
            assert!(!safe.contains(':'), "{hostile} → {safe}");
            assert!(!safe.starts_with('.'), "{hostile} → {safe}");
            assert_eq!(
                Path::new(&safe).components().count(),
                1,
                "{hostile} → {safe}"
            );
        }
    }

    #[test]
    fn every_error_says_what_to_do() {
        for e in [
            ImportError::UnsupportedFormat("woff2".into()),
            ImportError::TooLarge(30 * 1024 * 1024),
            ImportError::Corrupt,
        ] {
            let msg = e.to_string();
            assert!(!msg.is_empty());
            // رسائل الواجهة عربية — §٣ من `Luma.md`
            assert!(
                msg.chars().any(|c| ('\u{0600}'..='\u{06FF}').contains(&c)),
                "{msg}"
            );
        }
    }

    #[test]
    fn bundled_editor_font_is_almarai_only() {
        // Cairo خط واجهة لا يُختار — §١١ **ثابت**
        let b = bundled();
        assert_eq!(b.len(), 1);
        assert_eq!(b[0].family_name, "Almarai");
        assert!(!b.iter().any(|f| f.family_name == "Cairo"));
    }
}
