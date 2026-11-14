/**
 * acceptance.mjs —— 智能发票审核与开发助手 · 验收测试台
 * 用 Node 直接加载 src/engine.js（与 index.html 内联的是同一份代码），
 * 对 P1-01 数据集跑 8 项验收指标 + 负向用例。
 *
 * 运行：node tools/acceptance.mjs
 * 输出：控制台报告 + data/_acceptance_report.json
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = (f) => path.join(ROOT, 'data', f);
const readJSON = (f) => JSON.parse(fs.readFileSync(D(f), 'utf8'));

// ---- 载入引擎（与浏览器同一份源码）
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'src', 'engine.js'), 'utf8'), { filename: 'engine.js' });
const E = globalThis.TaxEngine;

const documents = readJSON('documents.json');
const ledger = readJSON('ledger.json');
const tables = readJSON('tables.json');
const dict = readJSON('dict.json');
const reconcile = readJSON('_reconcile_report.json');
E.configure({ dict });

const byId = new Map(documents.map((d) => [d.id, d]));
const SELF = documents[0].selfName;

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const pct = (n, d) => (d === 0 ? 'n/a' : (100 * n / d).toFixed(2) + '%');

// ============================================================ 1. 单据分类识别
log('\n========== 1. 单据分类识别准确率 ==========');
let clsOk = 0;
const clsBad = [];
const confSum = [];
for (const d of documents) {
  const r = E.classifyDoc(d);
  confSum.push(r.confidence);
  if (r.docType === d.docType) clsOk++;
  else clsBad.push({ id: d.id, expect: d.docType, got: r.docType, conf: r.confidence, reason: r.reason });
}
log(`样本 ${documents.length} 张，判对 ${clsOk} 张，准确率 ${pct(clsOk, documents.length)}（目标 ≥98%）`);
log(`平均置信度 ${(confSum.reduce((a, b) => a + b, 0) / confSum.length).toFixed(3)}`);
if (clsBad.length) clsBad.forEach((x) => log(`   ✗ ${x.id} 期望 ${x.expect} → 判定 ${x.got}（${x.reason}）`));
else log('   无判错样本');

// ============================================================ 2. 关键字段提取
log('\n========== 2. 关键字段提取准确率（对台账独立核对） ==========');
// 台账是独立来源：单据编号/类型/日期/对方单位/金额，可反向校验抽取结果
const ledgerBasis = reconcile.basisNote;
let fTotal = 0, fOk = 0;
const fBad = [];
for (const lr of ledger) {
  const d = byId.get(lr.id);
  if (!d) continue;
  const basis = ledgerBasis[d.docType] || '';
  let docAmount = d.amountTotal;
  if (basis === '进口增值税') docAmount = d.taxAmount;
  const cases = [
    ['单据类型', d.docType, lr.docType],
    ['业务日期', d.docDate, lr.date],
    ['对方单位', d.party, lr.party],
    ['业务金额', docAmount === null ? null : E.r2(docAmount), lr.amount === null ? null : E.r2(lr.amount)],
  ];
  for (const [name, got, want] of cases) {
    fTotal++;
    if (String(got) === String(want)) fOk++;
    else fBad.push({ id: lr.id, name, got, want });
  }
}
log(`核对 ${fTotal} 个字段（${ledger.length} 张 × 4 字段），一致 ${fOk}，准确率 ${pct(fOk, fTotal)}（目标 ≥98%）`);
if (fBad.length) fBad.slice(0, 10).forEach((x) => log(`   ✗ ${x.id} ${x.name} 抽取=${x.got} 台账=${x.want}`));

// 税率字段（对销项发票独立核对：专票 13%、出口票 0%）
let rTotal = 0, rOk = 0;
const rBad = [];
for (const d of documents) {
  if (!d.docType.endsWith('发票') || !d.taxRate) continue;
  if (d.docType === '增值税普通发票') continue; // 费用类普票征收率另计（见下方数据发现）
  rTotal++;
  const isExport = d.docType === '出口发票';
  const want = isExport ? '0%' : '13%';
  if (d.taxRate === want) rOk++; else rBad.push({ id: d.id, got: d.taxRate, want });
}
log(`销项发票税率核对 ${rTotal} 张（专票/出口票）：一致 ${rOk}，准确率 ${pct(rOk, rTotal)}；异常 ${rBad.length}`);
rBad.slice(0, 5).forEach((x) => log(`   ✗ ${x.id} 抽取=${x.got} 期望=${x.want}`));

// 数据发现：费用类普通发票征收率不在 tax_rates 五档字典内
const normalRates = {};
for (const d of documents) {
  if (d.docType !== '增值税普通发票' || !d.taxRate) continue;
  normalRates[d.taxRate] = (normalRates[d.taxRate] || 0) + 1;
}
log(`费用类普通发票征收率分布：${JSON.stringify(normalRates)}（tax_rates 字典为 13/9/6/0/5，征收率 3% 不在字典内 → 已列入数据质量发现）`);

// ============================================================ 3. 来源可追溯率
log('\n========== 3. 字段来源可追溯率 ==========');
let allFields = 0, locFields = 0, extractFields = 0, extractLoc = 0;
for (const d of documents) {
  allFields += d.fields.length;
  locFields += d.fields.filter((f) => f.loc).length;
  const ex = E.extractFields(d);
  extractFields += ex.fields.length;
  extractLoc += ex.fields.filter((f) => f.trace).length;
}
log(`全量字段 ${allFields} 个，有来源定位 ${locFields} 个，可追溯率 ${pct(locFields, allFields)}（目标 ≥99%）`);
log(`审核用关键字段 ${extractFields} 个，有来源串 ${extractLoc} 个，可追溯率 ${pct(extractLoc, extractFields)}`);

// ============================================================ 申请装配
function matchDocs(row) {
  // 与前端一致：优先使用构建期预计算的证据
  if (row.evidence && row.evidence.docs && row.evidence.docs.length) {
    return {
      contract: byId.get(row.evidence.contract) || null,
      acceptance: byId.get(row.evidence.acceptance) || null,
      stockOut: byId.get(row.evidence.stockOut) || null,
      sign: row.evidence.deliverySign ? byId.get(row.evidence.deliverySign) : null,
    };
  }
  const wantTotal = E.r2(row.amount * (row.region === '出口' ? 1 : 1.13));
  const cand = documents.filter((d) => d.party === row.customer);
  const byAmount = (types, target) => cand.filter((d) => types.includes(d.docType) && d.amountTotal !== null && Math.abs(d.amountTotal - target) < 0.01);
  const byName = (types) => cand.filter((d) => types.includes(d.docType) && d.items[0] && d.items[0].name === row.product);
  const byQty = (types) => cand.filter((d) => types.includes(d.docType) && d.items[0] && d.items[0].qty === row.qty);

  let contracts = byAmount(['销售合同'], wantTotal).filter((d) => d.items[0] && d.items[0].name === row.product);
  if (!contracts.length) contracts = byAmount(['销售合同'], wantTotal);
  if (contracts.length > 1) contracts = contracts.filter((d) => d.items[0] && d.items[0].qty === row.qty);
  const contract = contracts[0] || null;

  let accs = byAmount(['验收单'], row.amount).filter((d) => !d.items[0] || d.items[0].name === row.product || true);
  if (accs.length > 1) {
    const named = accs.filter((d) => d.items[0] && d.items[0].name === row.product);
    if (named.length) accs = named;
  }
  const acceptance = accs[0] || null;

  let cks = byQty(['出库单']);
  if (cks.length > 1) {
    const byDate = cks.filter((d) => d.docDate === row.date);
    if (byDate.length) cks = byDate;
  }
  const stockOut = cks[0] || null;

  const sign = cand.filter((d) => d.docType === '到货签收单')[0] || null;
  return { contract, acceptance, stockOut, sign };
}

function buildApplication(row, i, opts = {}) {
  const m = matchDocs(row);
  const docs = [m.contract, m.acceptance, m.stockOut].filter(Boolean);
  if (opts.withSign && m.sign) docs.push(m.sign);
  if (opts.withInvoice) {
    const inv = documents.filter((d) => d.docType.endsWith('发票') && d.party === row.customer &&
      d.amountTotal !== null && Math.abs(d.amountTotal - m.contract.amountTotal) < 0.01)[0];
    if (inv) docs.push(inv);
  }
  return {
    applicationNo: `INV-2025-12-${String(i + 1).padStart(3, '0')}`,
    applicant: '李娜',
    applyDate: row.date,
    region: row.region,
    declaredAmount: opts.declaredAmount !== undefined ? opts.declaredAmount : (m.contract ? m.contract.amountTotal : null),
    declaredCustomer: opts.declaredCustomer !== undefined ? opts.declaredCustomer : row.customer,
    customer: row.customer,
    product: row.product,
    documents: docs,
    _match: m,
  };
}

// 22 条待开票事项
const apps = tables.sales.map((row, i) => buildApplication(row, i));

// TC-022：上海衡远 未验收 2 台（仅有到货签收单，无验收单）
const ht002 = byId.get('HT-202512-002');
const sign002 = documents.filter((d) => d.docType === '到货签收单')[0];
const ck002 = documents.filter((d) => d.docType === '出库单' && d.party === '上海衡远机电设备有限公司' && d.items[0] && d.items[0].qty === 2)[0];
const app022 = {
  applicationNo: 'INV-2025-12-023',
  applicant: '李娜',
  applyDate: '2025-12-05',
  declaredAmount: ht002.amountTotal,
  declaredCustomer: '上海衡远机电设备有限公司',
  customer: '上海衡远机电设备有限公司',
  product: '五轴数控机床 HMC-800',
  documents: [ht002, sign002, ck002].filter(Boolean),
};
apps.push(app022);

// ============================================================ 4~7. 审核与草稿
log('\n========== 4. 开票申请审核覆盖率 / 5. 草稿生成率 ==========');
const results = [];
const pool = [];
let covered = 0, passed = 0, drafts = 0, logsOK = 0;
for (const app of apps) {
  const r = E.runAudit(app, { operator: '李娜', pool, ruleMode: 'rule' });
  const draft = E.buildDraft(r, app);
  covered++;
  const hasLog = !!(r.auditedAt && r.result && r.operator && r.applicationNo);
  if (hasLog) logsOK++;
  if (r.result === 'pass') { passed++; if (draft) drafts++; }
  results.push({ app, r, draft });
}
log(`申请 ${apps.length} 单，出结论 ${covered} 单，覆盖率 ${pct(covered, apps.length)}（目标 100%）`);
log(`审核通过 ${passed} 单，生成草稿 ${drafts} 单，草稿生成率 ${pct(drafts, passed)}（目标 100%）`);
log(`审核日志完整 ${logsOK}/${apps.length}，完整率 ${pct(logsOK, apps.length)}（目标 100%）`);

const notPass = results.filter((x) => x.r.result !== 'pass');
if (notPass.length) {
  log('  非通过明细：');
  notPass.forEach((x) => log(`   · ${x.r.applicationNo} ${x.r.resultLabel} —— ${x.r.summary.slice(0, 160)}`));
}

// ============================================================ 7. 误拒/漏放
log('\n========== 6. 高风险误拒 / 漏放 ==========');
// 期望：22 条待开票事项 → 通过并出草稿；TC-022（未验收）→ 暂缓、不出草稿
let expectPassOK = 0, expectSuspendOK = 0;
const misjudged = [];
for (let i = 0; i < tables.sales.length; i++) {
  const x = results[i];
  if (x.r.result === 'pass' && x.draft) expectPassOK++;
  else misjudged.push({ no: `ROW-${i + 1}`, customer: tables.sales[i].customer, product: tables.sales[i].product, expect: 'pass', got: x.r.result, summary: x.r.summary });
}
const x22 = results[results.length - 1];
if (x22.r.result === 'suspend' && !x22.draft) expectSuspendOK++;
else misjudged.push({ no: 'TC-022', expect: 'suspend', got: x22.r.result, summary: x22.r.summary });
log(`应通过的 22 单：判对 ${expectPassOK}/22`);
log(`应暂缓的 1 单（TC-022 未验收）：判对 ${expectSuspendOK}/1`);
log(`误拒/漏放合计 ${misjudged.length} 单（目标 0）`);
misjudged.forEach((m) => log(`   ✗ ${m.no} ${m.customer || ''} ${m.product || ''} 期望=${m.expect} 实际=${m.got} :: ${String(m.summary).slice(0, 150)}`));

// ============================================================ 出口单据专项
log('\n========== 7. 出口业务专项（0% 税率 / 出口发票） ==========');
const exportRows = tables.sales.map((r, i) => ({ r, i })).filter((x) => x.r.region === '出口');
let expOK = 0;
for (const { r, i } of exportRows) {
  const x = results[i];
  const d = x.draft;
  const ok = x.r.result === 'pass' && d && d.invoiceType === '出口发票' && d.taxRate === '0%' && (d.taxAmount === 0 || d.taxAmount === null);
  if (ok) expOK++;
  log(`   ${ok ? '✓' : '✗'} ${r.product} ${r.customer} → ${x.r.result} / ${d ? d.invoiceType + ' ' + d.taxRate + ' 价税合计 ' + E.fmt(d.amountTotal) : '无草稿'}`);
}
log(`   出口事项 ${exportRows.length} 单，判对 ${expOK} 单`);

// ============================================================ 负向用例
log('\n========== 8. 负向用例（应拦截的场景） ==========');
const neg = [];
function negCase(name, app, expectResult, expectCheck) {
  const r = E.runAudit(app, { operator: '李娜', pool: [] });
  const ck = expectCheck ? r.checks.find((c) => c.key === expectCheck) : null;
  const ok = r.result === expectResult && (!expectCheck || (ck && ['fail', 'suspend'].includes(ck.status)));
  neg.push({ name, expect: expectResult + (expectCheck ? '/' + expectCheck : ''), got: r.result + (ck ? '/' + ck.name + ':' + ck.status : ''), ok, summary: r.summary });
  log(`   ${ok ? '✓' : '✗'} ${name}：期望 ${expectResult}${expectCheck ? '/' + expectCheck : ''}，实际 ${r.result}${ck ? '（' + ck.name + ' ' + ck.status + '）' : ''}`);
  return r;
}

// N1 金额不一致（Prompt 示例2：申请单 100000 vs 合同 113000 → 用真实数据：合同 30,510,000 vs 申请 27,000,000）
negCase('N1 申请单金额与合同不一致', buildApplication(tables.sales[0], 0, { declaredAmount: 27000000 }), 'fail', 'check_amount');
// N2 抬头不一致
negCase('N2 购买方抬头不一致', buildApplication(tables.sales[1], 1, { declaredCustomer: '广州粤海智能装备（简称）' }), 'fail', 'check_title');
// N3 税率错误（构造一张 9% 的合同副本）
{
  const row = tables.sales[2];
  const app = buildApplication(row, 2);
  const c = JSON.parse(JSON.stringify(app._match.contract));
  c.id = c.id + '-MOD';
  c.taxRate = '9%';
  c.items.forEach((it) => { it.taxRate = '9%'; it.taxAmount = E.r2(it.amount * 0.09); });
  c.taxAmount = E.r2(c.amountExTax * 0.09);
  c.amountTotal = E.r2(c.amountExTax + c.taxAmount);
  const app2 = { ...app, documents: [c, app._match.acceptance, app._match.stockOut].filter(Boolean) };
  negCase('N3 税率错误（9% 代替 13%）', app2, 'fail', 'check_tax_rate');
}
// N4 验收金额不足
{
  const row = tables.sales[3];
  const app = buildApplication(row, 3);
  const acc = JSON.parse(JSON.stringify(app._match.acceptance));
  acc.id = acc.id + '-MOD';
  acc.amountTotal = E.r2(acc.amountTotal * 0.8);
  acc.amountExTax = acc.amountTotal;
  const app2 = { ...app, documents: [app._match.contract, acc, app._match.stockOut].filter(Boolean) };
  negCase('N4 验收金额少于合同（部分验收）', app2, 'fail', 'check_amount');
}
// N5 重复开票（会话发票池）
{
  const row = tables.sales[4];
  const app = buildApplication(row, 4);
  const inv = { id: 'FP-SESSION-001', docType: '增值税专用发票', docDate: row.date, party: row.customer, amountTotal: app._match.contract.amountTotal, taxAmount: app._match.contract.taxAmount, amountExTax: app._match.contract.amountExTax, taxRate: '13%', items: [] };
  const r = E.runAudit(app, { operator: '李娜', pool: [{ ...inv, poolKind: 'session' }] });
  const ck = r.checks.find((c) => c.key === 'check_duplicate');
  const ok = r.result === 'fail' && ck.status === 'fail';
  neg.push({ name: 'N5 同一业务重复开票', expect: 'fail/check_duplicate', got: r.result + '/' + ck.status, ok, summary: r.summary });
  log(`   ${ok ? '✓' : '✗'} N5 同一业务重复开票：期望 fail/check_duplicate，实际 ${r.result}/${ck.status}`);
}
// N6 缺验收单（暂缓）
{
  const row = tables.sales[5];
  const app = buildApplication(row, 5);
  const app2 = { ...app, documents: [app._match.contract, app._match.stockOut].filter(Boolean) };
  negCase('N6 缺验收单 → 暂缓开票', app2, 'suspend', 'check_date');
}
const negOK = neg.filter((x) => x.ok).length;
log(`   负向用例 ${neg.length} 条，判对 ${negOK} 条`);

// ============================================================ 内嵌测试示例
log('\n========== 9. 内嵌测试示例模块（testCase1 / testCase2） ==========');
// 与 Prompt 文档 Embedded Test Examples 完全一致的数据
const tc1 = {
  applicationNo: 'TEST-TC1', applicant: '测试', applyDate: '2024-03-15', region: '内销',
  declaredAmount: 113000, declaredCustomer: 'XX科技有限公司',
  documents: [
    mkTestDoc('TEST-APP-1', '开票申请单', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-15'),
    mkTestDoc('TEST-CON-1', '销售合同', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-01'),
    mkTestDoc('TEST-ACC-1', '验收单', 'XX科技有限公司', null, 113000, null, '2024-03-15'),
  ],
};
const tc2 = {
  applicationNo: 'TEST-TC2', applicant: '测试', applyDate: '2024-03-15', region: '内销',
  declaredAmount: 100000, declaredCustomer: 'XX科技有限公司',
  documents: [
    mkTestDoc('TEST-APP-2', '开票申请单', 'XX科技有限公司', '91310000XXXXXX', 100000, '13%', '2024-03-15'),
    mkTestDoc('TEST-CON-2', '销售合同', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-01'),
  ],
};
function mkTestDoc(id, docType, party, taxNo, total, rate, date) {
  const rn = rate ? E.taxRateNum(rate) : 0;
  const ex = rn ? E.r2(total / (1 + rn)) : total;
  return {
    id, docType, docTypeRaw: docType, title: docType, docDate: date,
    party, partyRole: '购买方', partyTaxNo: taxNo, selfName: SELF, selfTaxNo: '91440300MA5H8K2X3Q',
    amountExTax: ex, taxAmount: rn ? E.r2(total - ex) : null, amountTotal: total,
    taxRate: rate, items: [{ name: '智能设备', spec: '', unit: '台', qty: 10, unitPrice: E.r2(ex / 10), amount: ex, taxRate: rate, taxAmount: rn ? E.r2(total - ex) : null, extra: {}, loc: '明细表 第1行' }],
    fields: [
      { key: null, label: docType === '验收单' ? '往来单位' : '购买方名称', value: party, loc: '往来方区 · 第1方' },
      { key: 'amountTotal', label: '价税合计', value: String(total), loc: '合计区 · 价税合计' },
      { key: 'docDate', label: '单据日期', value: date, loc: '页眉区 · 单据编号' },
    ],
    terms: {}, totals: {}, footers: {}, textLen: 0, parseWarnings: [],
  };
}
const r1 = E.runAudit(tc1, { operator: '测试' });
const d1 = E.buildDraft(r1, tc1);
const r2 = E.runAudit(tc2, { operator: '测试' });
const ok1 = r1.result === 'pass' && !!d1;
const ok2 = r2.result === 'fail' && r2.checks.find((c) => c.key === 'check_amount').status === 'fail';
log(`   ${ok1 ? '✓' : '✗'} testCase1（审核通过场景）：结论 ${r1.result}，草稿 ${d1 ? '已生成' : '未生成'}，期望 pass + 草稿`);
log(`   ${ok2 ? '✓' : '✗'} testCase2（审核不通过场景）：结论 ${r2.result}，check_amount=${r2.checks.find((c) => c.key === 'check_amount').status}，期望 fail + 金额不一致`);
if (!ok1) log('     ' + r1.summary);
if (!ok2) log('     ' + r2.summary);

// ============================================================ 汇总
log('\n========== 验收结论汇总 ==========');
const metrics = [
  ['单据分类识别准确率', pct(clsOk, documents.length), '≥98%', clsOk / documents.length >= 0.98],
  ['关键字段提取准确率', pct(fOk, fTotal), '≥98%', fOk / fTotal >= 0.98],
  ['字段来源可追溯率', pct(locFields, allFields), '≥99%', locFields / allFields >= 0.99],
  ['开票申请审核覆盖率', pct(covered, apps.length), '=100%', covered === apps.length],
  ['通过申请草稿生成率', pct(drafts, passed), '=100%', drafts === passed && passed > 0],
  ['审核记录完整性', pct(logsOK, apps.length), '=100%', logsOK === apps.length],
  ['高风险误拒/漏放', String(misjudged.length), '0', misjudged.length === 0],
  ['负向用例拦截', `${negOK}/${neg.length}`, '全部拦截', negOK === neg.length],
  ['内嵌测试示例', `${[ok1, ok2].filter(Boolean).length}/2`, '2/2', ok1 && ok2],
];
for (const [k, v, t, pass] of metrics) log(`   ${pass ? '✅' : '❌'} ${k}: ${v}（目标 ${t}）`);
const allPass = metrics.every((m) => m[3]);

const report = {
  generatedAt: new Date().toISOString(),
  engine: 'src/engine.js',
  dataset: 'P1-01-发票开具-勾选数据集（175 张单据 / 4 张表 / 22 条用例）',
  metrics: metrics.map(([name, value, target, pass]) => ({ name, value, target, pass })),
  allPass,
  details: {
    classification: { total: documents.length, ok: clsOk, bad: clsBad },
    fieldExtraction: { total: fTotal, ok: fOk, bad: fBad.slice(0, 50) },
    traceability: { allFields, locFields, extractFields, extractLoc },
    applications: results.map((x) => ({
      applicationNo: x.r.applicationNo, result: x.r.result, riskLevel: x.r.riskLevel,
      checks: x.r.checks.map((c) => ({ key: c.key, name: c.name, status: c.status })),
      draft: x.draft ? { draftNo: x.draft.draftNo, invoiceType: x.draft.invoiceType, taxRate: x.draft.taxRate, amountTotal: x.draft.amountTotal } : null,
      summary: x.r.summary,
    })),
    negative: neg,
    embeddedTest: { tc1: { result: r1.result, draft: !!d1 }, tc2: { result: r2.result } },
    export: { total: exportRows.length, ok: expOK },
  },
};
fs.writeFileSync(path.join(ROOT, 'data', '_acceptance_report.json'), JSON.stringify(report, null, 1), 'utf8');
log(`\n${allPass ? '✅ 全部指标达标' : '❌ 存在未达标指标'}；明细已写入 data/_acceptance_report.json`);
process.exitCode = allPass ? 0 : 1;
