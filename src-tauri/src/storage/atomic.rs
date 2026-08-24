//! الكتابة الذرّية — `IMPLEMENTATION.md` §٤ **ثابت**.
//!
//! «كتابة إلى ملف مؤقت ثم استبدال. لا تعديل في مكانه.»
//! و«لا يُستبدل ملف سليم بملف جزئي في أي مسار» — §١٧ مبدأ ٢.

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

/// يكتب البايتات ذرّيًا: ملف مؤقت في **المجلد نفسه**، ثم `fsync`، ثم استبدال.
///
/// المؤقت في المجلد نفسه شرط لا تفصيل: `rename` لا يكون ذرّيًا عبر
/// أنظمة ملفات مختلفة، فملف مؤقت في `/tmp` يُبطل الضمان كله.
///
/// `fsync` على الملف قبل الاستبدال يمنع بقاء محتوى نصف مكتوب بعد
/// انقطاع الكهرباء. و`fsync` على المجلد يجعل الاستبدال نفسه دائمًا.
///
/// عند أي فشل يُحذف المؤقت **ويبقى الملف الأصلي كما هو**.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "مسار بلا مجلد أب"))?;
    fs::create_dir_all(dir)?;

    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("luma");
    let tmp = dir.join(format!(".{name}.{}.tmp", std::process::id()));

    let result = (|| -> io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)?;
        // استدامة الاستبدال نفسه. فشلها لا يُبطل الكتابة.
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// يقرأ ملفًا، ويميّز «غير موجود» عن «تالف» عن «تعذّرت القراءة».
pub fn read_optional(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(b) => Ok(Some(b)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("luma-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn writes_and_reads_back() {
        let d = tmpdir("basic");
        let p = d.join("a.json");
        write_atomic(&p, b"{\"x\":1}").unwrap();
        assert_eq!(fs::read(&p).unwrap(), b"{\"x\":1}");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn replaces_existing_content_completely() {
        let d = tmpdir("replace");
        let p = d.join("a.json");
        write_atomic(&p, "محتوى طويل جدًا يجب أن يختفي كاملًا".as_bytes()).unwrap();
        write_atomic(&p, "قصير".as_bytes()).unwrap();
        // لا بقايا من الكتابة السابقة — الاستبدال لا التعديل في مكانه
        assert_eq!(fs::read(&p).unwrap(), "قصير".as_bytes());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn leaves_no_temp_files_behind() {
        let d = tmpdir("notemp");
        let p = d.join("a.json");
        write_atomic(&p, b"x").unwrap();
        let leftovers: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "بقي ملف مؤقت: {leftovers:?}");
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn failure_keeps_original_intact() {
        let d = tmpdir("keep");
        let p = d.join("a.json");
        write_atomic(&p, "سليم".as_bytes()).unwrap();

        // مسار داخل ملف لا مجلد: الكتابة تفشل حتمًا
        let bad = p.join("nested").join("b.json");
        assert!(write_atomic(&bad, "جزئي".as_bytes()).is_err());

        // الملف السليم لم يُمسّ
        assert_eq!(fs::read(&p).unwrap(), "سليم".as_bytes());
        fs::remove_dir_all(&d).ok();
    }

    #[test]
    fn read_optional_distinguishes_missing_from_error() {
        let d = tmpdir("missing");
        assert!(read_optional(&d.join("nope.json")).unwrap().is_none());
        fs::remove_dir_all(&d).ok();
    }
}
