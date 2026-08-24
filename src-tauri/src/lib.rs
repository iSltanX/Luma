//! نواة Luma الأصلية.
//!
//! مسؤوليتها: تهيئة النافذة، والقائمة الأصلية، وتثبيت مسار التخزين،
//! وإبلاغ الواجهة بما لا تراه من طبقة النظام — مثل الجانب الذي يضع
//! فيه macOS أزرار النافذة.

pub mod commands;
pub mod fonts;
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

/// إحداثي **س** لزر إغلاق النافذة داخل النافذة، أو `None` إن تعذّر قياسه.
///
/// [ADR ٠٠٠٣](../../docs/decisions/0003-macos-rtl-window-chrome.md) ألزم
/// المرحلة ٥ بهذا: الحشوة المحجوزة في شريط النافذة تتبع **جانب الأزرار
/// الفعلي كما يقرره النظام**، لا اتجاه محتوى التطبيق. محتوى Luma دائمًا
/// RTL فطرفه المنطقي `end` هو اليسار دائمًا — وعلى نظام إنجليزي يضع
/// macOS الأزرار يسارًا أيضًا، فتقع حالة الحفظ فوقها.
///
/// **يُقاس الزر نفسه ولا يُستنتج الجانب من اللغة.** جُرِّب استنتاجه من
/// `NSApplication.userInterfaceLayoutDirection` فأعطى «يسار» على جهاز
/// نظامه عربي تقع فيه أزرار Luma يمينًا فعلًا — لأن الخاصية تُشتق من
/// لغات الحزمة لا من لغة النظام. القياس لا يخطئ في هذا.
///
/// الواجهة تقارنه بعرضها: نافذة العرض تملأ النافذة (`titleBarStyle:
/// Overlay`) فوحدة القياس واحدة في الطرفين.
#[cfg(target_os = "macos")]
#[tauri::command]
fn window_controls_x(window: tauri::Window) -> Option<f64> {
    use std::ffi::{c_char, c_void, CString};

    /// `NSWindowButton.closeButton`
    const CLOSE_BUTTON: isize = 0;

    /// `NSPoint` — بنية ١٦ بايت من عددين عشريين.
    ///
    /// حجمها هو ما يجعلها آمنة عبر `objc_msgSend` الخام: تمرّ في
    /// المسجّلات على معماريتَي Mac كلتيهما. `NSRect` (٣٢ بايت) تعود
    /// بآليتين مختلفتين وتحتاج `objc_msgSend_stret` على إحداهما،
    /// ولذلك يُقاس نقطةً لا مستطيلًا.
    #[repr(C)]
    #[derive(Clone, Copy)]
    struct NsPoint {
        x: f64,
        y: f64,
    }

    extern "C" {
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        fn objc_msgSend();
    }

    type SendButton = unsafe extern "C" fn(*mut c_void, *mut c_void, isize) -> *mut c_void;
    type SendPoint =
        unsafe extern "C" fn(*mut c_void, *mut c_void, NsPoint, *mut c_void) -> NsPoint;

    let ns_window = window.ns_window().ok()?;
    if ns_window.is_null() {
        return None;
    }
    let standard_button = CString::new("standardWindowButton:").ok()?;
    let convert = CString::new("convertPoint:toView:").ok()?;

    // SAFETY: محدِّدان ثابتان من AppKit بتوقيعين مطابقين لما تعلنه:
    // الأول يأخذ `NSWindowButton` ويعيد `NSButton*`، والثاني يأخذ
    // `NSPoint` و`NSView*` ويعيد `NSPoint`. المستقبِل نافذة حيّة
    // تملكها Tauri، والتحويل إلى `nil` يعني إحداثيات النافذة.
    unsafe {
        let send_button: SendButton = std::mem::transmute(objc_msgSend as *const ());
        let button = send_button(
            ns_window.cast(),
            sel_registerName(standard_button.as_ptr()),
            CLOSE_BUTTON,
        );
        if button.is_null() {
            return None;
        }
        let send_point: SendPoint = std::mem::transmute(objc_msgSend as *const ());
        let origin = send_point(
            button,
            sel_registerName(convert.as_ptr()),
            NsPoint { x: 0.0, y: 0.0 },
            std::ptr::null_mut(),
        );
        Some(origin.x)
    }
}

/// خارج macOS لا يرسم النظام أزرارًا فوق واجهة Luma.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn window_controls_x(_window: tauri::Window) -> Option<f64> {
    None
}

/// وضع عرض بصري للتحقق اليدوي: مستند محمَّل وتركيز مفعَّل.
/// يُضبط بـ`LUMA_DEMO=1`. أداة مرحلة ١ فقط.
#[tauri::command]
fn demo_mode() -> bool {
    std::env::var("LUMA_DEMO").is_ok_and(|v| v == "1")
}

/// مشهد عرض بصري يُطلب بالاسم — `LUMA_STAGE=library` مثلًا. أداة تطوير.
///
/// موجود لأن لا WebDriver لـWKWebView على macOS، ولأن الوصول المساعد
/// (الذي تحتاجه الأتمتة لإرسال نقرة) صلاحية يمنحها المستخدم لا الكود.
/// فتُفتح اللوحة من داخل التطبيق لتُلتقط صورتها. **لا يغني عن التجربة
/// اليدوية بالماوس ولوحة المفاتيح** — تلك بند تحقق يدوي.
#[tauri::command]
fn demo_stage() -> String {
    std::env::var("LUMA_STAGE").unwrap_or_default()
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
    // «الإعدادات… ⌘,» في قائمة التطبيق — العُرف الأصلي في macOS.
    // شاشة الإعدادات كاملة في التصميم بلا مدخل مرسوم لها في المحرر:
    // مدخلها هو مدخل النظام، ولا يُخترع زرّ ثالث في شريط هادئ.
    let settings_item = MenuItem::with_id(app, "settings", "الإعدادات…", true, Some("CmdOrCtrl+,"))?;

    let app_menu = SubmenuBuilder::new(app, "Luma")
        .item(&PredefinedMenuItem::about(
            app,
            Some("عن Luma"),
            Some(AboutMetadata::default()),
        )?)
        .separator()
        .item(&settings_item)
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            data_dir,
            window_controls_x,
            demo_mode,
            demo_stage,
            selftest_mode,
            gallery_mode,
            write_report,
            commands::save_document,
            commands::load_document,
            commands::list_documents,
            commands::most_recent_document,
            commands::cleanup_selftest,
            commands::list_fonts,
            commands::pick_and_import_font,
            commands::list_revisions,
            commands::load_revision,
            commands::restore_revision,
            commands::load_preferences,
            commands::save_preferences
        ])
        .on_menu_event(|app, event| {
            // القص والنسخ واللصق والتحديد تبقى للنظام؛ هذه وحدها تُبثّ.
            let id = event.id().0.as_str();
            if matches!(id, "undo" | "redo" | "settings") {
                let _ = app.emit("luma://menu", id);
            }
        })
        .setup(|app| {
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;

            let root =
                luma_data_dir().ok_or_else(|| std::io::Error::other("تعذّر تحديد مجلد البيانات"))?;
            std::fs::create_dir_all(&root)?;
            // **إعادة إتاحة الخطوط المستوردة عند كل إقلاع** — §٨.
            // التسجيل في نطاق العملية يموت بإغلاقها، فيُعاد هنا قبل
            // أن ترسم الواجهة أول حرف بخطٍّ اختاره المستخدم.
            let registered = fonts::register_all(&root);
            if registered > 0 {
                eprintln!("[luma] أُعيدت إتاحة {registered} خطًّا مستوردًا");
            }

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
