//! Mutable session state persisted as JSON in the app data directory.

use crate::audit::{Application, AuditResult, Check, Evidence};
use crate::draft::Draft;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedInvoice {
    pub id: String,
    pub invoice_no: String,
    pub invoice_type: String,
    pub buyer_name: String,
    pub buyer_tax_no: String,
    pub goods: String,
    pub amount_total: f64,
    pub tax_rate: String,
    pub issued_at: String,
    pub contract_id: String,
    pub source: String,
    /// "session" for invoices issued in this app, "document" for dataset samples.
    pub pool_kind: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub at: String,
    pub actor: String,
    pub action: String,
    pub target: String,
    pub detail: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedRecord {
    pub id: String,
    pub application_no: String,
    pub buyer: String,
    pub product: String,
    pub amount_total: Option<f64>,
    pub result: String,
    pub summary: String,
    pub audited_at: String,
    pub checks: Vec<Check>,
    pub evidence: Vec<Evidence>,
    pub application: Application,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    pub invoice: u32,
    pub draft: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionState {
    #[serde(default)]
    pub drafts: Vec<Draft>,
    #[serde(default)]
    pub invoices: Vec<IssuedInvoice>,
    #[serde(default)]
    pub rejected: Vec<RejectedRecord>,
    #[serde(default)]
    pub logs: Vec<LogEntry>,
    #[serde(default)]
    pub seq: Sequence,
}

impl SessionState {
    pub fn log(&mut self, actor: &str, action: &str, target: &str, detail: &str) {
        let now = chrono::Local::now();
        let entry = LogEntry {
            id: format!("LOG-{}", now.timestamp_millis()),
            at: now.format("%Y-%m-%d %H:%M:%S").to_string(),
            actor: actor.to_string(),
            action: action.to_string(),
            target: target.to_string(),
            detail: detail.to_string(),
        };
        self.logs.insert(0, entry);
        self.logs.truncate(200);
    }

    pub fn next_invoice_no(&mut self) -> String {
        self.seq.invoice += 1;
        format!("FP-SESSION-{:03}", self.seq.invoice)
    }

    pub fn upsert_rejected(&mut self, result: &AuditResult, application: &Application) {
        if result.result == "pass" {
            self.rejected
                .retain(|r| r.application_no != result.application_no);
            return;
        }
        let buyer = crate::audit::context(application)
            .contract
            .as_ref()
            .map(|c| c.party.clone())
            .unwrap_or_default();
        let product = crate::audit::context(application)
            .contract
            .as_ref()
            .and_then(|c| c.items.first())
            .map(|i| i.name.clone())
            .unwrap_or_default();
        let record = RejectedRecord {
            id: format!("REJ-{}", result.application_no),
            application_no: result.application_no.clone(),
            buyer,
            product,
            amount_total: application.declared_amount,
            result: result.result.clone(),
            summary: result.summary.clone(),
            audited_at: result.audited_at.clone(),
            checks: result
                .checks
                .iter()
                .filter(|c| c.status == "fail" || c.status == "suspend")
                .cloned()
                .collect(),
            evidence: result
                .evidence_table
                .iter()
                .take(4)
                .map(|e| Evidence {
                    doc_id: e.doc_id.clone(),
                    doc_type: e.doc_type.clone(),
                    doc_date: String::new(),
                    field: e.field.clone(),
                    value: e.value.clone(),
                    loc: e.loc.clone(),
                })
                .collect(),
            application: application.clone(),
        };
        if let Some(existing) = self
            .rejected
            .iter_mut()
            .find(|r| r.application_no == result.application_no)
        {
            *existing = record;
        } else {
            self.rejected.insert(0, record);
            self.rejected.truncate(50);
        }
    }
}

pub fn load(path: &std::path::Path) -> SessionState {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &std::path::Path, state: &SessionState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(path, body).map_err(|e| e.to_string())
}
