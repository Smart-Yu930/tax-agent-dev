use std::collections::BTreeMap;
use tax_core::catalog;
use tax_core::data::dataset;

#[test]
fn every_sales_row_produces_an_audit() {
    let ds = dataset();
    assert_eq!(ds.documents.len(), 175);
    assert_eq!(ds.tables.sales.len(), 22);

    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for index in 0..ds.tables.sales.len() {
        let row = &ds.tables.sales[index];
        let app = catalog::application_for_sale(index)
            .unwrap_or_else(|| panic!("row {index} should assemble an application"));
        assert_eq!(app.application_no, format!("INV-2025-12-{:03}", index + 1));
        assert!(!app.documents.is_empty());
        let outcome = tax_core::audit_application(&app, &[], "测试", "rule");
        *counts.entry(outcome.audit.result.clone()).or_default() += 1;
        println!(
            "{:03} {:<24} {:<6} checks={} draft={}",
            index + 1,
            row.product,
            outcome.audit.result,
            outcome
                .audit
                .checks
                .iter()
                .filter(|c| c.status == "pass")
                .count(),
            outcome.draft.is_some()
        );
        if outcome.audit.result == "pass" {
            assert!(
                outcome.draft.is_some(),
                "passing audit must produce a draft"
            );
        } else {
            assert!(outcome.draft.is_none(), "non-passing audit must not draft");
        }
        assert_eq!(outcome.audit.evidence_table.is_empty(), false);
    }
    println!("distribution: {counts:?}");
    assert_eq!(counts.values().sum::<usize>(), 22);
    assert!(counts.get("pass").copied().unwrap_or(0) >= 20);
}

fn field(label: &str, value: serde_json::Value, loc: &str) -> tax_core::ExtractedField {
    tax_core::ExtractedField {
        key: None,
        label: label.into(),
        value,
        loc: Some(loc.into()),
        field_source: None,
    }
}

fn test_doc(
    id: &str,
    doc_type: &str,
    party: &str,
    total: f64,
    rate: Option<&str>,
    date: &str,
) -> tax_core::Document {
    let rate = rate.unwrap_or("13%");
    let pct: f64 = rate.trim_end_matches('%').parse().unwrap_or(13.0) / 100.0;
    let ex = (total / (1.0 + pct) * 100.0).round() / 100.0;
    let tax = ((total - ex) * 100.0).round() / 100.0;
    tax_core::Document {
        id: id.into(),
        doc_type: doc_type.into(),
        doc_date: date.into(),
        party: party.into(),
        party_tax_no: Some("91310000XXXXXX".into()),
        amount_ex_tax: Some(ex),
        tax_amount: Some(tax),
        amount_total: Some(total),
        tax_rate: Some(rate.into()),
        items: vec![tax_core::Item {
            name: "智能设备".into(),
            spec: "A-STD".into(),
            unit: "台".into(),
            qty: Some(10.0),
            unit_price: Some((ex / 10.0 * 100.0).round() / 100.0),
            amount: Some(ex),
            tax_rate: Some(rate.into()),
            tax_amount: Some(tax),
            extra: serde_json::Value::Null,
            loc: "明细表 第1行".into(),
        }],
        fields: vec![
            field("购买方名称", party.into(), "往来方区 · 第1方"),
            field("价税合计", total.into(), "合计区 · 价税合计"),
            field("单据日期", date.into(), "页眉区 · 单据编号"),
        ],
        ..Default::default()
    }
}

fn tc1() -> tax_core::Application {
    tax_core::Application {
        application_no: "TEST-TC1".into(),
        applicant: "测试示例".into(),
        apply_date: "2024-03-15".into(),
        region: "内销".into(),
        declared_amount: Some(113000.0),
        declared_customer: "XX科技有限公司".into(),
        customer: "XX科技有限公司".into(),
        product: String::new(),
        source: "testCase1".into(),
        documents: vec![
            test_doc(
                "TEST-APP-1",
                "开票申请单",
                "XX科技有限公司",
                113000.0,
                Some("13%"),
                "2024-03-15",
            ),
            test_doc(
                "TEST-CON-1",
                "销售合同",
                "XX科技有限公司",
                113000.0,
                Some("13%"),
                "2024-03-01",
            ),
            test_doc(
                "TEST-ACC-1",
                "验收单",
                "XX科技有限公司",
                113000.0,
                None,
                "2024-03-15",
            ),
        ],
    }
}

fn tc2() -> tax_core::Application {
    tax_core::Application {
        application_no: "TEST-TC2".into(),
        applicant: "测试示例".into(),
        apply_date: "2024-03-15".into(),
        region: "内销".into(),
        declared_amount: Some(100000.0),
        declared_customer: "XX科技有限公司".into(),
        customer: "XX科技有限公司".into(),
        product: String::new(),
        source: "testCase2".into(),
        documents: vec![
            test_doc(
                "TEST-APP-2",
                "开票申请单",
                "XX科技有限公司",
                100000.0,
                Some("13%"),
                "2024-03-15",
            ),
            test_doc(
                "TEST-CON-2",
                "销售合同",
                "XX科技有限公司",
                113000.0,
                Some("13%"),
                "2024-03-01",
            ),
        ],
    }
}

#[test]
fn test_case_1_passes_and_drafts() {
    let outcome = tax_core::audit_application(&tc1(), &[], "测试示例", "rule");
    assert_eq!(outcome.audit.result, "pass", "{:?}", outcome.audit.summary);
    assert!(outcome.draft.is_some());
}

#[test]
fn test_case_2_fails_on_amount() {
    let outcome = tax_core::audit_application(&tc2(), &[], "测试示例", "rule");
    assert_eq!(outcome.audit.result, "fail", "{:?}", outcome.audit.summary);
    let amount = outcome
        .audit
        .checks
        .iter()
        .find(|c| c.key == "check_amount")
        .unwrap();
    assert_eq!(amount.status, "fail");
    assert!(outcome.draft.is_none());
}

#[test]
fn tc022_without_acceptance_suspends() {
    let ds = dataset();
    let contract = ds
        .documents
        .iter()
        .find(|d| d.id == "HT-202512-002")
        .unwrap()
        .clone();
    let receipt = ds
        .documents
        .iter()
        .find(|d| d.doc_type == "到货签收单")
        .unwrap()
        .clone();
    let delivery = ds
        .documents
        .iter()
        .find(|d| {
            d.doc_type == "出库单"
                && d.party == "上海衡远机电设备有限公司"
                && d.items.first().and_then(|i| i.qty) == Some(2.0)
        })
        .unwrap()
        .clone();
    let app = tax_core::Application {
        application_no: "INV-2025-12-023".into(),
        applicant: "李娜".into(),
        apply_date: "2025-12-05".into(),
        region: "内销".into(),
        declared_amount: contract.amount_total,
        declared_customer: "上海衡远机电设备有限公司".into(),
        customer: "上海衡远机电设备有限公司".into(),
        product: "五轴数控机床 HMC-800".into(),
        source: "TC-022".into(),
        documents: vec![contract, receipt, delivery],
    };
    let outcome = tax_core::audit_application(&app, &[], "测试", "rule");
    assert_eq!(
        outcome.audit.result, "suspend",
        "{:?}",
        outcome.audit.summary
    );
    assert!(outcome.draft.is_none());
    let date = outcome
        .audit
        .checks
        .iter()
        .find(|c| c.key == "check_date")
        .unwrap();
    assert_eq!(date.status, "suspend");
}

#[test]
fn sale_results_match_acceptance_report() {
    let ds = dataset();
    let report: serde_json::Value =
        serde_json::from_str(include_str!("../../../../data/_acceptance_report.json"))
            .expect("acceptance report json");
    let apps = report["details"]["applications"].as_array().unwrap();
    assert_eq!(apps.len(), 23);
    for index in 0..ds.tables.sales.len() {
        let app = catalog::application_for_sale(index).unwrap();
        let outcome = tax_core::audit_application(&app, &[], "测试", "rule");
        let expected = apps
            .iter()
            .find(|a| a["applicationNo"].as_str() == Some(app.application_no.as_str()))
            .unwrap_or_else(|| panic!("acceptance row missing for {}", app.application_no));
        assert_eq!(
            outcome.audit.result,
            expected["result"].as_str().unwrap(),
            "{}",
            app.application_no
        );
        let expected_checks: Vec<&str> = expected["checks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["status"].as_str().unwrap())
            .collect();
        let actual_checks: Vec<&str> = outcome
            .audit
            .checks
            .iter()
            .map(|c| c.status.as_str())
            .collect();
        assert_eq!(actual_checks, expected_checks, "{}", app.application_no);
        assert_eq!(
            outcome.draft.as_ref().map(|d| d.amount_total),
            expected["draft"]["amountTotal"].as_f64(),
            "{}",
            app.application_no
        );
    }
}
