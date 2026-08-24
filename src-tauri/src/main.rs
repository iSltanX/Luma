// يمنع فتح نافذة طرفية إضافية على Windows في وضع الإصدار.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    luma_lib::run()
}
