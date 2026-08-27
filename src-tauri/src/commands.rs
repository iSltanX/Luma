//! الأوامر بين النواة والواجهة.
//!
//! الواجهة تقرر **متى** يُحفظ (التجميع والسقف)، والنواة تقرر **كيف**
//! (الذرّية والتحقق والفشل). لا تعرف إحداهما تفاصيل الأخرى.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::storage::document::{DocumentStore, StoreError};
use crate::storage::model::{
    Block, Document, DocumentSummary, Revision, RevisionSource, RevisionSummary, TrashSummary,
};
use crate::storage::prefs::PreferencesStore;
use crate::storage::revision::{now_ms, RevisionStore};

/// **لا قفلَ هنا.** كان `trash_lock` حقلًا في هذا النوع وكل أمرِ سلّة
/// يأخذه بنفسه — عقدٌ يُنسى، ولم يحرسه إلا اختبارٌ يأخذ القفل بيده
/// (بندُ ب/١). صار القفل داخل `DocumentStore` نفسه، فأخذُه جزءٌ من
/// العملية لا سطرٌ يُتذكَّر عند كل مُستدعٍ جديد.
pub struct Storage {
    pub root: PathBuf,
}

impl Storage {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
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
    save_document_inner(&storage, payload)
}

/// جسد `save_document` — **مفصولٌ عن `State` كي يُختبر** (بندُ ب/٧).
///
/// القاعدة الحرجة فيه («الفراغ لا يُكتب فوق تالف») كان يحرسها تأكيدٌ
/// على نصّ المصدر — والدفاع الوحيد في المشروع كله عن ملفٍ لا نعرف ما
/// فيه. هنا يُقاس سلوكًا: بايتات الملف التالف قبل النداء وبعده.
pub fn save_document_inner(storage: &Storage, payload: SavePayload) -> Result<SaveResult, String> {
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
    delete_document_inner(&storage, &id)
}

/// جسد `delete_document` — **مفصولٌ عن `State` كي يُختبر**.
///
/// أمرُ Tauri يحتاج `State<'_, Storage>` ولا يُبنى في اختبار وحدة،
/// فكان الفرعُ محروسًا بأربع مطابقاتِ حضورِ نصٍّ على المصدر: تبقى
/// خضراء لو قُلب الشرط، بل إن إحداها كانت تُشبعها كلمةٌ في تعليق
/// (بندُ ب/٢). و`Storage::new(root)` يُبنى في اختبار، فهذه الدالّة
/// تُنادى مباشرةً ويُقاس **أيُّ فرعٍ يذهب إلى أيّ**.
pub fn delete_document_inner(storage: &Storage, id: &str) -> Result<(), String> {
    let docs = storage.docs();
    let doc = match docs.load(id) {
        Ok(d) => d,
        Err(StoreError::NotFound) => return Ok(()),
        Err(e) => return Err(to_message(e)),
    };
    // `has_any_snapshot` لا `list().is_empty()` — عمدًا. تلك تُسقط
    // اللقطة التالفة من العرض، وهذا يسأل «أهناك ما يُفقد لو مُحي
    // المستند فورًا؟». تلفٌ في اللقطة الوحيدة لا يعني غيابها — الشرح
    // الكامل عند `RevisionStore::has_any_snapshot`.
    let has_history = storage.revisions(id).has_any_snapshot();

    if doc.is_empty() && !has_history {
        docs.purge(id).map_err(to_message)
    } else {
        // القفل داخل `trash()` نفسها — لا سطرَ يُتذكَّر هنا.
        docs.trash(id).map_err(to_message)
    }
}

/// يعيد مستندًا من السلّة بسجله كاملًا. ADR ٠٠١٩.
#[tauri::command]
pub fn restore_document(storage: State<'_, Storage>, id: String) -> Result<(), String> {
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
///
/// **والكسح داخل `list_trash()` نفسها** لا سطرًا هنا: كان نداءً
/// منفصلًا يسبقها، فحذفُه يمرّ خضراء ويترك صفوفًا تَعِد بـ«تختفي خلال…»
/// عن مستندات لن تختفي — بندُ أ/٨.
#[tauri::command]
pub fn list_trash(storage: State<'_, Storage>) -> Result<TrashListing, String> {
    let (documents, damaged) = storage.docs().list_trash().map_err(to_message)?;
    Ok(TrashListing { documents, damaged })
}

/// يُفرغ السلّة كاملة فورًا — زرّ الإفراغ اليدوي. **يُبلّغ:** عدد ما مُحي.
#[tauri::command]
pub fn empty_trash(storage: State<'_, Storage>) -> Result<usize, String> {
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
///
/// **واستثناءٌ واحد على «لا يحذف إلا `selftest-`»:** قراءةُ السلّة
/// صارت تكسح ما تجاوز مهلته بنفسها (بندُ أ/٨)، فنداءُ `list_trash()`
/// هنا قد يمحو عنصرًا **ليس** من الفحص إن كان قد تجاوز ثلاثين يومًا.
/// وذلك محوٌ كان سيقع عند أول إقلاع تالٍ على أي حال، فالفارق توقيتُه
/// لا وقوعه — لكنه يُقال هنا كي لا يبقى العقد أعلاه أوسع من الواقع.
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
    use super::{delete_document_inner, save_document_inner, SavePayload, Storage};

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
    /// بلا القفل كانت استعادةٌ وإفراغٌ متزامنان على المعرّف
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
        let mut restored = 0;
        let mut purged = 0;

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
            // **ترتيب الإطلاق يتناوب.** الخيط الأخير الواصل إلى الحاجز
            // يمضي فورًا بينما يُوقَظ الآخر، فترتيبٌ ثابت يجعل الفائز
            // ثابتًا: قِيس فعلًا فكانت الاستعادة تخسر ٢٠ من ٢٠ — ولا
            // تأكيد يقع في المحاولات كلها.
            let order = if trial % 2 == 0 {
                [true, false]
            } else {
                [false, true]
            };
            for restoring in order {
                let storage = Arc::clone(&storage);
                let barrier = Arc::clone(&barrier);
                let id = id.clone();
                handles.push(std::thread::spawn(move || {
                    barrier.wait();
                    // **ولا قفلَ هنا — وهذا هو بيت القصيد.**
                    //
                    // كان هذا السطر `let _guard = storage.trash_guard();`
                    // فيأخذ الاختبارُ القفلَ بيده داخل خيطه: يقيس أن
                    // `Mutex` يعمل، لا أن العمليات تأخذه. الخيطان هنا
                    // يناديان `DocumentStore` عاريًا كما يفعل أيُّ مسار
                    // جديد — فإن لم يكن القفل داخل العملية نفسها سقط
                    // هذا الاختبار. بندُ ب/١.
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
                restored += 1;
            } else {
                // **وفوزُ المحو لا يجوز أن يترك نصف حالة**: لا بقايا
                // في السلّة ولا مجلدًا مفكَّكًا ينتظر من يلتقطه.
                assert!(
                    !root.join("Trash").join(&id).exists(),
                    "المحاولة {trial}: مُحي المستند وبقيت بقاياه في السلّة"
                );
                purged += 1;
            }
        }

        // **محاولةٌ فاز فيها المحو لا تؤكّد شيئًا** — والفوز يعتمد على
        // جدولة الخيوط، فقد تمرّ العشرون كلها بلا تأكيد واحد ويبقى
        // الاختبار أخضر على عطله. كشفته مراجعة خصومية على S4 وقاسته:
        // ٨٥٪ إلى ١٠٠٪ من المحاولات خاوية. فيُشترط أن يكون بعضها قد
        // مرّ بالفرع الذي يقيس فعلًا.
        assert!(
            restored > 0,
            "لم تفز الاستعادة في أيّ محاولة — لم يُقَس شيء، والخُضرة بلا معنى"
        );
        assert!(purged > 0, "لم يفز المحو في أيّ محاولة — لم يقع سباقٌ أصلًا");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// **ADR ٠٠١٩: الحذف المعتاد سلّة لا محو — مقيسًا لا مطابَقًا.**
    ///
    /// كان هذا الحارس أربع مطابقاتِ حضورِ نصٍّ على المصدر
    /// (`body.contains("docs.trash(&id)")` وأخواتها): لا واحدةَ منها
    /// تربط شرطًا بالفرع الذي يذهب إليه، فقلبُ الفرعين يُبقيها خضراء
    /// والسلاسل الأربع في مكانها. بل إن مطابقة `has_any_snapshot`
    /// كانت **خاوية**: الاختبار لا يصفّي أسطر التعليق، والاسم يرد في
    /// تعليقٍ فوق الشرط — بندُ ب/٢ في `docs/audit/AUDIT-2026-08-27.md`.
    ///
    /// وبانفصال الجسد عن `State` (`delete_document_inner`) صار الفرع
    /// يُقاس بأثره على القرص: **أين انتهى المستند فعلًا**.
    #[test]
    fn delete_document_sends_to_trash_except_the_empty_and_historyless() {
        use crate::storage::model::{Block, Document, RevisionSource, SCHEMA_VERSION};

        fn doc(id: &str, text: &str) -> Document {
            Document {
                schema_version: SCHEMA_VERSION,
                id: id.into(),
                title: None,
                blocks: vec![Block {
                    id: "b1".into(),
                    role: "body".into(),
                    text: text.into(),
                    marks: vec![],
                }],
                created_at: 0,
                updated_at: 0,
                last_opened_at: 0,
                deleted_at: None,
            }
        }

        let root =
            std::env::temp_dir().join(format!("luma-del-{}-{:?}", std::process::id(), "branch"));
        let _ = std::fs::remove_dir_all(&root);
        let storage = Storage::new(root.clone());
        let docs = storage.docs();

        // ① فيه نصّ ⇒ السلّة
        docs.save(&doc("has-text", "نصٌّ حقيقي")).unwrap();
        delete_document_inner(&storage, "has-text").unwrap();
        assert!(!docs.exists("has-text"), "بقي في المكتبة");
        assert!(
            docs.list_trash()
                .unwrap()
                .0
                .iter()
                .any(|d| d.id == "has-text"),
            "مستندٌ فيه نصّ لم يصل السلّة — محوٌ بلا تدارك"
        );

        // ② فارغ **وله لقطة** ⇒ السلّة كذلك: التدارك يخسر شيئًا
        docs.save(&doc("empty-with-history", "")).unwrap();
        storage
            .revisions("empty-with-history")
            .create(
                &doc("empty-with-history", "كان فيه نصّ"),
                RevisionSource::Automatic,
            )
            .unwrap();
        delete_document_inner(&storage, "empty-with-history").unwrap();
        assert!(
            docs.list_trash()
                .unwrap()
                .0
                .iter()
                .any(|d| d.id == "empty-with-history"),
            "مستندٌ أُفرغ نصّه وله سجل مُحي مباشرة — ضاع سجله بلا تدارك"
        );

        // ③ فارغ **وبلا لقطة** ⇒ محوٌ مباشر: لا شيء يخسره التدارك
        docs.save(&doc("empty-bare", "")).unwrap();
        delete_document_inner(&storage, "empty-bare").unwrap();
        assert!(!docs.exists("empty-bare"), "بقي في المكتبة");
        assert!(
            !docs
                .list_trash()
                .unwrap()
                .0
                .iter()
                .any(|d| d.id == "empty-bare"),
            "فارغٌ بلا سجل شغل صفًّا في السلّة لا يُستعاد منه شيء"
        );

        // ④ **الغياب التام ليس خطأً** — نجاحٌ صامت
        assert!(
            delete_document_inner(&storage, "never-existed").is_ok(),
            "معرّفٌ لا وجود له أعاد خطأ — رسالةٌ زائفة عند كل مغادرة"
        );

        let _ = std::fs::remove_dir_all(&root);
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

    /// **§١٤: لا يُستبدل التالف بمستند فارغ — مقيسًا بالبايتات.**
    ///
    /// كان الحارس مطابقتَي نصٍّ على المصدر
    /// (`!body.contains("exists(")` و`body.contains("is_empty() && …")`)
    /// — والدفاعَ **الوحيد** في المشروع كله عن ملفٍ لا نعرف ما فيه،
    /// إذ `DocumentStore::save` يكتب بلا شرط. وصياغةٌ أخرى للشرط
    /// نفسه تُسقط الحارس وهو سليم، وكتابةٌ مضافةٌ داخل الفرع تمرّ وهو
    /// أخضر — بندُ ب/٧.
    ///
    /// وبانفصال الجسد عن `State` يُقاس ما يهمّ فعلًا: **بايتات الملف
    /// التالف قبل النداء وبعده**.
    #[test]
    fn an_empty_payload_never_overwrites_a_corrupt_file() {
        let root = std::env::temp_dir().join(format!("luma-save-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let storage = Storage::new(root.clone());
        let docs = storage.docs();

        // ملفٌّ في المسار، غيرُ قابل للقراءة كمستند
        let path = docs.path_for("corrupt");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let original = "{ ليس هذا مستندًا صالحًا ".as_bytes().to_vec();
        std::fs::write(&path, &original).unwrap();

        let result = save_document_inner(
            &storage,
            SavePayload {
                id: "corrupt".into(),
                title: None,
                blocks: vec![],
                created_at: None,
            },
        );

        assert!(result.is_ok(), "الحفظ الفارغ أعاد خطأ بدل أن يمضي صامتًا");
        assert_eq!(
            std::fs::read(&path).unwrap(),
            original,
            "الفراغ كُتب فوق ملفٍّ تالف — محوٌ لما لا نعرف ما هو (§١٤)"
        );

        // **ومحتوًى حقيقي يُكتب فوق التالف عمدًا**: المستند مفتوحٌ في
        // المحرر فنسخته في الذاكرة هي السليمة، وحجبُ الكتابة يُبقي عمل
        // الكاتب بلا قرص. المنعُ للفراغ وحده لأنه محوٌ لا إصلاح.
        save_document_inner(
            &storage,
            SavePayload {
                id: "corrupt".into(),
                title: None,
                blocks: vec![crate::storage::model::Block {
                    id: "b1".into(),
                    role: "body".into(),
                    text: "نصٌّ حيّ".into(),
                    marks: vec![],
                }],
                created_at: None,
            },
        )
        .unwrap();
        assert_ne!(
            std::fs::read(&path).unwrap(),
            original,
            "محتوًى حقيقي لم يُكتب فوق التالف — عمل الكاتب بلا قرص"
        );

        // وملفٌّ **غائب تمامًا** مع حمولة فارغة لا يُنشأ أصلًا
        let empty_id = "never-written";
        save_document_inner(
            &storage,
            SavePayload {
                id: empty_id.into(),
                title: None,
                blocks: vec![],
                created_at: None,
            },
        )
        .unwrap();
        assert!(
            !docs.path_for(empty_id).exists(),
            "مستندٌ بلا محتوى كُتب على القرص — ضجيجٌ في المكتبة (§٢٠ مسألة ٣)"
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
