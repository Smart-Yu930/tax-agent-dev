# 数据契约（DATA_CONTRACT）V1.0

本文件是 `index.html` 内联数据与各 JS 模块之间唯一的接口约定。
任何模块只能依赖本文件定义的字段，不得臆造字段。

## 0. 构建与文件

```
src/            # 源码（分模块，便于并行开发与测试）
  styles.css        # 全局设计令牌 + 实务系统 + 智能体三区样式
  practice.js       # 实务系统 6 模块（复刻 P1-01 增值税发票开具系统）
  engine.js         # 审核引擎（识别、提取、5 项校验、草稿生成、来源追溯）
  agent.js          # 智能体三区工作流 + 大模型适配 + 测试示例模块
  boot.js           # 组装、路由、事件绑定
data/           # 预生成结构化数据（JSON）
   documents.json    # 175 张单据解析结果
   ledger.json       # 单据台账 175 行
   tables.json       # 销售明细表 / 关键业务数据表 / 智能体测试用例表
   policies.json     # 5 项企业制度要点与审核规则映射
   dict.json         # 税率字典、客户档案、开票范围、字段定义
tools/
   parse_docs.py     # 单据原件 HTML → documents.json
   build_data.py     # xlsx + manifest → ledger/tables/dict
   build.py          # 内联 src/* + data/* → index.html（单文件）
   acceptance.mjs    # 验收测试（Node，直接复用 engine.js）
index.html      # 交付物：单文件，双击即开
```

`index.html` 由 `tools/build.py` 生成，**不要手改 index.html**；改 `src/` 或 `data/` 后重新构建。

## 1. 内联数据结构

```js
window.TAX_DATA = {
  meta:      { case, period, company, selfTaxNo, generatedAt, docCount, tableCount },
  documents: [ Doc, ... ],      // 175 条
  ledger:    [ LedgerRow, ... ],// 175 条
  tables:    { sales: SalesRow[], kpi: KpiRow[], cases: TestCase[] },
  policies:  [ Policy, ... ],   // 5 条
  dict:      { taxRates, customers, scope, fieldDefs, docTypes }
}
```

## 2. Doc（单据解析结果）

```js
{
  idx: 1,                        // 台账序号 1..175
  id: "FP-202512-001",           // 单据编号
  file: "001-FP-202512-001-增值税专用发票-销售发票.html",
  docType: "增值税专用发票",       // 见 dict.docTypes
  title: "销售发票",
  docDate: "2025-12-05",
  party: "上海衡远机电设备有限公司", // 对方单位（购买方/卖方/往来单位/供应商）
  partyRole: "购买方",             // 购买方 | 销售方 | 往来单位 | 卖方 | 买方
  partyTaxNo: "91310112MA1GC8X21K" | null,
  selfName: "华衡智造集团股份有限公司",
  selfTaxNo: "91440300MA5H8K2X3Q",

  amountExTax: 27000000.00 | null, // 不含税金额
  taxAmount: 3510000.00 | null,    // 税额
  amountTotal: 30510000.00 | null, // 价税合计 / 合同总价 / 业务金额
  amountInWords: "人民币叁仟零伍拾壹万元整" | null,
  taxRate: "13%" | null,           // 主税率（明细首行税率 / 合同增值税率 / 征税率）
  currency: "CNY",

  invoiceCode: "044002500111" | null,
  invoiceNo: "25248111" | null,
  checkCode: "748111 9021 3388" | null,
  contractNo: "HT-202512-001" | null,
  remark: null | "...",

  items: [ Item, ... ],          // 明细行，无明细则为 []
  fields: [ Field, ... ],        // 全部已抽取字段 + 来源位置（来源追溯用）
  textLen: 11191,                // 原始文本长度（体量提示）
  parseWarnings: []              // 解析告警（缺字段等）
}

Item = {
  name, spec, unit,
  qty: 6, unitPrice: 4500000, amount: 27000000,
  taxRate: "13%", taxAmount: 3510000,
  loc: "明细表 第1行"            // 明细行来源
}

Field = {
  key: "amountTotal",            // 语义键（可用于审核取值）
  label: "价税合计（小写）",       // 原始标签文字
  value: "30510000.00",          // 原文值（字符串，保留原样）
  num: 30510000.00 | null,       // 数值化（金额/数量/税率）
  loc: "合计区 · 价税合计",        // 来源位置（区块 + 行/列）
  field_source: "rule"           // rule | ocr | llm（本轮均为 rule）
}
```

**来源追溯硬要求**：`fields[].loc` 必须能唯一定位到「单据内区块 + 行/列」，
审核报告里每个证据字段都要能显示 `单据编号 · 单据类型 · loc`。

`docTypes` 取值固定为：
`增值税专用发票 | 增值税普通发票 | 出口发票 | 销售合同 | 采购合同 | 验收单 | 到货签收单 | 出库单 | 海关进口增值税专用缴款书`

## 3. LedgerRow（单据台账）

```js
{ idx:1, id:"FP-202512-001", docType:"增值税专用发票", summary:"销售发票",
  date:"2025-12-05", party:"上海衡远机电设备有限公司", amount:30510000, file:"001-....html" }
```

## 4. tables

```js
SalesRow = { product, date, customer, qty, unitPrice, amount, region }  // region: 内销|出口
KpiRow   = { no, item, value, unit, note }
TestCase = { no:"TC-001", step, scenario, input, expected, criteria, score, taskType }
```

## 5. dict

```js
taxRates: [{ rate:"13%", code:"0.13", scope:"货物销售、加工修理修配劳务、有形动产租赁", source:"tax_rates" }, ...]
// 固定 5 档：13% / 9% / 6% / 0% / 5%

customers: [{ name, taxNo, creditLevel:null, invoiceCount, source:"document"|"customers表" }]
// creditLevel 为 null 表示数据集未提供，界面显示「未提供（需对接 customers 表）」，不得编造

scope: [{ product:"五轴数控机床 HMC-800", category:"货物-机械设备", defaultRate:"13%", taxClass:"应税货物" }, ...]

fieldDefs: [{ key:"party", label:"购买方名称", required:true, kinds:["增值税专用发票","出口发票"], check:"check_title" }, ...]

docTypes: [{ name:"增值税专用发票", role:"销项", auditRequired:true, evidence:["销售合同","验收单","出库单"] }, ...]
```

## 6. Policy（企业制度映射）

```js
{ id:"sys44", file:"44-数据管理制度.txt", name:"数据管理制度", dept:"信息管理部",
  clauses: [ { no:"§x.y", title:"...", text:"原文摘录(<=200字)", loc:"第X部分 第Y章" } ],
  rules:   [ "check_amount", ... ]  // 该制度支撑的审核项
}
```

## 7. 引擎接口（engine.js）

```js
window.TaxEngine = {
  TAX_RATES, SCOPE,                              // 来自 dict
  classifyDoc(doc),                              // → { docType, confidence, reason }
  extractFields(doc),                            // → Field[]
  runAudit(application, ctx),                    // → AuditResult
  buildDraft(auditResult, ctx),                  // → Draft | null
  formatMoney(n), parseAmount(s), taxRateNum(s)   // 工具
}
```

`application`（一次开票申请）：
```js
{ applicationNo:"INV-2025-12-001", applicant:"李娜", applyDate:"2025-12-05",
  documents:[Doc,...],   // 上传/载入的单据集合（含申请单、合同、验收单、出库单…）
  declaredAmount: 30510000 | null,   // 申请单声明金额（如有）
  declaredTaxRate: "13%" | null,
  customerOverride: null }
```

`AuditResult`：
```js
{ applicationNo, auditedAt, operator, result:"pass"|"fail"|"suspend",
  checks: [ { key:"check_title", name:"抬头一致性", status:"pass"|"warn"|"fail",
              conclusion:"...", evidence:[{docId,docType,field,value,loc}],
              diff: null|{left,right,gap}, advice:null|"..." } ],
  evidenceTable: [...],       // 字段-来源对照表
  ruleMode: "rule"|"hybrid-llm",
  summary: "...", riskLevel: "low"|"mid"|"high" }
```

`Draft`：
```js
{ draftNo, status:"pending", buyer:{name,taxNo}, seller:{name,taxNo},
  invoiceType:"增值税专用发票", items:[Item],
  amountExTax, taxRate, taxAmount, amountTotal,
  highlights:["party","amountTotal","taxRate"], commonErrors:[...],
  sources:[{field,docId,loc}], createdAt }
```

## 8. 实务系统模块契约（practice.js）

```js
window.Practice = {
  mount(container, data, ctx)   // 渲染 6 模块，返回 { show(viewName) }
}
// ctx: { goAgent(), openDraft(draft), toast(msg), getState() }
```

模块顺序（与 P1-01 实务系统一致）：
`开票工作台 | 合同与验收台账 | 待开票清单 | 发票开具 | 红冲与作废 | 开票台账`

## 9. 设计令牌

```css
--ink:#0b1b2b; --ink2:#12324c; --gold:#b5852f; --gold2:#d7b36a;
--bg:#eef2f6; --card:#fff; --line:#dfe7f0; --text:#1f3042; --muted:#6b7f93;
--ok:#0f6b4f; --warn:#9a4b00; --bad:#b91c1c;
```
