//! الهجرة بين إصدارات بنية البيانات — §١٨.
//!
//! «تُثبَّت قبل أول تغيير في المخطط.» موجودة من أول يوم وهي بلا خطوات
//! بعد: وجود المسار مختبَرًا قبل الحاجة إليه هو الغرض. إضافته بعد شحن
//! ملفات بلا إصدار تعني بيانات لا يمكن تمييزها.
//!
//! **قاعدة:** كل خطوة هجرة تحوّل من إصدار إلى الذي يليه فقط، وتُختبر
//! على عيّنة حقيقية قبل أن تُشحن.

use serde_json::Value;

use super::model::SCHEMA_VERSION;

type StepResult = std::result::Result<Value, String>;

/// يرفع مستندًا من إصداره إلى الإصدار الحالي، خطوة خطوة.
pub fn to_current(mut value: Value, from: u32) -> StepResult {
    let mut version = from;
    while version < SCHEMA_VERSION {
        value = step(value, version)?;
        version += 1;
    }
    if let Some(obj) = value.as_object_mut() {
        obj.insert("schemaVersion".into(), Value::from(SCHEMA_VERSION));
    }
    Ok(value)
}

/// خطوة واحدة: من `version` إلى `version + 1`.
///
/// عند إضافة الإصدار ٢ تُضاف ذراع `1 => migrate_1_to_2(value)` هنا،
/// ويُكتب لها اختبار على عيّنة حقيقية قبل الشحن.
fn step(_value: Value, version: u32) -> StepResult {
    Err(format!("لا مسار هجرة من الإصدار {version}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_version_passes_through_unchanged() {
        let v: Value = serde_json::from_str(
            r#"{"schemaVersion":1,"id":"a","blocks":[],"createdAt":0,"updatedAt":0,"lastOpenedAt":0}"#,
        )
        .unwrap();
        let out = to_current(v.clone(), 1).unwrap();
        assert_eq!(out["id"], v["id"]);
        assert_eq!(out["schemaVersion"], 1);
    }

    #[test]
    fn stamps_schema_version_when_absent() {
        let v: Value = serde_json::from_str(
            r#"{"id":"a","blocks":[],"createdAt":0,"updatedAt":0,"lastOpenedAt":0}"#,
        )
        .unwrap();
        let out = to_current(v, 1).unwrap();
        assert_eq!(out["schemaVersion"], SCHEMA_VERSION);
    }

    #[test]
    fn unknown_older_version_fails_loudly() {
        // إصدار ٠ لا مسار له: يُبلَّغ ولا يُخمَّن
        let v: Value = serde_json::from_str(r#"{"id":"a"}"#).unwrap();
        assert!(to_current(v, 0).is_err());
    }
}
