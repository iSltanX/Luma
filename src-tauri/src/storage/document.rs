//! `DocumentStore` — قراءة وكتابة ذرّية للمستندات. لا تعرف الواجهة.
//!
//! ملف لكل مستند: يحصر أثر أي تلف في مستند واحد، ويسمح بكتابة ذرّية
//! مستقلة — §٤.

use std::fs;
use std::path::{Path, PathBuf};

use super::atomic::{read_optional, write_atomic};
use super::model::{Document, DocumentSummary, TrashSummary, SCHEMA_VERSION};
use super::revision::now_ms;

/// مهلة الإفراغ التلقائي للسلّة — ٣٠ يومًا. ADR ٠٠١٩.
///
/// كافية لتغطية «حُذف بالخطأ ولم يُنتبه إلا بعد أسابيع»، ومحدودة كي لا
/// تصير السلّة مكتبةً ثانية بلا حدّ — الروح نفسها التي تحكم
/// `MAX_REVISIONS`/`MAX_TOTAL_BYTES` في `revision.rs`: شبكة أمان سخية
/// لا تخزين دائم.
pub const TRASH_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

#[derive(Debug)]
pub enum StoreError {
    Io(String),
    /// الملف موجود لكن لا يمكن قراءته كمستند.
    ///
    /// **متمايز عن `Io` عمدًا:** التالف لا يُستبدل بمستند فارغ ولا
    /// يُحذف — «تُكتشف البيانات غير القابلة للقراءة ويُمنع استبدال
    /// نسخة سليمة بها» §١٤.
    Corrupt {
        path: String,
        detail: String,
    },
    NotFound,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "تعذّر الوصول إلى التخزين: {e}"),
            Self::Corrupt { path, detail } => {
                write!(f, "ملف غير قابل للقراءة ({path}): {detail}")
            }
            Self::NotFound => write!(f, "المستند غير موجود"),
        }
    }
}

impl From<std::io::Error> for StoreError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

pub struct DocumentStore {
    root: PathBuf,
}

impl DocumentStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn documents_dir(&self) -> PathBuf {
        self.root.join("Documents")
    }

    /// السلّة — شقيقة `Documents/` لا مجلد داخلها. ADR ٠٠١٩: مجلد
    /// المستند يُنقل إليها كاملًا، فلا يبقى تحت `Documents/` ما دام في
    /// السلّة — والفرق بينهما مجلدٌ لا حقل، `list()` لا تفحص شيئًا.
    fn trash_dir(&self) -> PathBuf {
        self.root.join("Trash")
    }

    fn dir_for(&self, id: &str) -> PathBuf {
        self.documents_dir().join(id)
    }

    fn trash_dir_for(&self, id: &str) -> PathBuf {
        self.trash_dir().join(id)
    }

    pub fn path_for(&self, id: &str) -> PathBuf {
        self.dir_for(id).join("document.json")
    }

    pub fn revisions_dir(&self, id: &str) -> PathBuf {
        self.dir_for(id).join("revisions")
    }

    /// يحفظ المستند. الكتابة ذرّية، فإما أن تنجح كاملة أو لا تمسّ شيئًا.
    pub fn save(&self, doc: &Document) -> Result<()> {
        if !is_safe_id(&doc.id) {
            return Err(StoreError::Io(format!("معرّف غير صالح: {}", doc.id)));
        }
        let mut d = doc.clone();
        d.schema_version = SCHEMA_VERSION;
        let bytes = serde_json::to_vec_pretty(&d)
            .map_err(|e| StoreError::Io(format!("تعذّر التسلسل: {e}")))?;
        write_atomic(&self.path_for(&d.id), &bytes)?;
        Ok(())
    }

    pub fn load(&self, id: &str) -> Result<Document> {
        if !is_safe_id(id) {
            return Err(StoreError::NotFound);
        }
        let path = self.path_for(id);
        let Some(bytes) = read_optional(&path)? else {
            return Err(StoreError::NotFound);
        };
        parse_document(&bytes, &path)
    }

    /// المستندات مرتّبة بآخر فتح تنازليًا.
    ///
    /// الملفات التالفة **تُتخطّى ولا تُسقط التعداد**: مستند معطوب لا
    /// يمنع المستخدم من الوصول إلى بقية نصوصه — §٢ «كل خدمة تفشل بمعزل».
    pub fn list(&self) -> Result<(Vec<DocumentSummary>, Vec<String>)> {
        let dir = self.documents_dir();
        if !dir.exists() {
            return Ok((Vec::new(), Vec::new()));
        }
        let mut out = Vec::new();
        let mut damaged = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let Ok(entry) = entry else { continue };
            if !entry.path().is_dir() {
                continue;
            }
            let Some(id) = entry.file_name().to_str().map(String::from) else {
                continue;
            };
            match self.load(&id) {
                Ok(d) => out.push(DocumentSummary::from(&d)),
                Err(StoreError::NotFound) => {}
                Err(_) => damaged.push(id),
            }
        }
        // **الترتيب بآخر تعديل لا بآخر فتح.**
        //
        // «النصوص الأخيرة» في `Luma.md` §٦ هي آخر ما كُتب، والوقت
        // المعروض في الصف هو `updatedAt` نفسه. الترتيب بالفتح كان يقفز
        // بالنصّ إلى رأس القائمة بمجرّد قراءته — فيبدو كأنه عُدّل ولم
        // يُكتب فيه حرف.
        out.sort_by_key(|d| std::cmp::Reverse(d.updated_at));
        Ok((out, damaged))
    }

    /// يمحو مستندًا نهائيًا — **بلا سلّة ولا تدارك**. ADR ٠٠١٩.
    ///
    /// كانت هذه `delete()`، وكل استدعاء لها في المنتج صار `trash()`
    /// (سلّة، لا محوًا فوريًا) إلا حالة واحدة: مستندٌ لا كلمة فيه ولا
    /// لقطة سجل واحدة — لا شيء فيه يخسره التدارك، فيُمحى مباشرةً بدل
    /// أن يشغل صفًّا في السلّة لا يُستعاد منه شيء. والاسم الجديد يجعل
    /// النهائية ظاهرة في موضع الاستدعاء لا مطويّة خلف اسم عام.
    pub fn purge(&self, id: &str) -> Result<()> {
        if !is_safe_id(id) {
            return Err(StoreError::NotFound);
        }
        let dir = self.dir_for(id);
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }

    /// ينقل مستندًا إلى السلّة — **نقلٌ فعلي لا علامة**. ADR ٠٠١٩.
    ///
    /// مجلد المستند كاملًا (`document.json` وسجله في `revisions/`)
    /// يُنقَل من `Documents/<id>/` إلى `Trash/<id>/` بـ`fs::rename` —
    /// إدخال دليل واحد على القرص نفسه، لا نسخ. الوجهة تضمن العزل:
    /// `list()` لا تفحص `deleted_at` لأن المحذوف لم يعد داخل `Documents/`
    /// أصلًا، فلا فلترة يمكن أن تُنسى في مسارٍ يُضاف لاحقًا.
    ///
    /// **الختم يسبق النقل لا يتبعه.** لو انقلب الترتيب وتوقّف العمل
    /// بينهما، دخل السلّة مستندٌ بـ`deleted_at: None` — قيمة سويّة في
    /// مستند حيّ، لكنها هنا تكسر حساب انتهاء المهلة في `sweep_expired`
    /// (لا وقت يُقاس منه). بالترتيب هنا، توقّفٌ بين الختم والنقل يترك
    /// المستند في `Documents/` بحقل مختوم لا يُقرأ من هناك أصلًا —
    /// حالة سويّة تُصلحها أول كتابة تالية (`save_document` يضبط
    /// `deletedAt: null` دومًا)، لا حالة غامضة في السلّة.
    pub fn trash(&self, id: &str) -> Result<()> {
        let mut doc = self.load(id)?;
        doc.deleted_at = Some(now_ms());
        self.save(&doc)?;

        let from = self.dir_for(id);
        let to = self.trash_dir_for(id);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&from, &to)?;
        Ok(())
    }

    /// يعيد مستندًا من السلّة — بسجله كاملًا كما كان. ADR ٠٠١٩.
    ///
    /// **النقل يسبق تصفير الختم لا يتبعه** — عكس ترتيب `trash()` عمدًا:
    /// خطوة النقل هي الحرجة (`fs::rename` ذرّية)؛ وتصفير `deleted_at`
    /// بعدها تجميلٌ لا سلامة، إذ `list()` لا تقرأ الحقل أصلًا فور وصول
    /// المستند إلى `Documents/`. توقّفٌ بعد النقل يترك مستندًا حيًّا
    /// بحقلٍ متخلّف غير مقروء — تُصلحه أول كتابة تالية كما في `trash()`.
    /// لو انقلب الترتيب، توقّفٌ بين الخطوتين يترك المستند في `Trash/`
    /// بختمٍ صُفِّر — نقيض ما تحتاجه `sweep_expired` تمامًا.
    pub fn restore(&self, id: &str) -> Result<()> {
        if !is_safe_id(id) {
            return Err(StoreError::NotFound);
        }
        let from = self.trash_dir_for(id);
        let to = self.dir_for(id);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(&from, &to).map_err(|_| StoreError::NotFound)?;

        if let Ok(mut doc) = self.load(id) {
            doc.deleted_at = None;
            let _ = self.save(&doc);
        }
        Ok(())
    }

    /// محتويات السلّة، الأحدث حذفًا أولًا. التالفة تُتخطّى — القاعدة
    /// نفسها في `list()`.
    pub fn list_trash(&self) -> Result<(Vec<TrashSummary>, Vec<String>)> {
        let dir = self.trash_dir();
        if !dir.exists() {
            return Ok((Vec::new(), Vec::new()));
        }
        let mut out = Vec::new();
        let mut damaged = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let Ok(entry) = entry else { continue };
            if !entry.path().is_dir() {
                continue;
            }
            let Some(id) = entry.file_name().to_str().map(String::from) else {
                continue;
            };
            let path = self.trash_dir_for(&id).join("document.json");
            let read = read_optional(&path).map_err(StoreError::from);
            match read {
                Ok(Some(bytes)) => match parse_document(&bytes, &path) {
                    Ok(d) => out.push(TrashSummary::from(&d)),
                    Err(_) => damaged.push(id),
                },
                Ok(None) => {}
                Err(_) => damaged.push(id),
            }
        }
        out.sort_by_key(|d| std::cmp::Reverse(d.deleted_at));
        Ok((out, damaged))
    }

    /// يمحو عنصرًا واحدًا من السلّة نهائيًا — اللبنة التي يُبنى عليها
    /// `sweep_expired` و`empty_trash`، ويستعملها أيضًا `cleanup_selftest`
    /// لكنس ما تركته أدوات التطوير هناك.
    pub fn purge_trashed(&self, id: &str) -> Result<()> {
        if !is_safe_id(id) {
            return Err(StoreError::NotFound);
        }
        let dir = self.trash_dir_for(id);
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }

    /// يمحو ما تجاوز `retention_ms` منذ حذفه — نهائيًا. ADR ٠٠١٩.
    ///
    /// كسول لا خلفي: يُستدعى عند الإقلاع وعند فتح لوحة السلّة، لا من
    /// مؤقّت يعمل والتطبيق مغلق. **يُبلّغ:** عدد ما مُحي.
    pub fn sweep_expired(&self, now: i64, retention_ms: i64) -> Result<usize> {
        let (list, _) = self.list_trash()?;
        let mut purged = 0;
        for s in list {
            if now.saturating_sub(s.deleted_at) >= retention_ms && self.purge_trashed(&s.id).is_ok()
            {
                purged += 1;
            }
        }
        Ok(purged)
    }

    /// يُفرغ السلّة كاملة فورًا — زرّ الإفراغ اليدوي. **يُبلّغ:** عدد ما مُحي.
    pub fn empty_trash(&self) -> Result<usize> {
        let (list, _) = self.list_trash()?;
        let mut purged = 0;
        for s in list {
            if self.purge_trashed(&s.id).is_ok() {
                purged += 1;
            }
        }
        Ok(purged)
    }

    pub fn exists(&self, id: &str) -> bool {
        is_safe_id(id) && self.path_for(id).exists()
    }
}

/// يقرأ مستندًا ويهاجره إلى الإصدار الحالي إن لزم.
pub fn parse_document(bytes: &[u8], path: &Path) -> Result<Document> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| StoreError::Corrupt {
            path: path.display().to_string(),
            detail: e.to_string(),
        })?;

    let found = value
        .get("schemaVersion")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as u32;

    if found > SCHEMA_VERSION {
        // ملف من إصدار أحدث: لا يُقرأ بالتخمين ولا يُستبدل.
        return Err(StoreError::Corrupt {
            path: path.display().to_string(),
            detail: format!("إصدار بنية أحدث ({found}) من المدعوم ({SCHEMA_VERSION})"),
        });
    }

    let migrated =
        super::migrate::to_current(value, found).map_err(|detail| StoreError::Corrupt {
            path: path.display().to_string(),
            detail,
        })?;

    serde_json::from_value(migrated).map_err(|e| StoreError::Corrupt {
        path: path.display().to_string(),
        detail: e.to_string(),
    })
}

/// يمنع أن يخرج معرّف من مجلد البيانات — `../` أو مسار مطلق.
fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::model::Block;
    use crate::storage::model::InlineMark;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    fn store(name: &str) -> DocumentStore {
        let d = std::env::temp_dir().join(format!("luma-docs-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        DocumentStore::new(d)
    }

    fn doc(id: &str, text: &str) -> Document {
        Document {
            schema_version: SCHEMA_VERSION,
            id: id.into(),
            title: None,
            blocks: vec![Block {
                id: "b1".into(),
                role: "body".into(),
                text: text.into(),
                marks: Vec::new(),
            }],
            created_at: 100,
            updated_at: 100,
            last_opened_at: 100,
            deleted_at: None,
        }
    }

    #[test]
    fn round_trips_arabic_without_loss() {
        let s = store("round");
        let d = doc("a1", "بِسْمِ اللَّهِ — كتبت hello «اقتباس» ١٢٣");
        s.save(&d).unwrap();
        assert_eq!(s.load("a1").unwrap().blocks, d.blocks);
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **الدور والعلامة يعبران الرحلة كاملةً.**
    ///
    /// كان `Block` بلا حقل `marks`، وserde يُسقط ما لا يعرفه صامتًا:
    /// فالوزن يُرسَل من الواجهة ويُكتب ويختفي بلا خطأ، ثم يثبّت الحفظ
    /// التلقائي الفقدَ على القرص. واختبار الرحلة القديم عاجز عن كشفه
    /// لأنه يقارن كتلًا لا تحمل علامات أصلًا.
    #[test]
    fn round_trips_new_roles_and_marks() {
        let s = store("roles");
        let mut d = doc("a2", "نصّ");
        d.blocks = vec![
            Block {
                id: "b1".into(),
                role: "h3".into(),
                text: "عنوان ثالث".into(),
                marks: Vec::new(),
            },
            Block {
                id: "b2".into(),
                role: "quote".into(),
                text: "اقتباسٌ كامل".into(),
                marks: Vec::new(),
            },
            Block {
                id: "b3".into(),
                role: "body".into(),
                text: "فقرة فيها وزن".into(),
                marks: vec![InlineMark {
                    kind: "strong".into(),
                    from: 9,
                    to: 13,
                }],
            },
        ];
        s.save(&d).unwrap();
        assert_eq!(s.load("a2").unwrap().blocks, d.blocks);
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **مستند من قبل العلامات يُقرأ كما هو** — لا هجرة ولا رفع إصدار.
    #[test]
    fn documents_without_marks_still_load() {
        let s = store("nomarks");
        fs::create_dir_all(s.path_for("old").parent().unwrap()).unwrap();
        let json = r#"{"schemaVersion":1,"id":"old","title":null,
            "blocks":[{"id":"b1","role":"body","text":"قديم"}],
            "createdAt":1,"updatedAt":1,"lastOpenedAt":1}"#;
        fs::write(s.path_for("old"), json).unwrap();
        let loaded = s.load("old").unwrap();
        assert_eq!(loaded.blocks[0].text, "قديم");
        assert!(loaded.blocks[0].marks.is_empty());
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn missing_document_is_not_found_not_corrupt() {
        let s = store("missing");
        assert!(matches!(s.load("nope"), Err(StoreError::NotFound)));
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn corrupt_file_is_reported_not_silently_replaced() {
        let s = store("corrupt");
        s.save(&doc("c1", "نص")).unwrap();
        fs::write(s.path_for("c1"), "{ ليس JSON".as_bytes()).unwrap();

        let err = s.load("c1").unwrap_err();
        assert!(matches!(err, StoreError::Corrupt { .. }));
        // الملف التالف باقٍ كما هو: لم يُحذف ولم يُستبدل بفارغ
        assert!(s.path_for("c1").exists());
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn newer_schema_is_refused_not_guessed() {
        let s = store("newer");
        fs::create_dir_all(s.path_for("n1").parent().unwrap()).unwrap();
        fs::write(
            s.path_for("n1"),
            br#"{"schemaVersion":999,"id":"n1","blocks":[],"createdAt":0,"updatedAt":0,"lastOpenedAt":0}"#,
        )
        .unwrap();
        assert!(matches!(s.load("n1"), Err(StoreError::Corrupt { .. })));
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn listing_skips_damaged_without_failing() {
        let s = store("list");
        s.save(&doc("ok1", "سليم")).unwrap();
        s.save(&doc("bad1", "سيتلف")).unwrap();
        fs::write(s.path_for("bad1"), "تالف".as_bytes()).unwrap();

        let (list, damaged) = s.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ok1");
        assert_eq!(damaged, vec!["bad1"]);
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **فتح نصّ ليس تعديلًا له.**
    ///
    /// القائمة للعرض فتُرتَّب بآخر تعديل، وختمُ وقت الفتح لا يمسّها.
    /// خلطهما كان يقفز بالنصّ المقروء إلى رأس المكتبة بلا حرف واحد.
    #[test]
    fn opening_a_document_does_not_reorder_the_library() {
        let s = store("order");
        let mut older = doc("old", "قديم");
        older.updated_at = 10;
        older.last_opened_at = 10;
        let mut newer = doc("new", "جديد");
        newer.updated_at = 99;
        newer.last_opened_at = 99;
        s.save(&older).unwrap();
        s.save(&newer).unwrap();

        // يُفتح القديم الآن: يُختم وقت فتحه ولا يُمسّ وقت تعديله
        older.last_opened_at = 1000;
        s.save(&older).unwrap();

        let (list, _) = s.list().unwrap();
        assert_eq!(
            list.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(),
            vec!["new", "old"],
            "الترتيب يتبع آخر تعديل لا آخر فتح"
        );
        let _ = fs::remove_dir_all(&s.root);
    }

    #[test]
    fn rejects_ids_that_escape_the_data_dir() {
        let s = store("escape");
        for bad in ["../evil", "/etc/passwd", "a/b", "", "a b"] {
            assert!(!is_safe_id(bad), "قُبل معرّف خطر: {bad}");
            assert!(s.load(bad).is_err());
            // والمسارات الثلاثة كلها تمرّ بالحارس نفسه: معرّفٌ خطر لا
            // يمحو شيئًا ولا ينقل مجلدًا خارج البيانات.
            assert!(s.purge(bad).is_err(), "محوٌ بمعرّف خطر: {bad}");
            assert!(s.trash(bad).is_err(), "نقلٌ للسلّة بمعرّف خطر: {bad}");
            assert!(s.restore(bad).is_err(), "استعادةٌ بمعرّف خطر: {bad}");
        }
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **المحو النهائي يمحو المستند وسجله معًا** — `remove_dir_all` على
    /// مجلده. `purge()` لا يقع في مسار المنتج العادي إلا لمستندٍ لا
    /// كلمة فيه ولا لقطة — الحذف المعتاد `trash()` أدناه.
    #[test]
    fn purge_removes_the_document_with_its_revisions() {
        let s = store("purge");
        s.save(&doc("d1", "نصّ يُمحى")).unwrap();
        let dir = s.dir_for("d1");
        // لقطة داخل مجلد المستند — تمثّل سجله الزمني
        fs::create_dir_all(dir.join("revisions")).unwrap();
        fs::write(dir.join("revisions/r1.json"), b"{}").unwrap();
        assert!(s.path_for("d1").exists());

        s.purge("d1").unwrap();

        assert!(!dir.exists(), "بقي مجلد المستند بعد المحو");
        assert!(matches!(s.load("d1"), Err(StoreError::NotFound)));
        let (list, _) = s.list().unwrap();
        assert!(list.iter().all(|d| d.id != "d1"), "المحذوف باقٍ في المكتبة");
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **الحذف المعتاد ينقل لا يمحو** — المستند وسجله ينتقلان إلى
    /// السلّة كاملَين، ويختفيان من المكتبة والقرص لأن `Documents/` لم
    /// يعودا فيه، لا لأن حقلًا يُخفيهما. ADR ٠٠١٩.
    #[test]
    fn trash_moves_the_document_with_its_revisions_out_of_the_library() {
        let s = store("trash");
        s.save(&doc("d1", "نصّ يُنقل")).unwrap();
        let live_dir = s.dir_for("d1");
        fs::create_dir_all(live_dir.join("revisions")).unwrap();
        fs::write(live_dir.join("revisions/r1.json"), b"{}").unwrap();

        s.trash("d1").unwrap();

        assert!(!live_dir.exists(), "بقي مجلد المستند في Documents/");
        assert!(
            matches!(s.load("d1"), Err(StoreError::NotFound)),
            "لا يزال يُقرأ من موضعه القديم"
        );
        let (list, _) = s.list().unwrap();
        assert!(
            list.iter().all(|d| d.id != "d1"),
            "المنقول إلى السلّة باقٍ في المكتبة"
        );

        let trashed_dir = s.trash_dir_for("d1");
        assert!(trashed_dir.exists(), "لم يصل مجلد المستند إلى Trash/");
        assert!(
            trashed_dir.join("revisions/r1.json").exists(),
            "سجله لم يصل معه"
        );

        let (trash, _) = s.list_trash().unwrap();
        assert_eq!(trash.len(), 1);
        assert_eq!(trash[0].id, "d1");
        assert!(trash[0].deleted_at > 0, "لم يُختم وقت الحذف");
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **الاستعادة تعيد المستند بسجله كاملًا وتصفّر الختم.**
    #[test]
    fn restore_brings_the_document_back_with_its_history() {
        let s = store("restore");
        s.save(&doc("d1", "نصّ يُستعاد")).unwrap();
        fs::create_dir_all(s.dir_for("d1").join("revisions")).unwrap();
        fs::write(s.dir_for("d1").join("revisions/r1.json"), b"{}").unwrap();
        s.trash("d1").unwrap();

        s.restore("d1").unwrap();

        assert!(
            !s.trash_dir_for("d1").exists(),
            "بقي في Trash/ بعد الاستعادة"
        );
        let back = s.load("d1").unwrap();
        assert_eq!(back.deleted_at, None, "لم يُصفَّر ختم الحذف");
        assert!(
            s.dir_for("d1").join("revisions/r1.json").exists(),
            "سجله لم يعد معه"
        );
        let (list, _) = s.list().unwrap();
        assert!(list.iter().any(|d| d.id == "d1"), "لم يعد ظاهرًا في المكتبة");
        let _ = fs::remove_dir_all(&s.root);
    }

    /// استعادة ما ليس في السلّة خطأ صريح لا نجاحٌ صامت.
    #[test]
    fn restoring_what_is_not_in_trash_is_an_error() {
        let s = store("restore-missing");
        assert!(s.restore("ghost").is_err());
        let _ = fs::remove_dir_all(&s.root);
    }

    /// يضبط `deletedAt` مباشرة على القرص — الحذف الحقيقي يقع خلال
    /// ميلي‌ثوانٍ، فلا فارق زمني حقيقي يُنتج فرق أيام يحتاجه هذا
    /// الاختبار؛ التحكم المباشر أصدق من `sleep` طويل.
    fn set_deleted_at(s: &DocumentStore, id: &str, at: i64) {
        let path = s.trash_dir_for(id).join("document.json");
        let bytes = fs::read(&path).unwrap();
        let mut v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        v["deletedAt"] = serde_json::Value::from(at);
        fs::write(&path, serde_json::to_vec(&v).unwrap()).unwrap();
    }

    /// **الكسح يمحو ما تجاوز المهلة وحده ويُبقي الباقي.**
    #[test]
    fn sweep_expired_purges_only_what_passed_retention() {
        let s = store("sweep");
        s.save(&doc("old", "قديم")).unwrap();
        s.trash("old").unwrap();
        s.save(&doc("recent", "حديث")).unwrap();
        s.trash("recent").unwrap();

        // "قديم" حُذف قبل ٣١ يومًا من المرجع، و"حديث" قبل ٥ أيام فقط
        let now = 1_000_000_000_000i64;
        set_deleted_at(&s, "old", now - TRASH_RETENTION_MS - DAY_MS);
        set_deleted_at(&s, "recent", now - 5 * DAY_MS);

        let purged = s.sweep_expired(now, TRASH_RETENTION_MS).unwrap();
        assert_eq!(purged, 1);

        let (remaining, _) = s.list_trash().unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "recent", "الكسح مسّ ما لم تنتهِ مهلته");
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **الإفراغ اليدوي يمحو كل شيء بصرف النظر عن العمر.**
    #[test]
    fn empty_trash_purges_everything_regardless_of_age() {
        let s = store("empty-trash");
        s.save(&doc("a", "أ")).unwrap();
        s.trash("a").unwrap();
        s.save(&doc("b", "ب")).unwrap();
        s.trash("b").unwrap();

        let purged = s.empty_trash().unwrap();
        assert_eq!(purged, 2);
        let (remaining, _) = s.list_trash().unwrap();
        assert!(remaining.is_empty());
        let _ = fs::remove_dir_all(&s.root);
    }

    /// لقطة تالفة في السلّة لا تُسقط قائمتها — القاعدة نفسها في `list()`.
    #[test]
    fn list_trash_skips_damaged_without_failing() {
        let s = store("trash-damaged");
        s.save(&doc("ok1", "سليم")).unwrap();
        s.trash("ok1").unwrap();
        s.save(&doc("bad1", "سيتلف")).unwrap();
        s.trash("bad1").unwrap();
        fs::write(
            s.trash_dir_for("bad1").join("document.json"),
            "تالف".as_bytes(),
        )
        .unwrap();

        let (list, damaged) = s.list_trash().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "ok1");
        assert_eq!(damaged, vec!["bad1"]);
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **ملفٌّ في المسار ليس مستندًا يُقرأ** — والفرق كان يُخلط.
    ///
    /// حارسُ الفراغ في `save_document` بُني على `exists()`، فمرّ على
    /// التالف وكُتب الفراغ فوقه — وهو ما يمنعه §١٤. هذا الاختبار
    /// يثبّت الفرق بين السؤالين كي لا يُخلطا من جديد.
    #[test]
    fn a_corrupt_file_exists_on_the_path_but_is_not_a_readable_document() {
        let s = store("exists-vs-load");
        s.save(&doc("x1", "نصّ سليم")).unwrap();
        fs::write(s.path_for("x1"), "{ ليس JSON".as_bytes()).unwrap();

        assert!(s.exists("x1"), "المسار موجود");
        assert!(s.load("x1").is_err(), "والمستند لا يُقرأ");
        let _ = fs::remove_dir_all(&s.root);
    }

    /// محو ما ليس موجودًا ليس خطأً: المغادرة لا تتعثّر بمستند سبق محوه.
    #[test]
    fn purging_what_is_not_there_is_not_an_error() {
        let s = store("purge-missing");
        assert!(s.purge("ghost").is_ok());
        let _ = fs::remove_dir_all(&s.root);
    }
}
