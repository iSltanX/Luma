//! `DocumentStore` — قراءة وكتابة ذرّية للمستندات. لا تعرف الواجهة.
//!
//! ملف لكل مستند: يحصر أثر أي تلف في مستند واحد، ويسمح بكتابة ذرّية
//! مستقلة — §٤.

use std::fs;
use std::path::{Path, PathBuf};

use super::atomic::{read_optional, write_atomic};
use super::model::{Document, DocumentSummary, SCHEMA_VERSION};

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

    fn dir_for(&self, id: &str) -> PathBuf {
        self.documents_dir().join(id)
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

    pub fn delete(&self, id: &str) -> Result<()> {
        if !is_safe_id(id) {
            return Err(StoreError::NotFound);
        }
        let dir = self.dir_for(id);
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        Ok(())
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
            // والحذف يمرّ بالحارس نفسه: معرّفٌ خطر لا يمحو شيئًا
            assert!(s.delete(bad).is_err(), "حذفٌ بمعرّف خطر: {bad}");
        }
        let _ = fs::remove_dir_all(&s.root);
    }

    /// **الحذف يمحو المستند وسجله معًا** — `remove_dir_all` على مجلده.
    ///
    /// وهو ما يجعل الحذف بلا سلّة فقدًا لا رجعة فيه: اللقطات تذهب مع
    /// المستند، ومنها لقطة الأمان التي تسبق كل استعادة. القاعدة مقصودة
    /// ومقيسة هنا كي لا تتغيّر صامتة — `Luma.md` §٢٠ مسألة ١٩.
    #[test]
    fn delete_removes_the_document_with_its_revisions() {
        let s = store("delete");
        s.save(&doc("d1", "نصّ يُمحى")).unwrap();
        let dir = s.dir_for("d1");
        // لقطة داخل مجلد المستند — تمثّل سجله الزمني
        fs::create_dir_all(dir.join("revisions")).unwrap();
        fs::write(dir.join("revisions/r1.json"), b"{}").unwrap();
        assert!(s.path_for("d1").exists());

        s.delete("d1").unwrap();

        assert!(!dir.exists(), "بقي مجلد المستند بعد الحذف");
        assert!(matches!(s.load("d1"), Err(StoreError::NotFound)));
        let (list, _) = s.list().unwrap();
        assert!(list.iter().all(|d| d.id != "d1"), "المحذوف باقٍ في المكتبة");
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

    /// حذف ما ليس موجودًا ليس خطأً: المغادرة لا تتعثّر بمستند سبق محوه.
    #[test]
    fn deleting_what_is_not_there_is_not_an_error() {
        let s = store("delete-missing");
        assert!(s.delete("ghost").is_ok());
        let _ = fs::remove_dir_all(&s.root);
    }
}
