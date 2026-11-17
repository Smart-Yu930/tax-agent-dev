use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// A line item on an invoice, contract, acceptance or delivery note.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub spec: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub qty: Option<f64>,
    #[serde(default)]
    pub unit_price: Option<f64>,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub tax_rate: Option<String>,
    #[serde(default)]
    pub tax_amount: Option<f64>,
    #[serde(default)]
    pub extra: Value,
    #[serde(default)]
    pub loc: String,
}

impl Item {
    pub fn extra_text(&self, key: &str) -> String {
        self.extra
            .get(key)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    }
}

/// A field extracted from a source document, with its traceable location.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedField {
    #[serde(default)]
    pub key: Option<String>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub loc: Option<String>,
    #[serde(default, rename = "field_source")]
    pub field_source: Option<String>,
}

impl ExtractedField {
    pub fn value_text(&self) -> String {
        match &self.value {
            Value::Null => String::new(),
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }
    }

    pub fn loc_text(&self) -> String {
        self.loc.clone().unwrap_or_default()
    }
}

/// One of the 175 source documents in the case dataset.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    #[serde(default)]
    pub idx: Option<i64>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub doc_type: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub doc_type_raw: String,
    #[serde(default)]
    pub doc_date: String,
    #[serde(default)]
    pub party: String,
    #[serde(default)]
    pub party_role: String,
    #[serde(default)]
    pub party_tax_no: Option<String>,
    #[serde(default)]
    pub self_name: String,
    #[serde(default)]
    pub self_tax_no: String,
    #[serde(default)]
    pub amount_ex_tax: Option<f64>,
    #[serde(default)]
    pub tax_amount: Option<f64>,
    #[serde(default)]
    pub amount_total: Option<f64>,
    #[serde(default)]
    pub amount_in_words: Option<String>,
    #[serde(default)]
    pub tax_rate: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub invoice_code: Option<String>,
    #[serde(default)]
    pub invoice_no: Option<String>,
    #[serde(default)]
    pub check_code: Option<String>,
    #[serde(default)]
    pub contract_no: Option<String>,
    #[serde(default)]
    pub remark: Option<String>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub terms: BTreeMap<String, Value>,
    #[serde(default)]
    pub totals: BTreeMap<String, Value>,
    #[serde(default)]
    pub footers: BTreeMap<String, Value>,
    #[serde(default)]
    pub fields: Vec<ExtractedField>,
    #[serde(default)]
    pub apply_date: Option<String>,
}

impl Document {
    pub fn field_by_label(&self, labels: &[&str]) -> Option<&ExtractedField> {
        self.fields.iter().find(|f| {
            labels
                .iter()
                .any(|l| f.label.trim() == *l || f.label.contains(l))
        })
    }

    pub fn field_text(&self, labels: &[&str]) -> Option<String> {
        self.field_by_label(labels)
            .map(|f| f.value_text().trim().to_string())
            .filter(|v| !v.is_empty())
    }

    pub fn field_loc(&self, labels: &[&str]) -> String {
        self.field_by_label(labels)
            .map(|f| f.loc_text())
            .unwrap_or_default()
    }

    pub fn has_label_keyword(&self, keywords: &[&str]) -> bool {
        self.fields
            .iter()
            .any(|f| keywords.iter().any(|k| f.label.contains(k)))
    }

    pub fn has_field_label(&self, keyword: &str) -> bool {
        self.fields.iter().any(|f| f.label.contains(keyword))
    }

    pub fn party_tax_no_text(&self) -> String {
        self.party_tax_no.clone().unwrap_or_default()
    }

    pub fn display_rate(&self) -> String {
        match &self.tax_rate {
            Some(r) if !r.trim().is_empty() => r.clone(),
            _ => self
                .items
                .iter()
                .find_map(|i| i.tax_rate.clone())
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRefs {
    #[serde(default)]
    pub contract: Option<String>,
    #[serde(default)]
    pub acceptance: Option<String>,
    #[serde(default)]
    pub stock_out: Option<String>,
    #[serde(default)]
    pub delivery_sign: Option<String>,
    #[serde(default)]
    pub docs: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesRow {
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub customer: String,
    #[serde(default)]
    pub qty: Option<f64>,
    #[serde(default)]
    pub unit_price: Option<f64>,
    #[serde(default)]
    pub amount: f64,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub contract_no: Option<String>,
    #[serde(default)]
    pub accept_status: Option<String>,
    #[serde(default)]
    pub evidence: EvidenceRefs,
}

impl SalesRow {
    /// Tax-inclusive amount used for matching: 13% for domestic, 0% for exports.
    pub fn gross_amount(&self) -> f64 {
        let factor = if self.region == "出口" { 1.0 } else { 1.13 };
        crate::money::round2(self.amount * factor)
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KpiRow {
    #[serde(default)]
    pub no: i64,
    #[serde(default)]
    pub item: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub note: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseRow {
    #[serde(default)]
    pub no: String,
    #[serde(default)]
    pub step: String,
    #[serde(default)]
    pub scenario: String,
    #[serde(default)]
    pub input: String,
    #[serde(default)]
    pub expected: String,
    #[serde(default)]
    pub criteria: String,
    #[serde(default)]
    pub score: String,
    #[serde(default)]
    pub task_type: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tables {
    #[serde(default)]
    pub sales: Vec<SalesRow>,
    #[serde(default)]
    pub kpi: Vec<KpiRow>,
    #[serde(default)]
    pub cases: Vec<CaseRow>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    #[serde(default)]
    pub idx: Option<i64>,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub doc_type: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub party: String,
    #[serde(default)]
    pub amount: Option<f64>,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub in_dataset: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyClause {
    #[serde(default)]
    pub no: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub loc: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub dept: String,
    #[serde(default)]
    pub rules: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub clauses: Vec<PolicyClause>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxRateDef {
    #[serde(default)]
    pub rate: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerDef {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tax_no: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeItem {
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocTypeDef {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub role: String,
    #[serde(default, rename = "auditRequired")]
    pub audit_required: bool,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub count: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dict {
    #[serde(default)]
    pub tax_rates: Vec<TaxRateDef>,
    #[serde(default)]
    pub customers: Vec<CustomerDef>,
    #[serde(default)]
    pub scope: Vec<ScopeItem>,
    #[serde(default)]
    pub field_defs: Vec<Value>,
    #[serde(default)]
    pub doc_types: Vec<DocTypeDef>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountStat {
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub ok: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceStat {
    #[serde(default)]
    pub all_fields: i64,
    #[serde(default)]
    pub loc_fields: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppCheck {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDraft {
    #[serde(default)]
    pub draft_no: String,
    #[serde(default)]
    pub invoice_type: String,
    #[serde(default)]
    pub tax_rate: String,
    #[serde(default)]
    pub amount_total: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppRun {
    #[serde(default)]
    pub application_no: String,
    #[serde(default)]
    pub result: String,
    #[serde(default)]
    pub risk_level: String,
    #[serde(default)]
    pub checks: Vec<AppCheck>,
    #[serde(default)]
    pub draft: Option<AppDraft>,
    #[serde(default)]
    pub summary: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceDetails {
    #[serde(default)]
    pub classification: CountStat,
    #[serde(default)]
    pub field_extraction: CountStat,
    #[serde(default)]
    pub traceability: TraceStat,
    #[serde(default)]
    pub applications: Vec<AppRun>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricRow {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub value: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub pass: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptanceReport {
    #[serde(default)]
    pub generated_at: String,
    #[serde(default)]
    pub all_pass: bool,
    #[serde(default)]
    pub metrics: Vec<MetricRow>,
    #[serde(default)]
    pub details: AcceptanceDetails,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reconcile {
    #[serde(default)]
    pub exceptions: i64,
    #[serde(default)]
    pub parse_warnings: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    #[serde(default)]
    pub level: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataQuality {
    #[serde(default)]
    pub doc_count: i64,
    #[serde(default)]
    pub ledger_count: i64,
    #[serde(default)]
    pub reconcile: Reconcile,
    #[serde(default)]
    pub findings: Vec<Finding>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    #[serde(default)]
    pub case: String,
    #[serde(default)]
    pub period: String,
    #[serde(default)]
    pub company: String,
    #[serde(default)]
    pub self_tax_no: String,
    #[serde(default)]
    pub project: String,
    #[serde(default)]
    pub dataset: String,
    #[serde(default)]
    pub doc_count: i64,
    #[serde(default)]
    pub table_count: i64,
    #[serde(default)]
    pub case_count: i64,
    #[serde(default)]
    pub generated_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dataset {
    #[serde(default)]
    pub meta: Meta,
    #[serde(default)]
    pub documents: Vec<Document>,
    #[serde(default)]
    pub ledger: Vec<LedgerRow>,
    #[serde(default)]
    pub tables: Tables,
    #[serde(default)]
    pub dict: Dict,
    #[serde(default)]
    pub policies: Vec<Policy>,
    #[serde(default)]
    pub acceptance: Option<AcceptanceReport>,
    #[serde(default)]
    pub data_quality: Option<DataQuality>,
}

impl Dataset {
    pub fn doc_by_id(&self, id: &str) -> Option<Document> {
        self.documents.iter().find(|d| d.id == id).cloned()
    }
}
