/* ==========================================================================
 * engine.js —— 发票审核引擎
 * 识别 → 提取 → 5 项校验（+1 项重复开票附加校验）→ 草稿生成 → 来源追溯
 * 无依赖，浏览器与 Node 通用：挂载到 globalThis.TaxEngine
 * ========================================================================== */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- 常量 */

  // 增值税税率字典（与 dict.taxRates 同源；内置一份兜底，运行时可被 data 覆盖）
  var TAX_RATES = [
    { rate: '13%', code: 0.13, scope: '销售或进口货物、加工修理修配劳务、有形动产租赁服务' },
    { rate: '9%', code: 0.09, scope: '交通运输、邮政、基础电信、建筑、不动产租赁与销售、农产品等' },
    { rate: '6%', code: 0.06, scope: '现代服务、金融服务、生活服务、无形资产销售' },
    { rate: '0%', code: 0.0, scope: '出口货物、跨境应税行为（零税率）' },
    { rate: '5%', code: 0.05, scope: '简易计税征收率（不动产经营租赁等）' }
  ];

  // 开票品名经营范围（与 dict.scope 同源；运行时由 data 覆盖）
  var SCOPE = [];

  var DOC_TYPE = {
    SPECIAL: '增值税专用发票',
    NORMAL: '增值税普通发票',
    EXPORT: '出口发票',
    SALES_CONTRACT: '销售合同',
    PURCHASE_CONTRACT: '采购合同',
    ACCEPTANCE: '验收单',
    DELIVERY_SIGN: '到货签收单',
    STOCK_OUT: '出库单',
    CUSTOMS: '海关进口增值税专用缴款书',
    APPLICATION: '开票申请单'
  };

  var INVOICE_TYPES = [DOC_TYPE.SPECIAL, DOC_TYPE.NORMAL, DOC_TYPE.EXPORT];
  var SALES_EVIDENCE = [DOC_TYPE.SALES_CONTRACT, DOC_TYPE.ACCEPTANCE, DOC_TYPE.STOCK_OUT, DOC_TYPE.DELIVERY_SIGN];

  // 检查项定义（顺序即界面顺序）
  var CHECKS = [
    { key: 'check_title', name: '抬头一致性', desc: '购买方名称/纳税人识别号在合同、验收单、出库单、申请单之间精确一致', match: 'exact_match', rule: '合规管理制度 4.2 交易主体核验' },
    { key: 'check_tax_rate', name: '税率正确性', desc: '税率取自 tax_rates 字典，税额=不含税金额×税率，出口适用 0%', match: 'exact_match', rule: '增值税税率字典 tax_rates' },
    { key: 'check_amount', name: '金额一致性', desc: '合同价税合计 = 不含税金额 + 税额；验收单金额合计与合同不含税精确一致，差异 0.01 元即不通过', match: 'exact_match', rule: '内部审计制度 财务收支审计证据要求' },
    { key: 'check_scope', name: '开票范围', desc: '开票品名与合同标的一致，且属于企业经营范围；出口业务须开具出口发票', match: 'exact_match', rule: '合规管理制度 合规义务清单' },
    { key: 'check_date', name: '日期合理性', desc: '开票日期晚于合同签订日与验收合格日；未验收（控制权未转移）暂缓开票', match: 'exact_match', rule: '收入确认时点（控制权转移）' },
    { key: 'check_duplicate', name: '重复开票校验', desc: '同一业务在同一发票池中不得重复开具，需先红冲后再重开', match: 'exact_match', rule: '注意事项：同一业务不得重复开票' }
  ];

  var EPS = 0.005; // 金额比较容差（仅吸收浮点误差，业务口径为精确到分）

  /* ---------------------------------------------------------------- 工具 */

  function r2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  function fmt(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    var v = r2(n);
    var neg = v < 0;
    v = Math.abs(v);
    var s = v.toFixed(2).split('.');
    var intp = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + intp + '.' + s[1];
  }

  function fmtShort(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '—';
    if (Math.abs(n) >= 10000) return fmt(n / 10000).replace('.00', '') + ' 万元';
    return fmt(n) + ' 元';
  }

  function parseAmount(s) {
    if (s === null || s === undefined) return null;
    s = String(s).replace(/[¥￥,\s元]/g, '');
    if (s === '' || s === '—' || s === '-') return null;
    var m = s.match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }

  function taxRateNum(s) {
    if (s === null || s === undefined) return null;
    var m = String(s).match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? Number(m[1]) / 100 : null;
  }

  function taxRateStr(n) {
    if (n === null || n === undefined || isNaN(n)) return null;
    return (Math.round(n * 10000) / 100) + '%';
  }

  function sameAmount(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return Math.abs(r2(a) - r2(b)) <= EPS;
  }

  function eq(a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return null;
    return String(a).trim() === String(b).trim();
  }

  function pick(docs, types) {
    return (docs || []).filter(function (d) { return types.indexOf(d.docType) >= 0; });
  }

  function sum(ns) {
    var has = false, t = 0;
    for (var i = 0; i < ns.length; i++) {
      if (ns[i] !== null && ns[i] !== undefined && !isNaN(ns[i])) { t += Number(ns[i]); has = true; }
    }
    return has ? r2(t) : null;
  }

  function evidence(d, field, value) {
    return {
      docId: d.id, docType: d.docType, docDate: d.docDate,
      field: field, value: value,
      loc: d.id + ' · ' + d.docType + ' · ' + (field === '价税合计' ? '合计区' : field)
    };
  }

  function locate(doc, key, label) {
    var f = (doc.fields || []).filter(function (x) { return x.key === key; })[0] ||
            (doc.fields || []).filter(function (x) { return x.label === label; })[0];
    return f ? f.loc : null;
  }

  function evFromDoc(doc, key, label, value) {
    return {
      docId: doc.id, docType: doc.docType, docDate: doc.docDate,
      field: label, value: value,
      loc: doc.id + ' · ' + doc.docType + ' · ' + (locate(doc, key, label) || '原文')
    };
  }

  /* ------------------------------------------------------ 1. 单据分类识别 */

  /**
   * 依据单据结构与字段取值判定单据类型（不使用解析阶段已标注的类型，避免自证）
   * @returns {{docType:string, confidence:number, reason:string, signals:string[]}}
   */
  function classifyDoc(doc) {
    var labels = {};
    (doc.fields || []).forEach(function (f) { labels[f.label] = true; });
    var has = function (l) { return !!labels[l]; };
    var self = doc.selfName || '华衡智造集团股份有限公司';
    var items = doc.items || [];
    var signals = [];
    var rate = doc.taxRate;
    var rn = taxRateNum(rate);

    // 海关缴款书
    if (has('计税价格（CIF+关税）') || has('进口增值税')) {
      return { docType: DOC_TYPE.CUSTOMS, confidence: 0.99, reason: '存在「计税价格（CIF+关税）」「进口增值税」专用栏位', signals: ['合计区 进口增值税'] };
    }
    // 发票族：同时具备发票代码与校验码
    if (has('发票代码') && has('校验码')) {
      if (rn === 0) {
        return { docType: DOC_TYPE.EXPORT, confidence: 0.98, reason: '发票要素齐全且税率为 0%（出口零税率）', signals: ['发票代码', '校验码', '税率 0%'] };
      }
      // 专票：明细含规格型号/单位/数量/单价（货物销售类票面）；普票：项目/金额/税率/税额（费用类票面）
      var hasSpec = items.some(function (it) { return it.qty !== null && it.unitPrice !== null; });
      if (hasSpec) {
        return { docType: DOC_TYPE.SPECIAL, confidence: 0.97, reason: '发票要素齐全，明细为「数量×单价」货物票面' + (doc.partyTaxNo ? '，购买方税号 ' + doc.partyTaxNo : ''), signals: ['发票代码', '校验码', '数量×单价明细'] };
      }
      return { docType: DOC_TYPE.NORMAL, confidence: 0.95, reason: '发票要素齐全，明细为「项目/金额/税额」费用票面，税率 ' + rate, signals: ['发票代码', '校验码', '费用项目明细'] };
    }
    // 合同族
    if (has('合同编号')) {
      var sellerIsSelf = false, buyerIsSelf = false;
      (doc.fields || []).forEach(function (f) {
        if (f.label === '销售方名称' && f.value === self) sellerIsSelf = true;
        if (f.label === '买方' && f.value === self) buyerIsSelf = true;
        if (f.label === '卖方' && f.value === self) sellerIsSelf = true;
        if (f.label === '买方（甲方）' && f.value === self) buyerIsSelf = true;
      });
      if (buyerIsSelf) {
        return { docType: DOC_TYPE.PURCHASE_CONTRACT, confidence: 0.96, reason: '含合同编号且本企业为买方（采购方向）', signals: ['合同编号', '买方=本企业'] };
      }
      return { docType: DOC_TYPE.SALES_CONTRACT, confidence: 0.97, reason: '含合同编号且本企业为卖方/销售方，' + (sellerIsSelf ? '合同要素表含「增值税率」「价税合计」' : '合同要素表完整'), signals: ['合同编号', '卖方=本企业'] };
    }
    // 出入库/验收族
    if (has('物料编码') || has('成本单价')) {
      return { docType: DOC_TYPE.STOCK_OUT, confidence: 0.97, reason: '含「物料编码」「成本单价/成本金额」成本口径栏位', signals: ['物料编码', '成本金额'] };
    }
    if (has('质检结果') || has('实收 / 实盘数量')) {
      var qs = '';
      items.forEach(function (it) { qs += (it.extra && it.extra.quality) || ''; });
      if (/验收|控制权/.test(qs)) {
        return { docType: DOC_TYPE.ACCEPTANCE, confidence: 0.98, reason: '含质检结果且结论为「' + qs.slice(0, 24) + '」', signals: ['质检结果', '实收数量'] };
      }
      return { docType: DOC_TYPE.DELIVERY_SIGN, confidence: 0.9, reason: '含到货签收栏位、质检结论为入库状态：' + (qs || '—'), signals: ['质检结果', '实收数量'] };
    }
    // 兜底：按标题关键词
    var t = doc.docTypeRaw || doc.title || '';
    if (/合同/.test(t)) return { docType: /采购/.test(t) ? DOC_TYPE.PURCHASE_CONTRACT : DOC_TYPE.SALES_CONTRACT, confidence: 0.7, reason: '标题关键词兜底：' + t, signals: ['标题'] };
    if (/发票/.test(t)) return { docType: DOC_TYPE.NORMAL, confidence: 0.6, reason: '标题关键词兜底：' + t, signals: ['标题'] };
    return { docType: t || '未知单据', confidence: 0.3, reason: '无法归类，需人工确认', signals: [] };
  }

  /* ---------------------------------------------------- 2. 字段提取与追溯 */

  var KEY_FIELDS = [
    { key: 'party', label: '购买方名称', docKey: 'party' },
    { key: 'partyTaxNo', label: '纳税人识别号', docKey: 'partyTaxNo' },
    { key: 'amountExTax', label: '不含税金额', docKey: 'amountExTax' },
    { key: 'taxAmount', label: '税额', docKey: 'taxAmount' },
    { key: 'amountTotal', label: '价税合计', docKey: 'amountTotal' },
    { key: 'taxRate', label: '税率', docKey: 'taxRate' },
    { key: 'docDate', label: '单据日期', docKey: 'docDate' }
  ];

  /**
   * 提取关键字段并附来源位置
   * @returns {{fields:Array, byDoc:Array, coverage:number}}
   */
  function extractFields(doc) {
    var out = [];
    KEY_FIELDS.forEach(function (kf) {
      var v = doc[kf.docKey];
      if (v === null || v === undefined || v === '') return;
      var labelMap = { amountTotal: ['价税合计', '价税合计/业务金额'], taxRate: ['税率'], amountExTax: ['不含税金额'], taxAmount: ['税额'], party: ['购买方名称', '买方', '往来单位', '卖方名称'], partyTaxNo: ['纳税人识别号'], docDate: ['开票日期', '业务日期'] };
      var loc = locate(doc, kf.key, (labelMap[kf.key] || [kf.label])[0]);
      if (!loc) {
        // 从 fields 里按语义找
        var cand = (doc.fields || []).filter(function (f) {
          return f.label.indexOf(kf.label) >= 0 || (labelMap[kf.key] || []).some(function (l) { return f.label === l; });
        })[0];
        loc = cand ? cand.loc : '原文';
      }
      out.push({
        key: kf.key, label: kf.label, docKey: kf.docKey,
        value: typeof v === 'number' ? v : String(v),
        display: typeof v === 'number' ? fmt(v) : String(v),
        docId: doc.id, docType: doc.docType,
        trace: doc.id + ' · ' + doc.docType + ' · ' + loc,
        loc: loc,
        field_source: 'rule'
      });
    });
    var total = (doc.fields || []).length;
    var withLoc = (doc.fields || []).filter(function (f) { return !!f.loc; }).length;
    return { fields: out, coverage: total ? withLoc / total : 1, totalFields: total, withLoc: withLoc };
  }

  /* -------------------------------------------------------- 3. 审核主流程 */

  function applicationContext(application) {
    var docs = application.documents || [];
    var ctx = {
      all: docs,
      invoices: pick(docs, INVOICE_TYPES),
      contracts: pick(docs, [DOC_TYPE.SALES_CONTRACT, DOC_TYPE.PURCHASE_CONTRACT]),
      salesContracts: pick(docs, [DOC_TYPE.SALES_CONTRACT]),
      acceptances: pick(docs, [DOC_TYPE.ACCEPTANCE]),
      deliveries: pick(docs, [DOC_TYPE.DELIVERY_SIGN]),
      stockOuts: pick(docs, [DOC_TYPE.STOCK_OUT]),
      customs: pick(docs, [DOC_TYPE.CUSTOMS])
    };
    ctx.contract = ctx.salesContracts[0] || ctx.contracts[0] || null;
    ctx.acceptance = ctx.acceptances[0] || null;
    ctx.stockOut = ctx.stockOuts[0] || null;
    ctx.invoice = ctx.invoices[0] || null;
    return ctx;
  }

  function mkCheck(def, status, conclusion, evidenceList, extra) {
    var o = {
      key: def.key, name: def.name, desc: def.desc, match: def.match, rule: def.rule,
      status: status, conclusion: conclusion, evidence: evidenceList || []
    };
    if (extra) for (var k in extra) o[k] = extra[k];
    return o;
  }

  function buyerNameOf(ctx) {
    if (ctx.contract) {
      var f = (ctx.contract.fields || []).filter(function (x) {
        return x.label === '买方（甲方）' || x.label === '买方名称' || x.label === '买方';
      })[0];
      if (f) return f.value;
    }
    if (ctx.acceptance && ctx.acceptance.party) return ctx.acceptance.party;
    if (ctx.invoice && ctx.invoice.party) return ctx.invoice.party;
    return null;
  }

  /* --- check_title */
  function checkTitle(ctx, application) {
    var def = CHECKS[0];
    var names = [];
    var ev = [];
    function add(d, v, label) {
      if (v === null || v === undefined || v === '') return;
      names.push({ docId: d ? d.id : '申请单', name: String(v).trim(), from: label });
      if (d) ev.push(evFromDoc(d, 'party', label, String(v)));
      else ev.push({ docId: '开票申请单', docType: '开票申请单', field: label, value: v, loc: '开票申请单 · 申请信息区 · 购买方名称' });
    }
    if (application.declaredCustomer) add(null, application.declaredCustomer, '开票申请单');
    if (ctx.contract) add(ctx.contract, buyerNameOf(ctx), '合同买方');
    ctx.acceptances.forEach(function (d) { add(d, d.party, '验收单往来单位'); });
    ctx.stockOuts.forEach(function (d) { add(d, d.party, '出库单往来单位'); });
    ctx.invoices.forEach(function (d) { add(d, d.party, '发票购买方'); });

    if (!names.length) {
      return mkCheck(def, 'fail', '未识别到任何购买方名称，无法执行抬头一致性核对，需人工补充申请单或合同。', ev,
        { advice: '请补充开票申请单或销售合同，明确购买方全称与纳税人识别号。' });
    }
    var base = names[0];
    var diffs = names.filter(function (n) { return n.name !== base.name; });
    var selfName = ctx.all[0] && ctx.all[0].selfName;
    var selfHit = names.filter(function (n) { return selfName && n.name === selfName; });
    if (selfHit.length && names.length > 1) {
      // 明细中误把本企业当作购买方
      var nonSelf = names.filter(function (n) { return n.name !== selfName; });
      if (nonSelf.length) base = nonSelf[0];
      diffs = names.filter(function (n) { return n.name !== base.name && n.name !== selfName; });
    }
    if (diffs.length) {
      return mkCheck(def, 'fail',
        '抬头不一致：' + base.from + '为「' + base.name + '」，而 ' + diffs.map(function (d) { return d.from + '为「' + d.name + '」'; }).join('、') + '。',
        ev, {
          diff: { left: base.name, right: diffs[0].name, gap: 0 },
          advice: '请核对购买方全称与纳税人识别号，以合同买方为准修正申请单后重新提交。'
        });
    }
    // 税号一致性
    var taxs = ctx.all.filter(function (d) { return d.partyTaxNo; });
    var taxNote = '';
    if (taxs.length > 1) {
      var t0 = taxs[0].partyTaxNo;
      var tdiff = taxs.filter(function (d) { return d.partyTaxNo !== t0; });
      if (tdiff.length) {
        return mkCheck(def, 'fail', '纳税人识别号不一致：' + taxs[0].id + ' 为 ' + t0 + '，' + tdiff[0].id + ' 为 ' + tdiff[0].partyTaxNo + '。', ev,
          { advice: '请通过客户档案表 customers 复核纳税人识别号，修正后重新提交。' });
      }
    }
    if (!taxs.length) {
      taxNote = '；购买方纳税人识别号在单据中缺失（原值为「—」），建议人工补充核对';
      return mkCheck(def, 'warn', '购买方名称一致（' + base.name + '），' + taxNote + '。', ev,
        { advice: '请补充购买方纳税人识别号，以客户档案 customers 表核验。' });
    }
    return mkCheck(def, 'pass', '购买方名称与纳税人识别号在 ' + names.length + ' 处单据间精确一致（' + base.name + ' / ' + taxs[0].partyTaxNo + '）。', ev);
  }

  /* --- check_tax_rate */
  /**
   * 判定销售区域（决定税率）：内销 13% / 出口 0%
   * 优先用申请/销售明细携带的 region 字段；缺失时按既有出口发票、客户主体是否境内外回退判定。
   */
  function regionOf(ctx, application) {
    application = application || {};
    if (application.region) return application.region;
    if (ctx.invoices.some(function (d) { return d.docType === DOC_TYPE.EXPORT; })) return '出口';
    var party = (ctx.contract && ctx.contract.party) || '';
    if (/越南|境外|海外|HMC 制造/.test(party)) return '出口';
    return '内销';
  }

  function expectedRate(ctx, application) {
    var items = (ctx.contract && ctx.contract.items) || [];
    var product = items[0] ? items[0].name : (ctx.invoice && ctx.invoice.items[0] ? ctx.invoice.items[0].name : null);
    var region = regionOf(ctx, application);
    if (region === '出口') return { rate: 0, why: '出口业务适用 0% 税率（零税率）', product: product, region: region };
    return { rate: 0.13, why: '机械设备/零部件等应税货物销售适用 13%', product: product, region: region };
  }

  function checkTaxRate(ctx, application) {
    var def = CHECKS[1];
    var exp = expectedRate(ctx, application);
    var ev = [];
    var rates = [];
    [ctx.contract, ctx.invoice].forEach(function (d) {
      if (d && d.taxRate) { rates.push({ d: d, r: d.taxRate }); ev.push(evFromDoc(d, 'taxRate', '税率', d.taxRate)); }
    });
    if (!rates.length) {
      return mkCheck(def, 'fail', '未识别到税率字段，无法校验税率正确性。', ev,
        { advice: '请在合同或发票中明确增值税率后重新提交。' });
    }
    var bad = rates.filter(function (x) { return taxRateNum(x.r) !== exp.rate; });
    if (bad.length) {
      return mkCheck(def, 'fail', '税率不正确：' + bad.map(function (x) { return x.d.id + ' 为 ' + x.r; }).join('、') + '，按业务性质应为 ' + taxRateStr(exp.rate) + '（' + exp.why + '）。', ev, {
        diff: { left: taxRateStr(exp.rate), right: bad[0].r, gap: 0 },
        advice: '请核对业务性质与商品编码，按 13%/9%/6%/0% 对应税率重新开具。'
      });
    }
    // 不在字典内
    var inDict = TAX_RATES.some(function (t) { return taxRateNum(t.rate) === exp.rate; });
    // 税额 = 不含税 × 税率
    var d = ctx.invoice || ctx.contract;
    if (d && d.amountExTax !== null && d.taxAmount !== null) {
      var calc = r2(d.amountExTax * exp.rate);
      if (Math.abs(calc - r2(d.taxAmount)) > 0.01) {
        return mkCheck(def, 'fail', '税额计算不符：不含税 ' + fmt(d.amountExTax) + ' × ' + taxRateStr(exp.rate) + ' 应为 ' + fmt(calc) + '，单据为 ' + fmt(d.taxAmount) + '。', ev,
          { diff: { left: fmt(calc), right: fmt(d.taxAmount), gap: r2(d.taxAmount - calc) },
            advice: '请重算税额，确保「税额＝不含税金额×税率」精确到分。' });
      }
      ev.push(evFromDoc(d, 'taxAmount', '税额', fmt(d.taxAmount)));
    }
    if (exp.rate === 0) {
      var hasTax = (ctx.invoice && ctx.invoice.taxAmount) || (ctx.contract && ctx.contract.taxAmount);
      if (realNum(hasTax) > 0) {
        return mkCheck(def, 'fail', '出口业务适用 0% 税率，不应计列税额，单据税额为 ' + fmt(hasTax) + '。', ev,
          { advice: '出口发票请按 0% 开具，不单列销项税额。' });
      }
    }
    return mkCheck(def, 'pass', '税率 ' + taxRateStr(exp.rate) + ' 与 tax_rates 字典及业务性质一致（' + exp.why + '），税额勾稽通过' + (inDict ? '' : '（字典未匹配到该税率，需复核）') + '。', ev);
  }

  function realNum(v) { return v === null || v === undefined || isNaN(Number(v)) ? 0 : Number(v); }

  /* --- check_amount */
  function checkAmount(ctx, application) {
    var def = CHECKS[2];
    var ev = [];
    var c = ctx.contract;
    var rows = [];

    if (c) {
      if (c.amountTotal !== null) { rows.push({ label: '合同价税合计', v: c.amountTotal, d: c }); ev.push(evFromDoc(c, 'amountTotal', '价税合计', fmt(c.amountTotal))); }
      if (c.amountExTax !== null) { rows.push({ label: '合同不含税金额', v: c.amountExTax, d: c }); ev.push(evFromDoc(c, 'amountExTax', '不含税金额', fmt(c.amountExTax))); }
    }
    if (application.declaredAmount !== null && application.declaredAmount !== undefined) {
      rows.push({ label: '申请单声明金额', v: application.declaredAmount, d: null });
      ev.push({ docId: '开票申请单', docType: '开票申请单', field: '申请金额', value: fmt(application.declaredAmount), loc: '开票申请单 · 申请信息区 · 申请金额' });
    }
    var accSum = sum(ctx.acceptances.map(function (d) { return d.amountTotal; }));
    if (accSum !== null) {
      rows.push({ label: '验收单金额合计', v: accSum, d: ctx.acceptances[0] });
      ctx.acceptances.forEach(function (d) { ev.push(evFromDoc(d, 'amountTotal', '验收金额', fmt(d.amountTotal))); });
    }
    if (ctx.invoice && ctx.invoice.amountTotal !== null) {
      rows.push({ label: '发票价税合计', v: ctx.invoice.amountTotal, d: ctx.invoice });
      ev.push(evFromDoc(ctx.invoice, 'amountTotal', '价税合计', fmt(ctx.invoice.amountTotal)));
    }

    if (!rows.length) {
      return mkCheck(def, 'fail', '未识别到任何金额字段，无法执行金额一致性核对。', ev,
        { advice: '请补充销售合同或验收单，明确含税与不含税金额。' });
    }

    // A. 价税合计 = 不含税 + 税额
    if (c && c.amountTotal !== null && c.amountExTax !== null) {
      var calc = r2(c.amountExTax + realNum(c.taxAmount));
      if (Math.abs(calc - r2(c.amountTotal)) > 0.01) {
        return mkCheck(def, 'fail', '合同金额勾稽不平：不含税 ' + fmt(c.amountExTax) + ' + 税额 ' + fmt(c.taxAmount) + ' = ' + fmt(calc) + '，而价税合计为 ' + fmt(c.amountTotal) + '，差异 ' + fmt(c.amountTotal - calc) + ' 元。', ev,
          { diff: { left: fmt(calc), right: fmt(c.amountTotal), gap: r2(c.amountTotal - calc) },
            advice: '请核对合同含税/不含税口径，修正后重新提交。' });
      }
    }

    // B. 验收金额 vs 合同金额（允许两种口径，但必须与合同对应金额精确一致到分）
    var accBasis = '';
    if (accSum !== null && c && c.amountExTax !== null) {
      var okEx = sameAmount(accSum, c.amountExTax);
      var okTotal = c.amountTotal !== null && sameAmount(accSum, c.amountTotal);
      if (!okEx && !okTotal) {
        var gap = r2(accSum - c.amountExTax);
        var gapTotal = c.amountTotal !== null ? r2(accSum - c.amountTotal) : null;
        return mkCheck(def, 'fail', '金额不一致：合同不含税金额 ' + fmt(c.amountExTax) + ' 元（含税 ' + fmt(c.amountTotal) + ' 元），验收单金额合计 ' + fmt(accSum) + ' 元' +
          (gapTotal !== null ? '，与不含税差 ' + fmt(gap) + ' 元、与价税合计差 ' + fmt(gapTotal) + ' 元' : '，差 ' + fmt(gap) + ' 元') +
          '（' + (accSum > c.amountExTax ? '验收金额偏大' : '验收金额偏小') + '）。', ev, {
          diff: { left: fmt(c.amountExTax), right: fmt(accSum), gap: gap },
          advice: '请核对验收数量与单价，确认差异原因（是否含税口径、是否部分验收、是否发生折让），修正后重新提交。'
        });
      }
      accBasis = okEx ? '不含税口径' : '含税口径';
    }

    // C. 申请单声明金额 vs 合同价税合计（Prompt 示例2 场景）
    if (application.declaredAmount !== null && application.declaredAmount !== undefined && c && c.amountTotal !== null) {
      if (!sameAmount(application.declaredAmount, c.amountTotal)) {
        var g2 = r2(application.declaredAmount - c.amountTotal);
        return mkCheck(def, 'fail', '申请单金额与合同金额不一致：合同价税合计 ' + fmt(c.amountTotal) + ' 元，申请单金额 ' + fmt(application.declaredAmount) + ' 元，差异 ' + fmt(g2) + ' 元。', ev, {
          diff: { left: fmt(c.amountTotal), right: fmt(application.declaredAmount), gap: g2 },
          advice: '请核对合同金额，确认是否含税，修正申请单金额后重新提交。'
        });
      }
    }

    // D. 缺验收单 → 无法三方比对
    if (accSum === null) {
      return mkCheck(def, 'warn', '合同金额内部勾稽通过（' + fmt(c.amountTotal) + ' 元），但缺少验收单，无法完成「合同—验收—发票」三方金额比对。', ev, {
        advice: '请补充验收单，确认控制权已转移后再开票。'
      });
    }

    return mkCheck(def, 'pass', '金额三方一致：合同价税合计 ' + fmt(c.amountTotal) + ' 元 = 不含税 ' + fmt(c.amountExTax) + ' + 税额 ' + fmt(c.taxAmount) + '；验收单金额合计 ' + fmt(accSum) + ' 元与合同' + (accBasis === '含税口径' ? '价税合计' : '不含税金额') + '精确一致（差异 0.00 元，' + accBasis + '）。', ev);
  }

  /* --- check_scope */
  function checkScope(ctx, application) {
    var def = CHECKS[3];
    var ev = [];
    var c = ctx.contract;
    var product = c && c.items[0] ? c.items[0].name : null;
    var region = regionOf(ctx, application);
    var scopeHit = null;
    SCOPE.forEach(function (s) {
      if (product && s.product === product) scopeHit = s;
    });
    if (product) ev.push(evFromDoc(c, 'items', '合同标的', product));

    if (!product) {
      return mkCheck(def, 'fail', '未识别到合同标的（货物/服务名称），无法核对开票范围。', ev,
        { advice: '请补充销售合同，明确标的名称与规格型号。' });
    }
    if (!scopeHit) {
      return mkCheck(def, 'warn', '开票品名「' + product + '」未匹配到企业经营范围目录，需人工确认是否超范围开票。', ev, {
        advice: '请核对营业执照经营范围与商品税收分类编码，确认后再开具。'
      });
    }
    // 发票品名与合同标的一致
    if (ctx.invoice && ctx.invoice.items.length) {
      var invName = ctx.invoice.items[0].name;
      ev.push(evFromDoc(ctx.invoice, 'items', '发票品名', invName));
      if (!eq(invName, product)) {
        return mkCheck(def, 'fail', '开票品名与合同标的不一致：合同为「' + product + '」，发票为「' + invName + '」。', ev, {
          diff: { left: product, right: invName, gap: 0 },
          advice: '发票品名须与合同标的、税收分类编码一致，请修正后重开。'
        });
      }
    }
    // 出口业务类型
    if (/出口/.test(region)) {
      var isExportInv = ctx.invoices.length === 0 || ctx.invoices.every(function (d) { return d.docType === DOC_TYPE.EXPORT; });
      if (!isExportInv) {
        return mkCheck(def, 'fail', '出口业务应开具「出口发票」并适用 0% 税率，当前单据为「' + ctx.invoices[0].docType + '」。', ev,
          { advice: '出口业务请开具出口发票（0%），并按出口报关单核对 FOB 价。' });
      }
      ev.push({ docId: ctx.all[0] ? ctx.all[0].id : '—', docType: '区域判定', field: '销售区域', value: '出口', loc: '客户往来区域 · 出口' });
    }
    // 客户档案校验
    var custHit = null;
    CUSTOMERS.forEach(function (x) { if (x.name === (buyerNameOf(ctx) || '')) custHit = x; });
    if (!custHit) {
      return mkCheck(def, 'warn', '开票品名「' + product + '」在经营范围内（' + scopeHit.category + '，' + scopeHit.defaultRate + '），但购买方未在客户档案 customers 表匹配到记录。', ev, {
        advice: '请先在客户档案中建档并核对纳税人识别号与信用等级。'
      });
    }
    return mkCheck(def, 'pass', '开票品名「' + product + '」与合同标的精确一致，属于经营范围「' + scopeHit.category + '」（' + scopeHit.defaultRate + '），购买方已建档' + (/出口/.test(region) ? '，出口业务开具出口发票（0%）' : '') + '。', ev);
  }

  /* --- check_date */
  function checkDate(ctx) {
    var def = CHECKS[4];
    var ev = [];
    var c = ctx.contract;
    var acc = ctx.acceptance;
    var deliver = ctx.deliveries[0] || null;

    if (c && c.docDate) ev.push(evFromDoc(c, 'docDate', '合同日期', c.docDate));
    if (acc) ev.push(evFromDoc(acc, 'docDate', '验收日期', acc.docDate));
    else if (deliver) ev.push(evFromDoc(deliver, 'docDate', '签收日期', deliver.docDate));

    if (!c) {
      return mkCheck(def, 'fail', '缺少销售合同，无法核对开票日期与业务发生时点的先后关系。', ev,
        { advice: '请补充销售合同后再提交审核。' });
    }
    // 未验收 → 控制权未转移 → 暂缓开票（TC-022 场景）
    if (!acc) {
      var reason = deliver
        ? '单据中仅有「到货签收单」（' + deliver.id + '，' + deliver.docDate + ' 已签发），缺少「验收单」；控制权尚未转移，本期不得开票。'
        : '单据中缺少「验收单」，无法确认验收合格日期与控制权转移时点。';
      return mkCheck(def, 'suspend', reason + '请登记为待开票事项，待验收合格后重新提交审核。', ev, {
        advice: '按收入确认时点要求暂缓开票：先取得验收单（验收合格、控制权已转移），再重新提交开票申请。'
      });
    }
    // 验收日期 >= 合同日期
    if (acc.docDate && c.docDate && acc.docDate < c.docDate) {
      return mkCheck(def, 'fail', '验收日期 ' + acc.docDate + ' 早于合同签订日期 ' + c.docDate + '，业务时序不成立。', ev, {
        advice: '请核对合同签订日期与验收日期，疑似倒签或单据错配。'
      });
    }
    // 开票时点在验收之后（同月或次月，超过 90 天提示）
    var applDate = applDateOf(ctx) || acc.docDate || c.docDate;
    ev.push({ docId: '开票申请单', docType: '开票申请单', field: '拟开票日期', value: applDate, loc: '开票申请单 · 申请信息区 · 拟开票日期' });
    if (applDate < acc.docDate) {
      return mkCheck(def, 'fail', '拟开票日期 ' + applDate + ' 早于验收合格日期 ' + acc.docDate + '，控制权尚未转移，不得提前开票。', ev, {
        advice: '请在验收合格并转移控制权之后开具发票。'
      });
    }
    var days = diffDays(acc.docDate, applDate);
    if (days > 90) {
      return mkCheck(def, 'warn', '业务时序通过（验收 ' + acc.docDate + ' → 开票 ' + applDate + '），但间隔 ' + days + ' 天已超过 90 天，存在跨期收入确认风险。', ev, {
        advice: '请确认跨期原因，并按权责发生制确认收入。'
      });
    }
    return mkCheck(def, 'pass', '日期合理：合同 ' + c.docDate + ' → 验收合格 ' + acc.docDate + ' → 拟开票 ' + applDate + '（间隔 ' + days + ' 天，控制权已转移）。', ev);
  }

  function applDateOf(ctx) {
    for (var i = 0; i < ctx.all.length; i++) if (ctx.all[i].applyDate) return ctx.all[i].applyDate;
    return null;
  }

  function diffDays(a, b) {
    if (!a || !b) return 0;
    var d1 = new Date(a + 'T00:00:00'), d2 = new Date(b + 'T00:00:00');
    return Math.round(Math.abs(d2 - d1) / 86400000);
  }

  /* --- check_duplicate（附加校验） */
  function checkDuplicate(ctx, application, pool) {
    var def = CHECKS[5];
    var buyer = buyerNameOf(ctx);
    var c = ctx.contract;
    if (!buyer || !c || c.amountTotal === null) {
      return mkCheck(def, 'pass', '缺少比对要素（购买方或合同金额），跳过重复开票校验。', []);
    }
    var hits = [];
    var scopeNote = '';
    (pool || []).forEach(function (p) {
      if (p.party === buyer && sameAmount(p.amountTotal, c.amountTotal)) {
        hits.push(p);
      }
    });
    var ev = hits.map(function (h) {
      return { docId: h.id, docType: h.docType, docDate: h.docDate, field: '价税合计', value: fmt(h.amountTotal), loc: h.id + ' · ' + h.docType + ' · 合计区' };
    });
    if (!hits.length) {
      return mkCheck(def, 'pass', '发票池中未发现购买方「' + buyer + '」同一金额（' + fmt(c.amountTotal) + ' 元）的既有发票，无重复开票风险。', ev);
    }
    var blocking = hits.filter(function (h) { return h.poolKind === 'session'; });
    if (blocking.length) {
      return mkCheck(def, 'fail', '重复开票：本会话中已对购买方「' + buyer + '」金额 ' + fmt(c.amountTotal) + ' 元开具过发票 ' + blocking.map(function (x) { return x.id; }).join('、') + '，同一业务不得重复开票。', ev, {
        advice: '如需重开，须先取得红字信息表开具红字发票（红冲）后再重新开具。'
      });
    }
    return mkCheck(def, 'warn', '发票池（历史数据集）中已存在购买方「' + buyer + '」金额 ' + fmt(c.amountTotal) + ' 元的发票 ' + hits.map(function (x) { return x.id; }).join('、') + '。本数据集为同月已开具样本，仅作对照；正式环境须查询 tax_invoice_pool 校验。', ev, {
      advice: '若为复演/对照场景可继续；正式开票前请确认该业务未重复开票，必要时先红冲。'
    });
  }

  /* ------------------------------------------------ 4. 审核结果与草稿 */

  function decide(checks) {
    var fails = checks.filter(function (c) { return c.status === 'fail'; });
    var suspends = checks.filter(function (c) { return c.status === 'suspend'; });
    var warns = checks.filter(function (c) { return c.status === 'warn'; });
    if (fails.length) return { result: 'fail', riskLevel: fails.length >= 2 ? 'high' : 'mid', fails: fails, suspends: suspends, warns: warns };
    if (suspends.length) return { result: 'suspend', riskLevel: 'mid', fails: fails, suspends: suspends, warns: warns };
    return { result: 'pass', riskLevel: warns.length ? 'mid' : 'low', fails: fails, suspends: suspends, warns: warns };
  }

  function summarize(result, checks, ctx) {
    var c = ctx.contract;
    var title = c ? (c.items[0] ? c.items[0].name : '') : '';
    if (result === 'pass') {
      return '审核通过：' + checks.filter(function (x) { return x.status === 'pass'; }).length + '/' + checks.length +
        ' 项检查通过' + (checks.some(function (x) { return x.status === 'warn'; }) ? '（含 ' + checks.filter(function (x) { return x.status === 'warn'; }).length + ' 项提示）' : '') +
        '，业务"' + title + '"金额 ' + fmt(c ? c.amountTotal : null) + ' 元，已生成待确认开票草稿。';
    }
    if (result === 'suspend') {
      return '审核暂停：证据不齐备，未能形成通过/不通过结论，不得开票。' +
        checks.filter(function (x) { return x.status === 'suspend'; }).map(function (x) { return x.conclusion; }).join('');
    }
    return '审核不通过：' + checks.filter(function (x) { return x.status === 'fail'; }).length + ' 项检查未通过 —— ' +
      checks.filter(function (x) { return x.status === 'fail'; }).map(function (x) { return x.name + '：' + x.conclusion; }).join(' ');
  }

  function buildEvidenceTable(checks) {
    var rows = [];
    var seen = {};
    checks.forEach(function (ck) {
      (ck.evidence || []).forEach(function (e) {
        var k = e.docId + '|' + e.field + '|' + e.value;
        if (seen[k]) return;
        seen[k] = true;
        rows.push({ check: ck.name, checkKey: ck.key, checkStatus: ck.status, docId: e.docId, docType: e.docType, field: e.field, value: e.value, loc: e.loc });
      });
    });
    return rows;
  }

  /**
   * 审核主入口
   * @param {Object} application 一次开票申请
   * @param {Object} options { pool: 发票池数组, operator:string, ruleMode:string }
   * @returns {Object} AuditResult
   */
  function runAudit(application, options) {
    options = options || {};
    var ctx = applicationContext(application);
    var checks = [
      checkTitle(ctx, application),
      checkTaxRate(ctx, application),
      checkAmount(ctx, application),
      checkScope(ctx, application),
      checkDate(ctx),
      checkDuplicate(ctx, application, options.pool || [])
    ];
    var d = decide(checks);
    var now = new Date();
    var res = {
      applicationNo: application.applicationNo || ('APP-' + now.getTime()),
      auditedAt: fmtDateTime(now),
      operator: options.operator || application.applicant || '李娜',
      applicant: application.applicant || '—',
      result: d.result,
      resultLabel: d.result === 'pass' ? '通过' : (d.result === 'suspend' ? '暂缓（证据不齐备）' : '不通过'),
      riskLevel: d.riskLevel,
      checks: checks,
      evidenceTable: buildEvidenceTable(checks),
      ruleMode: options.ruleMode || 'rule',
      summary: summarize(d.result, checks, ctx),
      documents: (application.documents || []).map(function (x) {
        var cl = classifyDoc(x);
        return { id: x.id, docType: x.docType, classified: cl.docType, confidence: cl.confidence, reason: cl.reason, docDate: x.docDate, party: x.party, amount: x.amountTotal };
      })
    };
    return res;
  }

  function fmtDateTime(d) {
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  /**
   * 生成开票草稿（auto_fill_all：全量回填）
   */
  function buildDraft(auditResult, application) {
    if (!auditResult || auditResult.result !== 'pass') return null;
    var ctx = applicationContext(application);
    var c = ctx.contract;
    var buyer = buyerNameOf(ctx);
    var buyerTax = (ctx.contract && ctx.contract.partyTaxNo) ||
      (ctx.invoices[0] && ctx.invoices[0].partyTaxNo) ||
      (CUSTOMERS.filter(function (x) { return x.name === buyer; })[0] || {}).taxNo || null;
    if (!buyerTax) {
      var cust = CUSTOMERS.filter(function (x) { return x.name === buyer; })[0];
      if (cust) buyerTax = cust.taxNo;
    }
    var exp = expectedRate(ctx, application);
    var isExport = exp.region === '出口';
    var items = (c ? c.items : []).map(function (it) {
      return {
        name: it.name, spec: it.spec, unit: it.unit, qty: it.qty,
        unitPrice: it.unitPrice, amount: it.amount,
        taxRate: it.taxRate || taxRateStr(exp.rate),
        taxAmount: it.taxAmount !== null ? it.taxAmount : (it.amount !== null ? r2(it.amount * exp.rate) : null),
        loc: c.id + ' · 销售合同 · ' + it.loc
      };
    });
    var amountEx = c ? c.amountExTax : null;
    var rateNum = exp.rate;
    var taxAmount = c && c.taxAmount !== null ? c.taxAmount : (amountEx !== null ? r2(amountEx * rateNum) : null);
    var total = c ? c.amountTotal : null;
    if (total === null && amountEx !== null) total = r2(amountEx + realNum(taxAmount));

    var commonErrors = [];
    auditResult.checks.forEach(function (ck) {
      if (ck.status !== 'pass') commonErrors.push({ level: ck.status, check: ck.name, text: ck.conclusion, advice: ck.advice || null });
    });
    if (!buyerTax) commonErrors.push({ level: 'warn', check: '购买方信息', text: '购买方纳税人识别号在单据中缺失，草稿中留空，需人工补充。', advice: '请以客户档案 customers 表核验税号后补录。' });

    var sources = [];
    function addSource(field, docId, loc) { sources.push({ field: field, docId: docId, loc: loc }); }
    if (c) {
      addSource('购买方名称', c.id, locate(c, 'party', '买方（甲方）') || '往来方区');
      addSource('不含税金额', c.id, locate(c, 'amountExTax', '不含税金额') || '合同要素表');
      addSource('税率', c.id, locate(c, 'taxRate', '增值税率') || '合同要素表');
      addSource('价税合计', c.id, locate(c, 'amountTotal', '价税合计') || '合同要素表');
      addSource('货物/服务名称', c.id, locate(c, 'items', '合同标的') || '合同要素表');
    }
    if (ctx.acceptance) addSource('验收金额', ctx.acceptance.id, locate(ctx.acceptance, 'amountTotal', '验收金额') || '明细表');

    return {
      draftNo: 'DRF-' + (c ? c.id.replace(/[^0-9]/g, '').slice(-6) : String(Date.now()).slice(-6)),
      status: 'pending',
      statusLabel: '待人工确认',
      invoiceType: isExport ? DOC_TYPE.EXPORT : DOC_TYPE.SPECIAL,
      buyer: { name: buyer, taxNo: buyerTax },
      seller: { name: c ? c.selfName : '华衡智造集团股份有限公司', taxNo: c ? c.selfTaxNo : '91440300MA5H8K2X3Q' },
      items: items,
      amountExTax: amountEx,
      taxRate: taxRateStr(rateNum),
      taxAmount: taxAmount,
      amountTotal: total,
      amountInWords: c ? c.amountInWords : null,
      remark: isExport ? '出口业务，适用 0% 税率；FOB 价核对报关单。' : ('合同 ' + (c ? c.id : '') + '；验收合格；结算方式：验收后 30 天电汇。'),
      highlights: ['buyer.name', 'amountExTax', 'taxRate', 'taxAmount', 'amountTotal'],
      commonErrors: commonErrors,
      sources: sources,
      contractId: c ? c.id : null,
      acceptanceId: ctx.acceptance ? ctx.acceptance.id : null,
      applicationNo: auditResult.applicationNo,
      auditResultRef: auditResult.applicationNo,
      createdAt: fmtDateTime(new Date())
    };
  }

  /* ------------------------------------------- 5. 数据注入与运行期配置 */

  var CUSTOMERS = [];

  function configure(data) {
    if (!data) return;
    if (data.dict) {
      if (data.dict.taxRates && data.dict.taxRates.length) TAX_RATES = data.dict.taxRates;
      if (data.dict.scope) SCOPE = data.dict.scope;
      if (data.dict.customers) CUSTOMERS = data.dict.customers;
    }
    if (data.customers && data.customers.length) CUSTOMERS = data.customers;
    if (data.scope) SCOPE = data.scope;
  }

  root.TaxEngine = {
    DOC_TYPE: DOC_TYPE,
    INVOICE_TYPES: INVOICE_TYPES,
    SALES_EVIDENCE: SALES_EVIDENCE,
    CHECKS: CHECKS,
    KEY_FIELDS: KEY_FIELDS,
    get TAX_RATES() { return TAX_RATES; },
    get SCOPE() { return SCOPE; },
    get CUSTOMERS() { return CUSTOMERS; },
    configure: configure,
    classifyDoc: classifyDoc,
    extractFields: extractFields,
    applicationContext: applicationContext,
    runAudit: runAudit,
    buildDraft: buildDraft,
    buyerNameOf: buyerNameOf,
    expectedRate: expectedRate,
    regionOf: regionOf,
    fmt: fmt,
    fmtShort: fmtShort,
    fmtDateTime: fmtDateTime,
    parseAmount: parseAmount,
    taxRateNum: taxRateNum,
    taxRateStr: taxRateStr,
    sameAmount: sameAmount,
    sum: sum,
    r2: r2
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
