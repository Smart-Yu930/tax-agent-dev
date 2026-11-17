//! The six audit checks, ported one-for-one from the reference rule engine.

use crate::classify::{classify, doc_type};
use crate::data::Rules;
use crate::model::{Document, ExtractedField};
use crate::money::{fmt_money, parse_rate, rate_str, round2, same_amount};
use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const CHECK_DEFS: [(&str, &str, &str, &str); 6] = [
    (
        "check_title",
        "抬头一致性",
        "购买方名称/纳税人识别号在合同、验收单、出库单、申请单之间精确一致",
        "合规管理制度 4.2 交易主体核验",
    ),
    (
        "check_tax_rate",
        "税率正确性",
        "税率取自 tax_rates 字典，税额=不含税金额×税率，出口适用 0%",
        "增值税税率字典 tax_rates",
    ),
    (
        "check_amount",
        "金额一致性",
        "合同价税合计 = 不含税金额 + 税额；验收单金额合计与合同不含税精确一致，差异 0.01 元即不通过",
        "内部审计制度 财务收支审计证据要求",
    ),
    (
        "check_scope",
        "开票范围",
        "开票品名与合同标的一致，且属于企业经营范围；出口业务须开具出口发票",
        "合规管理制度 合规义务清单",
    ),
    (
        "check_date",
        "日期合理性",
        "开票日期晚于合同签订日与验收合格日；未验收（控制权未转移）暂缓开票",
        "收入确认时点（控制权转移）",
    ),
    (
        "check_duplicate",
        "重复开票校验",
        "同一业务在同一发票池中不得重复开具，需先红冲后再重开",
        "注意事项：同一业务不得重复开票",
    ),
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    #[serde(default)]
    pub application_no: String,
    #[serde(default)]
    pub applicant: String,
    #[serde(default)]
    pub apply_date: String,
    #[serde(default)]
    pub region: String,
    #[serde(default)]
    pub declared_amount: Option<f64>,
    #[serde(default)]
    pub declared_customer: String,
    #[serde(default)]
    pub customer: String,
    #[serde(default)]
    pub product: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub documents: Vec<Document>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolEntry {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub doc_type: String,
    #[serde(default)]
    pub doc_date: String,
    #[serde(default)]
    pub party: String,
    #[serde(default)]
    pub amount_total: Option<f64>,
    /// "session" for invoices issued here, "document" for dataset history.
    #[serde(default)]
    pub pool_kind: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub doc_id: String,
    pub doc_type: String,
    #[serde(default)]
    pub doc_date: String,
    pub field: String,
    pub value: String,
    pub loc: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub left: String,
    pub right: String,
    pub gap: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub key: String,
    pub name: String,
    pub desc: String,
    #[serde(rename = "match")]
    pub match_type: String,
    pub rule: String,
    pub status: String,
    pub conclusion: String,
    pub evidence: Vec<Evidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub advice: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<Diff>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRow {
    pub check: String,
    pub check_key: String,
    pub check_status: String,
    pub doc_id: String,
    pub doc_type: String,
    pub field: String,
    pub value: String,
    pub loc: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentSummary {
    pub id: String,
    pub doc_type: String,
    pub classified: String,
    pub confidence: f64,
    pub reason: String,
    pub doc_date: String,
    pub party: String,
    pub amount: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditResult {
    pub application_no: String,
    pub audited_at: String,
    pub operator: String,
    pub applicant: String,
    pub result: String,
    pub result_label: String,
    pub risk_level: String,
    pub checks: Vec<Check>,
    pub evidence_table: Vec<EvidenceRow>,
    pub rule_mode: String,
    pub summary: String,
    pub documents: Vec<DocumentSummary>,
}

#[derive(Debug, Clone, Default)]
pub struct AuditContext {
    pub all: Vec<Document>,
    pub invoices: Vec<Document>,
    pub contracts: Vec<Document>,
    pub sales_contracts: Vec<Document>,
    pub acceptances: Vec<Document>,
    pub deliveries: Vec<Document>,
    pub stock_outs: Vec<Document>,
    pub customs: Vec<Document>,
    pub contract: Option<Document>,
    pub acceptance: Option<Document>,
    pub stock_out: Option<Document>,
    pub invoice: Option<Document>,
}

fn pick(docs: &[Document], types: &[&str]) -> Vec<Document> {
    docs.iter()
        .filter(|d| types.iter().any(|t| *t == d.doc_type))
        .cloned()
        .collect()
}

pub fn context(application: &Application) -> AuditContext {
    let all = application.documents.clone();
    let invoices = pick(
        &all,
        &[doc_type::SPECIAL, doc_type::NORMAL, doc_type::EXPORT],
    );
    let contracts = pick(
        &all,
        &[doc_type::SALES_CONTRACT, doc_type::PURCHASE_CONTRACT],
    );
    let sales_contracts = pick(&all, &[doc_type::SALES_CONTRACT]);
    let acceptances = pick(&all, &[doc_type::ACCEPTANCE]);
    let deliveries = pick(&all, &[doc_type::DELIVERY_SIGN]);
    let stock_outs = pick(&all, &[doc_type::STOCK_OUT]);
    let customs = pick(&all, &[doc_type::CUSTOMS]);
    let contract = sales_contracts
        .first()
        .or_else(|| contracts.first())
        .cloned();
    let acceptance = acceptances.first().cloned();
    let stock_out = stock_outs.first().cloned();
    let invoice = invoices.first().cloned();
    AuditContext {
        all,
        invoices,
        sales_contracts,
        contracts,
        acceptances,
        deliveries,
        stock_outs,
        customs,
        contract,
        acceptance,
        stock_out,
        invoice,
    }
}

pub fn buyer_name_of(ctx: &AuditContext) -> Option<String> {
    if let Some(c) = &ctx.contract {
        if let Some(f) = c.field_by_label(&["买方（甲方）", "买方名称", "买方"]) {
            let v = f.value_text();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    if let Some(a) = &ctx.acceptance {
        if !a.party.is_empty() {
            return Some(a.party.clone());
        }
    }
    if let Some(i) = &ctx.invoice {
        if !i.party.is_empty() {
            return Some(i.party.clone());
        }
    }
    None
}

pub fn region_of(ctx: &AuditContext, application: &Application) -> String {
    if !application.region.is_empty() {
        return application.region.clone();
    }
    if ctx.invoices.iter().any(|d| d.doc_type == doc_type::EXPORT) {
        return "出口".into();
    }
    let party = ctx
        .contract
        .as_ref()
        .map(|c| c.party.as_str())
        .unwrap_or("");
    if party.contains("越南")
        || party.contains("境外")
        || party.contains("海外")
        || party.contains("HMC 制造")
    {
        return "出口".into();
    }
    "内销".into()
}

pub struct ExpectedRate {
    pub rate: f64,
    pub why: &'static str,
    pub product: Option<String>,
    pub region: String,
}

pub fn expected_rate(ctx: &AuditContext, application: &Application) -> ExpectedRate {
    let product = ctx
        .contract
        .as_ref()
        .and_then(|c| c.items.first())
        .map(|i| i.name.clone())
        .or_else(|| {
            ctx.invoice
                .as_ref()
                .and_then(|c| c.items.first())
                .map(|i| i.name.clone())
        });
    let region = region_of(ctx, application);
    if region == "出口" {
        ExpectedRate {
            rate: 0.0,
            why: "出口业务适用 0% 税率（零税率）",
            product,
            region,
        }
    } else {
        ExpectedRate {
            rate: 0.13,
            why: "机械设备/零部件等应税货物销售适用 13%",
            product,
            region,
        }
    }
}

fn field_value<'a>(doc: &'a Document, key: &str, label: &str) -> Option<&'a ExtractedField> {
    doc.fields
        .iter()
        .find(|f| f.key.as_deref() == Some(key))
        .or_else(|| doc.fields.iter().find(|f| f.label == label))
}

fn locate(doc: &Document, key: &str, label: &str) -> String {
    field_value(doc, key, label)
        .and_then(|f| f.loc.clone())
        .unwrap_or_else(|| "原文".into())
}

fn ev_from_doc(doc: &Document, key: &str, label: &str, value: impl Into<String>) -> Evidence {
    Evidence {
        doc_id: doc.id.clone(),
        doc_type: doc.doc_type.clone(),
        doc_date: doc.doc_date.clone(),
        field: label.into(),
        value: value.into(),
        loc: format!(
            "{} · {} · {}",
            doc.id,
            doc.doc_type,
            locate(doc, key, label)
        ),
    }
}

fn mk_check(
    index: usize,
    status: &str,
    conclusion: String,
    evidence: Vec<Evidence>,
    advice: Option<&str>,
    diff: Option<Diff>,
) -> Check {
    let (key, name, desc, rule) = CHECK_DEFS[index];
    Check {
        key: key.into(),
        name: name.into(),
        desc: desc.into(),
        match_type: "exact_match".into(),
        rule: rule.into(),
        status: status.into(),
        conclusion,
        evidence,
        advice: advice.map(str::to_string),
        diff,
    }
}

fn real_num(v: Option<f64>) -> f64 {
    v.unwrap_or(0.0)
}

fn sum(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut has = false;
    let mut total = 0.0;
    for v in values {
        if let Some(n) = v {
            if n.is_finite() {
                total += n;
                has = true;
            }
        }
    }
    has.then(|| round2(total))
}

fn check_title(ctx: &AuditContext, application: &Application) -> Check {
    struct NameRow {
        name: String,
        from: String,
    }
    let mut names = Vec::new();
    let mut ev = Vec::new();
    let add = |doc: Option<&Document>,
               value: Option<&str>,
               label: &str,
               names: &mut Vec<NameRow>,
               ev: &mut Vec<Evidence>| {
        let Some(value) = value else { return };
        let value = value.trim();
        if value.is_empty() {
            return;
        }
        let doc_id = doc
            .map(|d| d.id.clone())
            .unwrap_or_else(|| "开票申请单".into());
        names.push(NameRow {
            name: value.to_string(),
            from: label.to_string(),
        });
        if let Some(d) = doc {
            ev.push(ev_from_doc(d, "party", label, value));
        } else {
            ev.push(Evidence {
                doc_id,
                doc_type: doc_type::APPLICATION.into(),
                doc_date: String::new(),
                field: label.into(),
                value: value.into(),
                loc: "开票申请单 · 申请信息区 · 购买方名称".into(),
            });
        }
    };

    add(
        None,
        (!application.declared_customer.is_empty())
            .then_some(application.declared_customer.as_str()),
        "开票申请单",
        &mut names,
        &mut ev,
    );
    let buyer = buyer_name_of(ctx);
    add(
        ctx.contract.as_ref(),
        buyer.as_deref(),
        "合同买方",
        &mut names,
        &mut ev,
    );
    for d in &ctx.acceptances {
        add(
            Some(d),
            Some(&d.party),
            "验收单往来单位",
            &mut names,
            &mut ev,
        );
    }
    for d in &ctx.stock_outs {
        add(
            Some(d),
            Some(&d.party),
            "出库单往来单位",
            &mut names,
            &mut ev,
        );
    }
    for d in &ctx.invoices {
        add(Some(d), Some(&d.party), "发票购买方", &mut names, &mut ev);
    }

    if names.is_empty() {
        return mk_check(
            0,
            "fail",
            "未识别到任何购买方名称，无法执行抬头一致性核对，需人工补充申请单或合同。".into(),
            ev,
            Some("请补充开票申请单或销售合同，明确购买方全称与纳税人识别号。"),
            None,
        );
    }

    let mut base = 0usize;
    let self_name = ctx.all.first().map(|d| d.self_name.as_str()).unwrap_or("");
    let self_hit: Vec<&NameRow> = names
        .iter()
        .filter(|n| !self_name.is_empty() && n.name == self_name)
        .collect();
    if !self_hit.is_empty() && names.len() > 1 {
        if let Some(pos) = names.iter().position(|n| n.name != self_name) {
            base = pos;
        }
    }
    let base_name = names[base].name.clone();
    let diffs: Vec<&NameRow> = names
        .iter()
        .filter(|n| n.name != base_name && (self_name.is_empty() || n.name != self_name))
        .collect();
    if !diffs.is_empty() {
        let detail = diffs
            .iter()
            .map(|d| format!("{}为「{}」", d.from, d.name))
            .collect::<Vec<_>>()
            .join("、");
        let conclusion = format!(
            "抬头不一致：{}为「{}」，而 {}。",
            names[base].from, base_name, detail
        );
        return mk_check(
            0,
            "fail",
            conclusion,
            ev,
            Some("请核对购买方全称与纳税人识别号，以合同买方为准修正申请单后重新提交。"),
            Some(Diff {
                left: base_name,
                right: diffs[0].name.clone(),
                gap: 0.0,
            }),
        );
    }

    let taxs: Vec<&Document> = ctx
        .all
        .iter()
        .filter(|d| {
            d.party_tax_no
                .as_deref()
                .map(|s| !s.is_empty())
                .unwrap_or(false)
        })
        .collect();
    if taxs.len() > 1 {
        let t0 = taxs[0].party_tax_no.clone().unwrap_or_default();
        if let Some(tdiff) = taxs
            .iter()
            .find(|d| d.party_tax_no.as_deref() != Some(t0.as_str()))
        {
            let conclusion = format!(
                "纳税人识别号不一致：{} 为 {}，{} 为 {}。",
                taxs[0].id,
                t0,
                tdiff.id,
                tdiff.party_tax_no.clone().unwrap_or_default()
            );
            return mk_check(
                0,
                "fail",
                conclusion,
                ev,
                Some("请通过客户档案表 customers 复核纳税人识别号，修正后重新提交。"),
                None,
            );
        }
    }
    if taxs.is_empty() {
        return mk_check(
            0,
            "warn",
            format!("购买方名称一致（{base_name}），；购买方纳税人识别号在单据中缺失（原值为「—」），建议人工补充核对。"),
            ev,
            Some("请补充购买方纳税人识别号，以客户档案 customers 表核验。"),
            None,
        );
    }
    mk_check(
        0,
        "pass",
        format!(
            "购买方名称与纳税人识别号在 {} 处单据间精确一致（{} / {}）。",
            names.len(),
            base_name,
            taxs[0].party_tax_no.clone().unwrap_or_default()
        ),
        ev,
        None,
        None,
    )
}

fn check_tax_rate(ctx: &AuditContext, application: &Application, rules: &Rules) -> Check {
    let exp = expected_rate(ctx, application);
    let mut ev = Vec::new();
    let mut rates: Vec<(&Document, String)> = Vec::new();
    for d in [ctx.contract.as_ref(), ctx.invoice.as_ref()]
        .into_iter()
        .flatten()
    {
        if let Some(r) = d.tax_rate.as_ref().filter(|s| !s.is_empty()) {
            rates.push((d, r.clone()));
            ev.push(ev_from_doc(d, "taxRate", "税率", r.clone()));
        }
    }
    if rates.is_empty() {
        return mk_check(
            1,
            "fail",
            "未识别到税率字段，无法校验税率正确性。".into(),
            ev,
            Some("请在合同或发票中明确增值税率后重新提交。"),
            None,
        );
    }
    let bad: Vec<&(&Document, String)> = rates
        .iter()
        .filter(|(_, r)| parse_rate(r) != Some(exp.rate))
        .collect();
    if !bad.is_empty() {
        let detail = bad
            .iter()
            .map(|(d, r)| format!("{} 为 {}", d.id, r))
            .collect::<Vec<_>>()
            .join("、");
        let conclusion = format!(
            "税率不正确：{}，按业务性质应为 {}（{}）。",
            detail,
            rate_str(exp.rate),
            exp.why
        );
        return mk_check(
            1,
            "fail",
            conclusion,
            ev,
            Some("请核对业务性质与商品编码，按 13%/9%/6%/0% 对应税率重新开具。"),
            Some(Diff {
                left: rate_str(exp.rate),
                right: bad[0].1.clone(),
                gap: 0.0,
            }),
        );
    }
    let in_dict = rules.rate_known(exp.rate);

    let d = ctx.invoice.as_ref().or(ctx.contract.as_ref());
    if let Some(d) = d {
        if let (Some(ex), Some(tax)) = (d.amount_ex_tax, d.tax_amount) {
            let calc = round2(ex * exp.rate);
            if (calc - round2(tax)).abs() > 0.01 {
                let conclusion = format!(
                    "税额计算不符：不含税 {} × {} 应为 {}，单据为 {}。",
                    fmt_money(Some(ex)),
                    rate_str(exp.rate),
                    fmt_money(Some(calc)),
                    fmt_money(Some(tax))
                );
                return mk_check(
                    1,
                    "fail",
                    conclusion,
                    ev,
                    Some("请重算税额，确保「税额＝不含税金额×税率」精确到分。"),
                    Some(Diff {
                        left: fmt_money(Some(calc)),
                        right: fmt_money(Some(tax)),
                        gap: round2(tax - calc),
                    }),
                );
            }
            ev.push(ev_from_doc(d, "taxAmount", "税额", fmt_money(Some(tax))));
        }
    }

    if exp.rate == 0.0 {
        let has_tax = ctx
            .invoice
            .as_ref()
            .and_then(|d| d.tax_amount)
            .or_else(|| ctx.contract.as_ref().and_then(|d| d.tax_amount));
        if real_num(has_tax) > 0.0 {
            return mk_check(
                1,
                "fail",
                format!(
                    "出口业务适用 0% 税率，不应计列税额，单据税额为 {}。",
                    fmt_money(has_tax)
                ),
                ev,
                Some("出口发票请按 0% 开具，不单列销项税额。"),
                None,
            );
        }
    }

    mk_check(
        1,
        "pass",
        format!(
            "税率 {} 与 tax_rates 字典及业务性质一致（{}），税额勾稽通过{}。",
            rate_str(exp.rate),
            exp.why,
            if in_dict {
                ""
            } else {
                "（字典未匹配到该税率，需复核）"
            }
        ),
        ev,
        None,
        None,
    )
}

fn check_amount(ctx: &AuditContext, application: &Application) -> Check {
    let mut ev = Vec::new();
    let c = ctx.contract.as_ref();
    let mut row_count = 0usize;

    if let Some(c) = c {
        if let Some(total) = c.amount_total {
            row_count += 1;
            ev.push(ev_from_doc(
                c,
                "amountTotal",
                "价税合计",
                fmt_money(Some(total)),
            ));
        }
        if let Some(ex) = c.amount_ex_tax {
            row_count += 1;
            ev.push(ev_from_doc(
                c,
                "amountExTax",
                "不含税金额",
                fmt_money(Some(ex)),
            ));
        }
    }
    if let Some(declared) = application.declared_amount {
        row_count += 1;
        ev.push(Evidence {
            doc_id: "开票申请单".into(),
            doc_type: doc_type::APPLICATION.into(),
            doc_date: String::new(),
            field: "申请金额".into(),
            value: fmt_money(Some(declared)),
            loc: "开票申请单 · 申请信息区 · 申请金额".into(),
        });
    }
    let acc_sum = sum(ctx.acceptances.iter().map(|d| d.amount_total));
    if let Some(acc) = acc_sum {
        row_count += 1;
        if let Some(first) = ctx.acceptances.first() {
            let _ = first;
        }
        for d in &ctx.acceptances {
            ev.push(ev_from_doc(
                d,
                "amountTotal",
                "验收金额",
                fmt_money(d.amount_total),
            ));
        }
        let _ = acc;
    }
    if let Some(inv) = &ctx.invoice {
        if let Some(total) = inv.amount_total {
            row_count += 1;
            ev.push(ev_from_doc(
                inv,
                "amountTotal",
                "价税合计",
                fmt_money(Some(total)),
            ));
        }
    }
    if row_count == 0 {
        return mk_check(
            2,
            "fail",
            "未识别到任何金额字段，无法执行金额一致性核对。".into(),
            ev,
            Some("请补充销售合同或验收单，明确含税与不含税金额。"),
            None,
        );
    }

    if let Some(c) = c {
        if let (Some(total), Some(ex)) = (c.amount_total, c.amount_ex_tax) {
            let calc = round2(ex + real_num(c.tax_amount));
            if (calc - round2(total)).abs() > 0.01 {
                let conclusion = format!(
                    "合同金额勾稽不平：不含税 {} + 税额 {} = {}，而价税合计为 {}，差异 {} 元。",
                    fmt_money(Some(ex)),
                    fmt_money(c.tax_amount),
                    fmt_money(Some(calc)),
                    fmt_money(Some(total)),
                    fmt_money(Some(total - calc))
                );
                return mk_check(
                    2,
                    "fail",
                    conclusion,
                    ev,
                    Some("请核对合同含税/不含税口径，修正后重新提交。"),
                    Some(Diff {
                        left: fmt_money(Some(calc)),
                        right: fmt_money(Some(total)),
                        gap: round2(total - calc),
                    }),
                );
            }
        }
    }

    let mut acc_basis = "";
    if let (Some(acc_sum), Some(c)) = (acc_sum, c) {
        if let Some(ex) = c.amount_ex_tax {
            let ok_ex = same_amount(Some(acc_sum), Some(ex)).unwrap_or(false);
            let ok_total = c
                .amount_total
                .map(|t| same_amount(Some(acc_sum), Some(t)).unwrap_or(false))
                .unwrap_or(false);
            if !ok_ex && !ok_total {
                let gap = round2(acc_sum - ex);
                let gap_total = c.amount_total.map(|t| round2(acc_sum - t));
                let detail = match (c.amount_total, gap_total) {
                    (Some(total), Some(gt)) => format!(
                        "合同不含税金额 {} 元（含税 {} 元），验收单金额合计 {} 元，与不含税差 {} 元、与价税合计差 {} 元",
                        fmt_money(Some(ex)),
                        fmt_money(Some(total)),
                        fmt_money(Some(acc_sum)),
                        fmt_money(Some(gap)),
                        fmt_money(Some(gt))
                    ),
                    _ => format!(
                        "合同不含税金额 {} 元，验收单金额合计 {} 元，差 {} 元",
                        fmt_money(Some(ex)),
                        fmt_money(Some(acc_sum)),
                        fmt_money(Some(gap))
                    ),
                };
                let conclusion = format!(
                    "金额不一致：{}（{}）。",
                    detail,
                    if acc_sum > ex {
                        "验收金额偏大"
                    } else {
                        "验收金额偏小"
                    }
                );
                return mk_check(
                    2,
                    "fail",
                    conclusion,
                    ev,
                    Some("请核对验收数量与单价，确认差异原因（是否含税口径、是否部分验收、是否发生折让），修正后重新提交。"),
                    Some(Diff {
                        left: fmt_money(Some(ex)),
                        right: fmt_money(Some(acc_sum)),
                        gap,
                    }),
                );
            }
            acc_basis = if ok_ex {
                "不含税口径"
            } else {
                "含税口径"
            };
        }
    }

    if let (Some(declared), Some(_), Some(total)) = (
        application.declared_amount,
        c,
        c.and_then(|x| x.amount_total),
    ) {
        if !same_amount(Some(declared), Some(total)).unwrap_or(false) {
            let gap = round2(declared - total);
            let conclusion = format!(
                "申请单金额与合同金额不一致：合同价税合计 {} 元，申请单金额 {} 元，差异 {} 元。",
                fmt_money(Some(total)),
                fmt_money(Some(declared)),
                fmt_money(Some(gap))
            );
            return mk_check(
                2,
                "fail",
                conclusion,
                ev,
                Some("请核对合同金额，确认是否含税，修正申请单金额后重新提交。"),
                Some(Diff {
                    left: fmt_money(Some(total)),
                    right: fmt_money(Some(declared)),
                    gap,
                }),
            );
        }
    }

    if acc_sum.is_none() {
        let total = c.and_then(|x| x.amount_total);
        return mk_check(
            2,
            "warn",
            format!(
                "合同金额内部勾稽通过（{} 元），但缺少验收单，无法完成「合同—验收—发票」三方金额比对。",
                fmt_money(total)
            ),
            ev,
            Some("请补充验收单，确认控制权已转移后再开票。"),
            None,
        );
    }

    let c = c.expect("contract present when acceptance sum exists");
    let basis = if acc_basis == "含税口径" {
        "价税合计"
    } else {
        "不含税金额"
    };
    mk_check(
        2,
        "pass",
        format!(
            "金额三方一致：合同价税合计 {} 元 = 不含税 {} + 税额 {}；验收单金额合计 {} 元与合同{}精确一致（差异 0.00 元，{}）。",
            fmt_money(c.amount_total),
            fmt_money(c.amount_ex_tax),
            fmt_money(c.tax_amount),
            fmt_money(acc_sum),
            basis,
            acc_basis
        ),
        ev,
        None,
        None,
    )
}

fn check_scope(ctx: &AuditContext, application: &Application, rules: &Rules) -> Check {
    let mut ev = Vec::new();
    let c = ctx.contract.as_ref();
    let product = c.and_then(|x| x.items.first()).map(|i| i.name.clone());
    let region = region_of(ctx, application);
    let scope_hit = product.as_deref().and_then(|p| rules.scope_hit(p));
    if let (Some(c), Some(p)) = (c, product.as_deref()) {
        ev.push(ev_from_doc(c, "items", "合同标的", p));
    }
    let Some(product) = product else {
        return mk_check(
            3,
            "fail",
            "未识别到合同标的（货物/服务名称），无法核对开票范围。".into(),
            ev,
            Some("请补充销售合同，明确标的名称与规格型号。"),
            None,
        );
    };
    let Some(scope_hit) = scope_hit else {
        return mk_check(
            3,
            "warn",
            format!("开票品名「{product}」未匹配到企业经营范围目录，需人工确认是否超范围开票。"),
            ev,
            Some("请核对营业执照经营范围与商品税收分类编码，确认后再开具。"),
            None,
        );
    };

    if let Some(inv) = &ctx.invoice {
        if let Some(item) = inv.items.first() {
            let inv_name = item.name.clone();
            ev.push(ev_from_doc(inv, "items", "发票品名", inv_name.clone()));
            if inv_name.trim() != product.trim() {
                return mk_check(
                    3,
                    "fail",
                    format!(
                        "开票品名与合同标的不一致：合同为「{product}」，发票为「{inv_name}」。"
                    ),
                    ev,
                    Some("发票品名须与合同标的、税收分类编码一致，请修正后重开。"),
                    Some(Diff {
                        left: product.clone(),
                        right: inv_name,
                        gap: 0.0,
                    }),
                );
            }
        }
    }

    if region.contains("出口") {
        let is_export_inv =
            ctx.invoices.is_empty() || ctx.invoices.iter().all(|d| d.doc_type == doc_type::EXPORT);
        if !is_export_inv {
            let first_type = ctx
                .invoices
                .first()
                .map(|d| d.doc_type.as_str())
                .unwrap_or("");
            return mk_check(
                3,
                "fail",
                format!("出口业务应开具「出口发票」并适用 0% 税率，当前单据为「{first_type}」。"),
                ev,
                Some("出口业务请开具出口发票（0%），并按出口报关单核对 FOB 价。"),
                None,
            );
        }
        if let Some(d) = ctx.all.first() {
            ev.push(Evidence {
                doc_id: d.id.clone(),
                doc_type: "区域判定".into(),
                doc_date: String::new(),
                field: "销售区域".into(),
                value: "出口".into(),
                loc: "客户往来区域 · 出口".into(),
            });
        }
    }

    let buyer = buyer_name_of(ctx).unwrap_or_default();
    if rules.customer(&buyer).is_none() {
        return mk_check(
            3,
            "warn",
            format!(
                "开票品名「{}」在经营范围内（{}，{}），但购买方未在客户档案 customers 表匹配到记录。",
                product, scope_hit.category, scope_hit.note.clone().unwrap_or_else(|| "13%".into())
            ),
            ev,
            Some("请先在客户档案中建档并核对纳税人识别号与信用等级。"),
            None,
        );
    }

    mk_check(
        3,
        "pass",
        format!(
            "开票品名「{}」与合同标的精确一致，属于经营范围「{}」（{}），购买方已建档{}。",
            product,
            scope_hit.category,
            scope_hit.note.clone().unwrap_or_default(),
            if region.contains("出口") {
                "，出口业务开具出口发票（0%）"
            } else {
                ""
            }
        ),
        ev,
        None,
        None,
    )
}

fn appl_date_of(ctx: &AuditContext) -> Option<String> {
    ctx.all
        .iter()
        .find_map(|d| d.apply_date.as_ref().filter(|s| !s.is_empty()).cloned())
}

fn diff_days(a: &str, b: &str) -> i64 {
    let parse = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    match (parse(a), parse(b)) {
        (Some(a), Some(b)) => (b - a).num_days().abs(),
        _ => 0,
    }
}

fn check_date(ctx: &AuditContext) -> Check {
    let mut ev = Vec::new();
    let c = ctx.contract.as_ref();
    let acc = ctx.acceptance.as_ref();
    let deliver = ctx.deliveries.first();
    if let Some(c) = c {
        if !c.doc_date.is_empty() {
            ev.push(ev_from_doc(c, "docDate", "合同日期", c.doc_date.clone()));
        }
    }
    if let Some(a) = acc {
        ev.push(ev_from_doc(a, "docDate", "验收日期", a.doc_date.clone()));
    } else if let Some(d) = deliver {
        ev.push(ev_from_doc(d, "docDate", "签收日期", d.doc_date.clone()));
    }
    let Some(c) = c else {
        return mk_check(
            4,
            "fail",
            "缺少销售合同，无法核对开票日期与业务发生时点的先后关系。".into(),
            ev,
            Some("请补充销售合同后再提交审核。"),
            None,
        );
    };
    let Some(acc) = acc else {
        let reason = match deliver {
            Some(d) => format!(
                "单据中仅有「到货签收单」（{}，{} 已签发），缺少「验收单」；控制权尚未转移，本期不得开票。",
                d.id, d.doc_date
            ),
            None => "单据中缺少「验收单」，无法确认验收合格日期与控制权转移时点。".to_string(),
        };
        return mk_check(
            4,
            "suspend",
            format!("{reason}请登记为待开票事项，待验收合格后重新提交审核。"),
            ev,
            Some("按收入确认时点要求暂缓开票：先取得验收单（验收合格、控制权已转移），再重新提交开票申请。"),
            None,
        );
    };
    if !acc.doc_date.is_empty() && !c.doc_date.is_empty() && acc.doc_date < c.doc_date {
        return mk_check(
            4,
            "fail",
            format!(
                "验收日期 {} 早于合同签订日期 {}，业务时序不成立。",
                acc.doc_date, c.doc_date
            ),
            ev,
            Some("请核对合同签订日期与验收日期，疑似倒签或单据错配。"),
            None,
        );
    }
    let appl_date = appl_date_of(ctx)
        .or_else(|| Some(acc.doc_date.clone()))
        .or_else(|| Some(c.doc_date.clone()))
        .unwrap_or_default();
    ev.push(Evidence {
        doc_id: "开票申请单".into(),
        doc_type: doc_type::APPLICATION.into(),
        doc_date: String::new(),
        field: "拟开票日期".into(),
        value: appl_date.clone(),
        loc: "开票申请单 · 申请信息区 · 拟开票日期".into(),
    });
    if !appl_date.is_empty() && appl_date < acc.doc_date {
        return mk_check(
            4,
            "fail",
            format!(
                "拟开票日期 {} 早于验收合格日期 {}，控制权尚未转移，不得提前开票。",
                appl_date, acc.doc_date
            ),
            ev,
            Some("请在验收合格并转移控制权之后开具发票。"),
            None,
        );
    }
    let days = diff_days(&acc.doc_date, &appl_date);
    if days > 90 {
        return mk_check(
            4,
            "warn",
            format!(
                "业务时序通过（验收 {} → 开票 {}），但间隔 {} 天已超过 90 天，存在跨期收入确认风险。",
                acc.doc_date, appl_date, days
            ),
            ev,
            Some("请确认跨期原因，并按权责发生制确认收入。"),
            None,
        );
    }
    mk_check(
        4,
        "pass",
        format!(
            "日期合理：合同 {} → 验收合格 {} → 拟开票 {}（间隔 {} 天，控制权已转移）。",
            c.doc_date, acc.doc_date, appl_date, days
        ),
        ev,
        None,
        None,
    )
}

fn check_duplicate(ctx: &AuditContext, pool: &[PoolEntry]) -> Check {
    let buyer = buyer_name_of(ctx);
    let c = ctx.contract.as_ref();
    let (Some(buyer), Some(_), Some(total)) = (buyer, c, c.and_then(|x| x.amount_total)) else {
        return mk_check(
            5,
            "pass",
            "缺少比对要素（购买方或合同金额），跳过重复开票校验。".into(),
            vec![],
            None,
            None,
        );
    };
    let hits: Vec<&PoolEntry> = pool
        .iter()
        .filter(|p| p.party == buyer && same_amount(p.amount_total, Some(total)).unwrap_or(false))
        .collect();
    let ev: Vec<Evidence> = hits
        .iter()
        .map(|h| Evidence {
            doc_id: h.id.clone(),
            doc_type: h.doc_type.clone(),
            doc_date: h.doc_date.clone(),
            field: "价税合计".into(),
            value: fmt_money(h.amount_total),
            loc: format!("{} · {} · 合计区", h.id, h.doc_type),
        })
        .collect();
    if hits.is_empty() {
        return mk_check(
            5,
            "pass",
            format!(
                "发票池中未发现购买方「{}」同一金额（{} 元）的既有发票，无重复开票风险。",
                buyer,
                fmt_money(Some(total))
            ),
            ev,
            None,
            None,
        );
    }
    let blocking: Vec<&&PoolEntry> = hits.iter().filter(|h| h.pool_kind == "session").collect();
    if !blocking.is_empty() {
        let ids = blocking
            .iter()
            .map(|h| h.id.clone())
            .collect::<Vec<_>>()
            .join("、");
        return mk_check(
            5,
            "fail",
            format!(
                "重复开票：本会话中已对购买方「{}」金额 {} 元开具过发票 {}，同一业务不得重复开票。",
                buyer,
                fmt_money(Some(total)),
                ids
            ),
            ev,
            Some("如需重开，须先取得红字信息表开具红字发票（红冲）后再重新开具。"),
            None,
        );
    }
    let ids = hits
        .iter()
        .map(|h| h.id.clone())
        .collect::<Vec<_>>()
        .join("、");
    mk_check(
        5,
        "warn",
        format!(
            "发票池（历史数据集）中已存在购买方「{}」金额 {} 元的发票 {}。本数据集为同月已开具样本，仅作对照；正式环境须查询 tax_invoice_pool 校验。",
            buyer,
            fmt_money(Some(total)),
            ids
        ),
        ev,
        Some("若为复演/对照场景可继续；正式开票前请确认该业务未重复开票，必要时先红冲。"),
        None,
    )
}

struct Decision {
    result: String,
    risk_level: String,
}

fn decide(checks: &[Check]) -> Decision {
    let fails = checks.iter().filter(|c| c.status == "fail").count();
    let suspends = checks.iter().any(|c| c.status == "suspend");
    let warns = checks.iter().any(|c| c.status == "warn");
    if fails > 0 {
        return Decision {
            result: "fail".into(),
            risk_level: if fails >= 2 { "high" } else { "mid" }.into(),
        };
    }
    if suspends {
        return Decision {
            result: "suspend".into(),
            risk_level: "mid".into(),
        };
    }
    Decision {
        result: "pass".into(),
        risk_level: if warns { "mid" } else { "low" }.into(),
    }
}

fn summarize(result: &str, checks: &[Check], ctx: &AuditContext) -> String {
    let c = ctx.contract.as_ref();
    let title = c
        .and_then(|x| x.items.first())
        .map(|i| i.name.clone())
        .unwrap_or_default();
    match result {
        "pass" => {
            let passed = checks.iter().filter(|x| x.status == "pass").count();
            let warns = checks.iter().filter(|x| x.status == "warn").count();
            format!(
                "审核通过：{}/{} 项检查通过{}，业务「{}」金额 {} 元，已生成待确认开票草稿。",
                passed,
                checks.len(),
                if warns > 0 {
                    format!("（含 {warns} 项提示）")
                } else {
                    String::new()
                },
                title,
                fmt_money(c.and_then(|x| x.amount_total))
            )
        }
        "suspend" => format!(
            "审核暂停：证据不齐备，未能形成通过/不通过结论，不得开票。{}",
            checks
                .iter()
                .filter(|x| x.status == "suspend")
                .map(|x| x.conclusion.clone())
                .collect::<Vec<_>>()
                .join("")
        ),
        _ => format!(
            "审核不通过：{} 项检查未通过 —— {}",
            checks.iter().filter(|x| x.status == "fail").count(),
            checks
                .iter()
                .filter(|x| x.status == "fail")
                .map(|x| format!("{}：{}", x.name, x.conclusion))
                .collect::<Vec<_>>()
                .join(" ")
        ),
    }
}

fn build_evidence_table(checks: &[Check]) -> Vec<EvidenceRow> {
    let mut rows = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for ck in checks {
        for e in &ck.evidence {
            let key = format!("{}|{}|{}", e.doc_id, e.field, e.value);
            if !seen.insert(key) {
                continue;
            }
            rows.push(EvidenceRow {
                check: ck.name.clone(),
                check_key: ck.key.clone(),
                check_status: ck.status.clone(),
                doc_id: e.doc_id.clone(),
                doc_type: e.doc_type.clone(),
                field: e.field.clone(),
                value: e.value.clone(),
                loc: e.loc.clone(),
            });
        }
    }
    rows
}

pub fn run_audit(
    application: &Application,
    rules: &Rules,
    pool: &[PoolEntry],
    operator: &str,
    rule_mode: &str,
) -> AuditResult {
    let ctx = context(application);
    let checks = vec![
        check_title(&ctx, application),
        check_tax_rate(&ctx, application, rules),
        check_amount(&ctx, application),
        check_scope(&ctx, application, rules),
        check_date(&ctx),
        check_duplicate(&ctx, pool),
    ];
    let d = decide(&checks);
    let evidence_table = build_evidence_table(&checks);
    let summary = summarize(&d.result, &checks, &ctx);
    let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let application_no = if application.application_no.is_empty() {
        format!("APP-{}", Local::now().timestamp_millis())
    } else {
        application.application_no.clone()
    };
    let result_label = match d.result.as_str() {
        "pass" => "通过",
        "suspend" => "暂缓（证据不齐备）",
        _ => "不通过",
    };
    let documents = application
        .documents
        .iter()
        .map(|x| {
            let cl = classify(x);
            DocumentSummary {
                id: x.id.clone(),
                doc_type: x.doc_type.clone(),
                classified: cl.doc_type,
                confidence: cl.confidence,
                reason: cl.reason,
                doc_date: x.doc_date.clone(),
                party: x.party.clone(),
                amount: x.amount_total,
            }
        })
        .collect();
    AuditResult {
        application_no,
        audited_at: now,
        operator: if operator.is_empty() {
            if application.applicant.is_empty() {
                "李娜".into()
            } else {
                application.applicant.clone()
            }
        } else {
            operator.to_string()
        },
        applicant: if application.applicant.is_empty() {
            "—".into()
        } else {
            application.applicant.clone()
        },
        result: d.result.clone(),
        result_label: result_label.into(),
        risk_level: d.risk_level,
        summary,
        checks,
        evidence_table,
        rule_mode: if rule_mode.is_empty() {
            "rule".into()
        } else {
            rule_mode.into()
        },
        documents,
    }
}

pub fn checks_meta() -> Vec<serde_json::Value> {
    CHECK_DEFS
        .iter()
        .map(|(key, name, desc, rule)| {
            serde_json::json!({ "key": key, "name": name, "desc": desc, "rule": rule })
        })
        .collect()
}
pub fn now_text() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn days_between(a: &str, b: &str) -> i64 {
    diff_days(a, b)
}
