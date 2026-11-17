//! Structural document classification: only field labels and values are used,
//! never the docType tag produced by the parser.

use crate::model::{Document, Item};
use crate::money::parse_rate;
use serde::{Deserialize, Serialize};

pub mod doc_type {
    pub const SPECIAL: &str = "增值税专用发票";
    pub const NORMAL: &str = "增值税普通发票";
    pub const EXPORT: &str = "出口发票";
    pub const SALES_CONTRACT: &str = "销售合同";
    pub const PURCHASE_CONTRACT: &str = "采购合同";
    pub const ACCEPTANCE: &str = "验收单";
    pub const DELIVERY_SIGN: &str = "到货签收单";
    pub const STOCK_OUT: &str = "出库单";
    pub const CUSTOMS: &str = "海关进口增值税专用缴款书";
    pub const APPLICATION: &str = "开票申请单";
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub doc_type: String,
    pub confidence: f64,
    pub reason: String,
    pub signals: Vec<String>,
}

impl Classification {
    fn new(doc_type: &str, confidence: f64, reason: String, signals: &[&str]) -> Self {
        Self {
            doc_type: doc_type.to_string(),
            confidence,
            reason,
            signals: signals.iter().map(|s| s.to_string()).collect(),
        }
    }
}

fn quality_text(items: &[Item]) -> String {
    items
        .iter()
        .map(|i| i.extra_text("quality"))
        .collect::<Vec<_>>()
        .join("")
}

pub fn classify(doc: &Document) -> Classification {
    let labels: Vec<&str> = doc.fields.iter().map(|f| f.label.as_str()).collect();
    let has = |label: &str| labels.iter().any(|l| *l == label);
    let self_name = if doc.self_name.is_empty() {
        "华衡智造集团股份有限公司"
    } else {
        doc.self_name.as_str()
    };
    let rate = doc.tax_rate.clone().unwrap_or_default();
    let rate_num = parse_rate(&rate);

    if has("计税价格（CIF+关税）") || has("进口增值税") {
        return Classification::new(
            doc_type::CUSTOMS,
            0.99,
            "存在「计税价格（CIF+关税）」「进口增值税」专用栏位".into(),
            &["合计区 进口增值税"],
        );
    }

    if has("发票代码") && has("校验码") {
        if rate_num == Some(0.0) {
            return Classification::new(
                doc_type::EXPORT,
                0.98,
                "发票要素齐全且税率为 0%（出口零税率）".into(),
                &["发票代码", "校验码", "税率 0%"],
            );
        }
        let has_spec = doc
            .items
            .iter()
            .any(|it| it.qty.is_some() && it.unit_price.is_some());
        if has_spec {
            let tax_note = doc
                .party_tax_no
                .as_deref()
                .filter(|s| !s.is_empty())
                .map(|s| format!("，购买方税号 {s}"))
                .unwrap_or_default();
            return Classification::new(
                doc_type::SPECIAL,
                0.97,
                format!("发票要素齐全，明细为「数量×单价」货物票面{tax_note}"),
                &["发票代码", "校验码", "数量×单价明细"],
            );
        }
        return Classification::new(
            doc_type::NORMAL,
            0.95,
            format!("发票要素齐全，明细为「项目/金额/税额」费用票面，税率 {rate}"),
            &["发票代码", "校验码", "费用项目明细"],
        );
    }

    if has("合同编号") {
        let mut seller_is_self = false;
        let mut buyer_is_self = false;
        for f in &doc.fields {
            let value = f.value_text();
            if f.label == "销售方名称" && value == self_name {
                seller_is_self = true;
            }
            if f.label == "买方" && value == self_name {
                buyer_is_self = true;
            }
            if f.label == "卖方" && value == self_name {
                seller_is_self = true;
            }
            if f.label == "买方（甲方）" && value == self_name {
                buyer_is_self = true;
            }
        }
        if buyer_is_self {
            return Classification::new(
                doc_type::PURCHASE_CONTRACT,
                0.96,
                "含合同编号且本企业为买方（采购方向）".into(),
                &["合同编号", "买方=本企业"],
            );
        }
        return Classification::new(
            doc_type::SALES_CONTRACT,
            0.97,
            format!(
                "含合同编号且本企业为卖方/销售方，{}",
                if seller_is_self {
                    "合同要素表含「增值税率」「价税合计」"
                } else {
                    "合同要素表完整"
                }
            ),
            &["合同编号", "卖方=本企业"],
        );
    }

    if has("物料编码") || has("成本单价") {
        return Classification::new(
            doc_type::STOCK_OUT,
            0.97,
            "含「物料编码」「成本单价/成本金额」成本口径栏位".into(),
            &["物料编码", "成本金额"],
        );
    }

    if has("质检结果") || has("实收 / 实盘数量") {
        let qs = quality_text(&doc.items);
        if qs.contains("验收") || qs.contains("控制权") {
            let head: String = qs.chars().take(24).collect();
            return Classification::new(
                doc_type::ACCEPTANCE,
                0.98,
                format!("含质检结果且结论为「{head}」"),
                &["质检结果", "实收数量"],
            );
        }
        return Classification::new(
            doc_type::DELIVERY_SIGN,
            0.90,
            format!(
                "含到货签收栏位、质检结论为入库状态：{}",
                if qs.is_empty() { "—" } else { qs.as_str() }
            ),
            &["质检结果", "实收数量"],
        );
    }

    let title = if doc.doc_type_raw.is_empty() {
        doc.title.clone()
    } else {
        doc.doc_type_raw.clone()
    };
    if title.contains("合同") {
        return Classification::new(
            if title.contains("采购") {
                doc_type::PURCHASE_CONTRACT
            } else {
                doc_type::SALES_CONTRACT
            },
            0.70,
            format!("标题关键词兜底：{title}"),
            &["标题"],
        );
    }
    if title.contains("发票") {
        return Classification::new(
            doc_type::NORMAL,
            0.60,
            format!("标题关键词兜底：{title}"),
            &["标题"],
        );
    }
    Classification::new(
        if title.is_empty() {
            "未知单据"
        } else {
            title.as_str()
        },
        0.30,
        "无法归类，需人工确认".into(),
        &[],
    )
}
