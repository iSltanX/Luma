//! الأوامر بين النواة والواجهة.
//!
//! الواجهة تقرر **متى** يُحفظ (التجميع والسقف)، والنواة تقرر **كيف**
//! (الذرّية والتحقق والفشل). لا تعرف إحداهما تفاصيل الأخرى.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::document::{DocumentStore, StoreError, TRASH_RETENTION_MS};
use crate::storage::model::{
    Block, Document, DocumentSummary, Revision, RevisionSource, RevisionSummary, TrashSummary,
};
use crate::storage::prefs::PreferencesStore;
use crate::storage::revision::{now_ms, RevisionStore};

pub struct Storage {
    pub root: PathBuf,
    /// يحرس عمليات السلّة (`trash`/`restore`/`purge_trashed` وما
    /// يستدعيها) من التداخل على `Trash/<id>` نفسه.
    ///
    /// **اكتُشفت الحاجة إليه بمراجعة خصومية** (ADR ٠٠١٩، ٢٦ أغسطس
    /// ٢٠٢٦)، لا نظريًا: أوامر Tauri المتزامنة هنا تُنفَّذ على خيوط
    /// مستقلة بلا قفل، فاستعادةٌ وإفراغٌ (أو استعادتان لمعرّف واحد)
    /// متزامنتان كانتا تتقاطعان فعليًا على `Trash/<id>` — و`remove_dir_all`
    /// ليست ذرّية، تُفكّك ملفات الدليل واحدًا واحدًا، فـ`fs::rename`
    /// يمكن أن يلتقط دليلًا **نصف مُفرَّغ في تلك اللحظة بالذات** وينجح
    /// ظاهريًا، فيُبلَّغ النقل بنجاح وقد فقد سجله فعلًا بصمت — أُثبت
    /// تجريبيًا: ١٠٠٪ من محاولات السباق أعادت `Ok` وصفر لقطة نجت.
    trash_lock: std::sync::Mutex<()>,
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            trash_lock: std::sync::Mutex::new(()),
        }
    }

    pub fn docs(&self) -> DocumentStore {
        DocumentStore::new(self.root.clone())
    }
    pub fn prefs(&self) -> PreferencesStore {
        PreferencesStore::new(self.root.clone())
    }
    pub fn revisions(&self, doc_id: &str) -> RevisionStore {
        RevisionStore::new(self.docs().revisions_dir(doc_id))
    }

    /// يحصل على قفل السلّة. **لا يتجمّد على قفل مسموم**: عطبٌ برمزٍ
    /// آخر أثناء حمله لا يجوز أن يقفل السلّة إلى الأبد — استرجاع
    /// المحتوى الداخلي ومتابعة العمل أهون من تعطّل كل عملية سلّة تالية.
    fn trash_guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.trash_lock.lock().unwrap_or_else(|e| e.into_inner())
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
        // مستندٌ يُكتب فيه ليس في السلّة — والصفر هنا يشفي فعلًا أي ختم
        // متخلّف من `DocumentStore::trash`/`restore` توقّف عملها منتصف
        // الطريق (الشرح هناك): أول كتابة تالية على المستند تصفّره.
        deleted_at: None,
    };
    // **«موجود» = مستندٌ يُقرأ، لا ملفٌّ في المسار.**
    //
    // كان الفحص `exists()` — وهو يسأل عن وجود المسار وحده. وملفٌّ
    // تالف مسارُه موجود ومحتواه مجهول، فكان الفراغ يُكتب فوقه: محوٌ
    // لما لا نعرف ما هو، وضياعُ ما كان يمكن إنقاذه منه يدويًا. وهو ما
    // يمنعه §١٤ نصًّا: «لا يُستبدل بمستند فارغ… الملف يبقى كما هو».
    //
    // والقراءة تخدم غرضين — الحكم على «جديد»، واستعادة `createdAt` —
    // فتُقرأ مرة واحدة ويُقرأ جوابها مرتين.
    let existing = docs.load(&payload.id);
    if candidate.is_empty() && existing.is_err() {
        return Ok(SaveResult {
            id: payload.id,
            updated_at: now,
            snapshot_created: false,
        });
    }

    // ومحتوًى حقيقيّ يُكتب فوق التالف عمدًا: المستند مفتوحٌ في المحرر
    // فنسخته في الذاكرة هي السليمة، وحجبُ الكتابة يُبقي عمل الكاتب بلا
    // قرص. المنعُ للفراغ وحده — لأنه محوٌ لا إصلاح.
    let mut doc = candidate;
    if let Ok(ref e) = existing {
        // يُحافظ على `createdAt` الأصلي إن كان المستند مقروءًا
        doc.created_at = e.created_at;
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
    // الختم بلا قارئ منذ إلغاء الاستئناف — مصير الحقل مع هجرة
    // السلّة (ADR ٠٠١٧)، وفشله لا يمنع فتح المستند.
    doc.last_opened_at = now_ms();
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

/// يحذف مستندًا بسجله. `Luma.md` §٦ و§٢٠ مسألة ١٩ **معتمد** — [ADR ٠٠١٧]
/// و[ADR ٠٠١٩].
///
/// **الحذف المعتاد نقلٌ إلى السلّة لا محوٌ.** والاستثناء الوحيد: مستندٌ
/// لا كلمة فيه ولا لقطة سجل واحدة — لا شيء فيه يخسره التدارك، فيُمحى
/// مباشرةً بدل أن يشغل صفًّا في السلّة لا يُستعاد منه شيء. الحكم يُبنى
/// هنا لا في `DocumentStore`: يحتاج تركيب مخزنَي المستند والسجل معًا،
/// وهو تركيبٌ لا تعرفه طبقة تخزين واحدة — نمط `should_snapshot` نفسه
/// في `save_document` أعلاه.
///
/// **الغياب التام ليس خطأً.** مستندٌ لم يُحفظ على القرص قط (حرفٌ كُتب
/// ثم مُحي قبل أول حفظ) يفشل `docs.load` بـ`NotFound` — ونجاحٌ صامت هو
/// الجواب الصحيح: لا شيء ليُحذف، يطابق `purge`/`trash` القديمة على
/// معرّف غائب. **اكتشفته مراجعة خصومية** (ADR ٠٠١٩): بلا هذا، أبسط
/// إجراء — كتابة حرف ثم محوه فورًا ثم مغادرة — كان يُظهر رسالة خطأ
/// زائفة عند كل مغادرة، ويترك `session.documentId` صفرًا دائمًا بدل
/// إعادته، ناقضًا «فشل الفتح يترك المستند الحالي كما هو» (§١٧ مبدأ ٤).
///
/// مَن يستدعيه ملزَمٌ بأن يكون آخر حفظ قد استقرّ قبله: الحذف قبل
/// استقرار الكتابة يمحو ما لم يكن فارغًا — الترتيب في `session.ts`.
#[tauri::command]
pub fn delete_document(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    let docs = storage.docs();
    let doc = match docs.load(&id) {
        Ok(d) => d,
        Err(StoreError::NotFound) => return Ok(()),
        Err(e) => return Err(to_message(e)),
    };
    // `has_any_snapshot` لا `list().is_empty()` — عمدًا. تلك تُسقط
    // اللقطة التالفة من العرض، وهذا يسأل «أهناك ما يُفقد لو مُحي
    // المستند فورًا؟». تلفٌ في اللقطة الوحيدة لا يعني غيابها — الشرح
    // الكامل عند `RevisionStore::has_any_snapshot`.
    let has_history = storage.revisions(&id).has_any_snapshot();

    if doc.is_empty() && !has_history {
        docs.purge(&id).map_err(to_message)
    } else {
        // **مقفَل** — الشرح الكامل عند `Storage::trash_lock` أعلاه.
        let _guard = storage.trash_guard();
        docs.trash(&id).map_err(to_message)
    }
}

/// يعيد مستندًا من السلّة بسجله كاملًا. ADR ٠٠١٩.
#[tauri::command]
pub fn restore_document(storage: State<'_, Storage>, id: String) -> Result<(), String> {
    // **مقفَل** — الشرح الكامل عند `Storage::trash_lock` أعلاه: بلا هذا
    // القفل، استعادةٌ متزامنة مع إفراغ أو استعادةٍ أخرى لنفس المعرّف
    // كانت تتقاطع فعليًا على `Trash/<id>` — أثبتته مراجعة خصومية.
    let _guard = storage.trash_guard();
    storage.docs().restore(&id).map_err(to_message)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashListing {
    pub documents: Vec<TrashSummary>,
    /// عناصر سلّة تعذّرت قراءتها — تُعرض ولا تُخفى، كنظيرتها في المكتبة.
    pub damaged: Vec<String>,
}

/// محتويات السلّة — **بعد كسحٍ كسول** يمحو ما تجاوز مهلته. ADR ٠٠١٩:
/// «الفحص كسول: عند إطلاق التطبيق، وعند فتح لوحة السلّة». الإطلاق في
/// `lib.rs`، وفتح اللوحة هنا.
#[tauri::command]
pub fn list_trash(storage: State<'_, Storage>) -> Result<TrashListing, String> {
    let docs = storage.docs();
    {
        // **مقفَل** — الشرح الكامل عند `Storage::trash_lock` أعلاه.
        let _guard = storage.trash_guard();
        let _ = docs.sweep_expired(now_ms(), TRASH_RETENTION_MS);
    }
    let (documents, damaged) = docs.list_trash().map_err(to_message)?;
    Ok(TrashListing { documents, damaged })
}

/// يُفرغ السلّة كاملة فورًا — زرّ الإفراغ اليدوي. **يُبلّغ:** عدد ما مُحي.
#[tauri::command]
pub fn empty_trash(storage: State<'_, Storage>) -> Result<usize, String> {
    // **مقفَل** — الشرح الكامل عند `Storage::trash_lock` أعلاه.
    let _guard = storage.trash_guard();
    storage.docs().empty_trash().map_err(to_message)
}

/// بادئة معرّفات ما ينشئه الفحص الذاتي.
const SELFTEST_PREFIX: &str = "selftest-";

/// يزيل ما خلّفه الفحص الذاتي من مستندات. **أداة تطوير.**
///
/// الفحص يكتب مستندات حقيقية في مجلد بيانات المستخدم ليختبر المسار
/// الحقيقي، فكان يتركها بعده: مكتبةٌ ممتلئة بضجيج أداة.
///
/// **لا يحذف إلا ما تبدأ معرّفاته بـ`selftest-`.** وهو أضيق من
/// `delete_document` عمدًا ويبقى منفصلًا عنه: أداةُ تطوير تكنس أثرها،
/// لا مسارُ منتج — فلا يرث حدَّها ولا ترث حدَّه. ومحوٌ مباشر
/// (`purge`) لا نقلٌ للسلّة: أثر أداة تطوير لا يستحق صفًّا فيها.
///
/// **تكنس `Trash/` أيضًا** — احتياطًا لا لحاجة اليوم: الفحص الذاتي لا
/// يستدعي `delete_document` حاليًا (الشرح في `selftest.ts`)، لكن أداة
/// الكنس لا يصحّ أن تفترض ذلك يبقى صحيحًا إلى الأبد.
#[tauri::command]
pub fn cleanup_selftest(storage: State<'_, Storage>) -> Result<usize, String> {
    let docs = storage.docs();
    let (list, damaged) = docs.list().map_err(to_message)?;
    let (trashed, trash_damaged) = docs.list_trash().map_err(to_message)?;
    let mut removed = 0;
    for id in list
        .into_iter()
        .map(|d| d.id)
        .chain(damaged)
        .filter(|id| id.starts_with(SELFTEST_PREFIX))
    {
        if docs.purge(&id).is_ok() {
            removed += 1;
        }
    }
    // **مقفَل** — الشرح الكامل عند `Storage::trash_lock` أعلاه: كنسٌ
    // متزامن مع استعادة أو إفراغ حقيقي يتقاطع على `Trash/` نفسها.
    let _guard = storage.trash_guard();
    for id in trashed
        .into_iter()
        .map(|d| d.id)
        .chain(trash_damaged)
        .filter(|id| id.starts_with(SELFTEST_PREFIX))
    {
        if docs.purge_trashed(&id).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

/// يبذر مكتبة اصطناعية لقياس «زمن فتح مستند من مكتبة كبيرة». أداة قياس.
///
/// **كل معرّف يبدأ بـ`selftest-`** فيمحوها `cleanup_selftest` كاملةً،
/// ولا تختلط بمستندات المستخدم.
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
            deleted_at: None,
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
    ///
    /// `None` حين لا تكون ثمّة حالة تستحق الحفظ: مستندٌ فارغ لا شبكة
    /// أمان له، ولقطةٌ منه شَرَكٌ لا شبكة — انظر `restore_revision`.
    pub guard_revision_id: Option<String>,
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

    // شبكة الأمان قبل أي تعديل — والقاعدة في `create_guard` لا هنا:
    // «لا شبكة لفراغ»، وموضعها هناك يجعلها مقيسة. ولو فشل إنشاؤها
    // لمستند غير فارغ، تُلغى الاستعادة كلها.
    let guard = revs.create_guard(&doc).map_err(to_message)?;

    doc.blocks = target.blocks.clone();
    doc.updated_at = now_ms();
    docs.save(&doc).map_err(to_message)?;

    Ok(RestoreResult {
        blocks: target.blocks,
        guard_revision_id: guard.map(|g| g.id),
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

    /// **حارس مراجعة خصومية على ADR ٠٠١٩: القفل يمنع التقاطع فعليًا
    /// لا نظريًا.**
    ///
    /// بلا `trash_guard()` كانت استعادةٌ وإفراغٌ متزامنان على المعرّف
    /// نفسه يتقاطعان على `Trash/<id>` — `remove_dir_all` ليست ذرّية
    /// (تُفكّك ملفات الدليل واحدًا واحدًا)، و`fs::rename` قد يلتقط
    /// دليلًا نصف مُفرَّغ في تلك اللحظة بالذات فينجح ظاهريًا وقد فقد
    /// سجله بصمت — أُثبت تجريبيًا أن ١٠٠٪ من محاولات السباق بلا قفل
    /// أعادت `Ok` وصفر لقطة نجت. هذا الاختبار يُشغِّل الاستعادة
    /// والإفراغ من خيطين أُطلقا معًا بحاجز (`Barrier`) على المعرّف
    /// نفسه، عشرين مرة، ويقيس: إمّا مستند حيّ بكل لقطاته، أو غيابٌ
    /// تام — لا نصف نجاة أبدًا.
    #[test]
    fn trash_lock_prevents_restore_from_racing_purge_on_the_same_id() {
        use crate::storage::model::{Block, Document, RevisionSource, SCHEMA_VERSION};
        use std::sync::{Arc, Barrier};

        let root = std::env::temp_dir().join(format!("luma-trashlock-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let storage = Arc::new(super::Storage::new(root.clone()));

        for trial in 0..20 {
            let id = format!("race-{trial}");
            let docs = storage.docs();
            let doc = Document {
                schema_version: SCHEMA_VERSION,
                id: id.clone(),
                title: None,
                blocks: vec![Block {
                    id: "b1".into(),
                    role: "body".into(),
                    text: "نص".into(),
                    marks: vec![],
                }],
                created_at: 0,
                updated_at: 0,
                last_opened_at: 0,
                deleted_at: None,
            };
            docs.save(&doc).unwrap();
            let revs = storage.revisions(&id);
            for i in 0..30 {
                let mut d = doc.clone();
                d.blocks[0].text = format!("لقطة {i}");
                revs.create(&d, RevisionSource::Automatic).unwrap();
            }
            docs.trash(&id).unwrap();

            let barrier = Arc::new(Barrier::new(2));
            let mut handles = Vec::new();
            for restoring in [true, false] {
                let storage = Arc::clone(&storage);
                let barrier = Arc::clone(&barrier);
                let id = id.clone();
                handles.push(std::thread::spawn(move || {
                    barrier.wait();
                    // القفل هنا هو موضع الإصلاح — الاختبار نفسه هو
                    // الحارس: أزل `trash_guard()` من `restore_document`
                    // و`empty_trash` ليسقط هذا الاختبار على العطل القديم.
                    let _guard = storage.trash_guard();
                    let docs = storage.docs();
                    if restoring {
                        let _ = docs.restore(&id);
                    } else {
                        let _ = docs.purge_trashed(&id);
                    }
                }));
            }
            for h in handles {
                h.join().unwrap();
            }

            let docs = storage.docs();
            if docs.exists(&id) {
                let count = storage.revisions(&id).list().unwrap().len();
                assert_eq!(
                    count, 30,
                    "المحاولة {trial}: استعادة نجت لكن اللقطات نصف مفقودة — تقاطعٌ فعلي على Trash/"
                );
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **حارس ADR ٠٠١٩: الحذف المعتاد سلّة لا محو.**
    ///
    /// `delete_document` يستدعي `trash()` في الحالة العامة و`purge()`
    /// في حالة واحدة فقط — مستندٌ لا كلمة فيه ولا لقطة، فحصًا يركّب
    /// مخزنَي المستند والسجل معًا (`has_history`). حارسٌ سلوكي
    /// (اختبارات `document.rs`) يقيس `trash`/`purge` أنفسهما؛ وهذا
    /// يمنع أن يعود موضع الاستدعاء هنا إلى محوٍ غير مشروط كما كان قبل
    /// السلّة — عطلٌ لا تكشفه اختبارات `document.rs` مهما دقّت، لأنها
    /// تقيس الدالتين لا مَن يستدعيهما.
    #[test]
    fn delete_document_prefers_trash_over_purge() {
        let src = include_str!("commands.rs");
        let code = src.split("#[cfg(test)]").next().unwrap_or(src);
        let body = code
            .split("pub fn delete_document")
            .nth(1)
            .expect("لم يُعثر على delete_document")
            .split("#[tauri::command]")
            .next()
            .unwrap_or("");
        assert!(
            body.contains("docs.trash(&id)"),
            "delete_document لم يعد يستدعي trash()"
        );
        assert!(
            body.contains("docs.purge(&id)"),
            "delete_document فقد مسار المحو المباشر للفارغ بلا سجل"
        );
        assert!(
            body.contains("has_history"),
            "شرط الفراغ لا يفحص السجل — مستندٌ له لقطات قد يُمحى مباشرة"
        );
        // **`has_any_snapshot` لا `list().is_empty()`** — عمدًا.
        // `list()` تُسقط اللقطة التالفة، فحسمُ الفراغ على طولها كان
        // يمحو مستندًا له سجل فعلي (تالف) بلا سلّة — عطلٌ حقيقي
        // كشفته مراجعة خصومية على ADR ٠٠١٩ (٢٦ أغسطس ٢٠٢٦).
        assert!(
            body.contains("has_any_snapshot"),
            "شرط السجل يستعمل list().is_empty() — تلفٌ في لقطة يجعلها تبدو غائبة فيُمحى مستندٌ له سجل فعلي"
        );
    }

    /// **حارس §٩: القرار لا يُلتفّ عليه.**
    ///
    /// القاعدة نفسها («لا شبكة لفراغ») تعيش في `RevisionStore::create_guard`
    /// وتُقاس بسلوكها هناك. وهذا يحرس شيئًا واحدًا: ألّا يعود أحدٌ
    /// فينشئ `BeforeRestore` من طبقة الأوامر مباشرةً فيلتفّ عليها.
    ///
    /// **ويفحص غيابَ رمزٍ لا حضورَ نصّ** — عمدًا. سلفُه كان يطالب بوجود
    /// `doc.is_empty()` في المصدر، وثبت أنه يبقى أخضر على أربع صياغات
    /// تعيد العطل: شرطٌ مقلوب، وجملةٌ ميتة `let _ = doc.is_empty();`،
    /// و`target_doc.is_empty()` يفحص المستند الخطأ، وتعليقٌ في ذيل سطر
    /// (التصفية تُسقط ما **يبدأ** بـ`//` وحده). ومطابقةُ الغياب لا
    /// تُخدَع بهذا: من كتب `BeforeRestore` هنا سقط، ومن لم يكتبها لا
    /// سبيل له إلى إنشائها إلا عبر القاعدة.
    #[test]
    fn the_command_layer_never_creates_a_safety_snapshot_itself() {
        let src = include_str!("commands.rs");
        let code = src.split("#[cfg(test)]").next().unwrap_or(src);
        let code: String = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        assert!(
            !code.contains("BeforeRestore"),
            "طبقة الأوامر تنشئ شبكة أمان بنفسها — القاعدة في `create_guard` وحدها (§٩)"
        );
        assert!(
            code.contains("create_guard"),
            "لم تعد شبكة الأمان تمرّ بالقاعدة"
        );
    }

    /// **حارس §١٤: لا يُستبدل التالف بمستند فارغ.**
    ///
    /// حارسُ الفراغ في `save_document` كان يسأل `exists()` — وجودَ
    /// مسار — فيمرّ على ملفٍّ تالف مسارُه قائم ومحتواه مجهول، فيُكتب
    /// الفراغ فوقه. والفرق بين السؤالين لا يراه المترجم: كلاهما يعيد
    /// حكمًا، وأحدهما وحده يعرف أن هناك مستندًا.
    ///
    /// والقاعدة تُحرَس على المصدر لأن الحكم يعيش داخل أمرٍ يحتاج
    /// `State<Storage>` فلا يُبنى في اختبار وحدة. والفرق نفسه محروسٌ
    /// سلوكيًّا في `storage::document` — انظر
    /// `a_corrupt_file_exists_on_the_path_but_is_not_a_readable_document`.
    #[test]
    fn the_empty_guard_asks_for_a_readable_document_not_a_path() {
        let src = include_str!("commands.rs");
        let code = src.split("#[cfg(test)]").next().unwrap_or(src);
        let code: String = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");

        let save = code
            .split("pub fn save_document")
            .nth(1)
            .expect("لم يُعثر على save_document");
        let body = save.split("#[tauri::command]").next().unwrap_or(save);

        assert!(
            !body.contains("exists("),
            "حارس الفراغ يسأل عن وجود المسار — فيُكتب الفراغ فوق مستند تالف (§١٤)"
        );
        assert!(
            body.contains("is_empty() && existing.is_err()"),
            "حارس الفراغ لم يعد يسأل عن مستندٍ يُقرأ"
        );
    }
}
