//! نموذج البيانات المخزَّن — `IMPLEMENTATION.md` §٣.
//!
//! لا يحمل قرار عرض واحدًا: لا خط ولا حجم ولا لون ولا ثيم.
//! «تغيير الخط أو الثيم لا يمسّ المحتوى المخزَّن» — §١٧ مبدأ ٣.

use serde::{Deserialize, Serialize};

/// إصدار بنية البيانات.
///
/// موجود من أول يوم لا عند أول تغيير: إضافته لاحقًا تعني ملفات بلا
/// إصدار لا يمكن تمييزها. §١٨ مسألة الهجرة.
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Block {
    pub id: String,
    /// `body` أو `h1` أو `h2` — `Luma.md` §٥.
    pub role: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    /// عنوان صريح كتبه المستخدم.
    ///
    /// `None` تعني «لم يسمِّه» — والعرض يشتقّ من أول سطر، أو
    /// «بدون عنوان» إن كان فارغًا. لا يُطلب من المستخدم تسمية
    /// قبل الكتابة — `Luma.md` §٤ **ثابت**.
    #[serde(default)]
    pub title: Option<String>,
    pub blocks: Vec<Block>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_opened_at: i64,
}

fn default_schema_version() -> u32 {
    // ملف بلا حقل إصدار هو من الإصدار ١ — أول بنية شُحنت.
    1
}

impl Document {
    /// العنوان المعروض: صريحٌ، أو مشتقٌّ من أول سطر، أو «بدون عنوان».
    pub fn display_title(&self) -> String {
        if let Some(t) = self.title.as_ref() {
            let t = t.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
        for b in &self.blocks {
            let line = b.text.trim();
            if !line.is_empty() {
                return truncate_chars(line, 60);
            }
        }
        "بدون عنوان".to_string()
    }

    /// هل المستند بلا محتوى فعلي؟
    ///
    /// يحسمه النص لا عدد الكتل: مستند بعشر كتل فارغة لا يزال فارغًا.
    pub fn is_empty(&self) -> bool {
        self.blocks.iter().all(|b| b.text.trim().is_empty())
    }

    pub fn word_count(&self) -> usize {
        self.blocks
            .iter()
            .map(|b| b.text.split_whitespace().count())
            .sum()
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let cut: String = s.chars().take(max).collect();
    format!("{}…", cut.trim_end())
}

/// مصدر اللقطة — §٣.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RevisionSource {
    Automatic,
    BeforeRestore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    pub id: String,
    pub document_id: String,
    pub created_at: i64,
    pub source: RevisionSource,
    pub word_count: usize,
    pub blocks: Vec<Block>,
}

/// بطاقة لقطة للعرض — بلا محتوى، فلا تُحمَّل اللقطات كلها لعرض قائمة.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionSummary {
    pub id: String,
    pub created_at: i64,
    pub source: RevisionSource,
    pub word_count: usize,
}

/// بطاقة مستند للمكتبة — §٦ من `Luma.md`: عنوان ومقتطف ووقت.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub word_count: usize,
    pub updated_at: i64,
    pub last_opened_at: i64,
}

impl From<&Document> for DocumentSummary {
    fn from(d: &Document) -> Self {
        // المقتطف يبدأ **بعد** السطر الذي صار عنوانًا.
        //
        // بدون هذا يتكرّر العنوان في صف المكتبة: مرة عنوانًا ومرة أول
        // المقتطف. والتخطّي مشروط بأن يكون العنوان مشتقًّا فعلًا —
        // فالعنوان الصريح لا يستهلك سطرًا من النص.
        let derived = d
            .title
            .as_ref()
            .map(|t| t.trim().is_empty())
            .unwrap_or(true);
        let mut lines = d
            .blocks
            .iter()
            .map(|b| b.text.trim())
            .filter(|t| !t.is_empty());
        if derived {
            lines.next();
        }
        let text = lines.collect::<Vec<_>>().join(" ");
        Self {
            id: d.id.clone(),
            title: d.display_title(),
            excerpt: truncate_chars(&text, 120),
            word_count: d.word_count(),
            updated_at: d.updated_at,
            last_opened_at: d.last_opened_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(title: Option<&str>, texts: &[&str]) -> Document {
        Document {
            schema_version: SCHEMA_VERSION,
            id: "d1".into(),
            title: title.map(String::from),
            blocks: texts
                .iter()
                .enumerate()
                .map(|(i, t)| Block {
                    id: format!("b{i}"),
                    role: "body".into(),
                    text: (*t).into(),
                })
                .collect(),
            created_at: 0,
            updated_at: 0,
            last_opened_at: 0,
        }
    }

    #[test]
    fn display_title_prefers_explicit() {
        assert_eq!(doc(Some("عنواني"), &["أول سطر"]).display_title(), "عنواني");
    }

    #[test]
    fn display_title_derives_from_first_nonempty_line() {
        assert_eq!(
            doc(None, &["", "  ", "في الهدوء"]).display_title(),
            "في الهدوء"
        );
    }

    #[test]
    fn display_title_falls_back_when_nothing_written() {
        assert_eq!(doc(None, &["", "   "]).display_title(), "بدون عنوان");
        // عنوان صريح فارغ لا يُعامل كعنوان
        assert_eq!(doc(Some("   "), &[""]).display_title(), "بدون عنوان");
    }

    #[test]
    fn emptiness_is_decided_by_text_not_block_count() {
        assert!(doc(None, &["", "", ""]).is_empty());
        assert!(!doc(None, &["", "حرف"]).is_empty());
    }

    #[test]
    fn missing_schema_version_reads_as_one() {
        let json = r#"{"id":"a","blocks":[],"createdAt":0,"updatedAt":0,"lastOpenedAt":0}"#;
        let d: Document = serde_json::from_str(json).unwrap();
        assert_eq!(d.schema_version, 1);
        assert_eq!(d.title, None);
    }

    #[test]
    fn excerpt_does_not_repeat_a_derived_title() {
        // العنوان مشتقّ من أول سطر، فالمقتطف يبدأ من الثاني
        let s = DocumentSummary::from(&doc(None, &["في مديح البطء", "نعيش في عالم يُمجّد السرعة"]));
        assert_eq!(s.title, "في مديح البطء");
        assert_eq!(s.excerpt, "نعيش في عالم يُمجّد السرعة");

        // عنوان صريح لا يستهلك سطرًا: النص كله مقتطف
        let s = DocumentSummary::from(&doc(Some("عنواني"), &["أول سطر", "ثانٍ"]));
        assert_eq!(s.excerpt, "أول سطر ثانٍ");
    }

    #[test]
    fn single_line_document_has_title_and_no_excerpt() {
        let s = DocumentSummary::from(&doc(None, &["سطر واحد فقط"]));
        assert_eq!(s.title, "سطر واحد فقط");
        assert_eq!(s.excerpt, "");
    }

    #[test]
    fn truncation_counts_characters_not_bytes() {
        // العربية حرفان بالبايت: القطع بالبايت يشقّ الحرف
        let long = "ا".repeat(100);
        let t = truncate_chars(&long, 60);
        assert_eq!(t.chars().count(), 61); // ٦٠ حرفًا + «…»
    }
}
