use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::MutexGuard;
use tauri::State;
use tax_core::audit::{self, Application, PoolEntry};
use tax_core::catalog;
use tax_core::classify::doc_type;
use tax_core::draft::Draft;
use tax_core::session::{IssuedInvoice, SessionState};

fn lock<'a>(state: &'a State<'a, AppState>) -> Result<MutexGuard<'a, SessionState>, String> {
    state.session.lock().map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardRow {
    pub index: usize,
    pub product: String,
    pub date: String,
    pub customer: String,
    pub qty: Option<f64>,
    pub unit_price: Option<f64>,
    pub amount: f64,
    pub gross: f64,
    pub region: String,
    pub contract_no: String,
    pub accept_status: String,
    pub status: String,
    pub status_label: String,
    pub invoice_no: String,
    pub draft_no: String,
    pub issue_source: String,
}

fn invoice_for<'a>(
    invoices: &'a [IssuedInvoice],
    row: &tax_core::SalesRow,
) -> Option<&'a IssuedInvoice> {
    invoices.iter().find(|inv| {
        (!inv.contract_id.is_empty() && Some(&inv.contract_id) == row.evidence.contract.as_ref())
            || (inv.buyer_name == row.customer
                && inv.goods == row.product
                && (inv.amount_total - row.gross_amount()).abs() <= 1.0)
    })
}

pub fn board_rows(state: &SessionState) -> Vec<BoardRow> {
    let rules = catalog::rules();
    let _ = rules;
    catalog::sales()
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            let app = catalog::application_for_sale(index);
            let has_acceptance = app
                .as_ref()
                .map(|a| {
                    a.documents
                        .iter()
                        .any(|d| d.doc_type == doc_type::ACCEPTANCE)
                })
                .unwrap_or(false);
            let inv = invoice_for(&state.invoices, &row);
            let draft = state
                .drafts
                .iter()
                .find(|d| d.contract_id == row.evidence.contract.clone().unwrap_or_default());
            let (status, label) = if let Some(inv) = inv {
                let label = if inv.pool_kind == "document" {
                    "已开具（历史样本）"
                } else {
                    "已开具"
                };
                ("issued", label)
            } else if let Some(d) = draft {
                if d.status == "confirmed" {
                    ("issued", "已开具")
                } else {
                    ("draft", "待确认草稿")
                }
            } else if !has_acceptance {
                ("suspended", "未验收暂缓")
            } else {
                ("pending", "待开票")
            };
            BoardRow {
                index,
                product: row.product.clone(),
                date: row.date.clone(),
                customer: row.customer.clone(),
                qty: row.qty,
                unit_price: row.unit_price,
                amount: row.amount,
                gross: row.gross_amount(),
                region: row.region.clone(),
                contract_no: row.contract_no.clone().unwrap_or_default(),
                accept_status: row.accept_status.clone().unwrap_or_default(),
                status: status.into(),
                status_label: label.into(),
                invoice_no: inv.map(|i| i.invoice_no.clone()).unwrap_or_default(),
                draft_no: draft.map(|d| d.draft_no.clone()).unwrap_or_default(),
                issue_source: inv.map(|i| i.source.clone()).unwrap_or_default(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn bootstrap(state: State<AppState>) -> Result<Value, String> {
    let guard = lock(&state)?;
    let mut ov = catalog::overview();
    ov["checks"] = json!(audit::checks_meta());
    ov["session"] = serde_json::to_value(&*guard).map_err(|e| e.to_string())?;
    ov["board"] = json!(board_rows(&guard));
    Ok(ov)
}

#[tauri::command]
pub fn documents(
    doc_type: Option<String>,
    keyword: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> Value {
    catalog::documents(&catalog::DocQuery {
        doc_type: doc_type.unwrap_or_default(),
        keyword: keyword.unwrap_or_default(),
        page: page.unwrap_or(1),
        page_size: page_size.unwrap_or(24),
    })
}

#[tauri::command]
pub fn document(id: String) -> Option<tax_core::Document> {
    catalog::document(&id)
}

#[tauri::command]
pub fn pending_application(index: usize) -> Result<Application, String> {
    catalog::application_for_sale(index).ok_or_else(|| "无法从待开票清单组装申请单".to_string())
}

#[tauri::command]
pub fn run_audit(
    application: Application,
    operator: Option<String>,
    state: State<AppState>,
) -> Result<tax_core::AuditOutcome, String> {
    let guard = lock(&state)?;
    let pool: Vec<PoolEntry> = guard
        .invoices
        .iter()
        .map(|i| PoolEntry {
            id: i.invoice_no.clone(),
            doc_type: i.invoice_type.clone(),
            doc_date: i.issued_at.clone(),
            party: i.buyer_name.clone(),
            amount_total: Some(i.amount_total),
            pool_kind: i.pool_kind.clone(),
        })
        .collect();
    let outcome =
        tax_core::audit_application(&application, &pool, &operator.unwrap_or_default(), "rule");
    drop(guard);
    let mut guard = lock(&state)?;
    guard.upsert_rejected(&outcome.audit, &application);
    guard.log(
        "系统智能体",
        "审核",
        &outcome.audit.application_no,
        &format!("{} · {}", outcome.audit.result_label, outcome.audit.summary),
    );
    if let Some(draft) = &outcome.draft {
        if !guard.drafts.iter().any(|d| d.draft_no == draft.draft_no) {
            guard.drafts.push(draft.clone());
        }
    }
    state.persist(&guard)?;
    Ok(outcome)
}

#[tauri::command]
pub fn confirm_draft(
    draft_no: String,
    operator: Option<String>,
    state: State<AppState>,
) -> Result<IssuedInvoice, String> {
    let mut guard = lock(&state)?;
    let draft = guard
        .drafts
        .iter()
        .find(|d| d.draft_no == draft_no)
        .cloned()
        .ok_or_else(|| "草稿不存在".to_string())?;
    if guard.invoices.iter().any(|i| {
        i.buyer_name == draft.buyer.name
            && (i.amount_total - draft.amount_total).abs() <= 0.01
            && i.pool_kind == "session"
    }) {
        return Err(format!(
            "购买方 {} 金额 {} 元已开具，不得重复开票；请先红冲。",
            draft.buyer.name,
            tax_core::fmt_money(Some(draft.amount_total))
        ));
    }
    let invoice_no = guard.next_invoice_no();
    let invoice = IssuedInvoice {
        id: invoice_no.clone(),
        invoice_no: invoice_no.clone(),
        invoice_type: draft.invoice_type.clone(),
        buyer_name: draft.buyer.name.clone(),
        buyer_tax_no: draft.buyer.tax_no.clone(),
        goods: draft
            .items
            .first()
            .map(|i| i.name.clone())
            .unwrap_or_default(),
        amount_total: draft.amount_total,
        tax_rate: draft.tax_rate.clone(),
        issued_at: tax_core::audit::now_text(),
        contract_id: draft.contract_id.clone(),
        source: "开票审核 · 待确认草稿".into(),
        pool_kind: "session".into(),
    };
    guard.invoices.push(invoice.clone());
    if let Some(d) = guard.drafts.iter_mut().find(|d| d.draft_no == draft_no) {
        d.status = "confirmed".into();
        d.status_label = "已确认开具".into();
    }
    guard.log(
        &operator.unwrap_or_else(|| "张伟".into()),
        "开具",
        &invoice_no,
        &format!(
            "{} {} 元",
            invoice.buyer_name,
            tax_core::fmt_money(Some(invoice.amount_total))
        ),
    );
    state.persist(&guard)?;
    Ok(invoice)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssueForm {
    pub buyer_name: String,
    pub buyer_tax_no: String,
    pub goods: String,
    pub amount_total: f64,
    pub tax_rate: String,
    pub contract_id: String,
    pub invoice_type: String,
}

#[tauri::command]
pub fn issue_invoice(
    form: IssueForm,
    operator: Option<String>,
    state: State<AppState>,
) -> Result<IssuedInvoice, String> {
    let mut guard = lock(&state)?;
    if guard.invoices.iter().any(|i| {
        i.buyer_name == form.buyer_name
            && (i.amount_total - form.amount_total).abs() <= 0.01
            && i.pool_kind == "session"
    }) {
        return Err(format!(
            "重复开票：购买方「{}」金额 {} 元已开具，请先红冲后再重开。",
            form.buyer_name,
            tax_core::fmt_money(Some(form.amount_total))
        ));
    }
    let invoice_no = guard.next_invoice_no();
    let invoice = IssuedInvoice {
        id: invoice_no.clone(),
        invoice_no,
        invoice_type: form.invoice_type,
        buyer_name: form.buyer_name,
        buyer_tax_no: form.buyer_tax_no,
        goods: form.goods,
        amount_total: form.amount_total,
        tax_rate: form.tax_rate,
        issued_at: tax_core::audit::now_text(),
        contract_id: form.contract_id,
        source: "开票台 · 手工开具".into(),
        pool_kind: "session".into(),
    };
    guard.invoices.push(invoice.clone());
    guard.log(
        &operator.unwrap_or_else(|| "张伟".into()),
        "开具",
        &invoice.invoice_no,
        &format!(
            "{} {} 元",
            invoice.buyer_name,
            tax_core::fmt_money(Some(invoice.amount_total))
        ),
    );
    state.persist(&guard)?;
    Ok(invoice)
}

#[tauri::command]
pub fn sync_history(state: State<AppState>) -> Result<usize, String> {
    let mut guard = lock(&state)?;
    let rows = catalog::sales();
    let mut added = 0usize;
    for row in &rows {
        if invoice_for(&guard.invoices, row).is_some() {
            continue;
        }
        if let Some(doc) = catalog::dataset_invoice_for_row(row) {
            let invoice_no = doc.invoice_no.clone().unwrap_or_else(|| doc.id.clone());
            guard.invoices.push(IssuedInvoice {
                id: doc.id.clone(),
                invoice_no: invoice_no.clone(),
                invoice_type: doc.doc_type.clone(),
                buyer_name: doc.party.clone(),
                buyer_tax_no: doc.party_tax_no.clone().unwrap_or_default(),
                goods: doc
                    .items
                    .first()
                    .map(|i| i.name.clone())
                    .unwrap_or_default(),
                amount_total: doc.amount_total.unwrap_or(row.gross_amount()),
                tax_rate: doc.display_rate(),
                issued_at: doc.doc_date.clone(),
                contract_id: row.evidence.contract.clone().unwrap_or_default(),
                source: "数据集历史样本".into(),
                pool_kind: "document".into(),
            });
            added += 1;
        }
    }
    guard.log(
        "系统智能体",
        "同步历史发票",
        "dataset",
        &format!("匹配 {added} 张已开具发票"),
    );
    state.persist(&guard)?;
    Ok(added)
}

#[tauri::command]
pub fn reset_session(state: State<AppState>) -> Result<Value, String> {
    let mut guard = lock(&state)?;
    *guard = SessionState::default();
    guard.log("张伟", "重置会话", "session", "清空草稿、已开具发票与日志");
    state.persist(&guard)?;
    Ok(serde_json::to_value(&*guard).unwrap_or(Value::Null))
}

#[tauri::command]
pub fn policies() -> Value {
    catalog::policies()
}

#[tauri::command]
pub fn policy(id: String) -> Option<Value> {
    catalog::policy(&id)
}

#[tauri::command]
pub fn cases() -> Value {
    catalog::cases()
}

#[tauri::command]
pub fn acceptance() -> Value {
    catalog::acceptance()
}

#[tauri::command]
pub fn data_quality() -> Value {
    catalog::data_quality()
}

#[tauri::command]
pub fn ledger(page: Option<usize>, page_size: Option<usize>) -> Value {
    catalog::ledger(page.unwrap_or(1), page_size.unwrap_or(30))
}

#[tauri::command]
pub fn invoice_samples() -> Value {
    let docs: Vec<tax_core::Document> = tax_core::data::dataset()
        .documents
        .iter()
        .filter(|d| {
            matches!(
                d.doc_type.as_str(),
                doc_type::SPECIAL | doc_type::EXPORT | doc_type::NORMAL
            )
        })
        .take(12)
        .cloned()
        .collect();
    json!(docs)
}

#[tauri::command]
pub fn drafts(state: State<AppState>) -> Result<Vec<Draft>, String> {
    Ok(lock(&state)?.drafts.clone())
}
