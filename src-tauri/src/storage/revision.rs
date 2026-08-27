//! `RevisionStore` — ينشئ اللقطات ويقرؤها ويطبّق الاستعادة.
//! **لا يحذف الحالة الحالية** — §٢ و§٦ **ثابت**.

use std::fs;
use std::path::PathBuf;

use super::atomic::{read_optional, write_atomic};
use super::document::{Result, StoreError};
use super::model::{Document, Revision, RevisionSource, RevisionSummary, SCHEMA_VERSION};

/// حدود الاحتفاظ — تُبرَّر بالقياس في ADR ٠٠٠٦.
const MAX_REVISIONS: usize = 100;
const MAX_TOTAL_BYTES: u64 = 20 * 1024 * 1024;

/// أقل تغيّر يستحق لقطة تلقائية، بالحروف.
///
/// دونه تمتلئ الذاكرة الزمنية بلقطات لا تُميّز بعضها من بعض،
/// فتصير الاستعادة أصعب لا أسهل.
const MIN_CHANGE_CHARS: usize = 80;

pub struct RevisionStore {
    dir: PathBuf,
}

impl RevisionStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    fn path_for(&self, rev_id: &str) -> PathBuf {
        self.dir.join(format!("{rev_id}.json"))
    }

    /// هل يستحق هذا التغيّر لقطة تلقائية؟
    ///
    /// يُقارن بآخر لقطة: التقارب الزمني وحده لا يكفي، والتغيّر الطفيف
    /// لا يستحق مرحلة في السجل.
    pub fn should_snapshot(&self, doc: &Document) -> Result<bool> {
        if doc.is_empty() {
            return Ok(false);
        }
        let latest = self.latest()?;
        let Some(prev) = latest else {
            // أول محتوى فعلي — أحد محفّزات §٦
            return Ok(true);
        };
        let before: usize = prev.blocks.iter().map(|b| b.text.chars().count()).sum();
        let after: usize = doc.blocks.iter().map(|b| b.text.chars().count()).sum();
        Ok(before.abs_diff(after) >= MIN_CHANGE_CHARS)
    }

    /// شبكة الأمان قبل استعادة — **ولا شبكة لفراغ**.
    ///
    /// «الاستعادة لا تمحو الحالة الحالية: تُحفظ ضمن السجل قبل تطبيق
    /// النسخة المستعادة» — `Luma.md` §٩ **ثابت**. والمستند الفارغ لا
    /// حالةَ فيه تُمحى، فلقطته لا تحفظ شيئًا — لكنها تدخل السجل صفًّا
    /// اسمه «نسخة أمان قبل استعادة — ٠ كلمة»، **ولا يُقصّ أبدًا**
    /// (`prune` يستثني `BeforeRestore`). فيبقى إلى الأبد يعد بما لا
    /// يملك: من ضغط «استعادة» عليه — وهو عين ما يعد به اسمه — أفرغ
    /// مستنده. شبكة الأمان تصير شَرَكًا، وهو نقيض §٩ لا تحقيقٌ له.
    ///
    /// **والقاعدة هنا لا في طبقة الأوامر.** كانت شرطًا في
    /// `restore_revision`، وذاك أمرٌ يحتاج `State<Storage>` فلا يُبنى
    /// في اختبار وحدة — فلم يحرسه إلا مطابقةُ نصٍّ في المصدر، وثبت
    /// أنها تبقى خضراء على أربع صياغات تعيد العطل. موضعها هنا يجعلها
    /// **مقيسة**، وبجوار `should_snapshot` الذي يرفض الفارغ بالمعيار
    /// نفسه: قاعدة واحدة لا اثنتان.
    ///
    /// **يُبلّغ:** `None` حين لا شبكة — أي حين لا شيء يُحفظ.
    pub fn create_guard(&self, doc: &Document) -> Result<Option<RevisionSummary>> {
        if doc.is_empty() {
            return Ok(None);
        }
        Ok(Some(self.create(doc, RevisionSource::BeforeRestore)?))
    }

    pub fn create(&self, doc: &Document, source: RevisionSource) -> Result<RevisionSummary> {
        let created_at = now_ms();
        // المعرّف من الطابع الزمني: يجعل الترتيب المعجمي ترتيبًا زمنيًا
        let id = format!("{created_at:013}");
        let rev = Revision {
            schema_version: SCHEMA_VERSION,
            id: id.clone(),
            document_id: doc.id.clone(),
            created_at,
            source,
            word_count: doc.word_count(),
            blocks: doc.blocks.clone(),
        };
        let bytes = serde_json::to_vec(&rev)
            .map_err(|e| StoreError::Io(format!("تعذّر تسلسل اللقطة: {e}")))?;
        write_atomic(&self.path_for(&id), &bytes)?;
        self.prune()?;
        Ok(RevisionSummary {
            id,
            created_at,
            source,
            word_count: rev.word_count,
        })
    }

    /// اللقطات من الأحدث إلى الأقدم. التالفة تُتخطّى.
    pub fn list(&self) -> Result<Vec<RevisionSummary>> {
        if !self.dir.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.dir)? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(Some(bytes)) = read_optional(&path) else {
                continue;
            };
            // لقطة تالفة لا تُسقط القائمة — §٦
            if let Ok(r) = serde_json::from_slice::<Revision>(&bytes) {
                out.push(RevisionSummary {
                    id: r.id,
                    created_at: r.created_at,
                    source: r.source,
                    word_count: r.word_count,
                });
            }
        }
        out.sort_by_key(|r| std::cmp::Reverse(r.created_at));
        Ok(out)
    }

    /// هل يوجد أي ملف لقطة على القرص — سليمًا أو تالفًا؟
    ///
    /// **متعمَّدة الاختلاف عن `list()`.** تلك تُسقط التالف من العرض
    /// (§٦: لا يُخفي تلفٌ واحد بقيةَ السجل)؛ وهذه تُجيب سؤالًا آخر:
    /// أهناك ما يُفقَد لو مُحي المستند فورًا بلا سلّة؟ ملفٌّ تالف
    /// موجودٌ فعلًا على القرص — وإسقاطه من `list()` لا يعني عدم وجوده.
    ///
    /// **اكتشفته مراجعة خصومية على مسار السلّة (ADR ٠٠١٩، ٢٦ أغسطس
    /// ٢٠٢٦):** `delete_document` كان يحسم «فارغ بلا سلّة» على
    /// `list().is_empty()`، فتلفٌ في لقطة واحدة يجعل مستندًا له سجل
    /// فعلي يُقرأ بلا سجل — فيُمحى فورًا (`purge`) بدل أن ينتقل إلى
    /// السلّة، محوًا نهائيًا للقطاته التالفة **وسليمها إن وُجد** معًا.
    pub fn has_any_snapshot(&self) -> bool {
        let Ok(entries) = fs::read_dir(&self.dir) else {
            return false;
        };
        entries
            .flatten()
            .any(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
    }

    pub fn load(&self, rev_id: &str) -> Result<Revision> {
        if !rev_id.chars().all(|c| c.is_ascii_digit()) {
            return Err(StoreError::NotFound);
        }
        let path = self.path_for(rev_id);
        let Some(bytes) = read_optional(&path)? else {
            return Err(StoreError::NotFound);
        };
        // تعذُّر قراءة لقطة يُظهر خطأ محصورًا فيها ولا يمسّ المستند — §٦
        serde_json::from_slice(&bytes).map_err(|e| StoreError::Corrupt {
            path: path.display().to_string(),
            detail: e.to_string(),
        })
    }

    fn latest(&self) -> Result<Option<Revision>> {
        let list = self.list()?;
        match list.first() {
            Some(s) => Ok(Some(self.load(&s.id)?)),
            None => Ok(None),
        }
    }

    /// يقصّ **الأقدم** عند تجاوز حدّ العدد أو الحجم.
    ///
    /// **لا يُقصّ ما مصدره `BeforeRestore`:** تلك شبكة الأمان التي
    /// تجعل الاستعادة قابلة للتدارك.
    ///
    /// `list()` من الأحدث إلى الأقدم، والمرور يتراكم عليه: ما دام
    /// المُبقى داخل الحدّين يُبقى، وأول ما يتجاوزهما يُحذف ومَن بعده.
    /// فالحذف يقع في ذيل القائمة — أي في الأقدم.
    ///
    /// كان حدّ الحجم يُقاس على **مجموع الكل** ويُفحص من أول عنصر،
    /// فيحذف الأحدث أولًا ويستمر نازلًا حتى ينزل المجموع: أي أنه كان
    /// يقصّ عكس ما يوثّقه تمامًا، فيمحو لقطة اليوم ويُبقي لقطة الشهر
    /// الماضي.
    fn prune(&self) -> Result<()> {
        let list = self.list()?;
        let mut kept = 0usize;
        let mut kept_bytes: u64 = 0;

        for s in list.iter() {
            let size = fs::metadata(self.path_for(&s.id))
                .map(|m| m.len())
                .unwrap_or(0);

            // شبكة الأمان تُبقى دائمًا، وتُحسب في الميزانية لأنها
            // تشغل القرص فعلًا
            if s.source == RevisionSource::BeforeRestore {
                kept += 1;
                kept_bytes += size;
                continue;
            }

            let over_count = kept >= MAX_REVISIONS;
            let over_size = kept_bytes.saturating_add(size) > MAX_TOTAL_BYTES;
            if over_count || over_size {
                let _ = fs::remove_file(self.path_for(&s.id));
            } else {
                kept += 1;
                kept_bytes += size;
            }
        }
        Ok(())
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::model::Block;

    fn store(name: &str) -> RevisionStore {
        let d = std::env::temp_dir().join(format!("luma-rev-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        RevisionStore::new(d)
    }

    fn doc(text: &str) -> Document {
        Document {
            schema_version: SCHEMA_VERSION,
            id: "d1".into(),
            title: None,
            blocks: vec![Block {
                id: "b1".into(),
                role: "body".into(),
                text: text.into(),
                marks: Vec::new(),
            }],
            created_at: 0,
            updated_at: 0,
            last_opened_at: 0,
            deleted_at: None,
        }
    }

    #[test]
    fn first_real_content_triggers_a_snapshot() {
        let s = store("first");
        assert!(s.should_snapshot(&doc("أول محتوى")).unwrap());
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn empty_document_never_snapshots() {
        let s = store("empty");
        assert!(!s.should_snapshot(&doc("   ")).unwrap());
        let _ = fs::remove_dir_all(&s.dir);
    }

    /// **لا شبكة أمان من فراغ** — القاعدة نفسها، مقيسة على القرار.
    ///
    /// كان الشرط في `restore_revision`، ولم يحرسه إلا مطابقةُ نصٍّ في
    /// المصدر — وثبت أنها تبقى خضراء على أربع صياغات تعيد العطل
    /// (شرطٌ مقلوب، وجملةٌ ميتة، ومتغيّرٌ آخر ينتهي بـ`doc`، وتعليقٌ في
    /// ذيل سطر). فنُقلت القاعدة هنا لتُقاس بسلوكها.
    #[test]
    fn a_safety_snapshot_is_never_made_from_an_empty_document() {
        let s = store("guard-empty");
        for text in ["", "   ", "\n\t "] {
            assert!(
                s.create_guard(&doc(text)).unwrap().is_none(),
                "أُنشئت شبكة أمان من فراغ: {text:?}"
            );
        }
        assert!(s.list().unwrap().is_empty(), "دخل السجلَّ صفٌّ فارغ");
        let _ = fs::remove_dir_all(&s.dir);
    }

    /// ولمستندٍ فيه نصّ تُنشأ الشبكة فعلًا — القاعدة تمنع الفراغ لا الأمان.
    #[test]
    fn a_safety_snapshot_is_made_for_a_document_with_text() {
        let s = store("guard-text");
        let made = s.create_guard(&doc("نصّ يستحق شبكة")).unwrap();
        assert!(made.is_some(), "لم تُنشأ شبكة لمستند فيه نصّ");
        let list = s.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].source, RevisionSource::BeforeRestore);
        let _ = fs::remove_dir_all(&s.dir);
    }

    /// **وما يدخل شبكةَ أمان لا يُقصّ أبدًا** — ولذلك لا يجوز أن يدخل
    /// فارغًا: صفٌّ يعد بما لا يملك، باقٍ إلى الأبد.
    #[test]
    fn a_safety_snapshot_survives_pruning_forever() {
        let s = store("guard-prune");
        s.create_guard(&doc("شبكة أمان")).unwrap();
        for i in 0..(MAX_REVISIONS + 5) {
            s.create(&doc(&format!("نصّ {i}")), RevisionSource::Automatic)
                .unwrap();
        }
        assert!(
            s.list()
                .unwrap()
                .iter()
                .any(|r| r.source == RevisionSource::BeforeRestore),
            "قُصّت شبكة الأمان"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn small_edits_do_not_snapshot_but_large_ones_do() {
        let s = store("threshold");
        s.create(&doc(&"ا".repeat(200)), RevisionSource::Automatic)
            .unwrap();
        assert!(!s.should_snapshot(&doc(&"ا".repeat(210))).unwrap());
        assert!(s.should_snapshot(&doc(&"ا".repeat(400))).unwrap());
        let _ = fs::remove_dir_all(&s.dir);
    }

    /// **العتبة عند ٨٠ حرفًا بالضبط — لا في مدًى واسع.**
    ///
    /// الاختبار أعلاه يحصر `MIN_CHANGE_CHARS` بين ١١ و٢٠٠: أيُّ قيمة
    /// في المدى تُرضيه، و`80` لا يظهر في شجرة Rust إلا في تعريفه.
    /// وADR ٠٠٠٦ يسمّي الرقم نصًّا («تغيّر جوهري: ٨٠ حرفًا فأكثر»)،
    /// فيُقاس عند حدّه. بندُ ب/٢٢.
    ///
    /// **والأعداد هنا حرفية لا مشتقّة من الثابت** — عمدًا: اختبارٌ
    /// يكتب `base + MIN_CHANGE_CHARS` يرضى بأي قيمةٍ للثابت، فيقيس
    /// اتّساقه مع نفسه لا مطابقته لما تُعلنه الوثيقة.
    #[test]
    fn the_snapshot_threshold_is_exactly_eighty_characters() {
        let s = store("threshold-edge");
        let base = 1_000;
        s.create(&doc(&"ا".repeat(base)), RevisionSource::Automatic)
            .unwrap();

        assert!(
            !s.should_snapshot(&doc(&"ا".repeat(base + 79))).unwrap(),
            "٧٩ حرفًا ألقطت — العتبة أدنى مما يُعلنه ADR ٠٠٠٦"
        );
        assert!(
            s.should_snapshot(&doc(&"ا".repeat(base + 80))).unwrap(),
            "٨٠ حرفًا لم تُلقِط — العتبة أعلى مما يُعلنه ADR ٠٠٠٦"
        );
        // والنقصان كالزيادة: `abs_diff` لا اتجاه له
        assert!(
            s.should_snapshot(&doc(&"ا".repeat(base - 80))).unwrap(),
            "حذفُ ٨٠ حرفًا لم يُلقِط"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn snapshots_round_trip_and_sort_newest_first() {
        let s = store("sort");
        s.create(&doc("الأولى"), RevisionSource::Automatic).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        s.create(&doc("الثانية"), RevisionSource::Automatic)
            .unwrap();

        let list = s.list().unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].created_at >= list[1].created_at);
        assert_eq!(s.load(&list[0].id).unwrap().blocks[0].text, "الثانية");
        let _ = fs::remove_dir_all(&s.dir);
    }

    /// **الحاسم لقرار «فارغ بلا سلّة»: تلفٌ في اللقطة الوحيدة لا يعني
    /// غيابها.** `list()` تُسقط التالف عمدًا (§٦)، فحسمُ الفراغ على
    /// طولها كان يُحوّل تلفًا في لقطة إلى محوٍ نهائي — عطلٌ حقيقي
    /// كشفته مراجعة خصومية. هذا الاختبار يقيس الفرق مباشرةً: `list()`
    /// فارغة والحقيقة أن ثمّة ملفًا فعلًا.
    #[test]
    fn has_any_snapshot_sees_a_corrupt_file_that_list_hides() {
        let s = store("has-any-corrupt");
        fs::create_dir_all(&s.dir).unwrap();
        fs::write(s.path_for("r1"), "تالف لا يُحلَّل").unwrap();

        assert!(
            s.list().unwrap().is_empty(),
            "list() لم تُسقط التالف كما يُفترض"
        );
        assert!(
            s.has_any_snapshot(),
            "تلفٌ في اللقطة الوحيدة جعلها تبدو غائبة تمامًا"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn has_any_snapshot_is_false_when_nothing_was_ever_created() {
        let s = store("has-any-none");
        assert!(!s.has_any_snapshot());
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn a_corrupt_snapshot_does_not_break_the_list() {
        let s = store("corrupt");
        s.create(&doc("سليمة"), RevisionSource::Automatic).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(3));
        let bad = s.create(&doc("ستتلف"), RevisionSource::Automatic).unwrap();
        fs::write(s.path_for(&bad.id), "تالف".as_bytes()).unwrap();

        let list = s.list().unwrap();
        assert_eq!(list.len(), 1, "اللقطة التالفة أسقطت القائمة");
        assert!(matches!(s.load(&bad.id), Err(StoreError::Corrupt { .. })));
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn pruning_never_removes_the_before_restore_safety_net() {
        let s = store("prune");
        let guard = s
            .create(&doc("قبل الاستعادة"), RevisionSource::BeforeRestore)
            .unwrap();
        for i in 0..(MAX_REVISIONS + 20) {
            std::thread::sleep(std::time::Duration::from_millis(1));
            s.create(&doc(&format!("لقطة {i}")), RevisionSource::Automatic)
                .unwrap();
        }
        let list = s.list().unwrap();
        assert!(list.len() <= MAX_REVISIONS + 1);
        assert!(
            list.iter().any(|r| r.id == guard.id),
            "قُصّت لقطة ما قبل الاستعادة — شبكة الأمان"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }

    #[test]
    fn pruning_by_count_keeps_the_newest_and_drops_the_oldest() {
        let s = store("prune-order");
        let mut created = Vec::new();
        for i in 0..(MAX_REVISIONS + 5) {
            std::thread::sleep(std::time::Duration::from_millis(1));
            created.push(
                s.create(&doc(&format!("لقطة {i}")), RevisionSource::Automatic)
                    .unwrap(),
            );
        }
        let list = s.list().unwrap();
        assert!(list.len() <= MAX_REVISIONS);

        // الأحدث باقية
        let newest = created.last().unwrap();
        assert!(
            list.iter().any(|r| r.id == newest.id),
            "قُصّت أحدث لقطة بدل أقدمها"
        );
        // الأقدم ذهبت
        let oldest = created.first().unwrap();
        assert!(
            !list.iter().any(|r| r.id == oldest.id),
            "بقيت أقدم لقطة رغم تجاوز الحدّ"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }

    // ── اختبارات مؤقّتة للتحقق من الادعاء — تُحذف بعد القياس ──

    /// حدّ الحجم كان يُقاس على المجموع ويُفحص من رأس القائمة، فيحذف
    /// **الأحدث** أولًا. الحدّ هنا يُصغَّر بالحساب لا بتغيير الثابت:
    /// لقطات كبيرة يتجاوز مجموعها ٢٠MB.
    #[test]
    fn pruning_by_size_drops_the_oldest_not_the_newest() {
        let s = store("prune-size");
        // كل لقطة نحو ٢٫٥MB، فاثنتا عشرة تتجاوز حدّ ٢٠MB
        let heavy = "ن".repeat(1_200_000);
        let mut created = Vec::new();
        for i in 0..12 {
            std::thread::sleep(std::time::Duration::from_millis(1));
            created.push(
                s.create(&doc(&format!("{i} {heavy}")), RevisionSource::Automatic)
                    .unwrap(),
            );
        }

        let list = s.list().unwrap();
        assert!(list.len() < 12, "لم يقصّ حدّ الحجم شيئًا");

        let newest = created.last().unwrap();
        assert!(
            list.iter().any(|r| r.id == newest.id),
            "حدّ الحجم قصّ أحدث لقطة — عكس ما يوثّقه"
        );
        let oldest = created.first().unwrap();
        assert!(
            !list.iter().any(|r| r.id == oldest.id),
            "حدّ الحجم أبقى أقدم لقطة"
        );

        let total: u64 = list
            .iter()
            .map(|r| {
                fs::metadata(s.path_for(&r.id))
                    .map(|m| m.len())
                    .unwrap_or(0)
            })
            .sum();
        assert!(
            total <= MAX_TOTAL_BYTES,
            "المجموع بعد القصّ {total} فوق الحدّ"
        );
        let _ = fs::remove_dir_all(&s.dir);
    }
}
