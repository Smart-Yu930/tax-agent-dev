/**
 * tools/smoke_practice.mjs — practice.js 冒烟验证（无需 jsdom，自写最小 DOM 桩）
 *
 * 用途：在无浏览器环境下验证
 *   1) src/practice.js 能在「最小 DOM 桩 + 真实数据形状」下 mount() 不抛错；
 *   2) 6 个模块都能 show()，且视图/菜单高亮正确（「红冲与作废」已删除，不得复活）；
 *   3) 工作台数据看板（契约）：6 张概览卡、4 列任务看板（列名/顺序/计数与 data 现算一致、
 *      条目数 min(6, N)）、6 张模块任务卡（5 张跳实务视图 + 1 张走 ctx.goView 智能体）；
 *   4) 合同与验收台账（175 条分页 25/页）、待开票清单（22 条）、
 *      开票台账（104 张）、发票开具（草稿回填 + 校验）与原件摘要面板的核心逻辑符合预期。
 *
 * 数据来源：
 *   - 若 data/documents.json、data/ledger.json、data/tables.json 存在，直接用真实数据；
 *   - 否则用 fixture：单据清单取自 input/数据集/manifest.json（真实编号/类型/日期/对方单位/金额），
 *     销售明细取自 02-业务表格/01-销售明细表.xlsx（22 行，逐行抄录），
 *     不含税金额、字段与来源位置为 fixture 派生值（仅用于跑通渲染逻辑，非业务事实）。
 *
 * 运行：node tools/smoke_practice.mjs
 * 退出码：0 全部通过；1 有失败项。
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* ==================================================================
 * 1. 最小 DOM 桩（约 100 行，只实现 practice.js 用到的 API）
 * ================================================================== */

class ClassList {
  constructor(el) { this.el = el; }
  _set() {
    return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean));
  }
  add(...names) {
    const s = this._set();
    names.forEach((n) => s.add(n));
    this.el.className = [...s].join(' ');
  }
  remove(...names) {
    const s = this._set();
    names.forEach((n) => s.delete(n));
    this.el.className = [...s].join(' ');
  }
  contains(name) { return this._set().has(name); }
  toggle(name, force) {
    const has = this.contains(name);
    const on = force === undefined ? !has : !!force;
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class El {
  constructor(tag, doc) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.type = '';
    this.title = '';
    this.disabled = false;
    this._text = '';
    this._className = '';
    this._inner = '';
    this._parent = null;
    this._listeners = {};
    this.classList = new ClassList(this);
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get parentNode() { return this._parent; }
  get className() { return this._className; }
  set className(v) { this._className = v == null ? '' : String(v); }
  get innerHTML() { return this._inner; }
  set innerHTML(v) {
    this._inner = v == null ? '' : String(v);
    this.childNodes.forEach((c) => { c._parent = null; });
    this.childNodes = [];
    this._text = '';
  }
  get textContent() {
    let s = this._text;
    for (const c of this.childNodes) s += c.textContent;
    return s;
  }
  set textContent(v) {
    this.childNodes.forEach((c) => { c._parent = null; });
    this.childNodes = [];
    this._text = v == null ? '' : String(v);
  }
  appendChild(node) {
    if (!node) return node;
    if (node._parent) node._parent.removeChild(node);
    node._parent = this;
    this.childNodes.push(node);
    this._text = '';
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node._parent = null;
    return node;
  }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = v;
    else if (k === 'value') this.value = String(v);
    else if (k === 'type') this.type = String(v);
    else if (k === 'title') this.title = String(v);
    else if (k === 'disabled') this.disabled = true;
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners[type] || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, ev) {
    (this._listeners[type] || []).slice().forEach((fn) => fn(ev || { target: this }));
    return this;
  }
  click() { return this.dispatch('click', { target: this }); }
  focus() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

const documentStub = {
  createElement(tag) { return new El(tag, documentStub); },
  querySelector() { return null; },
  addEventListener() {},
  body: null
};
documentStub.body = new El('body', documentStub);

const windowStub = { document: documentStub };

/* ==================================================================
 * 2. 数据：优先真实 data/*.json，否则用 fixture
 * ================================================================== */

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/* 销售明细表 22 行（逐行取自 input/数据集/02-业务表格/01-销售明细表.xlsx） */
const SALES_ROWS = [
  ['五轴数控机床 HMC-800', '2025-12-05', '上海衡远机电设备有限公司', 6, 4500000, 27000000, '内销'],
  ['五轴数控机床 HMC-800', '2025-12-06', '越南 HMC 制造有限公司', 2, 3000000, 6000000, '出口'],
  ['智能产线集成 HLine-3', '2025-12-08', '广州粤海智能装备有限公司', 1, 7000000, 7000000, '内销'],
  ['智能产线集成 HLine-3', '2025-12-09', '北京中科精工科技有限公司', 1, 7000000, 7000000, '内销'],
  ['精密功能部件 HK-220', '2025-12-10', '成都天府智造有限公司', 3, 900000, 2700000, '内销'],
  ['工业机器人工作站 HR-6', '2025-12-12', '苏州工业园区精机有限公司', 2, 1200000, 2400000, '内销'],
  ['精密功能部件 HK-220', '2025-12-15', '武汉长江数控有限公司', 2, 900000, 1800000, '内销'],
  ['工业机器人工作站 HR-6', '2025-12-16', '青岛海德装备有限公司', 2, 1200000, 2400000, '内销'],
  ['五轴数控机床 HMC-800', '2025-12-18', '宁波甬江精密部件有限公司', 1, 4500000, 4500000, '内销'],
  ['备件与售后服务', '2025-12-20', '西安航天智造有限公司', 4, 340000, 1360000, '内销'],
  ['五轴数控机床 HMC-800', '2025-12-22', '广州粤海智能装备有限公司', 2, 4500000, 9000000, '内销'],
  ['备件与售后服务', '2025-12-23', '北京中科精工科技有限公司', 3, 340000, 1020000, '内销'],
  ['智能产线集成 HLine-3', '2025-12-25', '成都天府智造有限公司', 1, 7000000, 7000000, '内销'],
  ['精密功能部件 HK-220', '2025-12-26', '苏州工业园区精机有限公司', 2, 900000, 1800000, '内销'],
  ['备件与售后服务', '2025-12-27', '武汉长江数控有限公司', 5, 340000, 1700000, '内销'],
  ['五轴数控机床 HMC-800', '2025-12-28', '青岛海德装备有限公司', 1, 4500000, 4500000, '内销'],
  ['工业机器人工作站 HR-6', '2025-12-29', '宁波甬江精密部件有限公司', 1, 1200000, 1200000, '内销'],
  ['精密功能部件 HK-220', '2025-12-30', '西安航天智造有限公司', 1, 900000, 900000, '内销'],
  ['五轴数控机床 HMC-800', '2025-12-30', '西安航天智造有限公司', 3, 4500000, 13500000, '内销'],
  ['智能产线集成 HLine-3', '2025-12-30', '广州粤海智能装备有限公司', 2, 7000000, 14000000, '内销'],
  ['精密功能部件 HK-220', '2025-12-31', '北京中科精工科技有限公司', 4, 900000, 3600000, '内销'],
  ['智能产线集成 HLine-3', '2025-12-06', '越南 HMC 制造有限公司', 1, 6000000, 6000000, '出口']
].map(([product, date, customer, qty, unitPrice, amount, region]) => ({
  product, date, customer, qty, unitPrice, amount, region
}));

function derivedFields(doc) {
  /* fixture 派生字段：仅用于跑通「原件摘要」渲染，值来自该单据自身的台账金额 */
  const fields = [];
  const push = (key, label, value, loc) => {
    if (value == null || value === '') return;
    fields.push({ key, label, value: String(value), num: Number.isFinite(Number(String(value).replace(/,/g, ''))) ? Number(String(value).replace(/,/g, '')) : null, loc, field_source: 'rule' });
  };
  push('party', '购买方名称', doc.party, '票头区 · 购买方');
  push('amountTotal', '价税合计（小写）', doc.amountTotal, '合计区 · 价税合计');
  push('amountExTax', '金额（不含税）', doc.amountExTax, '合计区 · 合计金额');
  push('taxAmount', '税额', doc.taxAmount, '合计区 · 合计税额');
  push('taxRate', '税率', doc.taxRate, '明细表 第1行');
  if (doc.invoiceCode) push('invoiceCode', '发票代码', doc.invoiceCode, '票头区 · 发票代码');
  return fields;
}

function buildFixture() {
  const manifest = readJson(path.join(ROOT, 'input/数据集/manifest.json'));
  if (!manifest) return null;

  const docs = [];
  manifest.files
    .filter((f) => f.type === 'document')
    .forEach((f, i) => {
      const isInvoice = f.docType.includes('发票');
      const isContract = f.docType.includes('合同');
      const isYs = f.docType.includes('验收单');
      const rate = isInvoice || isContract ? 0.13 : null;
      const total = Number(f.amount) || 0;
      const exTax = rate ? Math.round((total / (1 + rate)) * 100) / 100 : total;
      const tax = rate ? Math.round((total - exTax) * 100) / 100 : null;
      const doc = {
        idx: i + 1,
        id: f.id,
        file: path.basename(f.path),
        docType: f.docType,
        title: f.title,
        docDate: f.date,
        party: f.party,
        partyRole: isInvoice ? '购买方' : isContract ? '买方' : '往来单位',
        partyTaxNo: isInvoice ? '91310112MA1GC8X21K' : null,
        selfName: '华衡智造集团股份有限公司',
        selfTaxNo: '91440300MA5H8K2X3Q',
        amountExTax: exTax,
        taxAmount: tax,
        amountTotal: total,
        amountInWords: null,
        taxRate: rate ? '13%' : null,
        currency: 'CNY',
        invoiceCode: isInvoice ? '044002500111' : null,
        invoiceNo: isInvoice ? String(25248111 + i) : null,
        checkCode: isInvoice ? '748111 9021 3388' : null,
        contractNo: null,
        remark: null,
        items: [],
        fields: [],
        textLen: 11000,
        parseWarnings: []
      };
      doc.fields = derivedFields(doc);
      docs.push(doc);
    });

  const ledger = docs.map((d) => ({
    idx: d.idx, id: d.id, docType: d.docType, summary: d.title,
    date: d.docDate, party: d.party, amount: d.amountTotal, file: d.file
  }));

  return {
    meta: {
      case: 'P1-01',
      period: '2025 年 12 月',
      company: '华衡智造集团股份有限公司',
      selfTaxNo: '91440300MA5H8K2X3Q',
      generatedAt: 'fixture',
      docCount: docs.length,
      tableCount: 4
    },
    documents: docs,
    ledger,
    tables: { sales: SALES_ROWS, kpi: [], cases: [] },
    dict: { taxRates: [], customers: [], scope: [], fieldDefs: [], docTypes: [] }
  };
}

function loadData() {
  const docs = readJson(path.join(ROOT, 'data/documents.json'));
  const ledger = readJson(path.join(ROOT, 'data/ledger.json'));
  const tables = readJson(path.join(ROOT, 'data/tables.json'));
  if (Array.isArray(docs) && docs.length && Array.isArray(ledger) && ledger.length && tables && Array.isArray(tables.sales) && tables.sales.length) {
    return {
      data: {
        meta: { period: '2025 年 12 月', company: '华衡智造集团股份有限公司' },
        documents: docs,
        ledger,
        tables,
        dict: readJson(path.join(ROOT, 'data/dict.json')) || {}
      },
      source: 'data/*.json（真实数据）'
    };
  }
  const fixture = buildFixture();
  if (!fixture) throw new Error('既没有 data/*.json，也读不到 input/数据集/manifest.json');
  return { data: fixture, source: 'fixture（manifest 单据清单 + 销售明细表 22 行）' };
}

/* ==================================================================
 * 3. 断言小工具
 * ================================================================== */

const results = [];
let failures = 0;

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail: detail == null ? '' : String(detail) });
    console.log(`  PASS  ${name}${detail ? '  —  ' + detail : ''}`);
  } catch (e) {
    failures++;
    results.push({ ok: false, name, detail: e && e.message ? e.message : String(e) });
    console.log(`  FAIL  ${name}  —  ${e && e.message ? e.message : e}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function walk(node, fn) {
  if (!node || node.nodeType !== 1) return;
  fn(node);
  for (const c of node.childNodes || []) if (c.nodeType === 1) walk(c, fn);
}

function byClass(root, cls) {
  const out = [];
  walk(root, (n) => {
    if ((' ' + n.className + ' ').indexOf(' ' + cls + ' ') >= 0) out.push(n);
  });
  return out;
}

function oneByClass(root, cls, label) {
  const list = byClass(root, cls);
  assert(list.length === 1, `期望恰好 1 个 .${cls}${label ? '（' + label + '）' : ''}，实际 ${list.length}`);
  return list[0];
}

function rowsOf(tableEl) {
  const tbody = (tableEl.childNodes || []).find((n) => n.tagName === 'TBODY');
  assert(tbody, '表格缺少 tbody');
  return (tbody.childNodes || []).filter((n) => n.tagName === 'TR');
}

function cellTexts(tr) {
  return (tr.childNodes || []).filter((n) => n.tagName === 'TD').map((td) => td.textContent.trim());
}

function fmtMoney(n) {
  const v = Math.abs(Number(n));
  const parts = v.toFixed(2).split('.');
  return (Number(n) < 0 ? '-' : '') + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + parts[1];
}

/* 第一个匹配标签的后代元素（含自身） */
function tag(node, name) {
  let found = null;
  walk(node, (n) => { if (!found && n.tagName === name) found = n; });
  return found;
}

/* DOM 桩不实现事件冒泡：自下而上逐级派发 click，与真实浏览器一致（每级监听器各触发一次，
 * e.target 始终是真正被点的元素）。stopAncestor 为本次点击的边界容器。 */
function clickThrough(node, stopAncestor) {
  let cur = node;
  while (cur && cur.nodeType === 1) {
    cur.dispatch('click', { target: node });
    if (cur === stopAncestor) break;
    cur = cur.parentNode;
  }
}

/* 未验收合同数：与 src/practice.js buildModel() 同口径（仅用 data 反推，不读实现内部状态）
 * 销售合同未匹配到「同对方单位 + 不含税金额吻合（≤1 元）」的验收单，即为未验收。 */
function countUnaccepted(dataSet) {
  const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const rate = (v) => {
    const m = String(v == null ? '' : v).match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = Number(m[0]);
    if (String(v).indexOf('%') >= 0 || n > 1) n = n / 100;
    return n;
  };
  const exTax = (doc, ledgerAmount) => {
    const ex = num(doc.amountExTax);
    if (ex != null) return ex;
    let total = num(doc.amountTotal);
    if (total == null) total = num(doc.amount);
    if (total == null) total = num(ledgerAmount);
    if (total == null) return null;
    const r = rate(doc.taxRate);
    if (r && r > 0) return Math.round((total / (1 + r)) * 100) / 100;
    return total;
  };
  const ledgerById = {};
  (dataSet.ledger || []).forEach((r) => { if (r && r.id) ledgerById[r.id] = r; });
  const inc = (hay, needle) => String(hay == null ? '' : hay).indexOf(needle) >= 0;
  const documents = dataSet.documents || [];
  const contracts = documents.filter((d) => d && d.id && inc(d.docType, '销售合同'));
  const accepts = documents.filter((d) => d && d.id && inc(d.docType, '验收单')); // 不含「到货签收单」
  if (!contracts.length || !accepts.length) return 0;
  return contracts.filter((c) => {
    const cAmt = exTax(c, ledgerById[c.id] ? ledgerById[c.id].amount : null);
    const matched = accepts.some((y) => {
      if (String(c.party || '') && String(y.party || '') && String(c.party) !== String(y.party)) return false;
      const yAmt = exTax(y, ledgerById[y.id] ? ledgerById[y.id].amount : null);
      if (cAmt == null || yAmt == null) return !!String(c.party || '') && String(c.party) === String(y.party);
      return Math.abs(cAmt - yAmt) <= 1;
    });
    return !matched;
  }).length;
}

/* ==================================================================
 * 4. 加载 practice.js
 * ================================================================== */

const code = fs.readFileSync(path.join(ROOT, 'src/practice.js'), 'utf8');
const sandbox = {
  window: windowStub,
  document: documentStub,
  console,
  setTimeout,
  clearTimeout,
  Date
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'src/practice.js' });

const { data, source } = loadData();

console.log('');
console.log('practice.js 冒烟验证');
console.log('  数据来源：' + source);
console.log('  documents=' + data.documents.length + '  ledger=' + data.ledger.length +
  '  sales=' + data.tables.sales.length);
console.log('');

const agentCalls = [];
const goViewCalls = [];
const toasts = [];
const draftsGiven = [];
const ctx = {
  goAgent(filter) { agentCalls.push(filter); },
  goView(view, anchor) { goViewCalls.push([view, anchor]); },
  openDraft(draft) { draftsGiven.push(draft); },
  toast(msg) { toasts.push(msg); },
  getState() { return { ok: true }; }
};

const container = new El('div', documentStub);

/* ---------- 4.1 挂载 ---------- */
console.log('[1] 挂载');
let api = null;
check('window.Practice.mount 存在且为函数', () => {
  assert(windowStub.Practice && typeof windowStub.Practice.mount === 'function', 'window.Practice.mount 缺失');
  return 'Practice.version=' + windowStub.Practice.version;
});

check('mount() 不抛错并返回 { show }', () => {
  api = windowStub.Practice.mount(container, data, ctx);
  assert(api && typeof api.show === 'function', 'mount 未返回 show 方法');
  return 'container 子节点 ' + container.children.length + ' 个';
});

check('渲染出 .pra-root 与 8 项侧边菜单', () => {
  const roots = container.children.filter((n) => n.className.indexOf('pra-root') >= 0);
  assert(roots.length === 1, '.pra-root 数量为 ' + roots.length);
  const navs = byClass(container, 'pra-navbtn');
  assert(navs.length === 8, '侧边菜单数量为 ' + navs.length);
  const names = navs.map((n) => n.textContent.trim());
  const want = ['工作台预览', '新建开票业务', '待开票清单', '被驳回申请', '单据台账', '发票开具', '已开发票', '开票台账'];
  assert(JSON.stringify(names) === JSON.stringify(want), '菜单顺序不符：' + names.join('|'));
  assert(names.every((n) => n.indexOf('红冲') < 0 && n.indexOf('作废') < 0),
    '「红冲与作废」已随重构删除，菜单里又出现了：' + names.join('|'));
  return names.join(' | ');
});

/* ---------- 4.2 6 个模块 show() ---------- */
console.log('');
console.log('[2] 8 个模块 show()');
const VIEW_KEYS = ['workbench', 'newbusiness', 'pending', 'rejected', 'ledger', 'issue', 'issued', 'invoices'];
const VIEW_NAMES = ['工作台预览', '新建开票业务', '待开票清单', '被驳回申请', '单据台账', '发票开具', '已开发票', '开票台账'];
VIEW_KEYS.forEach((key, i) => {
  check(`show("${key}") / show("${VIEW_NAMES[i]}") 正常切换`, () => {
    api.show(key);
    let active = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
    assert(active.length === 1, '激活视图数量为 ' + active.length);
    assert(active[0].getAttribute('data-view') === key, '激活视图是 ' + active[0].getAttribute('data-view'));
    api.show(VIEW_NAMES[i]);
    active = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
    assert(active[0].getAttribute('data-view') === key, '中文名切换失败');
    const navs = byClass(container, 'pra-navbtn').filter((n) => n.className.indexOf(' on') >= 0);
    assert(navs.length === 1 && navs[0].textContent.trim() === VIEW_NAMES[i], '菜单高亮不同步');
    return 'ok';
  });
});

check('非法/已删除视图名不抛错且保持当前视图', () => {
  api.show('ledger');
  api.show('不存在的模块');
  api.show('redvoid'); // 「红冲与作废」已删除，旧 key 不得再切走视图
  const active = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
  assert(active.length === 1, '激活视图数量为 ' + active.length);
  assert(active[0].getAttribute('data-view') === 'ledger', '当前视图被改变为 ' + active[0].getAttribute('data-view'));
  return 'ok';
});

check('兼容 boot.js 视图键（invoiceLedger）', () => {
  api.show('invoiceLedger');
  const active = byClass(container, 'pra-view').find((v) => v.className.indexOf(' on') >= 0);
  assert(active.getAttribute('data-view') === 'invoices', 'invoiceLedger 未映射到「开票台账」');
  return 'invoiceLedger → invoices';
});

/* ---------- 4.3 工作台数据看板（概览卡 / 任务看板 / 模块任务卡） ---------- */
console.log('');
console.log('[3] 工作台数据看板');
const docs = data.documents;
const salesRows = data.tables.sales;
/* 本会话已开具：宿主把智能体「确认开具」的销售明细行写回 issueStatus = 已开具 */
const issuedRows = salesRows.filter((r) => String((r || {}).issueStatus || '') === '已开具');
const unissuedCount = salesRows.length - issuedRows.length;
const expected = {
  pending: unissuedCount,                       // 未开具条数（概览卡「待开票事项」+ 看板「待开票」列）
  issued: issuedRows.length,                    // 已开具条数（概览卡「已开具」+ 看板「已开具」列）
  unaccepted: countUnaccepted(data),            // model.unaccepted 数（看板「未验收暂缓」列）
  contracts: docs.filter((d) => String(d.docType).includes('合同')).length,
  invoices: docs.filter((d) => String(d.docType).includes('发票')).length,
  salesWan: fmtMoney(salesRows.reduce((s, r) => s + (Number(r.amount) || 0), 0) / 10000) + ' 万元'
};

function workbenchView() {
  api.show('workbench');
  return byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'workbench');
}

/* 看板 4 列（契约：.pra-board 内 4 个 .pra-board-col，header > b 列名 + header > em 计数） */
function boardColumns(view) {
  const board = oneByClass(view, 'pra-board', '任务看板');
  const cols = byClass(board, 'pra-board-col');
  assert(cols.length === 4, '看板列数为 ' + cols.length + '（期望 4）');
  return cols;
}

function colHead(col, i) {
  const header = tag(col, 'HEADER');
  assert(header, `第 ${i + 1} 列缺少 header 容器`);
  const b = tag(header, 'B');
  const em = tag(header, 'EM');
  assert(b && em, `第 ${i + 1} 列 header 缺少 b（列名）或 em（计数）`);
  return { name: b.textContent.trim(), countText: em.textContent.trim() };
}

function countOf(emText, label) {
  const s = String(emText || '').trim();
  assert(/\d/.test(s), label + ' 计数不是数字：' + (s || '（空）'));
  return Number(s.replace(/[^\d.-]/g, ''));
}

/* 模块任务卡：data-go 在 .pra-taskcard-go 或卡片自身上 */
function taskcards(view) {
  const grid = oneByClass(view, 'pra-taskgrid', '模块任务卡');
  const cards = byClass(grid, 'pra-taskcard');
  assert(cards.length === 6, '任务卡数量为 ' + cards.length + '（期望 6）');
  return cards.map((card) => {
    const go = oneByClass(card, 'pra-taskcard-go');
    const target = go.getAttribute('data-go') || card.getAttribute('data-go') || '';
    return { card, go, target };
  });
}

check('页面标题仍为「工作台预览」', () => {
  const view = workbenchView();
  const head = oneByClass(view, 'pra-pagehead', '工作台页面标题');
  const h1 = tag(head, 'H1');
  assert(h1, '页面标题缺少 h1');
  assert(h1.textContent.trim() === '工作台预览', '页面标题为「' + h1.textContent.trim() + '」');
  return 'h1 = ' + h1.textContent.trim();
});

check('概览卡 5 张：待开票/合同/发票/已开具/开票完成率（已移除本月销售额）', () => {
  const view = workbenchView();
  const kpis = byClass(view, 'pra-kpi');
  assert(kpis.length === 5, '概览卡数量为 ' + kpis.length + '（期望 5）');
  const map = {};
  kpis.forEach((k) => {
    const b = tag(k, 'B');
    assert(b, '.pra-kpi 缺少数值节点 <b>');
    const labelEl = (k.childNodes || []).find((n) => n.nodeType === 1 && n.tagName !== 'B') || tag(k, 'SPAN');
    assert(labelEl, '.pra-kpi 缺少标签节点');
    map[labelEl.textContent.trim()] = b.textContent.trim();
  });
  const has = (k) => Object.prototype.hasOwnProperty.call(map, k);
  const actual = Object.keys(map).join(' / ');
  assert(has('待开票事项'), '缺少「待开票事项」概览卡；实际标签：' + actual);
  assert(map['待开票事项'] === String(expected.pending), `待开票事项 ${map['待开票事项']} != ${expected.pending}`);
  assert(has('合同样本'), '缺少「合同样本」概览卡；实际标签：' + actual);
  assert(map['合同样本'] === String(expected.contracts), `合同样本 ${map['合同样本']} != ${expected.contracts}`);
  assert(has('发票样本'), '缺少「发票样本」概览卡；实际标签：' + actual);
  assert(map['发票样本'] === String(expected.invoices), `发票样本 ${map['发票样本']} != ${expected.invoices}`);
  assert(has('已开具'), '缺少「已开具」概览卡；实际标签：' + actual);
  assert(has('开票完成率'), '缺少「开票完成率」概览卡；实际标签：' + actual);
  assert(!has('本月销售额'), '「本月销售额」概览卡应已移除；实际标签：' + actual);
  assert(countOf(map['已开具'], '已开具') === expected.issued, `已开具 ${map['已开具']} != ${expected.issued}`);
  assert(String(map['开票完成率']).includes('%'), '开票完成率未以百分比展示：' + map['开票完成率']);
  return actual;
});

check('工作台保留口径提示（出口 0% / 内销 13% / 未验收暂缓）', () => {
  const view = workbenchView();
  const box = oneByClass(view, 'pra-callout');
  const txt = box.textContent;
  assert(txt.includes('出口发票适用 0% 税率'), '口径提示缺少出口 0% 说明：' + txt.slice(0, 60));
  assert(txt.includes('13%'), '口径提示缺少内销 13% 说明');
  return txt.replace(/\s+/g, ' ').trim().slice(0, 46) + '…';
});

check('任务看板：同一框体内顶部四态切换，计数与 data 现算一致', () => {
  const view = workbenchView();
  const box = oneByClass(view, 'pra-board-box', '任务看板框');
  const tabs = byClass(box, 'pra-board-tab');
  const want = ['待开票', '未验收暂缓', '已开具', '待确认草稿'];
  const names = tabs.map((t) => {
    const lab = oneByClass(t, 'pra-board-tab-label').textContent.trim();
    return lab;
  });
  assert(JSON.stringify(names) === JSON.stringify(want), '四态页签不符：' + names.join('|'));
  const counts = tabs.map((t) => countOf(tag(t, 'EM').textContent, 'x'));
  assert(counts[0] === expected.pending, `待开票计数 ${counts[0]} != ${expected.pending}`);
  assert(counts[1] === expected.unaccepted, `未验收暂缓计数 ${counts[1]} != ${expected.unaccepted}`);
  assert(counts[2] === expected.issued, `已开具计数 ${counts[2]} != ${expected.issued}`);
  const panes = byClass(box, 'pra-board-pane');
  assert(panes.length === 4, '看板内容区数量为 ' + panes.length + '（期望 4）');
  const onPanes = panes.filter((p) => String(p.className).indexOf(' on') >= 0);
  assert(onPanes.length === 1, '同屏应只显示一个状态，实际 ' + onPanes.length);
  return names.map((n, i) => n + ' ' + counts[i]).join(' · ');
});

check('看板四态页签点击可切换显示', () => {
  const view = workbenchView();
  const box = oneByClass(view, 'pra-board-box');
  const tabs = byClass(box, 'pra-board-tab');
  const panes = byClass(box, 'pra-board-pane');
  tabs[2].click();
  const onAfter = panes.filter((p) => String(p.className).indexOf(' on') >= 0);
  assert(onAfter.length === 1 && onAfter[0] === panes[2], '点击「已开具」未切到第 3 个内容区');
  assert(String(tabs[2].className).indexOf(' on') >= 0, '页签高亮未同步');
  tabs[0].click();
  return '四态切换正常';
});

check('待开票面板条目数 = min(5, 未开具数)，序号从 1 开始且带金额', () => {
  const view = workbenchView();
  const box = oneByClass(view, 'pra-board-box');
  const panes = byClass(box, 'pra-board-pane');
  const items = byClass(panes[0], 'pra-board-item');
  const want = Math.min(5, expected.pending);
  assert(items.length === want, `待开票列条目 ${items.length} != ${want}`);
  const nos = items.map((it) => oneByClass(it, 'pra-board-no').textContent.trim());
  assert(nos[0] === '1', '首条序号应为「1」（从 1 开始），实际为「' + (nos[0] || '空') + '」');
  nos.forEach((n, i) => assert(n === String(i + 1), `第 ${i + 1} 条序号应为「${i + 1}」，实际为「${n}」`));
  items.forEach((it, i) => {
    const amt = oneByClass(it, 'pra-board-amt');
    assert(/\d/.test(amt.textContent), `第 ${i + 1} 条缺少金额：` + (amt.textContent || '（空）'));
  });
  return items.length + ' 条 · 序号 ' + nos.join('/');
});

check('已开具面板条目数 = min(5, 已开具数)', () => {
  const view = workbenchView();
  const box = oneByClass(view, 'pra-board-box');
  const panes = byClass(box, 'pra-board-pane');
  const items = byClass(panes[2], 'pra-board-item');
  const want = Math.min(5, expected.issued);
  assert(items.length === want, `已开具列条目 ${items.length} != ${want}`);
  return items.length + ' 条';
});

check('.pra-taskgrid 内 6 张任务卡，每张含标题/说明/入口', () => {
  const view = workbenchView();
  const cards = taskcards(view);
  const titles = cards.map((c) => {
    const title = oneByClass(c.card, 'pra-taskcard-title').textContent.trim();
    const desc = oneByClass(c.card, 'pra-taskcard-desc').textContent.trim();
    assert(title, '任务卡缺少标题文案');
    assert(desc, '任务卡「' + title + '」缺少说明文案');
    return title;
  });
  assert(new Set(titles).size === titles.length, '任务卡标题重复：' + titles.join('|'));
  return titles.join(' | ');
});

check('5 张任务卡 data-go 为合法实务视图 key，点击后对应视图激活', () => {
  const view = workbenchView();
  const all = taskcards(view);
  const practice = all.filter((c) => VIEW_KEYS.indexOf(c.target) >= 0);
  assert(practice.length === 5, 'data-go 为实务视图 key 的任务卡有 ' + practice.length + ' 张（期望 5）；实际：' +
    all.map((c) => c.target || '（无）').join(','));
  const keys = practice.map((c) => c.target);
  assert(new Set(keys).size === keys.length, '任务卡视图 key 重复：' + keys.join(','));
  const visited = [];
  practice.forEach((c) => {
    api.show('workbench');
    clickThrough(c.go, c.card);
    const active = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
    assert(active.length === 1, `点击 data-go=${c.target} 后激活视图数为 ` + active.length);
    assert(active[0].getAttribute('data-view') === c.target,
      `点击 data-go=${c.target} 后激活视图是 ` + active[0].getAttribute('data-view'));
    visited.push(c.target);
  });
  return visited.join(' → ');
});

check("第 6 张任务卡点击走 ctx.goView('agent','workspace')，不切换实务视图", () => {
  const view = workbenchView();
  const all = taskcards(view);
  const others = all.filter((c) => VIEW_KEYS.indexOf(c.target) < 0);
  assert(others.length === 1, '非实务视图的任务卡有 ' + others.length + ' 张（期望 1）');
  const before = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
  assert(before.length === 1 && before[0].getAttribute('data-view') === 'workbench', '点击前应处于工作台视图');
  goViewCalls.length = 0;
  clickThrough(others[0].go, others[0].card);
  assert(goViewCalls.length >= 1, '智能体任务卡未调用 ctx.goView');
  const args = goViewCalls[0];
  assert(args[0] === 'agent', 'ctx.goView 首个参数为 ' + String(args[0]));
  assert(args[1] === 'workspace', 'ctx.goView 第二个参数为 ' + String(args[1]));
  const after = byClass(container, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
  assert(after.length === 1 && after[0].getAttribute('data-view') === 'workbench',
    '智能体任务卡不应切换实务视图，实际切到 ' + (after[0] && after[0].getAttribute('data-view')));
  return 'ctx.goView(' + args.join(', ') + ')';
});

/* ---------- 4.4 合同与验收台账 ---------- */
console.log('');
console.log('[4] 合同与验收台账');
function ledgerView() {
  api.show('ledger');
  return byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'ledger');
}

check('默认第一页 25 条，并标注「共 N 条」', () => {
  const view = ledgerView();
  const table = oneByClass(view, 'pra-tbl', '合同台账');
  const rows = rowsOf(table);
  assert(rows.length === 25, '第一页行数为 ' + rows.length);
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('共 ' + data.ledger.length + ' 条'), '未标注总条数：' + note);
  assert(note.includes('第 1/7 页'), '未标注页码：' + note);
  return note.trim();
});

check('翻页到第 2 页，行数与定位正确', () => {
  const view = ledgerView();
  const next = byClass(view, 'pra-btn').find((b) => b.textContent === '下一页');
  assert(next, '找不到「下一页」按钮');
  next.click();
  const table = oneByClass(view, 'pra-tbl');
  const rows = rowsOf(table);
  assert(rows.length === 25, '第 2 页行数为 ' + rows.length);
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('第 2/7 页'), '页码未更新：' + note);
  return 'ok';
});

check('关键词搜索命中单据', () => {
  const view = ledgerView();
  const input = byClass(view, 'pra-input')[0];
  assert(input, '找不到搜索框');
  input.value = 'YS-202512-001';
  input.dispatch('input');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 1, '命中行数为 ' + rows.length);
  assert(cellTexts(rows[0])[1] === 'YS-202512-001', '命中行编号为 ' + cellTexts(rows[0])[1]);
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('关键词命中 1 条'), '未标注关键词命中数：' + note);
  input.value = '';
  input.dispatch('input');
  return 'ok';
});

check('分类筛选（出库单）行数与类型一致', () => {
  const view = ledgerView();
  const chip = byClass(view, 'pra-chip').find((c) => c.textContent.indexOf('出库单') === 0);
  assert(chip, '找不到「出库单」分类 chip');
  chip.click();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const want = data.ledger.filter((r) => r.docType === '出库单').length;
  assert(rows.length === Math.min(25, want), `行数 ${rows.length} != ${Math.min(25, want)}`);
  rows.forEach((tr) => {
    const cells = cellTexts(tr);
    assert(cells[2] === '出库单', '类型列出现 ' + cells[2]);
  });
  const all = byClass(view, 'pra-chip').find((c) => c.textContent.indexOf('全部') === 0);
  all.click();
  return want + ' 条出库单';
});

check('「查看原件摘要」弹出面板并展示 fields 来源位置', () => {
  const view = ledgerView();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const opBtn = byClass(rows[0], 'pra-btn').find((b) => b.textContent.includes('查看原件摘要'));
  assert(opBtn, '首行缺少「查看原件摘要」按钮');
  opBtn.click();
  const modal = oneByClass(container, 'pra-modal');
  assert(modal.className.indexOf(' on') >= 0, '面板未打开');
  const text = modal.textContent;
  const doc = data.documents[0];
  assert(text.includes(doc.id), '面板未显示单据编号 ' + doc.id);
  assert(text.includes('来源位置'), '面板缺少来源位置表头');
  assert(text.includes('票头区'), '面板未显示 fields 的 loc');
  const closeBtn = byClass(modal, 'pra-btn').find((b) => b.textContent === '关闭');
  assert(closeBtn, '面板缺少关闭按钮');
  closeBtn.click();
  assert(modal.className.indexOf(' on') < 0, '面板未关闭');
  return '首条 ' + doc.id;
});

/* ---------- 4.5 待开票清单 ---------- */
console.log('');
console.log('[5] 待开票清单');
function pendingView() {
  api.show('pending');
  return byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'pending');
}

check('22 条销售明细全部渲染，序号/区域/状态标注正确', () => {
  const view = pendingView();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === data.tables.sales.length, '行数为 ' + rows.length);
  assert(cellTexts(rows[0])[0] === '1', '首列序号不符：' + cellTexts(rows[0])[0]);
  assert(cellTexts(rows[1])[0] === '2', '第二行序号不符：' + cellTexts(rows[1])[0]);
  const exportRow = rows.find((tr) => cellTexts(tr)[6] === '出口');
  assert(exportRow, '缺少出口行');
  assert(cellTexts(exportRow)[7].includes('出口发票 0%'), '出口状态标注为 ' + cellTexts(exportRow)[7]);
  const summary = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(summary.includes('共 ' + data.tables.sales.length + ' 项'), '缺少合计行：' + summary);
  return summary.replace(/\s+/g, ' ').trim();
});

check('按区域筛选（出口）只留 2 条', () => {
  const view = pendingView();
  const chip = byClass(view, 'pra-chip').find((c) => c.textContent === '出口');
  assert(chip, '找不到「出口」筛选');
  chip.click();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 2, '出口行数为 ' + rows.length);
  rows.forEach((tr) => assert(cellTexts(tr)[6] === '出口', '混入非出口行'));
  const back = byClass(view, 'pra-chip').find((c) => c.textContent === '全部');
  back.click();
  return 'ok';
});

check('点「去开票」调用 ctx.goAgent 并带上单据集合', () => {
  const view = pendingView();
  agentCalls.length = 0;
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const btn = byClass(rows[0], 'pra-btn').find((b) => b.textContent.includes('去开票'));
  assert(btn, '首行缺少「去开票」按钮');
  btn.click();
  assert(agentCalls.length === 1, 'goAgent 调用次数为 ' + agentCalls.length);
  const f = agentCalls[0];
  assert(f.origin === 'practice', 'filter.origin 缺失');
  assert(f.row && f.row.customer === data.tables.sales[0].customer, 'filter.row.customer 不符');
  assert(Array.isArray(f.documents) && f.documents.length > 0, 'filter.documents 为空（未解析到关联单据）');
  return '关联单据 ' + f.documents.length + ' 份：' + f.documentIds.join(',');
});

/* ---------- 4.5.1 新建开票业务 ---------- */
check('新建开票业务：上传入口 + 待开票事项快选', () => {
  api.show('newbusiness');
  const view = byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'newbusiness');
  assert(view, '找不到「新建开票业务」视图');
  const upload = byClass(view, 'pra-upload');
  assert(upload.length === 1, '上传卡片数量为 ' + upload.length);
  assert(upload[0].textContent.includes('点击上传'), '上传卡片文案缺失');
  toasts.length = 0;
  agentCalls.length = 0;
  const upBtn = byClass(view, 'pra-btn').find((b) => b.textContent === '上传单据');
  assert(upBtn, '缺少「上传单据」按钮');
  upBtn.click();
  assert(agentCalls.length === 0, '上传不应走 goAgent');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === data.tables.sales.length, '快选行数为 ' + rows.length);
  const pick = byClass(rows[0], 'pra-btn').find((b) => b.textContent.includes('选择并审核'));
  assert(pick, '快选行缺少「选择并审核」按钮');
  pick.click();
  assert(agentCalls.length === 1, '「选择并审核」未调用 goAgent');
  return '上传卡片 + ' + rows.length + ' 项快选';
});

check('未验收暂缓区（由 验收单 反推）', () => {
  const view = pendingView();
  const sus = byClass(view, 'pra-suspend');
  if (!sus.length) return '本次数据无未验收合同（未展示暂缓区）';
  const text = sus[0].textContent;
  assert(text.includes('未验收'), '暂缓区文案异常：' + text);
  return text.replace(/\s+/g, ' ').trim().slice(0, 60) + '…';
});

/* ---------- 4.6 发票开具 ---------- */
console.log('');
console.log('[6] 发票开具');

function issueView() {
  api.show('issue');
  return byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'issue');
}

const SAMPLE_DRAFT = {
  draftNo: 'DRAFT-TEST-001',
  status: 'pending',
  invoiceType: '增值税专用发票',
  buyer: { name: '上海衡远机电设备有限公司', taxNo: '91310112MA1GC8X21K' },
  seller: { name: '华衡智造集团股份有限公司', taxNo: '91440300MA5H8K2X3Q' },
  items: [{ name: '五轴数控机床 HMC-800', qty: 6, unitPrice: 4500000, amount: 27000000, taxRate: '13%', taxAmount: 3510000 }],
  amountExTax: 27000000,
  taxRate: '13%',
  taxAmount: 3510000,
  amountTotal: 30510000,
  highlights: ['party', 'amountTotal', 'taxRate'],
  commonErrors: [],
  sources: [{ field: 'party', docId: 'HT-202512-001', loc: '合同表 · 买方' }],
  createdAt: '2026-11-14T00:00:00Z'
};

check('openDraft(draft) 回填票面字段', () => {
  const view = issueView();
  windowStub.Practice.openDraft(SAMPLE_DRAFT);
  const inputs = byClass(view, 'pra-input');
  const buyer = inputs.find((i) => i.value === SAMPLE_DRAFT.buyer.name);
  assert(buyer, '购方名称未回填');
  const values = inputs.map((i) => i.value);
  assert(values.includes('27,000,000.00'), '金额未回填：' + values.join('|'));
  assert(values.includes('3,510,000.00'), '税额未回填：' + values.join('|'));
  assert(values.includes('30,510,000.00'), '价税合计未回填：' + values.join('|'));
  const draftBox = oneByClass(view, 'pra-draft');
  assert(draftBox.textContent.includes('DRAFT-TEST-001'), '草稿区未显示草稿号');
  assert(draftBox.textContent.includes('HT-202512-001'), '草稿区未显示来源单据');
  return values.filter(Boolean).length + ' 个字段已回填';
});

check('金额×税率=税额、价税合计一致时校验通过', () => {
  const view = issueView();
  const head = oneByClass(view, 'pra-vhead');
  assert(head.textContent.includes('校验通过'), '校验未通过：' + head.textContent);
  const rows = byClass(view, 'pra-vrow');
  assert(rows.length >= 5, '校验项数量为 ' + rows.length);
  return rows.length + ' 项校验全部通过';
});

check('税额被改动后红字提示不一致', () => {
  const view = issueView();
  const inputs = byClass(view, 'pra-input');
  const taxInput = inputs.find((i) => i.value === '3,510,000.00');
  assert(taxInput, '找不到税额输入框');
  taxInput.value = '3,500,000.00';
  taxInput.dispatch('input');
  const bad = byClass(view, 'pra-vrow bad');
  assert(bad.length >= 1, '未产生红字提示');
  assert(bad[0].textContent.includes('差额'), '红字提示缺少差额：' + bad[0].textContent);
  const head = oneByClass(view, 'pra-vhead');
  assert(head.textContent.includes('存在不一致项'), '表头未提示不一致');
  const state = windowStub.Practice.getFormState();
  assert(state.valid === false, 'getFormState().valid 应为 false');
  assert(state.issues.length >= 1, 'getFormState().issues 为空');
  taxInput.value = '3,510,000.00';
  taxInput.dispatch('input');
  return bad.length + ' 条红字提示：' + bad[0].textContent.replace(/\s+/g, ' ').slice(0, 46) + '…';
});

check('保存草稿落本地缓存 / 提交开票交由宿主回写', () => {
  const view = issueView();
  toasts.length = 0;
  const save = byClass(view, 'pra-btn').find((b) => b.textContent === '保存草稿');
  const submit = byClass(view, 'pra-btn').find((b) => b.textContent === '提交开票');
  assert(save && submit, '缺少保存/提交按钮');
  save.click();
  submit.click();
  assert(toasts.length === 2, 'toast 次数为 ' + toasts.length);
  assert(toasts[1].includes('受理'), '提交提示未说明已受理：' + toasts[1]);
  assert(toasts[1].includes('复核'), '提交提示未说明等待复核：' + toasts[1]);
  return toasts[1].slice(0, 40) + '…';
});

check('税率单选 4 档，切换后重算税额', () => {
  const view = issueView();
  const rates = byClass(view, 'pra-radio');
  assert(rates.length === 4, '税率单选数量为 ' + rates.length);
  const labels = byClass(view, 'pra-rate').map((l) => l.textContent.trim());
  assert(JSON.stringify(labels) === JSON.stringify(['13%', '9%', '6%', '0%']), '税率档位不符：' + labels.join(','));
  const r9 = rates.find((r) => r.value === '9%');
  r9.checked = true;
  r9.dispatch('change');
  const values = byClass(view, 'pra-input').map((i) => i.value);
  assert(values.includes('2,430,000.00'), '9% 税额未重算：' + values.join('|'));
  const r13 = rates.find((r) => r.value === '13%');
  r13.checked = true;
  r13.dispatch('change');
  return labels.join(' / ');
});

/* ---------- 4.6.5 已开发票 ---------- */
console.log('');
console.log('[6.5] 已开发票');

const SESSION_INVOICES = [
  {
    id: 'FP-SESSION-001', docType: '增值税专用发票', party: '上海衡远机电设备有限公司',
    partyTaxNo: '91310112MA1GC8X21K', docDate: '2025-12-20',
    amountTotal: 30510000, amountExTax: 27000000, taxAmount: 3510000, taxRate: '13%',
    poolKind: 'session', draftNo: 'DRF-512001', contractId: 'HT-202512-001',
    items: [{ name: '五轴数控机床 HMC-800', qty: 6, unit: '台', amount: 27000000, taxRate: '13%', taxAmount: 3510000 }]
  },
  {
    id: 'FP-202512-003', docType: '增值税专用发票', party: '广州粤海智能装备有限公司',
    docDate: '2025-12-08', amountTotal: 7910000, amountExTax: 7000000, taxAmount: 910000,
    taxRate: '13%', poolKind: 'document', invoiceDocId: 'FP-202512-003',
    items: [{ name: '智能产线集成 HLine-3', qty: 1, unit: '套', amount: 7000000, taxRate: '13%', taxAmount: 910000 }]
  }
];

check('已开发票：空数据时给出可执行空态', () => {
  const box = new El('div', documentStub);
  const api4 = windowStub.Practice.mount(box, Object.assign({}, data, { sessionInvoices: [] }), ctx);
  api4.show('issued');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'issued');
  assert(view, '找不到「已开发票」视图');
  assert(view.textContent.includes('还没有已开发票'), '空态文案缺失：' + view.textContent.slice(0, 60));
  return '空态正常';
});

check('已开发票：列表展示票号/时间/客户/价税合计与来源', () => {
  const box = new El('div', documentStub);
  const api5 = windowStub.Practice.mount(box, Object.assign({}, data, { sessionInvoices: SESSION_INVOICES }), ctx);
  api5.show('issued');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'issued');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 2, '行数为 ' + rows.length);
  const texts = rows.map((tr) => cellTexts(tr));
  assert(texts[0][1] === 'FP-SESSION-001', '票号列不符：' + texts[0][1]);
  assert(texts[0][2] === '2025-12-20', '开票时间列不符：' + texts[0][2]);
  assert(texts[0][3] === '上海衡远机电设备有限公司', '客户列不符：' + texts[0][3]);
  assert(texts[0][9] === '30,510,000.00', '价税合计列不符：' + texts[0][9]);
  assert(view.textContent.includes('本会话开具') && view.textContent.includes('按原件同步'), '来源标记缺失');
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('筛选结果 2 张'), '缺少筛选结果统计：' + note);
  return '2 张 · 表头与来源标记正确';
});

check('已开发票：客户 / 来源 / 起止日期 / 关键词 / 快捷时间筛选生效', () => {
  const box = new El('div', documentStub);
  const api6 = windowStub.Practice.mount(box, Object.assign({}, data, { sessionInvoices: SESSION_INVOICES }), ctx);
  api6.show('issued');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'issued');
  const selects = byClass(view, 'pra-select');
  assert(selects.length >= 3, '筛选下拉数量为 ' + selects.length);
  const partySel = selects[0];
  partySel.value = '广州粤海智能装备有限公司';
  partySel.dispatch('change');
  let rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 1 && cellTexts(rows[0])[1] === 'FP-202512-003', '客户筛选未生效');
  partySel.value = '全部';
  partySel.dispatch('change');
  const srcSel = selects[2];
  srcSel.value = 'session';
  srcSel.dispatch('change');
  rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 1 && cellTexts(rows[0])[1] === 'FP-SESSION-001', '来源筛选未生效');
  srcSel.value = '全部';
  srcSel.dispatch('change');
  const dates = byClass(view, 'pra-input').filter((i) => i.getAttribute('type') === 'date');
  assert(dates.length === 2, '起止日期输入框数量为 ' + dates.length);
  dates[0].value = '2025-12-10';
  dates[0].dispatch('change');
  rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 1 && cellTexts(rows[0])[1] === 'FP-SESSION-001', '起始日期筛选未生效');
  dates[0].value = '';
  dates[0].dispatch('change');
  const kw = byClass(view, 'pra-input').filter((i) => i.getAttribute('type') !== 'date')[0];
  assert(kw, '缺少关键词输入框');
  kw.value = 'HLine-3';
  kw.dispatch('input');
  rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 1 && cellTexts(rows[0])[1] === 'FP-202512-003', '关键词筛选未生效');
  kw.value = '';
  kw.dispatch('input');
  const chips = byClass(view, 'pra-chip').map((c) => c.textContent.trim());
  assert(chips.includes('今天') && chips.includes('近 7 天') && chips.includes('本月'), '时间快捷 chip 不全：' + chips.join('|'));
  return '客户/来源/起止日期/关键词/快捷时间 全部生效';
});

/* ---------- 4.7 开票台账 ---------- */
console.log('');
console.log('[7] 开票台账');
function invoiceView() {
  api.show('invoices');
  return byClass(container, 'pra-view').find((v) => v.getAttribute('data-view') === 'invoices');
}

const invRows = data.ledger.filter((r) => String(r.docType).includes('发票'));

check('已开发票列表：分页 25/页，合计标注正确', () => {
  const view = invoiceView();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === Math.min(25, invRows.length), '行数为 ' + rows.length);
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('共 ' + invRows.length + ' 张'), '未标注发票张数：' + note);
  const total = invRows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  assert(note.includes(fmtMoney(total)), '金额合计不符：' + note);
  return note.replace(/\s+/g, ' ').trim().slice(0, 70) + '…';
});

check('按类型筛选（出口发票）', () => {
  const view = invoiceView();
  const select = oneByClass(view, 'pra-select');
  select.value = '出口发票';
  select.dispatch('change');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const want = invRows.filter((r) => r.docType === '出口发票').length;
  assert(rows.length === want, `行数 ${rows.length} != ${want}`);
  rows.forEach((tr) => assert(cellTexts(tr)[2] === '出口发票', '类型列不符'));
  select.value = '全部';
  select.dispatch('change');
  return want + ' 张';
});

check('金额降序排序生效', () => {
  const view = invoiceView();
  const btn = byClass(view, 'pra-btn').find((b) => b.textContent.indexOf('金额排序') === 0);
  assert(btn, '缺少金额排序按钮');
  btn.click();
  assert(btn.textContent.includes('降序'), '按钮文案未更新：' + btn.textContent);
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const amounts = rows.map((tr) => Number(cellTexts(tr)[4].replace(/,/g, '')));
  for (let i = 1; i < amounts.length; i++) {
    assert(amounts[i - 1] >= amounts[i], `第 ${i} 行顺序异常`);
  }
  return '首个金额 ' + fmtMoney(amounts[0]);
});

/* ---------- 4.8 边界与幂等 ---------- */
console.log('');
console.log('[8] 边界与幂等');
check('空 data 不抛错（8 个模块均可用）', () => {
  const box = new El('div', documentStub);
  const api2 = windowStub.Practice.mount(box, {}, ctx);
  VIEW_KEYS.forEach((k) => api2.show(k));
  assert(box.children.length === 1, '空数据下渲染结构异常');
  return '空数据渲染正常（8 视图）';
});

check('重复 mount 不产生重复 DOM', () => {
  const box = new El('div', documentStub);
  windowStub.Practice.mount(box, data, ctx);
  const first = box.children.length;
  windowStub.Practice.mount(box, data, ctx);
  assert(box.children.length === 1 && first === 1, `重复 mount 后子节点 ${box.children.length} 个`);
  return '幂等';
});

check('详情面板缺少对应 document 时不抛错', () => {
  const box = new El('div', documentStub);
  const ledgerOnly = {
    meta: data.meta,
    documents: [],
    ledger: [{ idx: 1, id: 'FP-XXXX-999', docType: '增值税专用发票', summary: '销售发票', date: '2025-12-05', party: '甲', amount: 100, file: 'x.html' }],
    tables: { sales: [] },
    dict: {}
  };
  const api3 = windowStub.Practice.mount(box, ledgerOnly, ctx);
  api3.show('ledger');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'ledger');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const btn = byClass(rows[0], 'pra-btn')[0];
  btn.click();
  const modal = oneByClass(box, 'pra-modal');
  assert(modal.textContent.includes('未找到编号'), '缺失文档时未给出提示：' + modal.textContent.slice(0, 40));
  return '降级提示正常';
});

check('mount 与翻页开销（175 条单据，只重建表格行）', () => {
  const box = new El('div', documentStub);
  const t0 = Date.now();
  const a = windowStub.Practice.mount(box, data, ctx);
  const t1 = Date.now();
  a.show('ledger');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'ledger');
  const next = byClass(view, 'pra-btn').find((b) => b.textContent === '下一页');
  const prev = byClass(view, 'pra-btn').find((b) => b.textContent === '上一页');
  assert(prev.disabled === true, '第 1 页时「上一页」应禁用');
  for (let i = 0; i < 6; i++) next.click();
  const t2 = Date.now();
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 25, '末页行数为 ' + rows.length);
  assert(next.disabled === true, '末页时「下一页」应禁用');
  assert(prev.disabled === false, '末页时「上一页」应可用');
  assert(t1 - t0 < 800, 'mount 耗时过长：' + (t1 - t0) + 'ms');
  assert(t2 - t1 < 400, '连续翻页耗时过长：' + (t2 - t1) + 'ms');
  return `mount ${t1 - t0}ms · 翻页 6 次 ${t2 - t1}ms（DOM 桩环境，仅供量级参考）`;
});

check('ctx.chrome=false（宿主外壳）时只渲染内容区，不出现双层导航', () => {
  const box = new El('div', documentStub);
  const apiBare = windowStub.Practice.mount(box, data, Object.assign({}, ctx, { chrome: false }));
  assert(byClass(box, 'pra-top').length === 0, '仍渲染了顶部系统条');
  assert(byClass(box, 'pra-navbtn').length === 0, '仍渲染了侧边菜单');
  const rootEl = box.children[0];
  assert(String(rootEl.className).includes('pra-bare'), '缺少 pra-bare 标记');
  VIEW_KEYS.forEach((k) => apiBare.show(k));
  const active = byClass(box, 'pra-view').filter((v) => v.className.indexOf(' on') >= 0);
  assert(active.length === 1, '激活视图数量为 ' + active.length);
  return '8 个模块可切换，仅内容区';
});

check('自动探测宿主外壳（doc 中存在 #side 与 .top）时进入 bare 模式', () => {
  const hostDoc = {
    createElement(tag) { return new El(tag, hostDoc); },
    querySelector(sel) {
      return sel === '#side' || sel === '.top' ? { nodeType: 1 } : null;
    },
    addEventListener() {}
  };
  const box = new El('div', hostDoc);
  windowStub.Practice.mount(box, data, ctx);
  assert(byClass(box, 'pra-top').length === 0, '自动探测失败：仍渲染顶部条');
  assert(String(box.children[0].className).includes('pra-bare'), '自动探测失败：缺少 pra-bare');
  return '探测生效，未渲染自带外壳';
});

check('真实 TaxEngine.buildDraft() 的草稿能回填并参与校验（engine.js 同上下文）', () => {
  const engineCode = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
  vm.runInContext(engineCode, sandbox, { filename: 'src/engine.js' });
  const E = sandbox.TaxEngine;
  assert(E && typeof E.buildDraft === 'function', 'TaxEngine 未挂载（engine.js 加载失败）');
  E.configure(data);

  const byId = (id) => data.documents.find((d) => d.id === id);
  const docs = ['HT-202512-001', 'YS-202512-001', 'CK-202512-001'].map(byId).filter(Boolean);
  assert(docs.length === 3, '联调单据不足：' + docs.map((d) => d.id).join(','));
  const contract = byId('HT-202512-001');
  const application = {
    applicationNo: 'INV-2025-12-001',
    applicant: '李娜',
    applyDate: '2025-12-05',
    documents: docs,
    declaredAmount: contract.amountTotal,
    declaredTaxRate: '13%',
    customerOverride: null
  };
  const audit = {
    applicationNo: 'INV-2025-12-001', auditedAt: '2025-12-05 18:00', operator: '系统',
    result: 'pass', checks: [], evidenceTable: [], ruleMode: 'rule', summary: '', riskLevel: 'low'
  };
  const draft = E.buildDraft(audit, application);
  assert(draft, 'buildDraft 返回 null');

  const box = new El('div', documentStub);
  const apiE = windowStub.Practice.mount(box, data, ctx);
  apiE.openDraft(draft);
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'issue');
  const values = byClass(view, 'pra-input').map((i) => i.value);
  assert(values.includes(draft.buyer.name), '购方名称未回填：' + draft.buyer.name);
  assert(values.includes(String(draft.buyer.taxNo)), '纳税人识别号未回填');
  const head = oneByClass(view, 'pra-vhead');
  assert(head.textContent.includes('校验通过'), '引擎草稿未通过票面校验：' + head.textContent);
  const draftBox = oneByClass(view, 'pra-draft');
  assert(draftBox.textContent.includes(draft.draftNo), '草稿号未显示');
  assert(draftBox.textContent.includes('待人工确认'), 'statusLabel 未显示');
  assert(draftBox.textContent.includes('合同 HT-202512-001'), '关联合同号未显示');
  const state = apiE.getFormState();
  assert(state.valid === true, 'getFormState().valid 应为 true');
  return draft.draftNo + ' · ' + draft.invoiceType + ' · 价税合计 ' + fmtMoney(draft.amountTotal);
});

/* ==================================================================
 * 5. 汇总
 * ================================================================== */
/* ---------- 4.9 被驳回申请（放最后：会切换 Practice 模块级 current 实例） ---------- */
/* ---------- 4.5.2 被驳回申请 ---------- */
console.log('');
console.log('[5.5] 被驳回申请');

const REJECTED_ONE = {
  applicationNo: 'INV-2025-12-001', result: 'fail', resultLabel: '不通过', riskLevel: 'mid',
  auditedAt: '2026-11-14 15:30:00', operator: '李娜',
  customer: '上海衡远机电设备有限公司', product: '五轴数控机床 HMC-800', amount: 27000000, region: '内销',
  summary: '审核不通过：1 项检查未通过 —— 金额一致性',
  checks: [{
    key: 'check_amount', name: '金额一致性', status: 'fail',
    conclusion: '金额不一致：合同不含税金额 27,000,000.00 元，验收单金额合计 25,000,000.00 元',
    advice: '请核对验收数量与单价，确认差异原因后重新提交。',
    evidence: [{ docId: 'HT-202512-001', docType: '销售合同', field: '不含税金额', value: '27,000,000.00' }]
  }],
  documents: [
    { id: 'HT-202512-001', docType: '销售合同', docDate: '2025-12-05', party: '上海衡远机电设备有限公司', amountTotal: 30510000 },
    { id: 'YS-202512-001', docType: '验收单', docDate: '2025-12-05', party: '上海衡远机电设备有限公司', amountTotal: 25000000 }
  ],
  application: { applicationNo: 'INV-2025-12-001', declaredCustomer: '上海衡远机电设备有限公司', declaredAmount: 27000000, product: '五轴数控机床 HMC-800' }
};

function rejectedCtx(overrides) {
  return Object.assign({}, ctx, {
    getRejected: () => rejectedState.list,
    patchRejected: (no, patch) => { rejectedState.patched = { no, patch }; return rejectedState.list[0]; },
    openRejected: (no) => { rejectedState.opened = no; return true; },
    retryRejected: (no) => { rejectedState.retried = no; return true; },
    openContractFix: (cid) => { rejectedState.fixed = cid; return true; }
  }, overrides || {});
}
const rejectedState = { list: [], patched: null, opened: null, retried: null, fixed: null };

check('被驳回申请：无待处理时给出空态', () => {
  rejectedState.list = [];
  const noDocsData = Object.assign({}, data, { documents: [], sessionInvoices: [] });
  const box = new El('div', documentStub);
  const apiR = windowStub.Practice.mount(box, noDocsData, rejectedCtx());
  apiR.show('rejected');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'rejected');
  assert(view, '找不到「被驳回申请」视图');
  assert(view.textContent.includes('暂无被驳回或暂不开票的申请'), '空态文案缺失：' + view.textContent.slice(0, 80));
  return '空态正常';
});

check('被驳回申请：数据侧「暂不开票」（缺验收单）也列入待处理', () => {
  rejectedState.list = [];
  const box = new El('div', documentStub);
  const apiR = windowStub.Practice.mount(box, data, rejectedCtx());
  apiR.show('rejected');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'rejected');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length >= 1, '行数为 ' + rows.length);
  const cells = cellTexts(rows[0]);
  assert(cells[2].includes('暂不开票'), '来源列不是「暂不开票」：' + cells[2]);
  assert(cells[3].includes('暂缓'), '结论列不是「暂缓」：' + cells[3]);
  assert(view.textContent.includes('缺少验收单等证据'), '缺少缺单据原因文案');
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('暂不开票'), '统计未包含暂不开票：' + note);
  // 点「补单据并重审」应调用 ctx.openContractFix
  rejectedState.fixed = null;
  const btn = byClass(rows[0], 'pra-btn').find((b) => b.textContent.includes('补单据并重审'));
  assert(btn, '缺少「补单据并重审」按钮');
  btn.click();
  assert(rejectedState.fixed, '未调用 openContractFix');
  return '合同 ' + rejectedState.fixed + ' · ' + note.replace(/\s+/g, ' ').trim();
});

check('被驳回申请：列表显示结论/客户/金额/主要问题与统计', () => {
  rejectedState.list = [REJECTED_ONE];
  const box = new El('div', documentStub);
  const apiR = windowStub.Practice.mount(box, data, rejectedCtx());
  apiR.show('rejected');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'rejected');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  assert(rows.length === 2, '行数为 ' + rows.length + '（期望 1 条审核驳回 + 1 条暂不开票）');
  const cells = cellTexts(rows[0]);
  assert(cells[1] === 'INV-2025-12-001', '申请编号列不符：' + cells[1]);
  assert(cells[2].includes('审核驳回'), '来源列不符：' + cells[2]);
  assert(cells[3].includes('不通过'), '结论列不符：' + cells[3]);
  assert(cells[4] === '上海衡远机电设备有限公司', '客户列不符：' + cells[4]);
  assert(cells[6] === '27,000,000.00', '金额列不符：' + cells[6]);
  assert(cells[8].includes('金额一致性'), '主要问题列不符：' + cells[8]);
  const note = byClass(view, 'pra-tnote').map((n) => n.textContent).join(' ');
  assert(note.includes('共 2 条待处理'), '缺少统计：' + note);
  assert(note.includes('审核不通过 1') && note.includes('暂不开票 1'), '统计口径不符：' + note);
  return '列表与统计正确';
});

check('被驳回申请：详情窗口含原因/单据/修改表单/三个处理入口', () => {
  rejectedState.list = [REJECTED_ONE];
  rejectedState.patched = null;
  rejectedState.opened = null;
  rejectedState.retried = null;
  const box = new El('div', documentStub);
  const apiR = windowStub.Practice.mount(box, data, rejectedCtx());
  apiR.show('rejected');
  const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === 'rejected');
  const rows = rowsOf(oneByClass(view, 'pra-tbl'));
  const btn = byClass(rows[0], 'pra-btn').find((b) => b.textContent.includes('查看并处理'));
  assert(btn, '缺少「查看并处理」按钮');
  btn.click();
  const modal = oneByClass(box, 'pra-modal');
  assert(modal.className.indexOf(' on') >= 0, '详情窗口未打开');
  const txt = modal.textContent;
  assert(txt.includes('金额一致性'), '详情缺少审核意见');
  assert(txt.includes('修改建议'), '详情缺少修改建议');
  assert(txt.includes('已上传单据'), '详情缺少单据区');
  assert(txt.includes('YS-202512-001'), '详情缺少单据明细');
  assert(txt.includes('修改申请信息'), '详情缺少修改表单');
  const inputs = byClass(modal, 'pra-input');
  assert(inputs.length >= 4, '修改表单字段数量为 ' + inputs.length);

  // 保存修改 → patchRejected 被调用
  const saveBtn = byClass(modal, 'pra-btn').find((b) => b.textContent === '保存修改');
  assert(saveBtn, '缺少「保存修改」');
  inputs[0].value = '上海衡远机电设备有限公司（改）';
  saveBtn.click();
  assert(rejectedState.patched && rejectedState.patched.no === 'INV-2025-12-001', '未调用 patchRejected');
  assert(rejectedState.patched.patch.customer.includes('（改）'), '修改内容未传出');

  // 补充单据 → openRejected
  const addBtn = byClass(modal, 'pra-btn').find((b) => b.textContent.includes('补充单据'));
  assert(addBtn, '缺少「补充单据」');
  addBtn.click();
  assert(rejectedState.opened === 'INV-2025-12-001', '未调用 openRejected');

  // 重新提交审核 → retryRejected（重开窗口后点）
  btn.click();
  const modal2 = byClass(box, 'pra-modal').filter((m) => m.className.indexOf(' on') >= 0)[0] || modal;
  const retryBtn = byClass(modal2, 'pra-btn').find((b) => b.textContent.includes('重新提交审核'));
  assert(retryBtn, '缺少「重新提交审核」');
  retryBtn.click();
  assert(rejectedState.retried === 'INV-2025-12-001', '未调用 retryRejected');

  return '详情窗口完整 + 修改/补单据/重审三条链路均触发';
});


const passed = results.filter((r) => r.ok).length;
console.log('');
console.log('==============================================');
console.log(`冒烟结果：${passed}/${results.length} 通过，${failures} 失败`);
console.log('==============================================');
if (failures) {
  console.log('失败项：');
  results.filter((r) => !r.ok).forEach((r) => console.log(' - ' + r.name + ' :: ' + r.detail));
  process.exitCode = 1;
}

/* ==================================================================
 * 6. --dump：输出各视图文本大纲，便于人工核对文案与信息密度
 * ================================================================== */
if (process.argv.includes('--dump')) {
  const box = new El('div', documentStub);
  const api4 = windowStub.Practice.mount(box, data, ctx);
  const outline = (node, depth, out) => {
    if (!node || node.nodeType !== 1) return;
    const own = String(node._text || '').trim();
    const cls = String(node.className || '');
    const tag = node.tagName.toLowerCase();
    const interesting = own || ['h1', 'h2', 'b', 'button', 'th'].includes(tag);
    if (interesting) {
      out.push('  '.repeat(depth) + tag + (cls ? '.' + cls.split(/\s+/).filter(Boolean).join('.') : '') +
        (own ? '  « ' + own.slice(0, 96) + ' »' : ''));
    }
    for (const c of node.childNodes || []) outline(c, interesting ? depth + 1 : depth, out);
  };
  VIEW_KEYS.forEach((key, i) => {
    api4.show(key);
    const view = byClass(box, 'pra-view').find((v) => v.getAttribute('data-view') === key);
    const out = [];
    outline(view, 0, out);
    console.log('');
    console.log('################ 视图 ' + (i + 1) + ' / 6：' + VIEW_NAMES[i] + ' ################');
    console.log(out.join('\n'));
  });
}
