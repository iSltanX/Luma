//! طبقة التخزين — `IMPLEMENTATION.md` §٤.
//!
//! «الطبقات حدود مسؤولية»: هذه الطبقة لا تعرف الواجهة، ولا تقرر
//! متى يُحفظ. تُنفّذ ما يُطلب منها ذرّيًا، وتُبلّغ بدقة عمّا فشل ولماذا.

pub mod atomic;
pub mod document;
pub mod migrate;
pub mod model;
pub mod prefs;
pub mod revision;
