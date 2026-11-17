//! Pure Rust core for the invoice audit desktop app.
//!
//! The crate owns classification, field extraction, the six audit checks,
//! draft generation and dataset access. The Tauri layer only adds commands
//! and persistence.

pub mod audit;
pub mod catalog;
pub mod classify;
pub mod data;
pub mod draft;
pub mod extract;
pub mod model;
pub mod money;
pub mod session;

pub use audit::{
    checks_meta, context, run_audit, Application, AuditResult, Check, Evidence, EvidenceRow,
    PoolEntry,
};
pub use classify::{classify, Classification};
pub use data::{dataset, Rules};
pub use draft::{build_draft, Draft};
pub use extract::{extract_fields, FieldExtraction};
pub use model::*;
pub use money::{fmt_money, round2};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditOutcome {
    pub audit: AuditResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft: Option<Draft>,
}

/// Run the full audit and, when it passes, attach a draft.
pub fn audit_application(
    application: &Application,
    pool: &[PoolEntry],
    operator: &str,
    rule_mode: &str,
) -> AuditOutcome {
    let rules = Rules::from_dataset(dataset());
    let audit = run_audit(application, &rules, pool, operator, rule_mode);
    let draft = build_draft(application, &rules, &audit);
    AuditOutcome { audit, draft }
}
