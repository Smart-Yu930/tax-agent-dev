//! Invoice draft generation. Only approved applications produce a draft.

use crate::audit::{buyer_name_of, context, expected_rate, Application, AuditResult};
use crate::classify::doc_type;
use crate::data::Rules;
use crate::model::Document;
use crate::money::{fmt_money, parse_rate, rate_str, round2};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    pub name: String,
    pub tax_no: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftItem {
    pub name: String,
    pub spec: String,
    pub unit: String,
    pub qty: Option<f64>,
    pub unit_price: Option<f64>,
    pub amount: Option<f64>,
    pub tax_rate: String,
    pub tax_amount: Option<f64>,
    pub loc: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftIssue {
    pub level: String,
    pub check: String,
    pub text: String,
    pub advice: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftSource {
    pub label: String,
    pub doc_id: String,
    pub doc_type: String,
    pub field: String,
    pub value: String,
    pub loc: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub draft_no: String,
    pub invoice_type: String,
    pub buyer: Party,
    pub seller: Party,
    pub amount_ex_tax: f64,
    pub tax_rate: String,
    pub tax_amount: f64,
    pub amount_total: f64,
    pub items: Vec<DraftItem>,
    pub remark: String,
    pub highlights: Vec<String>,
    pub common_errors: Vec<DraftIssue>,
    pub sources: Vec<DraftSource>,
    pub created_at: String,
    pub status: String,
    pub status_label: String,
    pub contract_id: String,
    pub acceptance_id: String,
    pub application_no: String,
}

fn source_of(
    doc: &Document,
    label: &str,
    field: &str,
    value: String,
    fallback: &str,
) -> DraftSource {
    DraftSource {
        label: label.into(),
        doc_id: doc.id.clone(),
        doc_type: doc.doc_type.clone(),
        field: field.into(),
        value,
        loc: if doc.field_loc(&[field]).is_empty() {
            fallback.to_string()
        } else {
            doc.field_loc(&[field])
        },
    }
}

pub fn build_draft(
    application: &Application,
    rules: &Rules,
    result: &AuditResult,
) -> Option<Draft> {
    if result.result != "pass" {
        return None;
    }
    let ctx = context(application);
    let contract = ctx.contract.as_ref()?;
    let acceptance = ctx.acceptance.as_ref();
    let buyer_name = buyer_name_of(&ctx).unwrap_or_default();
    let exp = expected_rate(&ctx, application);
    let rate = contract
        .tax_rate
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| rate_str(exp.rate));
    let rate_num = parse_rate(&rate).unwrap_or(exp.rate);
    let buyer_tax_no = contract
        .party_tax_no
        .clone()
        .or_else(|| ctx.invoice.as_ref().and_then(|d| d.party_tax_no.clone()))
        .or_else(|| rules.customer(&buyer_name).map(|c| c.tax_no))
        .unwrap_or_default();
    let amount_ex = contract.amount_ex_tax.unwrap_or(0.0);
    let tax_amount = contract
        .tax_amount
        .unwrap_or_else(|| round2(amount_ex * rate_num));
    let total = contract
        .amount_total
        .unwrap_or_else(|| round2(amount_ex + tax_amount));
    let items: Vec<DraftItem> = contract
        .items
        .iter()
        .map(|it| DraftItem {
            name: it.name.clone(),
            spec: it.spec.clone(),
            unit: it.unit.clone(),
            qty: it.qty,
            unit_price: it.unit_price,
            amount: it.amount,
            tax_rate: it.tax_rate.clone().unwrap_or_else(|| rate.clone()),
            tax_amount: it
                .tax_amount
                .or_else(|| it.amount.map(|a| round2(a * rate_num))),
            loc: format!("{} · {} · {}", contract.id, contract.doc_type, it.loc),
        })
        .collect();
    let mut sources = vec![
        source_of(
            contract,
            "购买方名称",
            "买方",
            buyer_name.clone(),
            "合同要素表",
        ),
        source_of(
            contract,
            "不含税金额",
            "不含税金额",
            fmt_money(Some(amount_ex)),
            "合同要素表",
        ),
        source_of(contract, "税率", "增值税率", rate.clone(), "合同要素表"),
        source_of(
            contract,
            "价税合计",
            "价税合计",
            fmt_money(Some(total)),
            "合同要素表",
        ),
        source_of(
            contract,
            "货物服务名称",
            "货物名称",
            contract
                .items
                .first()
                .map(|i| i.name.clone())
                .unwrap_or_default(),
            "明细表",
        ),
    ];
    if let Some(acc) = acceptance {
        sources.push(source_of(
            acc,
            "验收金额",
            "验收金额",
            fmt_money(acc.amount_total),
            "明细表",
        ));
    }
    let mut common_errors: Vec<DraftIssue> = result
        .checks
        .iter()
        .filter(|c| c.status != "pass")
        .map(|c| DraftIssue {
            level: c.status.clone(),
            check: c.name.clone(),
            text: c.conclusion.clone(),
            advice: c.advice.clone().unwrap_or_default(),
        })
        .collect();
    if buyer_tax_no.is_empty() {
        common_errors.push(DraftIssue {
            level: "warn".into(),
            check: "购买方信息".into(),
            text: "购买方纳税人识别号缺失，开票前需补齐。".into(),
            advice: "请在客户档案 customers 中补录纳税人识别号。".into(),
        });
    }
    let digits: String = contract.id.chars().filter(|c| c.is_ascii_digit()).collect();
    let suffix = if digits.len() >= 6 {
        &digits[digits.len() - 6..]
    } else {
        digits.as_str()
    };
    let draft_no = format!("DRF-{}", suffix);
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    Some(Draft {
        draft_no,
        invoice_type: if exp.region == "出口" {
            doc_type::EXPORT
        } else {
            doc_type::SPECIAL
        }
        .into(),
        buyer: Party {
            name: buyer_name,
            tax_no: buyer_tax_no,
        },
        seller: Party {
            name: contract.self_name.clone(),
            tax_no: contract.self_tax_no.clone(),
        },
        amount_ex_tax: amount_ex,
        tax_rate: rate,
        tax_amount,
        amount_total: total,
        items,
        remark: if exp.region == "出口" {
            "出口业务，适用 0% 税率；FOB 价核对报关单。".into()
        } else {
            format!(
                "合同 {}；验收合格；结算方式：验收后 30 天电汇。",
                contract.id
            )
        },
        highlights: [
            "buyer.name",
            "amountExTax",
            "taxRate",
            "taxAmount",
            "amountTotal",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect(),
        common_errors,
        sources,
        created_at: now,
        status: "pending".into(),
        status_label: "待人工确认".into(),
        contract_id: contract.id.clone(),
        acceptance_id: acceptance.map(|a| a.id.clone()).unwrap_or_default(),
        application_no: application.application_no.clone(),
    })
}
