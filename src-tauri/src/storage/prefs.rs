//! `PreferencesStore` — مخزن منفصل عن المستندات.
//!
//! «التفضيلات في مخزن منفصل، فلا يُفسد إعداد تالف نصًّا» — §٤ **ثابت**.
//! ولذلك تفضيلات غير قابلة للقراءة تعود إلى الافتراضات بصمت مقبول،
//! ولا تمنع فتح المستند.

use std::path::PathBuf;

use super::atomic::{read_optional, write_atomic};
use super::document::{Result, StoreError};

pub struct PreferencesStore {
    path: PathBuf,
}

impl PreferencesStore {
    pub fn new(root: PathBuf) -> Self {
        Self {
            path: root.join("preferences.json"),
        }
    }

    /// يقرأ التفضيلات كقيمة حرّة.
    ///
    /// الشكل تملكه الواجهة: المرحلة ٦ تحسم الحقول، والتخزين لا يفرض
    /// عليها بنية قبل أن تُعتمد.
    pub fn load(&self) -> serde_json::Value {
        match read_optional(&self.path) {
            Ok(Some(bytes)) => {
                serde_json::from_slice(&bytes).unwrap_or_else(|_| serde_json::json!({}))
            }
            _ => serde_json::json!({}),
        }
    }

    pub fn save(&self, value: &serde_json::Value) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(value)
            .map_err(|e| StoreError::Io(format!("تعذّر تسلسل التفضيلات: {e}")))?;
        write_atomic(&self.path, &bytes)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn corrupt_preferences_fall_back_to_defaults_not_an_error() {
        let d = std::env::temp_dir().join(format!("luma-prefs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let s = PreferencesStore::new(d.clone());

        s.save(&serde_json::json!({"themeId":"paper"})).unwrap();
        assert_eq!(s.load()["themeId"], "paper");

        fs::write(&s.path, "ليس JSON".as_bytes()).unwrap();
        assert!(s.load().is_object(), "إعداد تالف يجب ألا يرمي");
        let _ = fs::remove_dir_all(&d);
    }
}
