/* ==========================================================================
 * agent.js —— 智能体工作区
 * 三区界面：上传识别区 / 审核工作区（左字段+来源、右审核结论）/ 草稿确认区
 * 附：大模型 API 设置、测试示例模块、审核日志、制度依据、验收指标
 * 依赖：window.TaxEngine、window.TAX_DATA
 * ========================================================================== */
(function (root) {
  'use strict';

  // 模块加载即绑定引擎与数据（mount 时再次确认），保证不经 mount 也能渲染各视图
  var E = root.TaxEngine;
  var DATA = root.TAX_DATA || {};
  var state = {
    docs: [],            // 本次申请的待审单据
    application: null,
    audit: null,
    draft: null,
    pool: [],            // 本会话已开具发票池
    rejected: [],        // 被驳回 / 暂缓的申请（可查看、补单据、改信息、重审）
    logs: [],
    llm: { provider: 'Finance AI（跃客科技）', model: 'deepseek-v4.1-flash', apiKey: '', baseUrl: '/api/ai', enabled: false, checked: false },
    lastMode: 'rule',
    testResult: null,
    view: 'workspace'
  };

  var CTX = {};
  var EL = {};

  /* ------------------------------------------------------------ 基础工具 */

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, r) { return (r || document).querySelector(sel); }
  function $$(sel, r) { return Array.prototype.slice.call((r || document).querySelectorAll(sel)); }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function nowStr() { return E.fmtDateTime(new Date()); }
  function store(key, val) {
    try {
      if (val === undefined) { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; }
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* file:// 下可能不可用，静默降级 */ }
    return null;
  }

  /* ------------------------------------------------ 单据原件 HTML → 结构化 */

  function t(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function numOf(s) {
    if (s === null || s === undefined) return null;
    var x = String(s).replace(/[¥￥,元\s]/g, '');
    if (!x || x === '—' || x === '-') return null;
    var m = x.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  function rateOf(s) {
    if (!s) return null;
    var m = String(s).match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? (Math.round(Number(m[1]) * 100) / 100) + '%' : null;
  }

  var GRID_MAP = {
    '货物或应税劳务名称': 'name', '规格型号': 'spec', '单位': 'unit', '数量': 'qty',
    '单价': 'unitPrice', '金额': 'amount', '税率': 'taxRate', '税额': 'taxAmount',
    '货物名称': 'name', '货物': 'name', '项目': 'name', '物料编码': 'code', '名称': 'name',
    '物料 / 产品': 'name', '商品名称': 'name',
    '应收 / 账面数量': 'qtyBook', '实收 / 实盘数量': 'qtyActual',
    '单价（元）': 'unitPrice', '金额（元）': 'amount', '质检结果': 'quality',
    '成本单价': 'unitPrice', '成本金额': 'amount', '状态': 'status',
    '计税价格（CIF+关税）': 'base', '关税税率': 'tariffRate', '关税': 'tariff', '进口增值税': 'vat'
  };

  /**
   * 解析单张单据原件 HTML（与 tools/build_data.py 同一套规则，浏览器端实现）
   * @returns {Object} 与 data/documents.json 同构的单据对象
   */
  function parseDocHtml(text, fileName) {
    var dom = new DOMParser().parseFromString(text, 'text/html');
    var self = (DATA && DATA.meta && DATA.meta.company) || '华衡智造集团股份有限公司';
    var fields = [];
    var q = function (cls) { return dom.querySelector('.' + cls); };

    var noEl = q('q2-doc2-no');
    var id = noEl ? t(noEl.querySelector('b')) : '';
    if (!id) {
      var m = fileName.match(/([A-Z]{2}-\d{6}-\d{3})/);
      id = m ? m[1] : ('UPLOAD-' + Date.now().toString().slice(-6));
    }
    var docDate = '';
    if (noEl) {
      var dm = t(noEl).match(/(\d{4}-\d{2}-\d{2})/);
      if (dm) docDate = dm[1];
      fields.push({ key: 'id', label: '单据编号', value: id, loc: '页眉区 · 单据编号' });
    }
    var titleEl = q('q2-doc2-title');
    var docTypeRaw = titleEl && titleEl.querySelector('h2') ? t(titleEl.querySelector('h2')) : '';
    var subtitle = titleEl && titleEl.querySelector('p') ? t(titleEl.querySelector('p')) : '';
    if (subtitle) fields.push({ key: 'title', label: '单据二级标题', value: subtitle, loc: '标题区 · 副标题' });

    // 信息区
    var meta = {};
    ['q2-doc2-invmeta', 'q2-doc2-whbar', 'q2-doc2-orderbar', 'q2-doc2-formbar', 'q2-doc2-custombar'].forEach(function (cls) {
      var blk = q(cls);
      if (!blk) return;
      Array.prototype.forEach.call(blk.children, function (d, i) {
        var lab = d.querySelector('label') || d.querySelector('span');
        var b = d.querySelector('b');
        var label = t(lab), value = b ? t(b) : t(d);
        if (!label) {
          var mm = t(d).match(/^([^：:]{1,10})[：:]\s*(.*)$/);
          if (!mm) return;
          label = mm[1]; value = mm[2];
        }
        meta[label] = value;
        fields.push({ key: null, label: label, value: value, loc: '信息区 · 第' + (i + 1) + '项「' + label + '」' });
      });
    });
    if (!docDate) docDate = meta['开票日期'] || meta['业务日期'] || '';

    // 往来方
    var party = '', partyRole = '', partyTaxNo = null;
    var parties = [];
    var pblk = q('q2-doc2-parties');
    if (pblk) {
      Array.prototype.forEach.call(pblk.children, function (d, i) {
        var role = t(d.querySelector('label')) || t(d.querySelector('span'));
        var name = t(d.querySelector('b'));
        var extra = t(d.querySelector('span'));
        var tm = extra.match(/纳税人识别号\s*([0-9A-Z]{15,20})/);
        parties.push({ role: role, name: name, taxNo: tm ? tm[1] : null });
        fields.push({ key: null, label: role + '名称', value: name, loc: '往来方区 · 第' + (i + 1) + '方「' + role + '」' });
        if (tm) fields.push({ key: null, label: role + '纳税人识别号', value: tm[1], loc: '往来方区 · 第' + (i + 1) + '方「' + role + '」纳税人识别号' });
      });
    }
    var other = parties.filter(function (p) { return p.name && p.name !== self; });
    if (other.length) { party = other[0].name; partyRole = other[0].role; partyTaxNo = other[0].taxNo; }
    else if (parties.length) { party = parties[0].name; partyRole = parties[0].role; partyTaxNo = parties[0].taxNo; }
    if (!party && meta['往来单位']) { party = meta['往来单位']; partyRole = '往来单位'; }

    // 明细表
    var items = [];
    var grid = q('q2-doc2-grid');
    if (grid) {
      var ths = $$('thead th', grid).map(t);
      $$('tbody tr', grid).forEach(function (tr, ri) {
        var tds = $$('td', tr).map(t);
        if (!tds.length) return;
        var rec = {};
        tds.forEach(function (v, ci) { var k = GRID_MAP[ths[ci]]; if (k) rec[k] = v; });
        items.push({
          name: rec.name || rec.code || '', spec: rec.spec || '', unit: rec.unit || '',
          qty: numOf(rec.qty || rec.qtyActual || rec.qtyBook), unitPrice: numOf(rec.unitPrice),
          amount: numOf(rec.amount), taxRate: rateOf(rec.taxRate), taxAmount: numOf(rec.taxAmount),
          extra: { quality: rec.quality, status: rec.status }, loc: '明细表 第' + (ri + 1) + '行'
        });
        tds.forEach(function (v, ci) {
          if (ths[ci]) fields.push({ key: null, label: '明细·' + ths[ci], value: v, loc: '明细表 第' + (ri + 1) + '行「' + ths[ci] + '」' });
        });
      });
    }

    // 合同要素表
    var terms = {};
    var termsEl = q('q2-doc2-terms');
    if (termsEl) {
      $$('tbody tr', termsEl).forEach(function (tr) {
        var th = tr.querySelector('th'), td = tr.querySelector('td');
        if (!th || !td) return;
        terms[t(th)] = t(td);
        fields.push({ key: null, label: t(th), value: t(td), loc: '合同要素表 · 「' + t(th) + '」' });
      });
    }

    // 合计区
    var totals = {};
    var tb = q('q2-doc2-total');
    if (tb) {
      Array.prototype.forEach.call(tb.children, function (d, i) {
        var txt = t(d), m = txt.match(/^([^：:]{2,20})[：:]\s*(.*)$/);
        var lab = m ? m[1] : txt.slice(0, 12);
        var b = d.querySelector('b'), em = d.querySelector('em');
        totals[lab] = b ? t(b) : txt;
        if (em) totals[lab + '_小写'] = t(em);
        fields.push({ key: null, label: lab, value: totals[lab], loc: '合计区 · 第' + (i + 1) + '项「' + lab + '」' });
        if (em) fields.push({ key: null, label: lab + '（小写）', value: t(em), loc: '合计区 · 第' + (i + 1) + '项「' + lab + '」小写行' });
      });
    }

    // 语义字段
    var amountEx = null, taxAmt = null, amountTotal = null, amountWords = '', taxRate = null;
    var dt = docTypeRaw;
    if (/发票/.test(dt)) {
      amountEx = numOf(totals['合计金额']);
      taxAmt = numOf(totals['合计税额']);
      amountWords = totals['价税合计（大写）'] || '';
      amountTotal = numOf(totals['价税合计（大写）_小写']) || numOf(totals['价税合计_小写']);
      taxRate = (items[0] && items[0].taxRate) || null;
      if (amountTotal === null && amountEx !== null) amountTotal = E.r2(amountEx + (taxAmt || 0));
    } else if (/合同/.test(dt)) {
      if (/采购/.test(dt)) {
        amountTotal = numOf(terms['合同总价']); amountEx = amountTotal;
      } else {
        amountEx = numOf(terms['金额（不含税）']);
        amountTotal = numOf(terms['价税合计']);
        taxRate = rateOf(terms['增值税率']);
        if (amountTotal !== null && amountEx !== null) taxAmt = E.r2(amountTotal - amountEx);
      }
      if (terms['数量']) {
        var qm = terms['数量'].match(/([\d,\.]+)\s*(.*)/);
        if (qm) items = [{ name: terms['标的'] || '', spec: '', unit: (qm[2] || '').trim(), qty: numOf(qm[1]), unitPrice: numOf(terms['单价（不含税）']), amount: amountEx, taxRate: taxRate, taxAmount: null, extra: {}, loc: '合同要素表 · 标的/数量/单价行' }];
      }
    } else if (/验收单|到货签收单|出库单/.test(dt)) {
      amountTotal = items.reduce(function (s, it) { return s + (it.amount || 0); }, 0) || null;
      amountTotal = amountTotal === null ? null : E.r2(amountTotal);
      amountEx = amountTotal;
    } else if (/缴款书/.test(dt)) {
      amountEx = numOf(totals['计税价格']); taxAmt = numOf(totals['进口增值税']);
      amountTotal = amountEx !== null ? E.r2(amountEx + (taxAmt || 0)) : null;
    }

    if (amountEx !== null) fields.push({ key: 'amountExTax', label: '不含税金额', value: String(amountEx), loc: '语义汇总 · 不含税金额' });
    if (amountTotal !== null) fields.push({ key: 'amountTotal', label: '价税合计', value: String(amountTotal), loc: '语义汇总 · 价税合计/业务金额' });
    if (taxAmt !== null) fields.push({ key: 'taxAmount', label: '税额', value: String(taxAmt), loc: '语义汇总 · 税额' });
    if (taxRate) fields.push({ key: 'taxRate', label: '税率', value: taxRate, loc: '语义汇总 · 税率' });

    var doc = {
      idx: null, id: id, file: fileName, docTypeRaw: docTypeRaw, docType: '', title: subtitle,
      docDate: docDate, party: party, partyRole: partyRole, partyTaxNo: partyTaxNo,
      selfName: self, selfTaxNo: (DATA && DATA.meta && DATA.meta.selfTaxNo) || '91440300MA5H8K2X3Q',
      amountExTax: amountEx, taxAmount: taxAmt, amountTotal: amountTotal, amountInWords: amountWords || null,
      taxRate: taxRate, currency: 'CNY', invoiceCode: meta['发票代码'] || null, invoiceNo: meta['发票号码'] || null,
      checkCode: meta['校验码'] || null, contractNo: terms['合同编号'] || null, remark: null,
      items: items, terms: terms, totals: totals, footers: {}, fields: fields,
      textLen: text.length, parseWarnings: [], uploaded: true
    };
    doc.docType = E.classifyDoc(doc).docType;
    return doc;
  }

  /* -------------------------------------------------- 一次申请的装配逻辑 */

  function matchDocsForRow(row) {
    // 优先使用构建期预计算的证据（tools/build_data.py 直出，避免各端各自推断）
    if (row.evidence && row.evidence.docs && row.evidence.docs.length) {
      var byId = {};
      DATA.documents.forEach(function (d) { byId[d.id] = d; });
      var ev = row.evidence;
      return {
        contract: byId[ev.contract] || null,
        acceptance: byId[ev.acceptance] || null,
        stockOut: byId[ev.stockOut] || null,
        sign: ev.deliverySign ? (byId[ev.deliverySign] || null) : null
      };
    }
    var docs = DATA.documents;
    var wantTotal = E.r2(row.amount * (row.region === '出口' ? 1 : 1.13));
    var cand = docs.filter(function (d) { return d.party === row.customer; });
    function byAmount(types, target) {
      return cand.filter(function (d) { return types.indexOf(d.docType) >= 0 && d.amountTotal !== null && Math.abs(d.amountTotal - target) < 0.01; });
    }
    var contracts = byAmount(['销售合同'], wantTotal).filter(function (d) { return d.items[0] && d.items[0].name === row.product; });
    if (!contracts.length) contracts = byAmount(['销售合同'], wantTotal);
    if (contracts.length > 1) contracts = contracts.filter(function (d) { return d.items[0] && d.items[0].qty === row.qty; });
    var contract = contracts[0] || null;

    var accs = byAmount(['验收单'], row.amount);
    if (accs.length > 1) {
      var named = accs.filter(function (d) { return d.items[0] && d.items[0].name === row.product; });
      if (named.length) accs = named;
    }
    var acceptance = accs[0] || null;

    var cks = cand.filter(function (d) { return d.docType === '出库单' && d.items[0] && d.items[0].qty === row.qty; });
    if (cks.length > 1) {
      var byDate = cks.filter(function (d) { return d.docDate === row.date; });
      if (byDate.length) cks = byDate;
    }
    return { contract: contract, acceptance: acceptance, stockOut: cks[0] || null, sign: cand.filter(function (d) { return d.docType === '到货签收单'; })[0] || null };
  }

  function assembleFromRow(row, seq) {
    var m = matchDocsForRow(row);
    var docs = [m.contract, m.acceptance, m.stockOut].filter(Boolean);
    return {
      applicationNo: 'INV-2025-12-' + String(seq + 1).padStart(3, '0'),
      applicant: '李娜',
      applyDate: row.date,
      region: row.region,
      declaredAmount: m.contract ? m.contract.amountTotal : null,
      declaredCustomer: row.customer,
      customer: row.customer,
      product: row.product,
      documents: docs,
      source: '待开票清单 · ' + row.product + ' · ' + row.customer
    };
  }

  /* ------------------------------------------------------------ 界面骨架 */

  function mount(container, data, ctx) {
    EL.root = container;
    CTX = ctx || {};
    E = root.TaxEngine;
    DATA = data;
    E.configure(DATA);
    state.llm = Object.assign(state.llm, store('dsh_llm_cfg') || {});
    state.logs = store('dsh_audit_logs') || [];
    render();
    if (!state.llm.checked) {
      state.llm.checked = true;
      setTimeout(function () {
        toast('尚未配置大模型密钥，当前以规则引擎执行审核；可在「大模型API设置」中填写服务商、模型与密钥。', 'warn', 7000);
      }, 600);
    }
  }

  function toast(msg, kind, ms) {
    if (CTX.toast) return CTX.toast(msg, kind, ms);
    var box = $('#agentToast');
    if (!box) return;
    box.className = 'ag-toast on ' + (kind || '');
    box.textContent = msg;
    box.style.display = 'block';
    clearTimeout(box._t);
    box._t = setTimeout(function () { box.style.display = 'none'; }, ms || 3200);
  }

  function render() {
    EL.root.innerHTML = '';
    EL.root.appendChild(shell());
    wire();
  }

  function shell() {
    var wrap = h('div', 'ag');
    wrap.innerHTML =
      '<div class="ag-head">' +
        '<div class="ag-title"><b>智能审核工作区</b><span>开票申请 + 关联单据 → 识别 → 提取 → 审核 → 草稿</span></div>' +
        '<div class="ag-head-right">' +
          '<span class="ag-mode" id="agMode">规则引擎 · 本地</span>' +
          '<button class="ag-btn gold" id="btnNewBiz">＋ 新建业务（上传单据）</button>' +
          '<button class="ag-btn ghost" id="btnLlm">大模型API设置</button>' +
          '<button class="ag-btn ghost" id="btnTest">测试示例</button>' +
          '<button class="ag-btn ghost" id="btnReset">重置工作区</button>' +
        '</div>' +
      '</div>' +
      '<div class="ag-body">' +
        '<section class="ag-zone ag-zone-up" id="zoneUp"></section>' +
        '<section class="ag-zone ag-zone-audit" id="zoneAudit"></section>' +
        '<section class="ag-zone ag-zone-draft" id="zoneDraft"></section>' +
      '</div>' +
      '<div class="ag-toast" id="agentToast" style="display:none"></div>';
    return wrap;
  }

  function wire() {
    var nb = $('#btnNewBiz');
    if (nb) nb.onclick = function () { focusUpload(); };
    $('#btnLlm').onclick = openLlmModal;
    $('#btnTest').onclick = function () { CTX.go && CTX.go('testExample'); };
    $('#btnReset').onclick = function () {
      state.docs = []; state.application = null; state.audit = null; state.draft = null;
      renderZones(); toast('工作区已重置');
    };
    renderZones();
  }

  function renderZones() {
    renderUploadZone();
    renderAuditZone();
    renderDraftZone();
    var m = $('#agMode');
    if (m) {
      m.textContent = state.lastMode === 'hybrid-llm' ? '大模型 + 规则 · 双引擎' : '规则引擎 · 本地';
      m.className = 'ag-mode' + (state.lastMode === 'hybrid-llm' ? ' on' : '');
    }
  }

  /* ------------------------------------------------------- 区一：上传识别 */

  /** 聚焦上传区并唤起文件选择（实务系统「新建开票业务」与工作区「新建业务」都走这里） */
  function focusUpload() {
    var zone = $('#zoneUp');
    if (zone) {
      if (zone.scrollIntoView) zone.scrollIntoView({ behavior: 'smooth', block: 'start' });
      var drop = $('#dropZone');
      if (drop) {
        drop.classList.add('over');
        setTimeout(function () { drop.classList.remove('over'); }, 1800);
      }
    }
    var fi = $('#fileInput');
    if (fi) { try { fi.click(); } catch (e) { /* 浏览器可能拦截，用户仍可点击上传区 */ } }
    toast('选择要上传的业务单据：销售合同 + 验收单 + 出库单（可多选）', '', 5000);
  }

  function renderUploadZone() {
    var z = $('#zoneUp');
    if (!z) return;
    var docs = state.docs;
    z.innerHTML =
      '<div class="ag-zone-head"><span class="idx">01</span><b>上传与识别</b>' +
        '<em>支持 .html/.htm 单据原件、.json 结构化数据；图片/PDF 需 OCR 引擎</em></div>' +
      '<div class="ag-drop" id="dropZone">' +
        '<div class="ag-drop-in">' +
          '<b>拖拽单据到这里，或点击选择文件</b>' +
          '<span>多格式混合识别：结构化文件走规则引擎，图片/PDF 走 OCR 服务（未接入时标记为待人工补充）</span>' +
          '<input type="file" id="fileInput" multiple accept=".html,.htm,.json,.txt,.csv" style="display:none">' +
        '</div>' +
      '</div>' +
      '<div class="ag-quick">' +
        '<button class="ag-btn ghost" id="btnPickDataset">从数据集选单据（175 张）</button>' +
        '<button class="ag-btn ghost" id="btnPickCase">按待开票事项一键装配（22 项）</button>' +
        '<span class="ag-hint">数据集 = P1-01 发票开具 · 华衡智造 2025.12</span>' +
      '</div>' +
      '<div class="ag-filelist" id="fileList"></div>';

    var dz = $('#dropZone');
    var fi = $('#fileInput');
    dz.onclick = function () { fi.click(); };
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); };
    dz.ondragleave = function () { dz.classList.remove('over'); };
    dz.ondrop = function (e) {
      e.preventDefault(); dz.classList.remove('over');
      handleFiles(e.dataTransfer.files);
    };
    fi.onchange = function () { handleFiles(fi.files); fi.value = ''; };
    $('#btnPickDataset').onclick = openDatasetPicker;
    $('#btnPickCase').onclick = openCasePicker;
    renderFileList();
  }

  function renderFileList() {
    var box = $('#fileList');
    if (!box) return;
    if (!state.docs.length) {
      box.innerHTML = '<div class="ag-empty">尚未载入单据。可从数据集选择，或按「待开票事项」一键装配（合同 + 验收单 + 出库单）。</div>';
      return;
    }
    var rows = state.docs.map(function (d, i) {
      var cl = E.classifyDoc(d);
      var conf = Math.round(cl.confidence * 100);
      var warn = [];
      if (d.amountTotal === null) warn.push('金额缺失');
      if (d.docType.endsWith('发票') && !d.partyTaxNo) warn.push('购买方税号缺失');
      return '<tr>' +
        '<td class="mono">' + esc(d.id) + '</td>' +
        '<td><b>' + esc(d.docType) + '</b><div class="sub">' + esc(d.docTypeRaw || d.title || '') + '</div></td>' +
        '<td>' + esc(d.party || '—') + '</td>' +
        '<td class="mono">' + esc(d.docDate || '—') + '</td>' +
        '<td class="num">' + (d.amountTotal === null ? '—' : esc(E.fmt(d.amountTotal))) + '</td>' +
        '<td><span class="tag ok">识别 ' + conf + '%</span>' + (warn.length ? '<span class="tag warn">' + esc(warn.join('/')) + '</span>' : '') + '</td>' +
        '<td><button class="ag-mini" data-del="' + i + '">移除</button></td>' +
        '</tr>';
    }).join('');
    box.innerHTML = '<table class="ag-table"><thead><tr><th>单据编号</th><th>单据类型</th><th>对方单位</th><th>日期</th><th class="num">金额（元）</th><th>识别状态</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
    $$('[data-del]', box).forEach(function (b) {
      b.onclick = function () {
        state.docs.splice(Number(b.dataset.del), 1);
        if (state.application) state.application.documents = state.docs.slice();
        renderZones();
      };
    });
  }

  function handleFiles(files) {
    if (!files || !files.length) return;
    var pending = files.length, added = 0, skipped = [];
    Array.prototype.forEach.call(files, function (f) {
      var name = f.name || '';
      var isHtml = /\.(html?|htm)$/i.test(name);
      var isJson = /\.json$/i.test(name);
      if (!isHtml && !isJson) {
        skipped.push(name + '（' + (f.type || '未知类型') + ' 需 OCR/人工补充）');
        if (--pending === 0) done();
        return;
      }
      var fr = new FileReader();
      fr.onload = function () {
        try {
          if (isHtml) {
            var doc = parseDocHtml(String(fr.result), name);
            state.docs.push(doc); added++;
          } else {
            var j = JSON.parse(String(fr.result));
            var arr = Array.isArray(j) ? j : (j.documents || [j]);
            arr.forEach(function (d) { if (d && d.id) { if (!d.docType) d.docType = E.classifyDoc(d).docType; state.docs.push(d); added++; } });
          }
        } catch (err) {
          skipped.push(name + '（解析失败：' + err.message + '）');
        }
        if (--pending === 0) done();
      };
      fr.onerror = function () { skipped.push(name + '（读取失败）'); if (--pending === 0) done(); };
      fr.readAsText(f, 'utf-8');
    });
    function done() {
      if (state.application) state.application.documents = state.docs.slice();
      renderZones();
      if (added) toast('已识别 ' + added + ' 份单据');
      if (skipped.length) toast('未处理：' + skipped.join('；'), 'warn', 6000);
    }
  }

  /* --------------------------------------------------- 数据集选择器（模态） */

  function modal(title, bodyHtml, footHtml, onMount) {
    var mask = h('div', 'ag-mask');
    mask.innerHTML =
      '<div class="ag-modal">' +
        '<div class="ag-modal-head"><b>' + esc(title) + '</b><button class="ag-x">×</button></div>' +
        '<div class="ag-modal-body">' + bodyHtml + '</div>' +
        '<div class="ag-modal-foot">' + (footHtml || '<button class="ag-btn ghost" data-close>关闭</button>') + '</div>' +
      '</div>';
    document.body.appendChild(mask);
    var close = function () { if (mask.parentNode) mask.parentNode.removeChild(mask); };
    $('.ag-x', mask).onclick = close;
    $$('[data-close]', mask).forEach(function (b) { b.onclick = close; });
    mask.onclick = function (e) { if (e.target === mask) close(); };
    if (onMount) onMount(mask, close);
    return { el: mask, close: close };
  }

  function openDatasetPicker() {
    var types = ['全部'].concat(DATA.dict.docTypes.map(function (d) { return d.name; }));
    var sel = '全部', kw = '';
    var m = modal('从数据集选择单据（共 ' + DATA.documents.length + ' 张）',
      '<div class="ag-filter">' +
        '<select id="pkType">' + types.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select>' +
        '<input id="pkKw" placeholder="搜索单据编号 / 对方单位 / 摘要">' +
        '<span class="ag-hint" id="pkCount"></span>' +
      '</div>' +
      '<div class="ag-picklist" id="pkList"></div>',
      '<button class="ag-btn ghost" data-close>关闭</button><button class="ag-btn gold" id="pkAdd">加入待审单据</button>',
      function (mask, close) {
        var chosen = {};
        function renderList() {
          var list = DATA.documents.filter(function (d) {
            if (sel !== '全部' && d.docType !== sel) return false;
            if (!kw) return true;
            var s = (d.id + ' ' + (d.party || '') + ' ' + (d.title || '') + ' ' + d.docType).toLowerCase();
            return s.indexOf(kw.toLowerCase()) >= 0;
          }).slice(0, 300);
          $('#pkCount', mask).textContent = '匹配 ' + list.length + ' 张（最多显示 300）';
          $('#pkList', mask).innerHTML = '<table class="ag-table sm"><thead><tr><th></th><th>编号</th><th>类型</th><th>对方单位</th><th>日期</th><th class="num">金额</th></tr></thead><tbody>' +
            list.map(function (d) {
              var k = d.id;
              return '<tr><td><input type="checkbox" data-id="' + esc(k) + '"' + (chosen[k] ? ' checked' : '') + '></td>' +
                '<td class="mono">' + esc(d.id) + '</td><td>' + esc(d.docType) + '</td><td>' + esc(d.party || '—') + '</td>' +
                '<td class="mono">' + esc(d.docDate) + '</td><td class="num">' + esc(E.fmt(d.amountTotal)) + '</td></tr>';
            }).join('') + '</tbody></table>';
          $$('[data-id]', mask).forEach(function (cb) {
            cb.onchange = function () { if (cb.checked) chosen[cb.dataset.id] = true; else delete chosen[cb.dataset.id]; };
          });
        }
        $('#pkType', mask).onchange = function () { sel = this.value; renderList(); };
        $('#pkKw', mask).oninput = function () { kw = this.value.trim(); renderList(); };
        $('#pkAdd', mask).onclick = function () {
          var ids = Object.keys(chosen);
          if (!ids.length) { toast('请先勾选单据', 'warn'); return; }
          ids.forEach(function (id) {
            var d = DATA.documents.filter(function (x) { return x.id === id; })[0];
            if (d && !state.docs.some(function (x) { return x.id === id; })) state.docs.push(d);
          });
          if (state.application) state.application.documents = state.docs.slice();
          close(); renderZones(); toast('已加入 ' + ids.length + ' 张单据');
        };
        renderList();
      });
    return m;
  }

  function openCasePicker() {
    var m = modal('按待开票事项一键装配（销售明细 ' + DATA.tables.sales.length + ' 项）',
      '<div class="ag-hint" style="margin-bottom:8px">选中一项后，系统按「客户 + 产品 + 数量 + 金额」自动匹配销售合同、验收单、出库单，装配为一次开票申请。</div>' +
      '<div class="ag-picklist" id="csList"></div>',
      '<button class="ag-btn ghost" data-close>关闭</button>',
      function (mask, close) {
        $('#csList', mask).innerHTML = '<table class="ag-table sm"><thead><tr><th>#</th><th>产品</th><th>客户</th><th class="num">数量</th><th class="num">金额（不含税）</th><th>区域</th><th>匹配</th></tr></thead><tbody>' +
          DATA.tables.sales.map(function (r, i) {
            var mm = matchDocsForRow(r);
            var n = [mm.contract, mm.acceptance, mm.stockOut].filter(Boolean).length;
            return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.product) + '</td><td>' + esc(r.customer) + '</td>' +
              '<td class="num">' + esc(r.qty) + '</td><td class="num">' + esc(E.fmt(r.amount)) + '</td>' +
              '<td><span class="tag ' + (r.region === '出口' ? 'warn' : '') + '">' + esc(r.region) + '</span>' +
              (r.issueStatus ? '<span class="tag ok">' + esc(r.issueStatus) + '</span>' : '') + '</td>' +
              '<td><button class="ag-mini" data-row="' + i + '">装配（' + n + ' 份单据）</button></td></tr>';
          }).join('') +
          '<tr class="special"><td>—</td><td>五轴数控机床 HMC-800</td><td>上海衡远机电设备有限公司</td><td class="num">2</td><td class="num">9,000,000.00</td><td><span class="tag bad">未验收</span></td>' +
          '<td><button class="ag-mini" data-row="tc022">装配（TC-022 暂缓场景）</button></td></tr>' +
          '</tbody></table>';
        $$('[data-row]', mask).forEach(function (b) {
          b.onclick = function () {
            var row = b.dataset.row;
            if (row === 'tc022') {
              var ht = DATA.documents.filter(function (d) { return d.id === 'HT-202512-002'; })[0];
              var sg = DATA.documents.filter(function (d) { return d.docType === '到货签收单'; })[0];
              var ck = DATA.documents.filter(function (d) { return d.docType === '出库单' && d.party === '上海衡远机电设备有限公司' && d.items[0] && d.items[0].qty === 2; })[0];
              state.docs = [ht, sg, ck].filter(Boolean);
              state.application = {
                applicationNo: 'INV-2025-12-023', applicant: '李娜', applyDate: '2025-12-05', region: '内销',
                declaredAmount: ht.amountTotal, declaredCustomer: '上海衡远机电设备有限公司',
                customer: '上海衡远机电设备有限公司', product: '五轴数控机床 HMC-800',
                documents: state.docs.slice(), source: 'TC-022 · 未验收 2 台（暂缓开票场景）'
              };
            } else {
              var r = DATA.tables.sales[Number(row)];
              var app = assembleFromRow(r, Number(row));
              state.docs = app.documents.slice();
              state.application = app;
            }
            state.audit = null; state.draft = null;
            close(); renderZones();
            toast('已装配 ' + state.docs.length + ' 份单据，点击「执行审核」开始');
          };
        });
      });
    return m;
  }

  /* --------------------------------------------------- 区二：审核工作区 */

  function renderAuditZone() {
    var z = $('#zoneAudit');
    if (!z) return;
    var a = state.audit;
    var left, right;

    if (!state.docs.length) {
      z.innerHTML = '<div class="ag-zone-head"><span class="idx">02</span><b>审核工作区</b><em>字段提取与来源追溯 · 审核结论</em></div>' +
        '<div class="ag-empty big">先在上方载入单据，然后执行审核。<br><span>审核将依次执行：抬头一致性 / 税率正确性 / 金额一致性 / 开票范围 / 日期合理性 / 重复开票校验</span></div>';
      return;
    }

    // 左：字段 + 来源追溯
    left = '<div class="ag-col ag-col-l">' +
      '<div class="ag-col-head"><b>字段提取与来源追溯</b><em>每个字段都能点开看来源</em></div>' +
      '<div class="ag-fields" id="fieldBox">' + fieldTableHtml() + '</div>' +
      '</div>';

    // 右：审核结论
    if (!a) {
      right = '<div class="ag-col ag-col-r">' +
        '<div class="ag-col-head"><b>审核结论</b><em>待执行</em></div>' +
        '<div class="ag-run">' +
          '<div class="ag-appinfo">' + appInfoHtml() + '</div>' +
          '<button class="ag-btn gold big" id="btnAudit">执行审核</button>' +
          '<div class="ag-hint">规则引擎本地执行，不联网；配置大模型密钥后可启用 AI 辅助判定。</div>' +
        '</div></div>';
    } else {
      right = '<div class="ag-col ag-col-r">' +
        '<div class="ag-col-head"><b>审核结论</b><em>' + esc(a.resultLabel) + ' · ' + esc(a.auditedAt) + '</em></div>' +
        resultHtml(a) +
        '</div>';
    }

    z.innerHTML = '<div class="ag-zone-head"><span class="idx">02</span><b>审核工作区</b><em>字段提取与来源追溯 · 审核结论</em></div>' +
      '<div class="ag-grid2">' + left + right + '</div>';

    var btn = $('#btnAudit');
    if (btn) btn.onclick = function () { runAuditNow(btn); };
    bindFieldRows();
  }

  function appInfoHtml() {
    var app = state.application;
    if (!app) {
      return '<div class="ag-line"><span>申请编号</span><b>未装配（当前为自由组合单据）</b></div>' +
        '<div class="ag-line"><span>单据数</span><b>' + state.docs.length + ' 份</b></div>';
    }
    return '<div class="ag-line"><span>申请编号</span><b>' + esc(app.applicationNo) + '</b></div>' +
      '<div class="ag-line"><span>购买方</span><b>' + esc(app.declaredCustomer || app.customer || '—') + '</b></div>' +
      '<div class="ag-line"><span>销售区域</span><b>' + esc(app.region || '内销') + '</b></div>' +
      '<div class="ag-line"><span>申请金额（含税）</span><b>' + (app.declaredAmount === null || app.declaredAmount === undefined ? '—' : esc(E.fmt(app.declaredAmount)) + ' 元') + '</b></div>' +
      '<div class="ag-line"><span>关联单据</span><b>' + state.docs.map(function (d) { return d.docType; }).join('、') + '</b></div>' +
      (app.source ? '<div class="ag-line"><span>业务来源</span><b>' + esc(app.source) + '</b></div>' : '');
  }

  function fieldTableHtml() {
    var rows = [];
    state.docs.forEach(function (d) {
      var ex = E.extractFields(d);
      ex.fields.forEach(function (f) {
        rows.push('<tr class="frow" data-doc="' + esc(d.id) + '">' +
          '<td class="mono">' + esc(d.id) + '</td>' +
          '<td><span class="tag">' + esc(d.docType) + '</span></td>' +
          '<td>' + esc(f.label) + '</td>' +
          '<td class="num mono">' + esc(f.display) + '</td>' +
          '<td class="src">' + esc(f.loc) + '</td>' +
          '</tr>');
      });
    });
    return '<table class="ag-table tight"><thead><tr><th>单据</th><th>类型</th><th>字段</th><th class="num">值</th><th>来源位置</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }

  function bindFieldRows() {
    $$('.frow').forEach(function (tr) {
      tr.onclick = function () {
        var doc = state.docs.filter(function (d) { return d.id === tr.dataset.doc; })[0];
        if (doc) openDocDetail(doc);
      };
    });
  }

  function openDocDetail(doc) {
    modal('单据详情 · ' + doc.id + ' · ' + doc.docType,
      '<div class="ag-docmeta">' +
        '<div><span>单据编号</span><b>' + esc(doc.id) + '</b></div>' +
        '<div><span>单据类型</span><b>' + esc(doc.docType) + '</b></div>' +
        '<div><span>业务日期</span><b>' + esc(doc.docDate) + '</b></div>' +
        '<div><span>对方单位</span><b>' + esc(doc.party || '—') + '</b></div>' +
        '<div><span>价税合计/业务金额</span><b>' + esc(E.fmt(doc.amountTotal)) + ' 元</b></div>' +
        '<div><span>税率</span><b>' + esc(doc.taxRate || '—') + '</b></div>' +
      '</div>' +
      '<h4>明细行</h4>' +
      (doc.items.length ? '<table class="ag-table sm"><thead><tr><th>名称</th><th>规格</th><th>数量</th><th class="num">单价</th><th class="num">金额</th><th>税率</th><th class="num">税额</th><th>来源</th></tr></thead><tbody>' +
        doc.items.map(function (it) {
          return '<tr><td>' + esc(it.name) + '</td><td>' + esc(it.spec || '—') + '</td><td class="num">' + esc(it.qty) + '</td>' +
            '<td class="num">' + esc(E.fmt(it.unitPrice)) + '</td><td class="num">' + esc(E.fmt(it.amount)) + '</td>' +
            '<td>' + esc(it.taxRate || '—') + '</td><td class="num">' + esc(E.fmt(it.taxAmount)) + '</td><td class="src">' + esc(it.loc) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="ag-empty">无明细行</div>') +
      '<h4>全部抽取字段（' + doc.fields.length + ' 个，均带来源定位）</h4>' +
      '<div class="ag-fields tiny"><table class="ag-table tight"><thead><tr><th>标签</th><th>取值</th><th>来源位置</th></tr></thead><tbody>' +
      doc.fields.map(function (f) { return '<tr><td>' + esc(f.label) + '</td><td class="mono">' + esc(f.value) + '</td><td class="src">' + esc(f.loc) + '</td></tr>'; }).join('') +
      '</tbody></table></div>',
      '<button class="ag-btn ghost" data-close>关闭</button>');
  }

  function resultHtml(a) {
    var ok = a.result === 'pass', susp = a.result === 'suspend';
    var cls = ok ? 'pass' : (susp ? 'susp' : 'fail');
    var icon = ok ? '✅' : (susp ? '⏸' : '❌');
    var html = '<div class="ag-result ' + cls + '">' +
      '<div class="ag-result-head"><b>' + icon + ' ' + esc(a.resultLabel) + '</b><span>风险等级：' + esc({ low: '低', mid: '中', high: '高' }[a.riskLevel] || a.riskLevel) + ' · 审核人 ' + esc(a.operator) + '</span></div>' +
      '<div class="ag-result-sum">' + esc(a.summary) + '</div>' +
      '</div>';
    html += '<div class="ag-checks">';
    a.checks.forEach(function (c) {
      var s = c.status === 'pass' ? 'ok' : (c.status === 'warn' ? 'warn' : (c.status === 'suspend' ? 'susp' : 'bad'));
      var ico = c.status === 'pass' ? '✓' : (c.status === 'warn' ? '!' : (c.status === 'suspend' ? '⏸' : '✗'));
      html += '<div class="ag-check ' + s + '">' +
        '<div class="ag-check-head"><span class="ico">' + ico + '</span><b>' + esc(c.name) + '</b>' +
        '<em>' + esc({ pass: '通过', warn: '提示', suspend: '暂缓', fail: '不通过' }[c.status] || c.status) + '</em></div>' +
        '<div class="ag-check-desc">' + esc(c.desc) + '</div>' +
        '<div class="ag-check-conc">' + esc(c.conclusion) + '</div>' +
        (c.diff ? '<div class="ag-check-diff"><span>左：' + esc(c.diff.left) + '</span><span>右：' + esc(c.diff.right) + '</span>' + (c.diff.gap ? '<span>差异：' + esc(E.fmt(c.diff.gap)) + '</span>' : '') + '</div>' : '') +
        (c.advice ? '<div class="ag-check-advice">修改建议：' + esc(c.advice) + '</div>' : '') +
        '<div class="ag-check-ev">' + c.evidence.slice(0, 6).map(function (e) {
          return '<div class="ev"><b>' + esc(e.docId) + '</b> ' + esc(e.docType) + ' · ' + esc(e.field) + ' = ' + esc(e.value) + '<span class="src">' + esc(e.loc) + '</span></div>';
        }).join('') + '</div>' +
        '<div class="ag-check-rule">规则依据：' + esc(c.rule) + ' · 比对方式 ' + esc(c.match) + '</div>' +
        '</div>';
    });
    html += '</div>';
    // 制度依据
    var related = relatedPolicies(a.checks.filter(function (c) { return c.status !== 'pass'; }).map(function (c) { return c.key; }));
    if (related.length) {
      html += '<div class="ag-pol"><b>制度依据（不通过/暂缓项）</b>' + related.map(function (p) {
        return '<div class="ag-politem"><span>' + esc(p.pol.name) + ' · ' + esc(p.clause.loc) + '</span><p>' + esc(p.clause.text) + '</p></div>';
      }).join('') + '</div>';
    }
    html += '<div class="ag-actions">' +
      '<button class="ag-btn ghost" id="btnExportReport">下载审核报告</button>' +
      (a.result === 'pass' ? '<button class="ag-btn ghost" id="btnToDraft">查看开票草稿 →</button>' : '') +
      '<button class="ag-btn ghost" id="btnReAudit">重新审核</button>' +
      '</div>';
    setTimeout(function () {
      var b1 = $('#btnExportReport'); if (b1) b1.onclick = function () { downloadReport(a); };
      var b2 = $('#btnToDraft'); if (b2) b2.onclick = function () { document.getElementById('zoneDraft').scrollIntoView({ behavior: 'smooth', block: 'center' }); };
      var b3 = $('#btnReAudit'); if (b3) b3.onclick = function () { runAuditNow(null); };
    }, 0);
    return html;
  }

  function relatedPolicies(checkKeys) {
    var out = [];
    (DATA.policies || []).forEach(function (p) {
      p.clauses.forEach(function (c) {
        for (var i = 0; i < checkKeys.length; i++) {
          if ((p.rules || []).indexOf(checkKeys[i]) >= 0) { out.push({ pol: p, clause: c }); return; }
        }
      });
    });
    return out.slice(0, 4);
  }

  function runAuditNow(btn) {
    if (!state.docs.length) { toast('请先载入单据', 'warn'); return; }
    if (btn) { btn.disabled = true; btn.textContent = '审核中…'; }
    var app = state.application || {
      applicationNo: 'INV-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-001',
      applicant: '李娜', region: null, declaredAmount: null, declaredCustomer: null, documents: state.docs.slice()
    };
    app.documents = state.docs.slice();

    var finish = function (mode) {
      state.lastMode = mode;
      var res = E.runAudit(app, { operator: '李娜', pool: state.pool, ruleMode: mode });
      state.audit = res;
      state.application = app;
      state.draft = E.buildDraft(res, app);
      pushLog(res, state.draft);
      rememberRejected(res, app);
      renderZones();
      var msg = res.result === 'pass' ? '审核通过，已生成开票草稿（待人工确认）' : (res.result === 'suspend' ? '审核暂停：证据不齐备，请按建议补充' : '审核不通过，请按修改建议处理');
      toast(msg, res.result === 'pass' ? '' : 'warn', 5000);
    };

    if (state.llm.enabled && state.llm.apiKey) {
      llmAudit(app).then(function (verdict) {
        finish(verdict ? 'hybrid-llm' : 'rule');
      }).catch(function (err) {
        toast('大模型调用失败（' + err.message + '），已降级为规则引擎审核', 'warn', 6000);
        finish('rule');
      });
    } else {
      setTimeout(function () { finish('rule'); }, 120);
    }
  }

  /**
   * 记住被驳回 / 暂缓的申请，供实务系统「被驳回申请」模块后续查看、补单据、改信息、重审
   */
  function rememberRejected(res, app) {
    var no = res.applicationNo;
    var idx = -1;
    for (var i = 0; i < state.rejected.length; i++) {
      if (state.rejected[i].applicationNo === no) { idx = i; break; }
    }
    if (res.result === 'pass') {
      if (idx >= 0) state.rejected.splice(idx, 1);   // 重审通过则移出待处理
      return;
    }
    var badChecks = res.checks.filter(function (c) { return c.status === 'fail' || c.status === 'suspend'; });
    var rec = {
      applicationNo: no,
      result: res.result,
      resultLabel: res.resultLabel,
      riskLevel: res.riskLevel,
      auditedAt: res.auditedAt,
      operator: res.operator,
      customer: app.declaredCustomer || (app.customer || '') || '',
      product: app.product || '',
      amount: app.declaredAmount == null ? null : app.declaredAmount,
      region: app.region || '内销',
      summary: res.summary,
      checks: badChecks.map(function (c) {
        return {
          key: c.key, name: c.name, status: c.status,
          conclusion: c.conclusion, advice: c.advice || '',
          evidence: (c.evidence || []).slice(0, 4)
        };
      }),
      documents: (app.documents || []).map(function (d) {
        return { id: d.id, docType: d.docType, docDate: d.docDate, party: d.party, amountTotal: d.amountTotal };
      }),
      application: app
    };
    if (idx >= 0) state.rejected[idx] = rec; else state.rejected.unshift(rec);
    if (state.rejected.length > 50) state.rejected.length = 50;
  }

  function pushLog(res, draft) {
    state.logs.unshift({
      time: res.auditedAt, applicationNo: res.applicationNo, result: res.result, resultLabel: res.resultLabel,
      operator: res.operator, docs: res.documents.map(function (d) { return d.id; }),
      docsText: res.documents.map(function (d) { return d.docType; }).join('、'),
      summary: res.summary, draftNo: draft ? draft.draftNo : null, ruleMode: res.ruleMode
    });
    if (state.logs.length > 200) state.logs.length = 200;
    store('dsh_audit_logs', state.logs);
  }

  /* --------------------------------------------- 区三：草稿确认 + 开具 */

  /* 发票预览模块由 src/invoice-template.js 提供（契约 window.InvoicePreview）；
     未加载或被裁剪时按钮降级为 toast，不抛错 */
  function invoicePreviewApi() {
    var w = (typeof window !== 'undefined' && window) || root;
    var m = w ? w.InvoicePreview : null;
    return m && typeof m === 'object' ? m : null;
  }

  /** 草稿对象 → InvoicePreview 契约 data：沿用草稿已有字段，补收款人/复核人/开票人/开票日期 */
  function previewInvoiceData(d) {
    var src = d || {};
    var data = Object.assign({}, src);
    data.payee = src.seller ? src.seller.name : '';
    data.reviewer = '李娜';
    data.drawer = '田甜';
    data.issueDate = src.createdAt ? String(src.createdAt).slice(0, 10) : '';
    return data;
  }

  function previewDraftInvoice(d) {
    var m = invoicePreviewApi();
    if (!m || typeof m.open !== 'function') { toast('发票预览模块未加载', 'warn'); return; }
    try {
      m.open(previewInvoiceData(d));
    } catch (e) {
      toast('发票预览失败：' + (e && e.message ? e.message : e), 'warn');
    }
  }

  function downloadDraftInvoicePng(d) {
    var m = invoicePreviewApi();
    if (!m || typeof m.download !== 'function') { toast('发票预览模块未加载', 'warn'); return; }
    try {
      m.download(previewInvoiceData(d), 'png');
    } catch (e) {
      toast('发票下载失败：' + (e && e.message ? e.message : e), 'warn');
    }
  }

  function renderDraftZone() {
    var z = $('#zoneDraft');
    if (!z) return;
    var d = state.draft;
    var a = state.audit;
    if (!a) {
      z.innerHTML = '<div class="ag-zone-head"><span class="idx">03</span><b>草稿确认区</b><em>审核通过后自动回填，关键字段高亮</em></div>' +
        '<div class="ag-empty">审核通过后，这里会显示已回填的开票草稿；需二次确认才会正式开具。</div>';
      return;
    }
    if (!d) {
      var why = a.result === 'suspend'
        ? '审核结论为「暂缓（证据不齐备）」，按规则不生成草稿。请先补齐验收单等证据后重新提交。'
        : '审核不通过，未生成开票草稿。请按上方修改建议处理后重新提交。';
      z.innerHTML = '<div class="ag-zone-head"><span class="idx">03</span><b>草稿确认区</b><em>未生成</em></div>' +
        '<div class="ag-nodraft">' + esc(why) + '</div>';
      return;
    }
    var hl = function (field) { return d.highlights.indexOf(field) >= 0 ? ' class="hl"' : ''; };
    z.innerHTML =
      '<div class="ag-zone-head"><span class="idx">03</span><b>草稿确认区</b><em>' + esc(d.statusLabel) + ' · ' + esc(d.draftNo) + '</em></div>' +
      '<div class="ag-draft">' +
        '<div class="ag-draft-top">' +
          '<div class="ag-draft-title"><b>' + esc(d.invoiceType) + '</b><span>草稿编号 ' + esc(d.draftNo) + ' · 由审核 ' + esc(d.auditResultRef) + ' 自动生成</span></div>' +
          '<div class="ag-draft-tag">待人工确认</div>' +
        '</div>' +
        '<div class="ag-draft-grid">' +
          '<div><span>购买方名称</span><b' + hl('buyer.name') + '>' + esc(d.buyer.name || '（待补充）') + '</b></div>' +
          '<div><span>纳税人识别号</span><b' + (d.buyer.taxNo ? '' : ' class="miss"') + '>' + esc(d.buyer.taxNo || '（单据缺失，请人工补充）') + '</b></div>' +
          '<div><span>销售方</span><b>' + esc(d.seller.name) + '</b></div>' +
          '<div><span>销售方税号</span><b>' + esc(d.seller.taxNo) + '</b></div>' +
        '</div>' +
        '<table class="ag-table sm draft-items"><thead><tr><th>货物或应税劳务名称</th><th>规格型号</th><th>单位</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th><th>税率</th><th class="num">税额</th><th>来源</th></tr></thead><tbody>' +
        d.items.map(function (it) {
          return '<tr><td>' + esc(it.name) + '</td><td>' + esc(it.spec || '—') + '</td><td>' + esc(it.unit || '—') + '</td>' +
            '<td class="num">' + esc(it.qty) + '</td><td class="num">' + esc(E.fmt(it.unitPrice)) + '</td>' +
            '<td class="num">' + esc(E.fmt(it.amount)) + '</td><td>' + esc(it.taxRate) + '</td>' +
            '<td class="num">' + esc(E.fmt(it.taxAmount)) + '</td><td class="src">' + esc(it.loc) + '</td></tr>';
        }).join('') + '</tbody></table>' +
        '<div class="ag-draft-total">' +
          '<div><span>金额（不含税）</span><b' + hl('amountExTax') + '>' + esc(E.fmt(d.amountExTax)) + ' 元</b></div>' +
          '<div><span>税率</span><b' + hl('taxRate') + '>' + esc(d.taxRate) + '</b></div>' +
          '<div><span>税额</span><b' + hl('taxAmount') + '>' + esc(E.fmt(d.taxAmount)) + ' 元</b></div>' +
          '<div><span>价税合计</span><b' + hl('amountTotal') + '>' + esc(E.fmt(d.amountTotal)) + ' 元</b></div>' +
        '</div>' +
        (d.amountInWords ? '<div class="ag-draft-words">价税合计（大写）：<b>' + esc(d.amountInWords) + '</b></div>' : '') +
        '<div class="ag-draft-remark">备注：' + esc(d.remark) + '</div>' +
        (d.commonErrors.length ? '<div class="ag-tips"><b>提交前请重点核对（常见错误提示）</b>' + d.commonErrors.map(function (x) {
          return '<div class="tip ' + esc(x.level) + '">· ' + esc(x.check) + '：' + esc(x.text) + (x.advice ? '<em>' + esc(x.advice) + '</em>' : '') + '</div>';
        }).join('') + '</div>' : '') +
        '<div class="ag-sources"><b>回填来源（可追溯）</b>' + d.sources.map(function (s) {
          return '<div class="srcrow"><span>' + esc(s.field) + '</span><b>' + esc(s.docId) + '</b><em>' + esc(s.loc) + '</em></div>';
        }).join('') + '</div>' +
        '<div class="ag-draft-actions">' +
          '<button class="ag-btn ghost" id="btnDraftExport">下载开票草稿</button>' +
          '<button class="ag-btn ghost" id="btnDraftPreview">预览发票图</button>' +
          '<button class="ag-btn ghost" id="btnDraftPng">下载发票 PNG</button>' +
          '<button class="ag-btn ghost" id="btnDraftToForm">回填到「发票开具」台</button>' +
          '<button class="ag-btn gold" id="btnConfirmIssue">确认开具</button>' +
        '</div>' +
      '</div>';

    $('#btnDraftExport').onclick = function () { downloadDraft(d); };
    $('#btnDraftPreview').onclick = function () { previewDraftInvoice(d); };
    $('#btnDraftPng').onclick = function () { downloadDraftInvoicePng(d); };
    $('#btnDraftToForm').onclick = function () {
      if (CTX.openDraft) { CTX.openDraft(d); toast('草稿已回填到实务系统「发票开具」台'); }
      else toast('实务系统未就绪', 'warn');
    };
    $('#btnConfirmIssue').onclick = function () { confirmIssue(d); };
  }

  function confirmIssue(d) {
    var m = modal('二次确认 · 正式开具',
      '<div class="ag-confirm">' +
        '<p class="warnline">⚠️ 开具后即写入开票台账并计入发票池，同一业务不得重复开票。请逐项核对下方关键信息：</p>' +
        '<div class="ag-confirm-grid">' +
          '<div><span>购买方</span><b>' + esc(d.buyer.name) + '</b></div>' +
          '<div><span>纳税人识别号</span><b>' + esc(d.buyer.taxNo || '（缺失）') + '</b></div>' +
          '<div><span>发票类型</span><b>' + esc(d.invoiceType) + '</b></div>' +
          '<div><span>税率</span><b>' + esc(d.taxRate) + '</b></div>' +
          '<div><span>价税合计</span><b class="big">' + esc(E.fmt(d.amountTotal)) + ' 元</b></div>' +
          '<div><span>草稿编号</span><b>' + esc(d.draftNo) + '</b></div>' +
        '</div>' +
        '<label class="ag-ck"><input type="checkbox" id="ckConfirm"> 我已核对上述信息，确认与实际业务一致，同意正式开具</label>' +
      '</div>',
      '<button class="ag-btn ghost" data-close>取消</button><button class="ag-btn gold" id="btnDoIssue" disabled>确认开具</button>',
      function (mask, close) {
        var ck = $('#ckConfirm', mask), b = $('#btnDoIssue', mask);
        ck.onchange = function () { b.disabled = !ck.checked; };
        b.onclick = function () {
          doIssue(d);
          close();
        };
      });
    return m;
  }

  function doIssue(d) {
    var issued = {
      id: 'FP-SESSION-' + String(state.pool.length + 1).padStart(3, '0'),
      docType: d.invoiceType, party: d.buyer.name, partyTaxNo: d.buyer.taxNo,
      docDate: new Date().toISOString().slice(0, 10), amountTotal: d.amountTotal,
      amountExTax: d.amountExTax, taxAmount: d.taxAmount, taxRate: d.taxRate,
      items: d.items, poolKind: 'session', draftNo: d.draftNo,
      // 供实务系统定位销售明细行并回写「待开票清单」状态
      contractId: d.contractId || null,
      acceptanceId: d.acceptanceId || null,
      customer: d.buyer.name,
      product: d.items && d.items[0] ? d.items[0].name : null
    };
    state.pool.push(issued);
    d.status = 'issued';
    d.statusLabel = '已开具';
    var hostMessage = '';
    if (CTX.onIssued) {
      try { hostMessage = CTX.onIssued(issued) || ''; } catch (e) { console.warn('[agent] onIssued 回调异常', e); }
    }
    renderZones();
    toast(hostMessage || ('已正式开具：' + issued.id + ' · ' + issued.party + ' · ' + E.fmt(issued.amountTotal) + ' 元'), '', 5600);
  }

  /* ------------------------------------------------------ 报告与草稿下载 */

  function download(name, text) {
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    } catch (e) { toast('当前浏览器限制了本地下载：' + e.message, 'warn'); }
  }

  function reportText(a, app) {
    var L = [];
    L.push('【审核报告】');
    L.push('申请编号：' + a.applicationNo);
    L.push('审核时间：' + a.auditedAt);
    L.push('审核人：' + a.operator);
    L.push('审核结果：' + (a.result === 'pass' ? '✅ 通过' : (a.result === 'suspend' ? '⏸ 暂缓（证据不齐备）' : '❌ 不通过')));
    L.push('风险等级：' + ({ low: '低', mid: '中', high: '高' }[a.riskLevel] || a.riskLevel));
    L.push('审核模式：' + (a.ruleMode === 'hybrid-llm' ? '大模型 + 规则双引擎' : '规则引擎'));
    L.push('');
    L.push('一、单据识别');
    a.documents.forEach(function (d) {
      L.push('- ' + d.id + ' → ' + d.classified + '（置信度 ' + Math.round(d.confidence * 100) + '%）' + (d.classified !== d.docType ? ' ⚠️ 与台账标注「' + d.docType + '」不一致' : ''));
    });
    L.push('');
    L.push('二、字段提取与来源');
    L.push('| 字段 | 值 | 来源 |');
    L.push('|------|-----|------|');
    a.evidenceTable.forEach(function (e) {
      L.push('| ' + e.field + ' | ' + e.value + ' | ' + e.loc + ' |');
    });
    L.push('');
    L.push('三、审核检查');
    a.checks.forEach(function (c) {
      L.push('- ' + c.name + '：' + ({ pass: '✅ 通过', warn: '⚠️ 提示', suspend: '⏸ 暂缓', fail: '❌ 不通过' }[c.status]) + ' — ' + c.conclusion);
      if (c.advice) L.push('    修改建议：' + c.advice);
      L.push('    规则依据：' + c.rule);
    });
    L.push('');
    L.push('四、结论');
    L.push(a.summary);
    return L.join('\n');
  }

  function downloadReport(a) {
    download('审核报告_' + a.applicationNo + '.txt', reportText(a, state.application));
    toast('审核报告已下载');
  }

  function draftText(d) {
    var L = [];
    L.push('【待确认开票草稿】');
    L.push('草稿编号：' + d.draftNo + '（' + d.statusLabel + '）');
    L.push('发票类型：' + d.invoiceType);
    L.push('购买方：' + d.buyer.name);
    L.push('纳税人识别号：' + (d.buyer.taxNo || '（待补充）'));
    L.push('销售方：' + d.seller.name);
    L.push('销售方纳税人识别号：' + d.seller.taxNo);
    d.items.forEach(function (it, i) {
      L.push('明细' + (i + 1) + '：' + it.name + ' ' + (it.spec || '') + ' ' + (it.qty || '') + (it.unit || '') +
        ' × ' + E.fmt(it.unitPrice) + ' = ' + E.fmt(it.amount) + ' 元，税率 ' + it.taxRate + '，税额 ' + E.fmt(it.taxAmount) + ' 元');
    });
    L.push('金额（不含税）：' + E.fmt(d.amountExTax) + ' 元');
    L.push('税率：' + d.taxRate);
    L.push('税额：' + E.fmt(d.taxAmount) + ' 元');
    L.push('价税合计：' + E.fmt(d.amountTotal) + ' 元');
    if (d.amountInWords) L.push('价税合计（大写）：' + d.amountInWords);
    L.push('备注：' + d.remark);
    L.push('');
    L.push('【回填来源】');
    d.sources.forEach(function (s) { L.push('- ' + s.field + ' ← ' + s.docId + ' · ' + s.loc); });
    return L.join('\n');
  }

  function downloadDraft(d) {
    download('开票草稿_' + d.draftNo + '.txt', draftText(d));
    toast('开票草稿已下载（待人工确认）');
  }

  /* ------------------------------------------------ 大模型 API 设置弹窗 */

  function openLlmModal() {
    var cfg = state.llm;
    var m = modal('大模型 API 设置',
      '<div class="ag-llm">' +
        '<div class="ag-llm-note">当前状态：' + esc(cfg.apiKey ? '已配置密钥' : '未配置密钥，使用规则引擎') + '。密钥仅保存在本机浏览器，不会上传服务器；生产环境建议由后端代理托管密钥。</div>' +
        '<label>服务商<input id="llmProv" value="' + esc(cfg.provider) + '" placeholder="Finance AI（跃客科技）"></label>' +
        '<label>模型名称<input id="llmModel" value="' + esc(cfg.model) + '" placeholder="deepseek-v4.1-flash"></label>' +
        '<label>API Key<input id="llmKey" type="password" value="' + esc(cfg.apiKey) + '" placeholder="留空则仅用规则引擎"></label>' +
        '<label>API Base URL<input id="llmBase" value="' + esc(cfg.baseUrl) + '" placeholder="/api/ai"></label>' +
        '<label class="ag-ck"><input type="checkbox" id="llmEn" ' + (cfg.enabled ? 'checked' : '') + '> 启用大模型辅助审核（不可用时自动降级为规则引擎）</label>' +
        '<div class="ag-hint">说明：file:// 双击打开时浏览器会拦截跨域请求，AI 调用需经本地代理（如 start.bat 启动的后端）转发；调用失败会自动降级，不影响审核可用性。</div>' +
      '</div>',
      '<button class="ag-btn ghost" data-close>取消</button><button class="ag-btn gold" id="llmSave">保存并生效</button>',
      function (mask, close) {
        $('#llmSave', mask).onclick = function () {
          cfg.provider = $('#llmProv', mask).value.trim();
          cfg.model = $('#llmModel', mask).value.trim();
          cfg.apiKey = $('#llmKey', mask).value.trim();
          cfg.baseUrl = $('#llmBase', mask).value.trim();
          cfg.enabled = $('#llmEn', mask).checked;
          store('dsh_llm_cfg', cfg);
          close();
          renderZones();
          toast(cfg.enabled && cfg.apiKey ? '大模型配置已保存，将启用双引擎审核' : '已保存（未启用大模型，使用规则引擎）');
        };
      });
    return m;
  }

  /**
   * 大模型辅助审核：把已抽取的结构化字段送模型判定，返回 true 表示成功参与
   * 失败一律抛错，由调用方降级为纯规则引擎
   */
  function llmAudit(app) {
    var cfg = state.llm;
    if (!cfg.apiKey) return Promise.reject(new Error('未配置 API Key'));
    var ctx = E.applicationContext(app);
    var payload = {
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是增值税发票开票合规审核专家。只依据给定单据字段判定，输出 JSON：{"result":"pass|fail","reason":"..."}。不得猜测缺失字段。' },
        {
          role: 'user', content: JSON.stringify({
            application: app.applicationNo,
            region: app.region || null,
            documents: (app.documents || []).map(function (d) {
              return { id: d.id, type: d.docType, date: d.docDate, party: d.party, taxNo: d.partyTaxNo, amountExTax: d.amountExTax, taxAmount: d.taxAmount, amountTotal: d.amountTotal, taxRate: d.taxRate };
            })
          })
        }
      ],
      temperature: 0
    };
    var url = (cfg.baseUrl || '/api/ai').replace(/\/$/, '') + '/chat/completions';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      var m = txt.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('返回内容非 JSON');
      JSON.parse(m[0]);
      return true;
    });
  }

  /* -------------------------------------------------------- 其他视图 */

  function viewLogs(container) {
    var rows = state.logs.map(function (l) {
      return '<tr><td class="mono">' + esc(l.time) + '</td><td class="mono">' + esc(l.applicationNo) + '</td>' +
        '<td><span class="tag ' + (l.result === 'pass' ? 'ok' : (l.result === 'suspend' ? 'warn' : 'bad')) + '">' + esc(l.resultLabel) + '</span></td>' +
        '<td>' + esc(l.operator) + '</td><td>' + esc(l.docsText) + '</td><td>' + esc(l.docs.join('、')) + '</td>' +
        '<td>' + esc(l.draftNo || '—') + '</td><td class="sum">' + esc(l.summary) + '</td></tr>';
    }).join('');
    container.innerHTML = '<div class="ag-page"><div class="ag-page-head"><b>审核日志</b><em>时间 · 结果 · 操作人 · 依据单据 · 草稿编号，全程留痕可追溯（本机保存 ' + state.logs.length + ' 条）</em>' +
      '<button class="ag-btn ghost" id="btnClearLog" style="margin-left:auto">清空</button></div>' +
      '<table class="ag-table"><thead><tr><th>审核时间</th><th>申请编号</th><th>结果</th><th>操作人</th><th>单据类型</th><th>依据单据</th><th>草稿编号</th><th>结论摘要</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="8" class="ag-empty">暂无审核记录</td></tr>') + '</tbody></table></div>';
    var c = $('#btnClearLog');
    if (c) c.onclick = function () { state.logs = []; store('dsh_audit_logs', []); viewLogs(container); };
  }

  /** 「制度依据」页内子页签：制度库 / 验收指标 */
  function viewPolicyHub(container, tab) {
    var cur = tab === 'metrics' ? 'metrics' : 'policies';
    var policyCount = (DATA.policies || []).reduce(function (s2, p2) { return s2 + p2.clauses.length; }, 0);
    var head = '<div class="ag-page-head"><b>制度依据</b><em>企业制度库 ' + (DATA.policies || []).length +
      ' 项 · ' + policyCount + ' 条原文摘录，以及审核指标自检</em></div>' +
      '<div class="hub-tabs">' +
        '<button data-hub="policies"' + (cur === 'policies' ? ' class="on"' : '') + '>制度库</button>' +
        '<button data-hub="metrics"' + (cur === 'metrics' ? ' class="on"' : '') + '>验收指标</button>' +
      '</div>' +
      '<div id="hubBody"></div>';
    container.innerHTML = '<div class="ag-page">' + head + '</div>';
    var body = container.querySelector('#hubBody');
    function paint(name) {
      cur = name;
      Array.prototype.forEach.call(container.querySelectorAll('.hub-tabs button'), function (b) {
        b.classList.toggle('on', b.dataset.hub === name);
      });
      if (name === 'metrics') metricsInner(body); else policiesInner(body);
    }
    Array.prototype.forEach.call(container.querySelectorAll('.hub-tabs button'), function (b) {
      b.onclick = function () { paint(b.dataset.hub); };
    });
    paint(cur);
  }

  /** 制度库内容（不带外层卡片） */
  function policiesInner(container) {
    var html = (DATA.policies || []).map(function (p) {
      return '<div class="pol-card"><div class="pol-head"><b>' + esc(p.name) + '</b><span>' + esc(p.file) + ' · ' + esc(p.dept) + '</span></div>' +
        '<div class="pol-rules">支撑审核项：' + (p.rules || []).map(function (r) {
          var def = E.CHECKS.filter(function (c) { return c.key === r; })[0];
          return '<span class="tag">' + esc(def ? def.name : r) + '</span>';
        }).join('') + '</div>' +
        (p.note ? '<div class="pol-note">' + esc(p.note) + '</div>' : '') +
        '<div class="pol-clauses">' + p.clauses.map(function (c) {
          return '<div class="pol-clause"><div class="no">' + esc(c.no) + '</div><div class="body"><b>' + esc(c.title) + '</b><p>' + esc(c.text) + '</p><em>' + esc(c.loc) + '</em></div></div>';
        }).join('') + '</div></div>';
    }).join('');
    container.innerHTML = html;
  }

  function viewPolicies(container) { viewPolicyHub(container, 'policies'); }

  function viewMetrics(container) { viewPolicyHub(container, 'metrics'); }

  /** 验收指标内容（不带外层卡片） */
  function metricsInner(container) {
    var rep = DATA.acceptance;
    if (!rep) {
      container.innerHTML = '<div class="ag-empty">验收指标未内联（构建时未生成 data/_acceptance_report.json）</div>';
      return;
    }
    var rows = rep.metrics.map(function (m) {
      return '<tr><td>' + (m.pass ? '<span class="tag ok">达标</span>' : '<span class="tag bad">未达标</span>') + '</td>' +
        '<td><b>' + esc(m.name) + '</b></td><td class="mono">' + esc(m.value) + '</td><td class="mono">' + esc(m.target) + '</td></tr>';
    }).join('');
    var d = rep.details;
    container.innerHTML = '<div class="hint-line">由 tools/acceptance.mjs 对 175 张单据 / 4 张表 / 22 条用例实跑生成 · ' +
      esc(rep.generatedAt) + '</div>' +
      '<div class="ag-kpis">' +
        '<div class="kpi"><b>' + d.classification.ok + '/' + d.classification.total + '</b><span>单据分类判对</span></div>' +
        '<div class="kpi"><b>' + d.fieldExtraction.ok + '/' + d.fieldExtraction.total + '</b><span>字段抽取与台账一致</span></div>' +
        '<div class="kpi"><b>' + d.traceability.locFields + '/' + d.traceability.allFields + '</b><span>字段带来源定位</span></div>' +
        '<div class="kpi"><b>' + d.applications.length + '</b><span>实跑开票申请</span></div>' +
        '<div class="kpi"><b>' + d.applications.filter(function (x) { return x.result === 'pass'; }).length + '</b><span>审核通过</span></div>' +
        '<div class="kpi"><b>' + d.applications.filter(function (x) { return x.draft; }).length + '</b><span>生成草稿</span></div>' +
      '</div>' +
      '<table class="ag-table"><thead><tr><th>结论</th><th>指标</th><th>实测值</th><th>目标值</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h4>22 条申请实跑结果</h4>' +
      '<table class="ag-table sm"><thead><tr><th>申请编号</th><th>结果</th><th>草稿</th><th>结论摘要</th></tr></thead><tbody>' +
      d.applications.map(function (x) {
        return '<tr><td class="mono">' + esc(x.applicationNo) + '</td>' +
          '<td><span class="tag ' + (x.result === 'pass' ? 'ok' : (x.result === 'suspend' ? 'warn' : 'bad')) + '">' + esc(x.result) + '</span></td>' +
          '<td>' + (x.draft ? esc(x.draft.invoiceType + ' ' + x.draft.taxRate) : '—') + '</td>' +
          '<td class="sum">' + esc(x.summary) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      dqHtml();
  }

  /** 数据质量发现（由 tools/data_quality.py 生成） */
  function dqHtml() {
    var q = DATA.dataQuality;
    if (!q || !q.findings) return '';
    var lv = { ok: 'ok', info: '', warn: 'warn', bad: 'bad' };
    return '<h4>数据质量与口径发现（' + (q.docCount || 0) + ' 张单据 / ' + (q.ledgerCount || 0) + ' 行台账，对账异常 ' +
      ((q.reconcile && q.reconcile.exceptions) || 0) + ' 条）</h4>' +
      '<table class="ag-table sm"><thead><tr><th>级别</th><th>发现</th><th class="num">影响单据</th><th>说明</th></tr></thead><tbody>' +
      q.findings.map(function (f) {
        return '<tr><td><span class="tag ' + (lv[f.level] || '') + '">' + esc(f.level) + '</span></td>' +
          '<td><b>' + esc(f.title) + '</b></td><td class="num">' + esc(f.count) + '</td>' +
          '<td class="sum">' + esc(f.detail) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  /* ------------------------------------------------------- 测试示例模块 */

  function mkTestDoc(id, docType, party, taxNo, total, rate, date) {
    var rn = rate ? E.taxRateNum(rate) : 0;
    var ex = rn ? E.r2(total / (1 + rn)) : total;
    return {
      id: id, docType: docType, docTypeRaw: docType, title: docType, docDate: date,
      party: party, partyRole: '购买方', partyTaxNo: taxNo,
      selfName: DATA.meta.company, selfTaxNo: DATA.meta.selfTaxNo,
      amountExTax: ex, taxAmount: rn ? E.r2(total - ex) : null, amountTotal: total, taxRate: rate,
      items: [{ name: '智能设备', spec: 'A-STD', unit: '台', qty: 10, unitPrice: E.r2(ex / 10), amount: ex, taxRate: rate, taxAmount: rn ? E.r2(total - ex) : null, extra: {}, loc: '明细表 第1行' }],
      fields: [
        { key: null, label: docType === '验收单' ? '往来单位' : (docType === '开票申请单' ? '购买方名称' : '买方（甲方）'), value: party, loc: '往来方区 · 第1方' },
        { key: 'amountTotal', label: '价税合计', value: String(total), loc: '合计区 · 价税合计' },
        { key: 'docDate', label: '单据日期', value: date, loc: '页眉区 · 单据编号' }
      ],
      terms: {}, totals: {}, footers: {}, textLen: 0, parseWarnings: []
    };
  }

  function runTestExamples() {
    var t1 = {
      applicationNo: 'TEST-TC1', applicant: '测试示例', applyDate: '2024-03-15', region: '内销',
      declaredAmount: 113000, declaredCustomer: 'XX科技有限公司',
      documents: [
        mkTestDoc('TEST-APP-1', '开票申请单', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-15'),
        mkTestDoc('TEST-CON-1', '销售合同', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-01'),
        mkTestDoc('TEST-ACC-1', '验收单', 'XX科技有限公司', null, 113000, null, '2024-03-15')
      ],
      expect: '审核通过，生成草稿'
    };
    var t2 = {
      applicationNo: 'TEST-TC2', applicant: '测试示例', applyDate: '2024-03-15', region: '内销',
      declaredAmount: 100000, declaredCustomer: 'XX科技有限公司',
      documents: [
        mkTestDoc('TEST-APP-2', '开票申请单', 'XX科技有限公司', '91310000XXXXXX', 100000, '13%', '2024-03-15'),
        mkTestDoc('TEST-CON-2', '销售合同', 'XX科技有限公司', '91310000XXXXXX', 113000, '13%', '2024-03-01')
      ],
      expect: '审核不通过，金额不一致'
    };
    function runOne(t) {
      var r = E.runAudit(t, { operator: '测试示例', pool: [] });
      var dr = E.buildDraft(r, t);
      return { t: t, r: r, draft: dr };
    }
    var a = runOne(t1), b = runOne(t2);
    var ok1 = a.r.result === 'pass' && !!a.draft;
    var ok2 = b.r.result === 'fail' && b.r.checks.filter(function (c) { return c.key === 'check_amount'; })[0].status === 'fail';
    return { a: a, b: b, ok1: ok1, ok2: ok2, pass: ok1 && ok2 };
  }

  function viewTestExample(container) {
    var res = state.testResult || (state.testResult = runTestExamples());
    var card = function (x, ok, title) {
      return '<div class="test-card ' + (ok ? 'ok' : 'bad') + '">' +
        '<div class="test-head"><b>' + (ok ? '✅ 测试通过' : '❌ 测试失败') + '</b><span>' + esc(title) + '</span></div>' +
        '<div class="test-body">' +
          '<div class="test-line"><span>预期输出</span><b>' + esc(x.t.expect) + '</b></div>' +
          '<div class="test-line"><span>实际结果</span><b>' + esc(x.r.resultLabel) + '</b></div>' +
          '<div class="test-line"><span>草稿</span><b>' + (x.draft ? esc(x.draft.invoiceType + ' · ' + x.draft.taxRate + ' · ' + E.fmt(x.draft.amountTotal) + ' 元') : '未生成') + '</b></div>' +
          '<div class="test-line"><span>结论摘要</span><b class="sum">' + esc(x.r.summary) + '</b></div>' +
          '<div class="test-checks">' + x.r.checks.map(function (c) {
            var s = c.status === 'pass' ? 'ok' : (c.status === 'warn' ? 'warn' : 'bad');
            return '<div class="tc ' + s + '"><b>' + esc(c.name) + '</b><span>' + esc(c.status) + '</span></div>';
          }).join('') + '</div>' +
        '</div></div>';
    };
    container.innerHTML = '<div class="ag-page">' +
      '<div class="ag-page-head"><b>测试示例</b><em>内嵌两套用例（审核通过场景 / 审核不通过场景），一键跑通完整审核流程并与预期结果比对</em>' +
        '<button class="ag-btn gold" id="btnRunTest" style="margin-left:auto">重新运行</button></div>' +
      '<div class="test-sum ' + (res.pass ? 'ok' : 'bad') + '">' + (res.pass ? '✅ 测试通过：两套用例结果均与预期一致' : '❌ 测试失败：存在与预期不一致的用例') + '</div>' +
      '<div class="test-grid">' + card(res.a, res.ok1, 'testCase1 · 审核通过场景（3 份单据，金额一致 113,000 元）') + card(res.b, res.ok2, 'testCase2 · 审核不通过场景（申请单 100,000 元 ≠ 合同 113,000 元）') + '</div>' +
      '</div>';
    var btn = $('#btnRunTest');
    if (btn) btn.onclick = function () { state.testResult = runTestExamples(); viewTestExample(container); toast('测试示例已重新运行'); };
  }

  /* ------------------------------------------------------------- 对外 API */

  root.Agent = {
    mount: mount,
    setContext: function (c) { CTX = c || {}; },
    getContext: function () { return CTX; },
    show: function (view, container) {
      state.view = view;
      if (!container) return;
      if (view === 'logs') viewLogs(container);
      else if (view === 'policies') viewPolicies(container);
      else if (view === 'metrics') viewMetrics(container);
      else if (view === 'testExample') viewTestExample(container);
      else if (view === 'workspace') {
        container.innerHTML = '';
        var box = h('div', 'ag-holder');
        container.appendChild(box);
        mount(box, DATA, CTX);
      }
    },
    // 供实务系统调用的入口
    loadApplication: function (app) {
      state.docs = app.documents.slice();
      state.application = app;
      state.audit = null; state.draft = null;
      if (CTX.go) CTX.go('workspace');
      setTimeout(renderZones, 0);
    },
    getPool: function () { return state.pool; },
    /* ---------- 被驳回申请：查看 / 补单据 / 改信息 / 重审 ---------- */
    getRejected: function () { return state.rejected; },
    getRejectedOne: function (no) {
      return state.rejected.filter(function (x) { return x.applicationNo === no; })[0] || null;
    },
    /** 载入该申请到工作区（可继续上传单据补充证据） */
    openRejected: function (no) {
      var rec = this.getRejectedOne(no);
      if (!rec) return false;
      state.docs = (rec.documents || []).map(function (d) {
        return DATA.documents.filter(function (x) { return x.id === d.id; })[0];
      }).filter(Boolean);
      state.application = rec.application;
      state.application.documents = state.docs.slice();
      state.audit = null;
      state.draft = null;
      if (CTX.go) CTX.go('agent', 'workspace');
      setTimeout(function () {
        if (root.Agent.loadApplication) root.Agent.loadApplication(rec.application);
      }, 40);
      return true;
    },
    /** 修改申请信息（客户 / 金额 / 产品 / 区域），并同步到待处理卡片 */
    patchRejected: function (no, patch) {
      var rec = this.getRejectedOne(no);
      if (!rec) return null;
      var p = patch || {};
      if (p.customer != null && String(p.customer) !== '') {
        rec.customer = String(p.customer);
        rec.application.declaredCustomer = String(p.customer);
        rec.application.customer = String(p.customer);
      }
      if (p.amount != null && String(p.amount) !== '') {
        var n = Number(String(p.amount).replace(/[,\s]/g, ''));
        if (isFinite(n)) { rec.amount = n; rec.application.declaredAmount = n; }
      }
      if (p.product != null && String(p.product) !== '') {
        rec.product = String(p.product);
        rec.application.product = String(p.product);
      }
      if (p.region != null && String(p.region) !== '') {
        rec.region = String(p.region);
        rec.application.region = String(p.region);
      }
      return rec;
    },
    /** 重新提交审核（载入 → 自动执行一次审核） */
    retryRejected: function (no) {
      var rec = this.getRejectedOne(no);
      if (!rec) return false;
      var self = this;
      state.docs = (rec.documents || []).map(function (d) {
        return DATA.documents.filter(function (x) { return x.id === d.id; })[0];
      }).filter(Boolean);
      state.application = rec.application;
      state.application.documents = state.docs.slice();
      state.audit = null;
      state.draft = null;
      if (CTX.go) CTX.go('agent', 'workspace');
      setTimeout(function () {
        if (root.Agent.loadApplication) root.Agent.loadApplication(rec.application);
        setTimeout(function () { runAuditNow(null); }, 120);
      }, 40);
      return true;
    },
    clearRejected: function () { state.rejected = []; },
    /** 由宿主登记一张已开具发票（实务系统「发票开具」台提交时使用） */
    addPool: function (inv) {
      if (!inv || !inv.id) return;
      if (!state.pool.some(function (x) { return x.id === inv.id; })) state.pool.push(inv);
    },
    focusUpload: focusUpload,
    /** 由宿主回填本会话/已持久化的发票池（刷新后仍能拦截重复开票） */
    seedPool: function (list) {
      state.pool = (list || []).slice();
    },
    /** 清空本次会话的开票状态（用于「重置开票状态」与自检） */
    resetPool: function () {
      state.pool = [];
      state.rejected = [];
      state.docs = [];
      state.application = null;
      state.audit = null;
      state.draft = null;
    },
    getLogs: function () { return state.logs; },
    _state: state,
    _parseDocHtml: parseDocHtml,
    _runTestExamples: runTestExamples
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
