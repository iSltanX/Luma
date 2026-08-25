//! الأوامر بين النواة والواجهة.
//!
//! الواجهة تقرر **متى** يُحفظ (التجميع والسقف)، والنواة تقرر **كيف**
//! (الذرّية والتحقق والفشل). لا تعرف إحداهما تفاصيل الأخرى.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::document::{DocumentStore, StoreError};
use crate::storage::model::{
    Block, Document, DocumentSummary, Revision, RevisionSource, RevisionSummary,
};
use crate::storage::prefs::PreferencesStore;
use crate::storage::revision::{now_ms, RevisionStore};

pub struct Storage {
    pub root: PathBuf,
}

impl Storage {
    pub fn docs(&self) -> DocumentStore {
        DocumentStore::new(self.root.clone())
    }
    pub fn prefs(&self) -> PreferencesStore {
        PreferencesStore::new(self.root.clone())
    }
    pub fn revisions(&self, doc_id: &str) -> RevisionStore {
        RevisionStore::new(self.docs().revisions_dir(doc_id))
    }
}

fn to_message(e: StoreError) -> String {
    e.to_string()
}

// ── المستندات ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePayload {
    pub id: String,
    pub title: Option<String>,
    pub blocks: Vec<Block>,
    /// أول حفظ لهذا المستند — تُضبط `createdAt` عنده فقط.
    #[serde(default)]
    pub created_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub id: String,
    pub updated_at: i64,
    /// أُنشئت لقطة مع هذا الحفظ.
    pub snapshot_created: bool,
}

#[tauri::command]
pub fn save_document(
    storage: State<'_, Storage>,
    payload: SavePayload,
) -> Result<SaveResult, String> {
    let docs = storage.docs();
    let now = now_ms();

    // مستند بلا محتوى لا يُكتب أصلًا: «لا ضجيج في المكتبة من مستندات
    // فارغة» — `Luma.md` §٢٠ مسألة ٣.
    let candidate = Document {
        schema_version: crate::storage::model::SCHEMA_VERSION,
        id: payload.id.clone(),
        title: payload.title.clone(),
        blocks: payload.blocks.clone(),
        created_at: payload.created_at.unwrap_or(now),
        updated_at: now,
        last_opened_at: now,
    };
    if candidate.is_empty() && !docs.exists(&payload.id) {
        return Ok(SaveResult {
            id: payload.id,
            updated_at: now,
            snapshot_created: false,
        });
    }

    // يُحافظ على `createdAt` الأصلي إن كان المستند موجودًا
    let mut doc = candidate;
    if let Ok(existing) = docs.load(&payload.id) {
        doc.created_at = existing.created_at;
    }

    docs.save(&doc).map_err(to_message)?;

    // اللقطة بعد نجاح الحفظ لا قبله: لا لقطة لحالة لم تُحفظ.
    let revs = storage.revisions(&payload.id);
    let snapshot_created = match revs.should_snapshot(&doc) {
        Ok(true) => revs.create(&doc, RevisionSource::Automatic).is_ok(),
        _ => false,
    };

    Ok(SaveResult {
        id: doc.id,
        updated_at: doc.updated_at,
        snapshot_created,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedDocument {
    pub id: String,
    pub title: Option<String>,
    pub display_title: String,
    pub blocks: Vec<Block>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[tauri::command]
pub fn load_document(storage: State<'_, Storage>, id: String) -> Result<LoadedDocument, String> {
    let docs = storage.docs();
    let mut doc = docs.load(&id).map_err(to_message)?;
    doc.last_opened_at = now_ms();
    // فشل ختم وقت الفتح لا يمنع فتح المستند
    let _ = docs.save(&doc);
    Ok(LoadedDocument {
        display_title: doc.display_title(),
        id: doc.id,
        title: doc.title,
        blocks: doc.blocks,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryListing {
    pub documents: Vec<DocumentSummary>,
    /// مستندات تعذّرت قراءتها — تُعرض ولا تُخفى ولا تُحذف.
    pub damaged: Vec<String>,
}

#[tauri::command]
pub fn list_documents(storage: State<'_, Storage>) -> Result<LibraryListing, String> {
    let (documents, damaged) = storage.docs().list().map_err(to_message)?;
    Ok(LibraryListing { documents, damaged })
}

/// آخر مستند فُتح — أساس الاستئناف. `Luma.md` §٢٠ مسألة ١.
#[tauri::command]
pub fn most_recent_document(storage: State<'_, Storage>) -> Result<Option<String>, String> {
    storage.docs().most_recent().map_err(to_message)
}

/// بادئة معرّفات ما ينشئه الفحص الذاتي.
const SELFTEST_PREFIX: &str = "selftest-";

/// يزيل ما خلّفه الفحص الذاتي من مستندات. **أداة تطوير.**
///
/// الفحص يكتب مستندات حقيقية في مجلد بيانات المستخدم ليختبر المسار
/// الحقيقي، فكان يتركها بعده: مكتبةٌ ممتلئة بضجيج أداة، وأسوأ من ذلك
/// أن الاستئناف يفتح آخرها بدل نصّ المستخدم.
///
/// **لا يحذف إلا ما تبدأ معرّفاته بـ`selftest-`.** لا يوجد أمر حذف عام
/// في Luma — «لا حذف» قرارٌ في `Luma.md` §٦، وهذا لا ينقضه.
#[tauri::command]
pub fn cleanup_selftest(storage: State<'_, Storage>) -> Result<usize, String> {
    let docs = storage.docs();
    let (list, damaged) = docs.list().map_err(to_message)?;
    let mut removed = 0;
    for id in list
        .into_iter()
        .map(|d| d.id)
        .chain(damaged)
        .filter(|id| id.starts_with(SELFTEST_PREFIX))
    {
        if docs.delete(&id).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// يبذر مكتبة اصطناعية لقياس «زمن فتح مستند من مكتبة كبيرة». أداة قياس.
///
/// **كل معرّف يبدأ بـ`selftest-`** فيمحوها `cleanup_selftest` كاملةً،
/// ولا تختلط بمستندات المستخدم ولا تسبقها في الاستئناف.
#[tauri::command]
pub fn seed_library(
    storage: State<'_, Storage>,
    count: usize,
    words: usize,
) -> Result<usize, String> {
    let docs = storage.docs();
    let now = now_ms();
    // فقرة عربية واقعية: التسلسل والتشكيل يغيّران حجم البايتات فعلًا
    let sentence = "الكتابة فعل هادئ لا يحتمل الضجيج، وكل ما يزاحم النص يسرق منه شيئًا ";
    let per = sentence.split_whitespace().count();
    let body = sentence.repeat(words.div_ceil(per).max(1));

    let mut made = 0;
    for i in 0..count {
        let id = format!("{SELFTEST_PREFIX}lib-{i:05}");
        let doc = Document {
            schema_version: crate::storage::model::SCHEMA_VERSION,
            id: id.clone(),
            title: Some(format!("مستند قياس {i}")),
            blocks: vec![Block {
                id: format!("b-{i}"),
                role: "body".into(),
                text: body.clone(),
                marks: Vec::new(),
            }],
            created_at: now,
            updated_at: now - i as i64,
            last_opened_at: now - i as i64,
        };
        if docs.save(&doc).is_ok() {
            made += 1;
        }
    }
    Ok(made)
}

/// عنوان المستودع — **الوحيد الذي يُفتح**، ولا يُقرأ من الواجهة.
pub const PROJECT_URL: &str = "https://github.com/iSltanX";

/// يفتح صفحة المشروع في متصفح النظام.
///
/// **Luma لا تتصل بشيء** ([ADR ٠٠١٥](../../docs/decisions/0015-no-telemetry.md)):
/// العنوان يُسلَّم إلى النظام ليفتحه غيرُها، ولا يُطلب من داخلها ولا
/// تُقرأ استجابة. والعنوان ثابتٌ في النواة لا يأتي من الواجهة، فلا
/// يفتح هذا البابُ عنوانًا آخر مهما مرّرت الواجهة.
#[tauri::command]
pub fn open_project_page() -> Result<(), String> {
    std::process::Command::new("/usr/bin/open")
        .arg(PROJECT_URL)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("تعذّر فتح صفحة المشروع: {e}"))
}

// ── السجل الزمني ─────────────────────────────────────────────

#[tauri::command]
pub fn list_revisions(
    storage: State<'_, Storage>,
    document_id: String,
) -> Result<Vec<RevisionSummary>, String> {
    storage.revisions(&document_id).list().map_err(to_message)
}

#[tauri::command]
pub fn load_revision(
    storage: State<'_, Storage>,
    document_id: String,
    revision_id: String,
) -> Result<Revision, String> {
    storage
        .revisions(&document_id)
        .load(&revision_id)
        .map_err(to_message)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub blocks: Vec<Block>,
    /// لقطة الحالة التي كانت قائمة قبل الاستعادة.
    pub guard_revision_id: String,
}

/// يستعيد نسخة **بعد حفظ الحالة الحالية أولًا**.
///
/// «الاستعادة لا تمحو الحالة الحالية: تُحفظ ضمن السجل قبل تطبيق
/// النسخة المستعادة» — `Luma.md` §٩ **ثابت**، و§١٧ مبدأ ٥.
#[tauri::command]
pub fn restore_revision(
    storage: State<'_, Storage>,
    document_id: String,
    revision_id: String,
) -> Result<RestoreResult, String> {
    let docs = storage.docs();
    let revs = storage.revisions(&document_id);

    // تُقرأ النسخة المطلوبة أولًا: إن كانت تالفة لا نلمس شيئًا.
    let target = revs.load(&revision_id).map_err(to_message)?;

    let mut doc = docs.load(&document_id).map_err(to_message)?;

    // شبكة الأمان قبل أي تعديل — لو فشلت تُلغى الاستعادة كلها.
    let guard = revs
        .create(&doc, RevisionSource::BeforeRestore)
        .map_err(to_message)?;

    doc.blocks = target.blocks.clone();
    doc.updated_at = now_ms();
    docs.save(&doc).map_err(to_message)?;

    Ok(RestoreResult {
        blocks: target.blocks,
        guard_revision_id: guard.id,
    })
}

// ── التفضيلات ────────────────────────────────────────────────

#[tauri::command]
pub fn load_preferences(storage: State<'_, Storage>) -> serde_json::Value {
    storage.prefs().load()
}

#[tauri::command]
pub fn save_preferences(
    storage: State<'_, Storage>,
    value: serde_json::Value,
) -> Result<(), String> {
    // حقن الفشل يقع داخل `write_atomic` — مصدرٌ واحد لا فحصان.
    storage.prefs().save(&value).map_err(to_message)
}

// ── الخطوط ───────────────────────────────────────────────────

use crate::fonts::{self, FontReference};

/// كل ما يمكن أن يكتب به المستخدم: مدمج ونظام ومستورد.
#[tauri::command]
pub fn list_fonts(storage: State<'_, Storage>) -> Vec<FontReference> {
    fonts::available(&storage.root)
}

/// يفتح لوحة اختيار ملف أصلية ثم يستورد ما اختير.
///
/// اللوحة أصلية لا مرسومة — §١ **ثابت**: «ما يجب أن يأتي من المنصة».
/// `None` تعني أن المستخدم ألغى، وهي ليست خطأ.
///
/// **`async` هنا ليست زينة: بدونها يتجمّد التطبيق.** الأمر المتزامن
/// يعمل على الخيط الرئيسي، و`blocking_pick_file` يحجب خيطه حتى تُغلق
/// اللوحة — واللوحة الأصلية لا تُعرض ولا تستجيب إلا من حلقة الخيط
/// الرئيسي نفسها. فحجبه انتظارًا لها يمنعها من العمل: تجمّدٌ لا مخرج
/// منه إلا إنهاء التطبيق. وثيقة المكتبة صريحة: «عملية حاجبة، **لا**
/// تُستعمل على الخيط الرئيسي»، وكل أمثلتها `async fn`. والأمر
/// اللاتزامني يعمل خارج الخيط الرئيسي، فينتظر بلا أن يحجب.
#[tauri::command]
pub async fn pick_and_import_font(
    app: tauri::AppHandle,
    storage: State<'_, Storage>,
) -> Result<Option<FontReference>, String> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .add_filter("خطوط", &["ttf", "otf", "ttc", "otc"])
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("مسار غير صالح: {e}"))?;

    fonts::import(&storage.root, &path)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod guards {
    /// **حارس تجمّد.**
    ///
    /// أمرٌ متزامن يعمل على الخيط الرئيسي، فاستدعاء `blocking_*` فيه
    /// يحجب الحلقة التي تُعرض بها اللوحة الأصلية — تجمّدٌ لا مخرج منه
    /// إلا إنهاء التطبيق. وقع فعلًا في `pick_and_import_font`: فُتحت
    /// لوحة الملفات فتوقّف كل شيء.
    ///
    /// والقاعدة لا يحرسها المترجم: `pub fn` و`pub async fn` كلتاهما
    /// تُصرَّفان، والفرق يظهر عند المستخدم لا عند البناء.
    #[test]
    fn no_blocking_call_inside_a_sync_command() {
        let src = include_str!("commands.rs");
        // التعليقات تُطرح أولًا: شرحُ القاعدة يذكرها، وذِكرها فوق
        // الأمر يقع في كتلة الأمر الذي قبله فيتّهمه بريئًا. ويُقطع
        // المصدر عند وحدة الاختبار فلا يفحص الحارسُ نفسَه.
        let code = src.split("#[cfg(test)]").next().unwrap_or(src);
        let code: String = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        let offenders: Vec<&str> = code
            .split("#[tauri::command]")
            .skip(1)
            .filter(|chunk| chunk.contains("blocking_"))
            .filter(|chunk| !chunk.trim_start().starts_with("pub async fn"))
            .map(|chunk| chunk.trim_start().lines().next().unwrap_or("?"))
            .collect();

        assert!(
            offenders.is_empty(),
            "أمر متزامن يستدعي blocking_ — يتجمّد على الخيط الرئيسي: {offenders:?}"
        );
    }
}
