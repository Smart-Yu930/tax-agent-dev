//! Key-field extraction with a traceable source location for every value.

use crate::model::{Document, ExtractedField};
use crate::money::fmt_money;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedValue {
    pub key: String,
    pub label: String,
    pub doc_key: String,
    pub value: Value,
    pub display: String,
    pub doc_id: String,
    pub doc_type: String,
    pub trace: String,
    pub loc: String,
    pub field_source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldExtraction {
    pub fields: Vec<ExtractedValue>,
    pub coverage: f64,
    pub total_fields: usize,
    pub with_loc: usize,
}

const KEY_FIELDS: [(&str, &str, &str, &[&str]); 7] = [
    (
        "party",
        "购买方名称",
        "party",
        &["购买方名称", "买方", "往来单位", "卖方名称"],
    ),
    (
        "partyTaxNo",
        "纳税人识别号",
        "partyTaxNo",
        &["纳税人识别号"],
    ),
    ("amountExTax", "不含税金额", "amountExTax", &["不含税金额"]),
    ("taxAmount", "税额", "taxAmount", &["税额"]),
    (
        "amountTotal",
        "价税合计",
        "amountTotal",
        &["价税合计", "价税合计/业务金额"],
    ),
    ("taxRate", "税率", "taxRate", &["税率"]),
    ("docDate", "单据日期", "docDate", &["开票日期", "业务日期"]),
];

fn locate(doc: &Document, key: &str, labels: &[&str]) -> Option<String> {
    if let Some(f) = doc.fields.iter().find(|f| f.key.as_deref() == Some(key)) {
        return f.loc.clone();
    }
    if let Some(f) = doc
        .fields
        .iter()
        .find(|f| labels.iter().any(|l| f.label == *l))
    {
        return f.loc.clone();
    }
    None
}

fn raw_value(doc: &Document, key: &str) -> Option<Value> {
    match key {
        "party" => (!doc.party.is_empty()).then(|| Value::String(doc.party.clone())),
        "partyTaxNo" => doc
            .party_tax_no
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| Value::String(s.clone())),
        "amountExTax" => doc.amount_ex_tax.map(|v| Value::from(v)),
        "taxAmount" => doc.tax_amount.map(|v| Value::from(v)),
        "amountTotal" => doc.amount_total.map(|v| Value::from(v)),
        "taxRate" => doc
            .tax_rate
            .as_ref()
            .filter(|s| !s.is_empty())
            .map(|s| Value::String(s.clone())),
        "docDate" => (!doc.doc_date.is_empty()).then(|| Value::String(doc.doc_date.clone())),
        _ => None,
    }
}

pub fn extract_fields(doc: &Document) -> FieldExtraction {
    let mut out = Vec::new();
    for (key, label, doc_key, labels) in KEY_FIELDS {
        let Some(value) = raw_value(doc, doc_key) else {
            continue;
        };
        let loc = locate(doc, key, labels).unwrap_or_else(|| "原文".to_string());
        let display = match &value {
            Value::Number(n) => fmt_money(n.as_f64()),
            Value::String(s) => s.clone(),
            Value::Null => "—".to_string(),
            other => other.to_string(),
        };
        out.push(ExtractedValue {
            key: key.to_string(),
            label: label.to_string(),
            doc_key: doc_key.to_string(),
            value,
            display,
            doc_id: doc.id.clone(),
            doc_type: doc.doc_type.clone(),
            trace: format!("{} · {} · {}", doc.id, doc.doc_type, loc),
            loc,
            field_source: "rule".to_string(),
        });
    }
    let total_fields = doc.fields.len();
    let with_loc = doc
        .fields
        .iter()
        .filter(|f: &&ExtractedField| f.loc.as_deref().map(|l| !l.is_empty()).unwrap_or(false))
        .count();
    FieldExtraction {
        fields: out,
        coverage: if total_fields == 0 {
            1.0
        } else {
            with_loc as f64 / total_fields as f64
        },
        total_fields,
        with_loc,
    }
}
