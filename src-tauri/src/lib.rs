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
/// **مثبَّت صراحةً ولا يُشتق من معرّف الحزمة.** كان المعرّف مؤقتًا
/// (`dev.luma.app`) واستُبدل في المرحلة ٨ بـ`com.sultanart.luma`
/// ([ADR ٠٠١٤](../../docs/decisions/0014-bundle-identifier.md)) — ولو
/// كان المسار مشتقًّا منه لضاعت بيانات كل من كتب قبل الاستبدال.
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

/// رقم المرحلة التي يُنسب إليها التقرير — `LUMA_PHASE=7`. أداة تطوير.
///
/// كان مثبَّتًا في الواجهة، فحمل ملف أدلة المرحلة السادسة الرقم «٥».
#[tauri::command]
fn selftest_phase() -> String {
    std::env::var("LUMA_PHASE").unwrap_or_default()
}

/// وضع المعرض — `LUMA_GALLERY=1`. أداة تطوير.
#[tauri::command]
fn gallery_mode() -> bool {
    std::env::var("LUMA_GALLERY").is_ok_and(|v| v == "1")
}

/// لحظة بدء العملية — مرساة «زمن الفتح حتى مؤشر قابل للكتابة».
///
/// القياس من داخل نافذة العرض وحدها يبدأ بعد إقلاع العملية وتهيئة
/// النافذة، فيقيس نصف الطريق. `Instant` هنا يُلتقط في أول سطر من
/// `run()`، فيصير الرقمُ ما يشعر به المستخدم فعلًا: من النقر على
/// الأيقونة إلى مؤشر يقبل الحرف.
static STARTED_AT: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

/// المنقضي بالمللي منذ بدء العملية. أداة قياس.
#[tauri::command]
fn startup_elapsed_ms() -> f64 {
    STARTED_AT
        .get()
        .map(|t| t.elapsed().as_secs_f64() * 1000.0)
        .unwrap_or(-1.0)
}

/// الذاكرة المقيمة للعملية بالكيلوبايت، أو `None` إن تعذّر القياس.
///
/// `performance.memory` غير موجود في WebKit، ولا يقيس عملية النواة
/// أصلًا. و«الذاكرة في جلسة ممتدة» ميزانيةُ **العملية** لا الكومة —
/// فتُقرأ من النظام. `ps` كافٍ ولا يجرّ اعتمادية.
#[tauri::command]
fn memory_rss_kb() -> Option<u64> {
    let out = std::process::Command::new("/bin/ps")
        .args(["-o", "rss=", "-p", &std::process::id().to_string()])
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

/// الواجهة رفضت الإغلاق لأن الحفظ لم ينجح — يُفتح المزلاج من جديد.
///
/// بدونه: أول محاولة إغلاق تُمنع وتُبثّ، والواجهة ترفض الهدم لأن
/// النص لم يصل القرص، ثم **المحاولة الثانية تمرّ بلا حفظ** لأن
/// المزلاج بقي مغلقًا — فيُغلق التطبيق على نصّ ضائع. الفتح هنا يجعل
/// كل محاولة تمرّ بالحفظ وتُبلّغ من جديد (§٥ **ثابت**: «فرصة استرجاع
/// صريحة»).
///
/// **والمخرج ليس هنا.** ⌘Q يبثّ `luma://flush-and-close` نفسه (انظر
/// `on_menu_event`)، فلا هو ولا الزر الأحمر ولا ⌘W بابٌ يلتفّ على
/// الرفض — وفتحُ المزلاج هنا يجعلها كلها تُرفض من جديد. ولولا حدٌّ في
/// الواجهة لكان الإنهاء القسري المخرجَ الوحيد، وهو يقتل النسخة الوحيدة
/// من النص: الخسارة عينها التي وُضع الرفض ليمنعها. **والحدّ في
/// `App.svelte`:** يُرفض مرةً ويُقال للكاتب ثمنُ الإصرار، ثم يُحترم.
#[tauri::command]
fn close_declined() {
    CLOSING.store(false, std::sync::atomic::Ordering::SeqCst);
    EXITING.store(false, std::sync::atomic::Ordering::SeqCst);
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

    // «إنهاء Luma» بند بمعرّف لا `PredefinedMenuItem::quit` — **وهذا
    // هو ما يجعل ⌘Q يحفظ**.
    //
    // البند المعرَّف مسبقًا يرسل `terminate:` إلى `NSApplication`
    // (`muda`: `Quit => sel!(terminate:)`)، ولا يعترضه أحد: لا
    // `applicationShouldTerminate:` في tao ولا wry ولا tauri. فيمضي
    // إلى `applicationWillTerminate:` ثم `AppState::exit()` ثم
    // `Event::LoopDestroyed` — وهذا يصل إلينا **`RunEvent::Exit`**، وهي
    // ذراع لا تُمنع ولا تُؤجَّل، فتموت العملية على نصٍّ لم يصل القرص.
    //
    // قِيس داخل `Luma.app`: عند الإنهاء ظهر `Exit` وحده — لا
    // `ExitRequested` ولا `CloseRequested` ولا `Destroyed`. أي أن
    // اعتراض `ExitRequested` (أدناه) لم يكن يقع على هذا المسار أصلًا.
    //
    // البند بمعرّف يمرّ بـ`on_menu_event` بدله، فيسلك طريق الحفظ نفسه
    // الذي يسلكه إغلاق النافذة.
    let quit_item = MenuItem::with_id(app, "quit", "إنهاء Luma", true, Some("CmdOrCtrl+Q"))?;

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
        .item(&quit_item)
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

/// ومزلاج ثانٍ لطلب خروجٍ يبلغنا فعلًا — هدمُ آخر نافذة.
///
/// ⌘Q لا يمرّ من هنا: مساره `terminate:` ولا يقع عليه `ExitRequested`
/// إطلاقًا (قِيس — الشرح عند بناء بند «إنهاء Luma»). لذلك صار البند
/// معرَّفًا يمرّ بـ`on_menu_event`.
static EXITING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// **الواجهة جاهزة لاستقبال `luma://flush-and-close`.**
///
/// الحدث لا يُخزَّن لمستمع متأخر: البثّ إلى نافذة لم تسجّل مستمعًا بعدُ
/// يسقط صامتًا ويعود بـ`Ok(())`. وكان طلبُ إغلاق يقع قبل أن تسجّل
/// الواجهة مستمعها **يحرق المزلاج**: يُمنع الإغلاق ولا يصل الطلب أحدًا،
/// فلا التطبيق يُغلق ولا المزلاج يُفتح — وأول إغلاق حقيقي بعده يهدم
/// النافذة بلا حفظ.
///
/// والحلّ أن يُقاس أمرٌ واحد: هل ثمّة من يستقبل؟ فإن لم يكن، **لا يُمنع
/// الإغلاق ولا يُستهلك المزلاج** — ولا شيء يُفقد لأن الجلسة لم تُنشأ
/// بعد ولا بُفر لها.
static UI_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// تُعلنها الواجهة بعد إنشاء الجلسة وتسجيل مستمعي النواة.
#[tauri::command]
fn ui_ready() {
    UI_READY.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// قرار منع الإغلاق — دالة خالصة ليُختبَر ما لا تشغّله أي حزمة فحص.
///
/// `ready`: سجّلت الواجهة مستمعها · `latch_taken`: المزلاج مستهلَك
/// سلفًا · `has_windows`: بقيت نافذة تُبثّ إليها.
fn should_defer_close(ready: bool, latch_taken: bool, has_windows: bool) -> bool {
    ready && !latch_taken && has_windows
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = STARTED_AT.set(std::time::Instant::now());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            data_dir,
            window_controls_x,
            demo_mode,
            demo_stage,
            selftest_mode,
            selftest_phase,
            gallery_mode,
            write_report,
            startup_elapsed_ms,
            memory_rss_kb,
            close_declined,
            ui_ready,
            commands::seed_library,
            commands::open_project_page,
            commands::save_document,
            commands::load_document,
            commands::list_documents,
            commands::delete_document,
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
            } else if id == "quit" {
                // ⌘Q يسلك طريق الحفظ نفسه الذي يسلكه إغلاق النافذة:
                // تُفرغ الواجهة ما لديها ثم تهدم نافذتها، فيخرج
                // التطبيق من تلقائه حين لا تبقى نافذة.
                //
                // وإن لم تكن جاهزة بعدُ فلا شيء يُفرَغ — ولا يُترك
                // المستخدم أمام اختصارٍ لا يفعل شيئًا.
                if UI_READY.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = app.emit("luma://flush-and-close", ());
                } else {
                    app.exit(0);
                }
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
                    let ready = UI_READY.load(std::sync::atomic::Ordering::SeqCst)
                        && !window
                            .state::<commands::Storage>()
                            .root
                            .as_os_str()
                            .is_empty();
                    // المزلاج لا يُستهلك إلا إذا كان ثمّة من يستقبل
                    if ready && !CLOSING.swap(true, std::sync::atomic::Ordering::SeqCst) {
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
        .build(tauri::generate_context!())
        .expect("تعذّر تشغيل Luma")
        .run(|app, event| {
            // **⌘Q يمرّ بالحفظ كما يمرّ إغلاق النافذة.**
            //
            // `terminate:` لا يقع عليه `CloseRequested`، فيلزم اعتراضه
            // هنا. النمط نفسه: يُمنع الخروج مرة، وتُخطَر الواجهة
            // لتُفرغ ما لديها، ثم تُنهي هي — أو ترفض وتُبلّغ وتفتح
            // المزلاج (§٥ **ثابت**: فرصة استرجاع صريحة).
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // **لا يُمنع خروجٌ لا نافذة فيه.** بعد أن تُفرغ الواجهة
                // وتهدم نافذتها يطلب Tauri الخروج من جديد؛ ومنعُه
                // عندئذٍ يبثّ حدثًا إلى نافذة لم تعد موجودة، فيعلق
                // التطبيق حيًّا بلا واجهة ولا يخرج أبدًا.
                //
                // وخروجٌ طلبه الكود (`code` موجود) يمضي بلا اعتراض.
                // القراءة قبل الاستهلاك: `swap` كوسيطٍ يُنفَّذ دائمًا،
                // فيحرق المزلاج ولو لم يكن ثمّة من يستقبل.
                let defer = code.is_none()
                    && should_defer_close(
                        UI_READY.load(std::sync::atomic::Ordering::SeqCst),
                        EXITING.load(std::sync::atomic::Ordering::SeqCst),
                        !app.webview_windows().is_empty(),
                    );
                if defer && !EXITING.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit("luma://flush-and-close", ());
                }
            }
        });
}

#[cfg(test)]
mod close_guards {
    use super::should_defer_close;

    /// المزلاج لا يُحرق قبل أن يوجد من يستقبل — العطل الذي وقع.
    #[test]
    fn no_deferral_before_the_ui_can_receive() {
        assert!(!should_defer_close(false, false, true));
    }

    /// وإن كان ثمّة من يستقبل، يُؤجَّل الإغلاق مرة واحدة.
    #[test]
    fn defers_once_when_ready() {
        assert!(should_defer_close(true, false, true));
        assert!(!should_defer_close(true, true, true));
    }

    /// **لا يُمنع خروجٌ لا نافذة فيه**: البثّ إلى نافذة مهدومة يعلّق
    /// التطبيق حيًّا بلا واجهة.
    #[test]
    fn never_defers_a_windowless_exit() {
        assert!(!should_defer_close(true, false, false));
    }

    /// **حارس انحدار**: بند «إنهاء Luma» المعرَّف مسبقًا يرسل
    /// `terminate:` فيصل `RunEvent::Exit` — ذراعٌ لا تُمنع — فيموت
    /// التطبيق على نصٍّ لم يصل القرص. قِيس داخل `Luma.app`.
    #[test]
    fn quit_is_an_identified_item_not_a_predefined_one() {
        let src = include_str!("lib.rs");
        let code = src.split("#[cfg(test)]").next().unwrap_or(src);
        let code: String = code
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        assert!(
            !code.contains("PredefinedMenuItem::quit"),
            "بند الإنهاء المعرَّف مسبقًا يتجاوز الحفظ — يلزم بند بمعرّف يمرّ بـon_menu_event"
        );
        assert!(
            code.contains(r#"MenuItem::with_id(app, "quit""#),
            "بند الإنهاء بمعرّف مفقود"
        );
    }
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
        // لا المؤقت ولا النهائي: القاعدة أن المسار **لا يُشتق** من
        // المعرّف أصلًا، لا أن يتجنّب قيمة بعينها.
        for id in ["dev.luma.app", "com.sultanart.luma"] {
            assert!(
                !s.contains(id),
                "المسار يجب ألا يُشتق من معرّف الحزمة ({id}): {s}"
            );
        }
        assert!(
            s.contains("Application Support"),
            "المسار خارج المكان المتوقع: {s}"
        );
    }
}
