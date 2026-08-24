//! نواة Luma الأصلية.
//!
//! المرحلة ١ — بوابة القدرات. مسؤوليتها هنا محصورة في:
//! تهيئة النافذة، والقائمة الأصلية، وتثبيت مسار التخزين.
//! التخزين والحفظ واللقطات تدخل في المرحلة ٣.

use std::path::PathBuf;

use tauri::menu::{AboutMetadata, MenuBuilder, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Runtime};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            data_dir,
            demo_mode,
            selftest_mode,
            write_report
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

            // يُنشأ مجلد البيانات عند الإقلاع حتى تكون المرحلة ٣ على أرض ثابتة.
            if let Some(dir) = luma_data_dir() {
                let _ = std::fs::create_dir_all(&dir);
            }

            Ok(())
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
