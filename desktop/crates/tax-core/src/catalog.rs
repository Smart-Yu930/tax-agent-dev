//! Read-only views over the embedded case dataset.

use crate::audit::Application;
use crate::classify::doc_type;
use crate::data::{dataset, Rules};
use crate::model::{Document, SalesRow};
use crate::money::{fmt_money, round2, same_amount};
use serde_json::{json, Value};

pub fn meta() -> Value {
    serde_json::to_value(&dataset().meta).unwrap_or(Value::Null)
}

pub fn rules() -> Rules {
    Rules::from_dataset(dataset())
}

fn is_invoice(d: &Document) -> bool {
    matches!(
        d.doc_type.as_str(),
        doc_type::SPECIAL | doc_type::NORMAL | doc_type::EXPORT
    )
}

pub fn overview() -> Value {
    let ds = dataset();
    let docs = &ds.documents;
    let invoice_count = docs.iter().filter(|d| is_invoice(d)).count();
    let contract_count = docs
        .iter()
        .filter(|d| {
            d.doc_type == doc_type::SALES_CONTRACT || d.doc_type == doc_type::PURCHASE_CONTRACT
        })
        .count();
    let acceptance_count = docs
        .iter()
        .filter(|d| d.doc_type == doc_type::ACCEPTANCE)
        .count();
    let sales_total: f64 = ds.tables.sales.iter().map(|s| s.amount).sum();
    json!({
        "meta": ds.meta,
        "kpi": ds.tables.kpi,
        "stats": {
            "documents": docs.len(),
            "invoices": invoice_count,
            "contracts": contract_count,
            "acceptances": acceptance_count,
            "sales": ds.tables.sales.len(),
            "cases": ds.tables.cases.len(),
            "policies": ds.policies.len(),
            "salesTotal": round2(sales_total),
            "salesTotalText": fmt_money(Some(sales_total)),
        },
        "dict": ds.dict,
        "policies": ds.policies,
        "acceptance": ds.acceptance,
        "dataQuality": ds.data_quality,
    })
}

#[derive(Debug, Clone, Default)]
pub struct DocQuery {
    pub doc_type: String,
    pub keyword: String,
    pub page: usize,
    pub page_size: usize,
}

fn doc_matches(d: &Document, q: &DocQuery) -> bool {
    if !q.doc_type.is_empty() && q.doc_type != "全部" && d.doc_type != q.doc_type {
        return false;
    }
    if q.keyword.is_empty() {
        return true;
    }
    let k = q.keyword.to_lowercase();
    d.id.to_lowercase().contains(&k)
        || d.title.to_lowercase().contains(&k)
        || d.party.to_lowercase().contains(&k)
        || d.file.to_lowercase().contains(&k)
        || d.items.iter().any(|i| i.name.to_lowercase().contains(&k))
}

pub fn documents(q: &DocQuery) -> Value {
    let all: Vec<&Document> = dataset()
        .documents
        .iter()
        .filter(|d| doc_matches(d, q))
        .collect();
    let total = all.len();
    let page_size = if q.page_size == 0 { 20 } else { q.page_size };
    let page = q.page.max(1);
    let start = (page - 1) * page_size;
    let items: Vec<&Document> = all.iter().skip(start).take(page_size).copied().collect();
    json!({
        "total": total,
        "page": page,
        "pageSize": page_size,
        "pages": (total + page_size - 1) / page_size,
        "items": items,
    })
}

pub fn document(id: &str) -> Option<Document> {
    dataset().doc_by_id(id)
}

pub fn sales() -> Vec<SalesRow> {
    dataset().tables.sales.clone()
}

pub fn cases() -> Value {
    serde_json::to_value(&dataset().tables.cases).unwrap_or(Value::Null)
}

pub fn policies() -> Value {
    serde_json::to_value(&dataset().policies).unwrap_or(Value::Null)
}

pub fn policy(id: &str) -> Option<Value> {
    dataset()
        .policies
        .iter()
        .find(|p| p.id == id)
        .and_then(|p| serde_json::to_value(p).ok())
}

pub fn ledger(page: usize, page_size: usize) -> Value {
    let all = &dataset().ledger;
    let page_size = if page_size == 0 { 30 } else { page_size };
    let page = page.max(1);
    let start = (page - 1) * page_size;
    let items: Vec<_> = all.iter().skip(start).take(page_size).collect();
    json!({ "total": all.len(), "page": page, "pageSize": page_size, "items": items })
}

pub fn acceptance() -> Value {
    serde_json::to_value(&dataset().acceptance).unwrap_or(Value::Null)
}

pub fn data_quality() -> Value {
    serde_json::to_value(&dataset().data_quality).unwrap_or(Value::Null)
}

fn by_id_or_match<F>(id: Option<&String>, pred: F) -> Option<Document>
where
    F: Fn(&Document) -> bool,
{
    if let Some(id) = id {
        if let Some(d) = dataset().doc_by_id(id) {
            return Some(d);
        }
    }
    dataset().documents.iter().find(|d| pred(d)).cloned()
}

/// Assemble an audit application from one row of the pending-invoice sheet.
pub fn application_for_sale(index: usize) -> Option<Application> {
    let ds = dataset();
    let row = ds.tables.sales.get(index)?;
    let gross = row.gross_amount();
    let product = row.product.clone();
    let customer = row.customer.clone();

    let mut docs: Vec<Document> = Vec::new();
    for id in &row.evidence.docs {
        if let Some(d) = ds.doc_by_id(id) {
            if !docs.iter().any(|x: &Document| x.id == d.id) {
                docs.push(d);
            }
        }
    }

    let contract = by_id_or_match(row.evidence.contract.as_ref(), |d| {
        d.doc_type == doc_type::SALES_CONTRACT
            && d.party == customer
            && d.items.first().map(|i| i.name == product).unwrap_or(false)
            && same_amount(d.amount_total, Some(gross)).unwrap_or(false)
    });
    if let Some(c) = &contract {
        if !docs.iter().any(|x| x.id == c.id) {
            docs.push(c.clone());
        }
    }
    let acceptance = by_id_or_match(row.evidence.acceptance.as_ref(), |d| {
        d.doc_type == doc_type::ACCEPTANCE
            && d.party == customer
            && contract
                .as_ref()
                .map(|c| {
                    same_amount(d.amount_total, c.amount_ex_tax).unwrap_or(false)
                        || same_amount(d.amount_total, c.amount_total).unwrap_or(false)
                })
                .unwrap_or(false)
    });
    if let Some(a) = &acceptance {
        if !docs.iter().any(|x| x.id == a.id) {
            docs.push(a.clone());
        }
    }
    let stock_out = by_id_or_match(row.evidence.stock_out.as_ref(), |d| {
        d.doc_type == doc_type::STOCK_OUT && d.party == customer
    });
    if let Some(s) = &stock_out {
        if !docs.iter().any(|x| x.id == s.id) {
            docs.push(s.clone());
        }
    }
    if docs.is_empty() {
        return None;
    }
    let declared_amount = contract
        .as_ref()
        .and_then(|c| c.amount_total)
        .or(Some(gross));
    Some(Application {
        application_no: format!("INV-2025-12-{:03}", index + 1),
        applicant: "李娜".into(),
        apply_date: row.date.clone(),
        region: row.region.clone(),
        declared_amount,
        declared_customer: row.customer.clone(),
        customer: row.customer.clone(),
        product: row.product.clone(),
        source: format!("待开票清单 · {} · {}", row.product, row.customer),
        documents: docs,
    })
}

/// Look up the sales row that a submitted invoice form refers to.
pub fn find_sales_row(buyer: &str, goods: &str, total: f64) -> Option<(usize, SalesRow)> {
    dataset()
        .tables
        .sales
        .iter()
        .enumerate()
        .find(|(_, row)| {
            row.customer == buyer
                && row.product == goods
                && same_amount(Some(row.gross_amount()), Some(total)).unwrap_or(false)
        })
        .map(|(i, row)| (i, row.clone()))
}

/// Dataset invoices that already correspond to a sales row (issue status sync).
pub fn dataset_invoice_for_row(row: &SalesRow) -> Option<Document> {
    dataset()
        .documents
        .iter()
        .find(|d| {
            matches!(d.doc_type.as_str(), doc_type::SPECIAL | doc_type::EXPORT)
                && d.party == row.customer
                && same_amount(d.amount_total, Some(row.gross_amount())).unwrap_or(false)
                && d.items
                    .first()
                    .map(|i| i.name.is_empty() || i.name == row.product)
                    .unwrap_or(true)
        })
        .cloned()
}
