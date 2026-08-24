//! نواة Luma الأصلية.
//!
//! المرحلة ١ — بوابة القدرات. مسؤوليتها هنا محصورة في:
//! تهيئة النافذة، والقائمة الأصلية، وتثبيت مسار التخزين.
//! التخزين والحفظ واللقطات تدخل في المرحلة ٣.

pub mod commands;
pub mod storage;

use std::path::PathBuf;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime, WindowEvent};

/// مسار بيانات Luma.
///
/// **مثبَّت صراحةً ولا يُشتق من معرّف الحزمة.** معرّف الحزمة مؤقت
/// (`dev.luma.app`) ويُستبدل بالنهائي في المرحلة ٨؛ لو كان المسار
/// مشتقًّا منه لضاعت بيانات المستخدم عند الاستبدال.
/// المرجع: `IMPLEMENTATION.md` §٤.
pub fn luma_data_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Luma"),
    )
}

/// يعيد مسار التخزين للواجهة، وينشئه إن لم يكن موجودًا.
#[tauri::command]
fn data_dir() -> Result<String, String> {
    let dir = luma_data_dir().ok_or_else(|| "تعذّر تحديد مجلد المستخدم".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("تعذّر إنشاء مجلد البيانات: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// وضع عرض بصري للتحقق اليدوي: مستند محمَّل وتركيز مفعَّل.
/// يُضبط بـ`LUMA_DEMO=1`. أداة مرحلة ١ فقط.
#[tauri::command]
fn demo_mode() -> bool {
    std::env::var("LUMA_DEMO").is_ok_and(|v| v == "1")
}

/// وضع الفحص الذاتي — يُضبط بـ`LUMA_SELFTEST=1`. أداة تطوير.
#[tauri::command]
fn selftest_mode() -> bool {
    std::env::var("LUMA_SELFTEST").is_ok_and(|v| v == "1")
}

/// وضع المعرض — `LUMA_GALLERY=1`. أداة تطوير.
#[tauri::command]
fn gallery_mode() -> bool {
    std::env::var("LUMA_GALLERY").is_ok_and(|v| v == "1")
}

/// يكتب تقرير الفحص إلى مجلد البيانات. أداة تطوير.
#[tauri::command]
fn write_report(json: String) -> Result<String, String> {
    let dir = luma_data_dir().ok_or_else(|| "تعذّر تحديد مجلد المستخدم".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("تعذّر إنشاء مجلد البيانات: {e}"))?;
    let path = dir.join("selftest-report.json");
    std::fs::write(&path, json).map_err(|e| format!("تعذّرت كتابة التقرير: {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// القائمة الأصلية لـmacOS.
///
/// عناصر «تحرير» القياسية شرط لا زينة: بدونها لا تصل اختصارات
/// التراجع والنسخ واللصق والتحديد إلى مساحة الكتابة داخل نافذة العرض.
/// المرجع: `IMPLEMENTATION.md` §١ — «ما يجب أن يأتي من المنصة».
fn build_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "Luma")
        .item(&PredefinedMenuItem::about(
            app,
            Some("عن Luma"),
            Some(AboutMetadata::default()),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some("الخدمات"))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some("إخفاء Luma"))?)
        .item(&PredefinedMenuItem::hide_others(app, Some("إخفاء الآخرين"))?)
        .item(&PredefinedMenuItem::show_all(app, Some("إظهار الكل"))?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("إنهاء Luma"))?)
        .build()?;

    // التراجع والإعادة **ليسا** عنصرَي نظام.
    //
    // `PredefinedMenuItem::undo` يرسل محدِّد `undo:` إلى نافذة العرض،
    // فيعمل مدير التراجع في WebKit على شجرة يديرها المحرر — فيتنازع
    // مكدّسان على النص الواحد. مكدّس واحد فقط يملك التراجع: مكدّس
    // المحرر. البند يبثّ حدثًا والواجهة تنفّذه.
    // §٧ **ثابت**: «تجميع عمليات التراجع بحسب دفقة الكتابة».
    let undo_item = MenuItem::with_id(app, "undo", "تراجع", true, Some("CmdOrCtrl+Z"))?;
    let redo_item = MenuItem::with_id(app, "redo", "إعادة", true, Some("Shift+CmdOrCtrl+Z"))?;

    let edit_menu = SubmenuBuilder::new(app, "تحرير")
        .item(&undo_item)
        .item(&redo_item)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some("قص"))?)
        .item(&PredefinedMenuItem::copy(app, Some("نسخ"))?)
        .item(&PredefinedMenuItem::paste(app, Some("لصق"))?)
        .item(&PredefinedMenuItem::select_all(app, Some("تحديد الكل"))?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "نافذة")
        .item(&PredefinedMenuItem::minimize(app, Some("تصغير"))?)
        .item(&PredefinedMenuItem::maximize(app, Some("تكبير"))?)
        .separator()
        .item(&PredefinedMenuItem::close_window(
            app,
            Some("إغلاق النافذة"),
        )?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()
}

/// يُمنع الإغلاق مرة واحدة فقط: لو فشل الحفظ لا يعلق المستخدم داخل نافذة.
static CLOSING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_dir,
            demo_mode,
            selftest_mode,
            gallery_mode,
            write_report,
            commands::save_document,
            commands::load_document,
            commands::list_documents,
            commands::most_recent_document,
            commands::list_revisions,
            commands::load_revision,
            commands::restore_revision,
            commands::load_preferences,
            commands::save_preferences
        ])
        .on_menu_event(|app, event| {
            // القص والنسخ واللصق والتحديد تبقى للنظام؛ هذه وحدها تُبثّ.
            let id = event.id().0.as_str();
            if matches!(id, "undo" | "redo") {
                let _ = app.emit("luma://menu", id);
            }
        })
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            let root =
                luma_data_dir().ok_or_else(|| std::io::Error::other("تعذّر تحديد مجلد البيانات"))?;
            std::fs::create_dir_all(&root)?;
            app.manage(commands::Storage { root });

            Ok(())
        })
        .on_window_event(|window, event| {
            // الإغلاق يُؤجَّل حتى تُكتب آخر دفقة.
            //
            // «عند إخفاء النافذة أو الخروج أو تبديل المستند: كتابة
            // فورية» — §٥ **ثابت**. الواجهة تُخطَر لتُفرغ ما لديها،
            // ثم تطلب الإغلاق ثانيةً. النافذة تُمنع مرة واحدة فقط
            // حتى لا يعلق المستخدم إن فشل الحفظ.
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if !window
                        .state::<commands::Storage>()
                        .root
                        .as_os_str()
                        .is_empty()
                        && !CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst)
                    {
                        api.prevent_close();
                        let _ = window.emit("luma://flush-and-close", ());
                    }
                }
                WindowEvent::Focused(false) => {
                    // فقد التركيز محفّز كتابة فورية
                    let _ = window.emit("luma://flush", ());
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("تعذّر تشغيل Luma");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_is_luma_not_bundle_identifier() {
        let dir = luma_data_dir().expect("HOME موجود في بيئة الاختبار");
        // القاعدة: المسار ينتهي بـLuma، ولا يحمل معرّف الحزمة إطلاقًا.
        assert!(dir.ends_with("Luma"), "المسار يجب أن ينتهي بـLuma: {dir:?}");
        let s = dir.to_string_lossy();
        assert!(
            !s.contains("dev.luma.app"),
            "المسار يجب ألا يُشتق من معرّف الحزمة: {s}"
        );
        assert!(
            s.contains("Application Support"),
            "المسار خارج المكان المتوقع: {s}"
        );
    }
}
