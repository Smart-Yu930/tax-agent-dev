/*!
 * practice.js — 实务系统（复刻 P1-01 增值税发票开具系统）
 *
 * 契约：docs/DATA_CONTRACT.md 第 8 节
 *   window.Practice = { mount(container, data, ctx) }  ->  { show(viewName) }
 *   ctx = { goAgent(filter), openDraft(draft), toast(msg), getState() }
 *
 * 取数：只从 data 参数取（契约第 1–5 节），不硬编码任何业务数值；
 *       概览卡、清单、台账均由 data 现算。
 * 实现：原生 JS（ES2017），IIFE 挂 window.Practice，无外部依赖、无网络请求。
 * 安全：业务数据一律用 textContent / setAttribute 写入，不用 innerHTML 拼接。
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';

  /* 模块顺序：按「看板 → 建业务 → 选事项 → 查单据 → 开票 → 台账」的实际作业流排列
     alias 用于兼容外部路由（旧链接 redflush / invoiceLedger 仍可解析） */
  var VIEWS = [
    { key: 'workbench', name: '工作台预览', alias: ['workbench', 'desk', 'home', '开票工作台'] },
    { key: 'newbusiness', name: '新建开票业务', alias: ['newbusiness', 'new', 'create', 'upload'] },
    { key: 'pending', name: '待开票清单', alias: ['pending', 'topending', 'list'] },
    { key: 'rejected', name: '被驳回申请', alias: ['rejected', 'reject', 'refused', 'backlog'] },
    { key: 'ledger', name: '单据台账', alias: ['ledger', 'contracts', 'docs', '合同与验收台账'] },
    { key: 'issue', name: '发票开具', alias: ['issue', 'invoice', 'make'] },
    { key: 'issued', name: '已开发票', alias: ['issued', 'opened', 'history', 'issuedlist'] },
    { key: 'invoices', name: '开票台账', alias: ['invoices', 'invoiceLedger', 'invoiceledger', 'issueledger'] }
  ];

  /* 单据类型展示顺序（仅影响分类筛选的排列，类型集合仍来自 data） */
  var TYPE_ORDER = [
    '销售合同', '采购合同', '验收单', '到货签收单', '出库单',
    '增值税专用发票', '增值税普通发票', '出口发票', '海关进口增值税专用缴款书'
  ];

  var RATE_CHOICES = ['13%', '9%', '6%', '0%'];
  var PAGE_SIZE = 25;

  /* ==================================================================
   * 1. 基础工具
   * ================================================================== */

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isArr(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  function arr(v) {
    return isArr(v) ? v : [];
  }

  function obj(v) {
    return v && typeof v === 'object' && !isArr(v) ? v : {};
  }

  function str(v) {
    return v == null ? '' : String(v);
  }

  /** 宽松数值化：兼容 "30,510,000.00"、"13%"、"¥3,510,000.00"、number */
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = str(v).replace(/[,，\s¥￥%]/g, '');
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function fmtMoney(v) {
    var n = num(v);
    if (n == null) return '—';
    var neg = n < 0;
    var parts = Math.abs(n).toFixed(2).split('.');
    var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + int + '.' + parts[1];
  }

  function fmtInt(v) {
    var n = num(v);
    if (n == null) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /** 金额统一到「万元」，与参照系统一致（12,638.00 万元） */
  function fmtWan(v) {
    var n = num(v);
    if (n == null) return '—';
    return fmtMoney(n / 10000) + ' 万元';
  }

  /** 税率字符串 -> 小数：'13%' -> 0.13，13 -> 0.13，'0%' -> 0 */
  function rateNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? (v > 1 ? v / 100 : v) : null;
    var m = str(v).match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var n = Number(m[0]);
    if (str(v).indexOf('%') >= 0 || n > 1) n = n / 100;
    return isFinite(n) ? n : null;
  }

  function fmtRate(r) {
    var n = rateNum(r);
    if (n == null) return '—';
    var pct = round2(n * 100);
    return (pct % 1 === 0 ? String(pct) : String(pct)) + '%';
  }

  function includes(hay, needle) {
    return str(hay).indexOf(needle) >= 0;
  }

  function text(v, fallback) {
    var s = str(v).trim();
    return s ? s : (fallback == null ? '—' : fallback);
  }

  function uniq(list) {
    var out = [], seen = {};
    arr(list).forEach(function (v) {
      var k = str(v);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push(v);
    });
    return out;
  }

  /** 两位数补零（日期拼接用） */
  function pad2(n) {
    n = Number(n) || 0;
    return (n < 10 ? '0' : '') + n;
  }

  /* ==================================================================
   * 2. 数据装配（全部来自 data，缺字段时安全退化）
   * ================================================================== */

  function isInvoiceType(docType) {
    return includes(docType, '发票');
  }

  function docExTax(doc, ledgerAmount) {
    var d = obj(doc);
    var ex = num(d.amountExTax);
    if (ex != null) return ex;
    var total = num(d.amountTotal);
    if (total == null) total = num(d.amount);
    if (total == null) total = num(ledgerAmount);
    if (total == null) return null;
    var r = rateNum(d.taxRate);
    if (r && r > 0) return round2(total / (1 + r));
    return total;
  }

  function itemsOf(doc) {
    return arr(obj(doc).items);
  }

  function itemQty(doc) {
    var items = itemsOf(doc), total = 0, has = false;
    items.forEach(function (it) {
      var q = num(obj(it).qty);
      if (q != null) { total += q; has = true; }
    });
    return has ? total : null;
  }

  function itemProduct(doc) {
    var items = itemsOf(doc);
    for (var i = 0; i < items.length; i++) {
      var n = str(obj(items[i]).name).trim();
      if (n) return n;
    }
    return '';
  }

  function itemsHaveProduct(doc, product) {
    var p = str(product).trim();
    if (!p) return false;
    return itemsOf(doc).some(function (it) {
      var n = str(obj(it).name).trim();
      if (!n) return false;
      return n === p || includes(n, p) || includes(p, n);
    });
  }

  function buildModel(data) {
    var D = obj(data);
    var meta = obj(D.meta);
    var tables = obj(D.tables);
    var dict = obj(D.dict);

    var docs = arr(D.documents).filter(function (d) { return !!str(obj(d).id); });
    var ledger = arr(D.ledger).filter(function (r) { return !!str(obj(r).id); });
    var sales = arr(tables.sales);

    var docById = {};
    docs.forEach(function (d) { docById[d.id] = d; });

    var ledgerById = {};
    ledger.forEach(function (r) { ledgerById[r.id] = r; });

    var invDocs = docs.filter(function (d) { return isInvoiceType(d.docType); });
    var contractDocs = docs.filter(function (d) { return includes(d.docType, '合同'); });
    var salesContractDocs = docs.filter(function (d) { return includes(d.docType, '销售合同'); });
    var ysDocs = docs.filter(function (d) { return includes(d.docType, '验收单'); });      // 不含「到货签收单」
    var deliveryDocs = docs.filter(function (d) { return includes(d.docType, '出库单'); });

    /* 台账行：优先 data.ledger（含 summary），缺失时退化为 documents */
    var records;
    if (ledger.length) {
      records = ledger.map(function (r) {
        var o = obj(r);
        return {
          idx: num(o.idx),
          id: str(o.id),
          docType: str(o.docType),
          summary: str(o.summary),
          date: str(o.date),
          party: str(o.party),
          amount: num(o.amount),
          file: str(o.file)
        };
      });
    } else {
      records = docs.map(function (d) {
        var o = obj(d);
        return {
          idx: num(o.idx),
          id: str(o.id),
          docType: str(o.docType),
          summary: str(o.title),
          date: str(o.docDate),
          party: str(o.party),
          amount: num(o.amountTotal),
          file: str(o.file)
        };
      });
    }
    records.sort(function (a, b) {
      var ai = a.idx == null ? 1e9 : a.idx;
      var bi = b.idx == null ? 1e9 : b.idx;
      if (ai !== bi) return ai - bi;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    /* 分类统计（仅统计台账中实际出现的类型） */
    var typeCount = {};
    records.forEach(function (r) {
      if (!r.docType) return;
      typeCount[r.docType] = (typeCount[r.docType] || 0) + 1;
    });
    var types = Object.keys(typeCount).sort(function (a, b) {
      var ia = TYPE_ORDER.indexOf(a), ib = TYPE_ORDER.indexOf(b);
      if (ia < 0) ia = 99;
      if (ib < 0) ib = 99;
      if (ia !== ib) return ia - ib;
      return a < b ? -1 : 1;
    });

    /* 未验收：销售合同未匹配到「验收单」——仅用 data 反推，不臆造字段 */
    var unaccepted = [];
    if (salesContractDocs.length && ysDocs.length) {
      salesContractDocs.forEach(function (c) {
        var lr = ledgerById[c.id];
        var cAmt = docExTax(c, lr ? lr.amount : null);
        var matched = ysDocs.some(function (y) {
          if (str(c.party) && str(y.party) && str(c.party) !== str(y.party)) return false;
          var ly = ledgerById[y.id];
          var yAmt = docExTax(y, ly ? ly.amount : null);
          if (cAmt == null || yAmt == null) return !!str(c.party) && str(c.party) === str(y.party);
          return Math.abs(cAmt - yAmt) <= 1;
        });
        if (!matched) {
          var lr2 = ledgerById[c.id];
          unaccepted.push({
            id: c.id,
            party: str(c.party),
            product: itemProduct(c),
            qty: itemQty(c),
            amountExTax: cAmt,
            amountTotal: num(c.amountTotal) != null ? num(c.amountTotal) : (lr2 ? num(lr2.amount) : null),
            taxRate: c.taxRate || null,
            doc: c
          });
        }
      });
    }

    /* 本月销售额：销售明细金额合计（不含税），单位换算到万元 */
    var salesTotal = 0, salesKnown = 0;
    sales.forEach(function (r) {
      var a = num(obj(r).amount);
      if (a != null) { salesTotal += a; salesKnown++; }
    });

    /* 本会话已开具：由宿主（智能体确认开具 / 开具台提交 / 按发票原件同步）回写 */
    var issuedRows = sales.filter(function (r) { return str(obj(r).issueStatus) === STATUS_ISSUED; });
    var sessionInvoices = arr(obj(data).sessionInvoices).map(function (inv) {
      var kind = str(inv.poolKind) === 'document' ? 'document' : 'session';
      return {
        id: str(inv.id),
        docType: str(inv.docType),
        party: str(inv.party),
        amount: num(inv.amountTotal) != null ? num(inv.amountTotal) : num(inv.amount),
        date: str(inv.docDate),
        status: kind
      };
    });

    /* 「已开发票」明细：保留完整票面字段，供筛选与预览使用 */
    var issuedInvoices = arr(obj(data).sessionInvoices).map(function (inv) {
      var o = obj(inv);
      var kind = str(o.poolKind) === 'document' ? 'document' : 'session';
      var items = arr(o.items);
      var product = str(o.product);
      if (!product && items.length) product = str(obj(items[0]).name);
      var total = num(o.amountTotal);
      var ex = num(o.amountExTax);
      var tax = num(o.taxAmount);
      if (ex == null && total != null && tax != null) ex = round2(total - tax);
      return {
        id: str(o.id) || str(o.invoiceDocId),
        invoiceDocId: str(o.invoiceDocId),
        docType: str(o.docType) || '增值税专用发票',
        party: str(o.party),
        partyTaxNo: str(o.partyTaxNo),
        product: product,
        qty: items.length ? num(obj(items[0]).qty) : null,
        unit: items.length ? str(obj(items[0]).unit) : '',
        amountExTax: ex,
        taxRate: str(o.taxRate),
        taxAmount: tax,
        amountTotal: total,
        date: str(o.docDate),
        draftNo: str(o.draftNo),
        contractId: str(o.contractId),
        source: kind,               // session | document
        items: items
      };
    }).sort(function (a, b) {
      if (a.date === b.date) return a.id < b.id ? 1 : -1;
      return a.date < b.date ? 1 : -1;   // 开票时间倒序
    });

    var model = {
      meta: meta,
      docs: docs,
      ledger: ledger,
      sales: sales,
      dict: dict,
      docById: docById,
      ledgerById: ledgerById,
      records: records,
      types: types,
      typeCount: typeCount,
      invDocs: invDocs,
      contractDocs: contractDocs,
      salesContractDocs: salesContractDocs,
      ysDocs: ysDocs,
      deliveryDocs: deliveryDocs,
      unaccepted: unaccepted,
      issuedRows: issuedRows,
      sessionInvoices: sessionInvoices,
      kpi: {
        pendingCount: sales.length - issuedRows.length,
        totalCount: sales.length,
        issuedCount: issuedRows.length,
        contractCount: contractDocs.length,
        invoiceCount: invDocs.length,
        salesTotal: round2(salesTotal),
        salesKnownCount: salesKnown
      },
      invoiceRows: sessionInvoices.concat(records.filter(function (r) { return isInvoiceType(r.docType); })),
      issuedInvoices: issuedInvoices
    };
    return model;
  }

  /* ==================================================================
   * 3. 开票状态与口径（由 data 现算，避免硬编码业务结论）
   * ================================================================== */

  var STATUS_PENDING = '待开票';
  var STATUS_EXPORT = '出口发票 0%（待开）';
  var STATUS_SUSPEND = '未验收暂缓';
  var STATUS_ISSUED = '已开具';
  var STATUS_REJECTED = '不通过';

  function salesStatus(row, unaccepted) {
    var r = obj(row);
    // 本会话已通过智能体「确认开具」的事项，由宿主把 issueStatus 写回销售明细行
    if (str(r.issueStatus)) return str(r.issueStatus);
    var region = str(r.region);
    var party = str(r.customer);
    var amount = num(r.amount);
    var suspended = arr(unaccepted).some(function (u) {
      if (str(u.party) !== party) return false;
      if (amount == null || u.amountExTax == null) return false;
      return Math.abs(u.amountExTax - amount) <= 1;
    });
    if (suspended) return STATUS_SUSPEND;
    if (region === '出口') return STATUS_EXPORT;
    return STATUS_PENDING;
  }

  function isIssued(row) {
    return salesStatus(row, []) === STATUS_ISSUED;
  }

  function exportCount(sales) {
    return arr(sales).filter(function (r) { return str(obj(r).region) === '出口'; }).length;
  }

  /* ==================================================================
   * 4. 应用装配
   * ================================================================== */

  function resolveContainer(container) {
    if (!container) return null;
    if (typeof container === 'string') {
      var owner = (typeof document !== 'undefined' && document) || null;
      return owner ? owner.querySelector(container) : null;
    }
    return container;
  }

  function createApp(container, data, ctx) {
    var doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
    var C = obj(ctx);
    var model = buildModel(data);
    var st = {
      view: VIEWS[0].key,
      ledger: { cat: '全部', kw: '', page: 1 },
      pending: { region: '全部', status: '全部' },
      invoices: { type: '全部', sort: 'none', page: 1 },
      issued: { page: 1 },
      workbenchTab: 'pending',
      draft: null,
      pickedRow: null
    };
    /** 「被驳回申请」列表的刷新器（切回该视图 / 修改信息后重绘） */
    var rejectedRefresher = null;

    /* ---------- 4.1 创建元素小工具 ---------- */
    function h(tag, cls, content) {
      var n = doc.createElement(tag);
      if (cls) n.className = cls;
      if (content != null) {
        if (typeof content === 'object' && content.nodeType === 1) n.appendChild(content);
        else n.textContent = str(content);
      }
      return n;
    }

    function add(parent) {
      for (var i = 1; i < arguments.length; i++) {
        var c = arguments[i];
        if (c) parent.appendChild(c);
      }
      return parent;
    }

    function clear(node) {
      if (!node) return node;
      while (node.firstChild) node.removeChild(node.firstChild);
      return node;
    }

    function button(label, cls, onClick) {
      var b = h('button', cls || 'pra-btn', label);
      b.setAttribute('type', 'button');
      if (onClick) b.addEventListener('click', onClick);
      return b;
    }

    function td(content, cls) {
      return h('td', cls || '', content);
    }

    function makeTable(headers) {
      var wrap = h('div', 'pra-tblwrap');
      var table = h('table', 'pra-tbl');
      var thead = h('thead');
      var tr = h('tr');
      arr(headers).forEach(function (hd) {
        var th = h('th', hd.cls || '', hd.label);
        if (hd.title) th.setAttribute('title', hd.title);
        tr.appendChild(th);
      });
      add(thead, tr);
      var tbody = h('tbody');
      add(table, thead, tbody);
      wrap.appendChild(table);
      return { wrap: wrap, table: table, tbody: tbody };
    }

    function emptyRow(tbody, colCount, msg) {
      var tr = h('tr');
      var cell = h('td', 'pra-empty', msg);
      cell.setAttribute('colspan', String(colCount));
      tr.appendChild(cell);
      tbody.appendChild(tr);
    }

    function pageHead(title, subtitle) {
      var ph = h('div', 'pra-pagehead');
      add(ph,
        h('h1', null, title),
        h('p', null, subtitle),
        h('span', 'pra-tag', text(model.meta.period, '2025 年 12 月'))
      );
      return ph;
    }

    function panel(title, note) {
      var p = h('section', 'pra-panel');
      var head = h('header');
      add(head, h('b', null, title));
      if (note) head.appendChild(h('em', null, note));
      p.appendChild(head);
      var body = h('div', 'pra-pb');
      p.appendChild(body);
      return { panel: p, body: body, head: head };
    }

    function callout(kind, content) {
      var c = h('div', 'pra-callout ' + (kind || 'info'));
      if (typeof content === 'string') c.textContent = content;
      else if (content) c.appendChild(content);
      return c;
    }

    function smallNote(t) {
      return h('div', 'pra-tnote', t);
    }

    /* ---------- 4.2 toast（无 ctx.toast 时用内置提示条） ---------- */
    var toastTimer = null;

    function toast(msg) {
      if (typeof C.toast === 'function') {
        try { C.toast(msg); return; } catch (e) { /* 退回内置提示 */ }
      }
      if (!toastEl) return;
      toastEl.textContent = str(msg);
      toastEl.className = 'pra-toast on';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.className = 'pra-toast';
      }, 3000);
    }

    /* ---------- 4.3 骨架 ----------
       宿主（index.html + boot.js 外壳）已自带顶部条与左侧菜单时，只渲染 6 个模块内容区，
       避免出现「双层导航」。判定顺序：ctx.chrome 显式指定 > 宿主 DOM 探测 > 默认自带。 */
    function hostHasChrome() {
      if (C.chrome === false) return true;
      if (C.chrome === true) return false;
      try {
        if (!doc || typeof doc.querySelector !== 'function') return false;
        return !!(doc.querySelector('#side') && doc.querySelector('.top'));
      } catch (e) {
        return false;
      }
    }

    var bare = hostHasChrome();
    var root = h('div', 'pra-root' + (bare ? ' pra-bare' : ''));
    var top = h('header', 'pra-top');

    top.innerHTML =
      '<div class="pra-brand">' +
      '<span class="pra-logo">衡</span>' +
      '<div><b>' + esc(text(model.meta.company, '华衡智造集团股份有限公司')) + '</b>' +
      '<em>增值税发票开具系统</em></div>' +
      '</div>' +
      '<div class="pra-sysname">增值税发票开具系统<i>实务基座</i></div>' +
      '<div class="pra-user">' +
      '<span>销售会计 / 开票岗</span>' +
      '<span>' + esc(text(model.meta.period, '2025-12')) + '</span>' +
      '<span>' + esc(text(model.meta.operator, '开票岗')) + '</span>' +
      '</div>';

    var bodyWrap = h('div', 'pra-body');
    var side = h('aside', 'pra-side');
    var mainEl = h('main', 'pra-main');

    var navBtns = [];
    if (!bare) {
      side.appendChild(h('h4', null, '功能菜单'));
      VIEWS.forEach(function (v, i) {
        var b = h('button', 'pra-navbtn' + (i === 0 ? ' on' : ''), v.name);
        b.setAttribute('type', 'button');
        b.setAttribute('data-v', v.key);
        b.addEventListener('click', function () { show(v.key); });
        navBtns.push(b);
        side.appendChild(b);
      });
      var sideNote = h('div', 'pra-side-note');
      sideNote.innerHTML = '<b>本系统不含智能体</b>系统只提供岗位实务操作；智能体的读取、校验、填写与回写能力，由「智能体」区域提供。';
      side.appendChild(sideNote);
    }

    var viewEls = VIEWS.map(function (v, i) {
      var sec = h('section', 'pra-view' + (i === 0 ? ' on' : ''));
      sec.setAttribute('data-view', v.key);
      mainEl.appendChild(sec);
      return sec;
    });

    if (bare) add(bodyWrap, mainEl);
    else add(bodyWrap, side, mainEl);
    if (bare) add(root, bodyWrap);
    else add(root, top, bodyWrap);

    /* 原件摘要面板（data.documents 中同 id 的字段） */
    var modal = h('div', 'pra-modal');
    var modalCard = h('div', 'pra-modal-card');
    var modalHead = h('header', 'pra-modal-head');
    var modalTitle = h('b', null, '原件摘要');
    var modalClose = button('关闭', 'pra-btn pra-btn-ghost', function () { closeModal(); });
    add(modalHead, modalTitle, h('em', null, '字段与来源位置'), modalClose);
    var modalBody = h('div', 'pra-modal-body');
    add(modalCard, modalHead, modalBody);
    modal.appendChild(modalCard);
    modal.addEventListener('click', function (e) {
      if (e.target === modal) closeModal();
    });
    root.appendChild(modal);

    var toastEl = h('div', 'pra-toast');
    root.appendChild(toastEl);

    function openModal(title) {
      modalTitle.textContent = str(title || '原件摘要');
      modal.className = 'pra-modal on';
    }

    function closeModal() {
      modal.className = 'pra-modal';
    }

    /* ---------- 4.4 视图切换 ---------- */
    function viewIndex(name) {
      var key = str(name).trim();
      if (!key) return -1;
      for (var i = 0; i < VIEWS.length; i++) {
        if (VIEWS[i].key === key || VIEWS[i].name === key) return i;
        if (arr(VIEWS[i].alias).indexOf(key) >= 0) return i;
        if (arr(VIEWS[i].alias).indexOf(key.toLowerCase()) >= 0) return i;
      }
      if (/^\d+$/.test(key)) {
        var n = Number(key);
        if (n >= 0 && n < VIEWS.length) return n;
      }
      return -1;
    }

    function show(name) {
      var i = viewIndex(name);
      if (i < 0) return api;
      st.view = VIEWS[i].key;
      navBtns.forEach(function (b, j) { b.className = 'pra-navbtn' + (j === i ? ' on' : ''); });
      viewEls.forEach(function (v, j) { v.className = 'pra-view' + (j === i ? ' on' : ''); });
      if (mainEl) mainEl.scrollTop = 0;
      /* 被驳回申请的数据在宿主侧随时变化，切回该视图时重绘 */
      if (st.view === 'rejected' && typeof rejectedRefresher === 'function') {
        try { rejectedRefresher(); } catch (e) { /* 刷新失败不影响切换 */ }
      }
      /* 通知宿主同步左侧导航高亮（看板任务卡、内部跳转都走这里） */
      if (typeof C.onShow === 'function') {
        try { C.onShow(st.view); } catch (e) { /* 宿主同步失败不影响视图切换 */ }
      }
      return api;
    }

    /* ---------- 4.5 把本行交给智能体 ---------- */
    function relatedDocsFor(row) {
      var r = obj(row);
      var party = str(r.customer);
      var amount = num(r.amount);
      var product = str(r.product);
      var out = [], seen = {};

      function push(d) {
        if (!d || !str(d.id) || seen[d.id]) return;
        seen[d.id] = 1;
        out.push(d);
      }

      function amountClose(d) {
        var lr = model.ledgerById[d.id];
        var amt = docExTax(d, lr ? lr.amount : null);
        if (amt == null || amount == null) return false;
        return Math.abs(amt - amount) <= 1;
      }

      /* 先按「同一对方单位 + 金额吻合」精确匹配；没有精确命中时退化为「同一对方单位 + 同一产品」 */
      function collectByAmount(pool) {
        var hit = pool.filter(function (d) {
          return str(d.party) === party && amountClose(d);
        });
        return hit;
      }

      function collectByProduct(pool) {
        return pool.filter(function (d) {
          return str(d.party) === party && itemsHaveProduct(d, product);
        });
      }

      var contracts = collectByAmount(model.salesContractDocs);
      if (!contracts.length) contracts = collectByProduct(model.salesContractDocs);
      contracts.forEach(push);

      var accepts = collectByAmount(model.ysDocs);
      if (!accepts.length) accepts = collectByProduct(model.ysDocs);
      accepts.forEach(push);

      /* 出库单金额为成本口径，按产品 + 对方单位匹配 */
      collectByProduct(model.deliveryDocs).forEach(push);

      collectByAmount(model.invDocs).forEach(push);
      return out;
    }

    function handToAgent(row, viewName) {
      var r = obj(row);
      var status = salesStatus(r, model.unaccepted);
      var docs = relatedDocsFor(r);
      var filter = {
        origin: 'practice',
        view: viewName,
        row: {
          product: str(r.product),
          date: str(r.date),
          customer: str(r.customer),
          qty: num(r.qty),
          unitPrice: num(r.unitPrice),
          amount: num(r.amount),
          region: str(r.region)
        },
        status: status,
        documentIds: docs.map(function (d) { return str(d.id); }),
        documents: docs
      };

      if (typeof C.goAgent !== 'function') {
        toast('未检测到智能体入口（ctx.goAgent 未注入），已生成筛选条件：' +
          text(r.product) + ' · ' + text(r.customer));
        return filter;
      }
      try {
        C.goAgent(filter);
      } catch (e) {
        toast('调用智能体失败：' + (e && e.message ? e.message : str(e)));
      }
      return filter;
    }

    /* ==================================================================
     * 5. 模块一：工作台预览（数据任务看板）
     *   ① 概览卡：原有 4 张 + 已开具 + 开票完成率，数值全部由 data 现算
     *   ② 任务看板：4 列（待开票 / 未验收暂缓 / 已开具 / 待确认草稿）
     *   ③ 模块任务卡：6 张，整卡可点，一键跳到对应模块
     *   ④ 口径提示：沿用 workbenchNote()，文案不变
     * ================================================================== */
    function buildWorkbench(viewSec) {
      var k = model.kpi;

      /* ---------- 5.0 看板口径：全部由 model 现算，不硬编码业务数值 ---------- */
      var pendingRows = model.sales.filter(function (row) { return !isIssued(row); });
      var pendingTotal = 0;
      pendingRows.forEach(function (row) {
        var a = num(obj(row).amount);
        if (a != null) pendingTotal += a;
      });
      var invoiceTotal = 0;
      model.invoiceRows.forEach(function (r) {
        var a = num(r.amount);
        if (a != null) invoiceTotal += a;
      });
      pendingTotal = round2(pendingTotal);
      invoiceTotal = round2(invoiceTotal);

      /** 完成率：保留 1 位小数 + %；总数为 0 时显示「—」 */
      function pctText(part, total) {
        if (!total) return '—';
        return (part / total * 100).toFixed(1) + '%';
      }

      function draftNoText() {
        return st.draft ? text(obj(st.draft).draftNo, '未编号') : '无';
      }

      /** 已开具事项的发票号：优先销售明细行回写的 invoiceNo，缺失时按「购买方 + 金额」回查会话发票 */
      function issuedInvoiceNo(row) {
        var r = obj(row);
        var no = str(r.invoiceNo);
        if (no) return no;
        var amt = num(r.amount);
        var hit = model.sessionInvoices.filter(function (inv) {
          if (str(inv.party) !== str(r.customer)) return false;
          var a = num(inv.amount);
          if (a == null || amt == null) return false;
          return Math.abs(a - amt) <= 1 || Math.abs(a - round2(amt * 1.13)) <= 1;
        })[0];
        return hit ? text(hit.id, '—') : '—';
      }

      /* ---------- 5.1 概览卡（5 张，「本月销售额」已移除） ---------- */
      var kpis = h('div', 'pra-kpis pra-kpis-five');

      function kpiCard(value, label, tip) {
        var c = h('div', 'pra-kpi');
        add(c, h('b', null, value), h('span', null, label));
        if (tip) c.setAttribute('title', tip);
        kpis.appendChild(c);
        return c;
      }

      kpiCard(fmtInt(k.pendingCount), '待开票事项', '本月销售明细 ' + fmtInt(k.totalCount) + ' 项（含出口 ' + fmtInt(exportCount(model.sales)) + ' 项）' +
        (k.issuedCount ? '，其中 ' + fmtInt(k.issuedCount) + ' 项已开具并从待开票清单移除' : ''));
      kpiCard(fmtInt(k.contractCount), '合同样本', 'data.documents 中类型含「合同」的单据');
      kpiCard(fmtInt(k.invoiceCount), '发票样本', 'data.documents 中类型含「发票」的单据');
      kpiCard(fmtInt(k.issuedCount), '已开具', '销售明细行 issueStatus = 已开具 的事项（本会话开具或数据集同步回写）');
      kpiCard(pctText(k.issuedCount, k.totalCount), '开票完成率', '已开具 ' + fmtInt(k.issuedCount) + ' / 本月销售明细 ' + fmtInt(k.totalCount) + ' 项');

      /* ---------- 5.2 任务看板：同一框体内，顶部切换四种状态 ---------- */
      var boardBox = h('div', 'pra-board-box');

      var boardHead = h('div', 'pra-board-head');
      add(boardHead,
        h('b', null, '任务看板'),
        h('span', null, '顶部切换四种状态，一屏看清本月任务分布')
      );

      var boardTabs = h('div', 'pra-board-tabs');
      boardBox.appendChild(boardTabs);
      var panes = [];

      function addPane(key, label, countText) {
        var btn = h('button', 'pra-board-tab');
        btn.setAttribute('type', 'button');
        var badge = h('em', null, countText);
        add(btn, h('span', 'pra-board-tab-label', label), badge);
        boardTabs.appendChild(btn);
        var pane = h('div', 'pra-board-pane');
        boardBox.appendChild(pane);
        var item = { key: key, btn: btn, pane: pane, badge: badge };
        panes.push(item);
        btn.addEventListener('click', function () { activate(key); });
        return item;
      }

      function activate(key) {
        st.workbenchTab = key;
        panes.forEach(function (p) {
          p.btn.className = 'pra-board-tab' + (p.key === key ? ' on' : '');
          p.pane.className = 'pra-board-pane' + (p.key === key ? ' on' : '');
        });
      }

      function boardEmpty(host, msg) {
        host.appendChild(h('div', 'pra-board-empty', msg));
      }

      /* 列 1 / 待开票：前 5 条，超出时给「还有 N 项」直达待开票清单 */
      var pane1 = addPane('pending', '待开票', fmtInt(k.pendingCount) + ' 项');
      if (!model.sales.length) {
        boardEmpty(pane1.pane, 'data.tables.sales 为空，无待开票事项');
      } else if (!pendingRows.length) {
        boardEmpty(pane1.pane, '本月待开票事项已全部开具');
      } else {
        var list1 = h('ul', 'pra-board-list');
        pendingRows.slice(0, 5).forEach(function (row, i) {
          var r = obj(row);
          var li = h('li', 'pra-board-item');
          li.setAttribute('title', text(r.product) + ' · ' + text(r.customer) +
            ' · ' + fmtMoney(r.amount) + ' 元（不含税）');
          add(li,
            h('span', 'pra-board-no', String(i + 1)),
            h('b', 'pra-board-name', text(r.product)),
            h('span', 'pra-board-party', text(r.customer)),
            h('span', 'pra-board-amt', fmtWan(r.amount))
          );
          list1.appendChild(li);
        });
        pane1.pane.appendChild(list1);
        var foot1 = h('div', 'pra-board-foot');
        if (pendingRows.length > 5) {
          foot1.appendChild(button('还有 ' + fmtInt(pendingRows.length - 5) + ' 项 →',
            'pra-btn pra-btn-sm', function () { show('pending'); }));
        }
        foot1.appendChild(button('去处理', 'pra-btn pra-btn-sm pra-btn-ghost', function () { show('pending'); }));
        pane1.pane.appendChild(foot1);
      }

      /* 列 2 / 未验收暂缓 */
      var pane2 = addPane('suspend', '未验收暂缓', fmtInt(model.unaccepted.length) + ' 份');
      if (!model.unaccepted.length) {
        boardEmpty(pane2.pane, '本月无未验收事项');
      } else {
        var list2 = h('ul', 'pra-board-list');
        model.unaccepted.forEach(function (u) {
          var o = obj(u);
          var li = h('li', 'pra-board-item warn');
          li.setAttribute('title', '合同 ' + text(o.id) + ' 未匹配到验收单，暂缓开票');
          add(li,
            h('b', 'pra-board-name', text(o.id)),
            h('span', 'pra-board-qty', o.qty == null ? '数量 —' : fmtInt(o.qty) + ' 台'),
            h('span', 'pra-board-party', text(o.party)),
            h('span', 'pra-board-amt', fmtWan(o.amountExTax))
          );
          list2.appendChild(li);
        });
        pane2.pane.appendChild(list2);
        pane2.pane.appendChild(smallNote('未匹配到验收单的合同不计入待开票清单'));
      }

      /* 列 3 / 已开具 */
      var pane3 = addPane('issued', '已开具', fmtInt(k.issuedCount) + ' 张');
      if (!model.issuedRows.length) {
        boardEmpty(pane3.pane, '暂无已开具事项');
      } else {
        var list3 = h('ul', 'pra-board-list');
        model.issuedRows.slice(0, 5).forEach(function (row, i) {
          var r = obj(row);
          var li = h('li', 'pra-board-item done');
          li.setAttribute('title', text(r.product) + ' · ' + text(r.customer) + ' · 发票号 ' + issuedInvoiceNo(r));
          add(li,
            h('span', 'pra-board-no', String(i + 1)),
            h('b', 'pra-board-name', text(r.product)),
            h('span', 'pra-board-party', text(r.customer)),
            h('span', 'pra-issued-no', issuedInvoiceNo(r))
          );
          list3.appendChild(li);
        });
        pane3.pane.appendChild(list3);
        if (model.issuedRows.length > 5) {
          var foot3 = h('div', 'pra-board-foot');
          foot3.appendChild(button('查看全部 ' + fmtInt(model.issuedRows.length) + ' 张 →',
            'pra-btn pra-btn-sm', function () { show('issued'); }));
          pane3.pane.appendChild(foot3);
        }
      }

      /* 列 4 / 待确认草稿 */
      var pane4 = addPane('draft', '待确认草稿', st.draft ? '1 份' : '0 份');

      function renderDraftCol() {
        clear(pane4.pane);
        pane4.badge.textContent = st.draft ? '1 份' : '0 份';
        if (!st.draft) {
          boardEmpty(pane4.pane, '当前没有待确认草稿');
          pane4.pane.appendChild(button('去新建开票业务', 'pra-btn pra-btn-gold pra-btn-sm', function () {
            show('newbusiness');
          }));
          return;
        }
        var d = obj(st.draft);
        var li = h('li', 'pra-board-item draft');
        add(li,
          h('b', 'pra-board-name', text(d.draftNo, '未编号')),
          h('span', 'pra-board-party', text(obj(d.buyer).name)),
          h('span', 'pra-board-amt', fmtMoney(d.amountTotal) + ' 元'),
          h('span', 'pra-board-state', text(d.statusLabel, text(d.status, '待人工确认')))
        );
        var list4 = h('ul', 'pra-board-list');
        list4.appendChild(li);
        pane4.pane.appendChild(list4);
        pane4.pane.appendChild(button('去核对', 'pra-btn pra-btn-gold pra-btn-sm', function () { show('issue'); }));
      }
      renderDraftCol();

      activate(st.workbenchTab || 'pending');

      /* ---------- 5.3 模块任务卡（6 张，整卡可点） ---------- */
      var taskHead = h('div', 'pra-board-head');
      add(taskHead,
        h('b', null, '模块任务卡'),
        h('span', null, '6 个模块的本月数据指标，点击整卡进入对应模块')
      );

      var taskGrid = h('div', 'pra-taskgrid');

      function navTo(key) {
        return function () { show(key); };
      }

      /** 智能审核工作区不属于实务系统视图，必须走宿主导航；缺失时逐级降级 */
      function goAgentWorkspace() {
        if (typeof C.goView === 'function') {
          try { C.goView('agent', 'workspace'); return; } catch (e) { /* 继续降级 */ }
        }
        if (typeof C.goAgent === 'function') {
          try { C.goAgent({}); return; } catch (e2) { /* 继续降级 */ }
        }
        toast('智能审核工作区入口未就绪（ctx.goView / ctx.goAgent 均未注入）');
      }

      function taskCard(goKey, title, desc, onClick) {
        var b = h('button', 'pra-taskcard');
        b.setAttribute('type', 'button');
        b.setAttribute('data-go', goKey);
        var descNode = h('span', 'pra-taskcard-desc', desc);
        add(b,
          h('span', 'pra-taskcard-title', title),
          descNode,
          h('span', 'pra-taskcard-go', '进入 →')
        );
        b.addEventListener('click', onClick);
        taskGrid.appendChild(b);
        return descNode;
      }

      taskCard('newbusiness', '新建开票业务',
        '待开票 ' + fmtInt(k.pendingCount) + ' 项 · 可上传 .htm/.html 单据原件与 .json 结构化数据',
        navTo('newbusiness'));
      taskCard('pending', '待开票清单',
        '待开票 ' + fmtInt(k.pendingCount) + ' 项 · 合计金额 ' + fmtMoney(pendingTotal) + ' 元',
        navTo('pending'));
      taskCard('ledger', '单据台账',
        '共 ' + fmtInt(model.records.length) + ' 张单据（合同 ' + fmtInt(model.contractDocs.length) +
        ' / 验收单 ' + fmtInt(model.ysDocs.length) + ' / 出库单 ' + fmtInt(model.deliveryDocs.length) +
        ' / 发票 ' + fmtInt(model.invDocs.length) + '）',
        navTo('ledger'));
      var issueDesc = taskCard('issue', '发票开具',
        '当前草稿：' + draftNoText(),
        navTo('issue'));
      taskCard('invoices', '开票台账',
        fmtInt(model.invoiceRows.length) + ' 张 · 金额合计 ' + fmtMoney(invoiceTotal) + ' 元（含本会话/数据集已开具）',
        navTo('invoices'));
      taskCard('agent', '智能审核工作区',
        '上传单据 → 识别 → 审核 → 草稿',
        goAgentWorkspace);

      /* ---------- 5.4 口径提示（放到底部，不再压住看板与任务卡） ---------- */
      var noteBox = h('div', 'pra-board-note');
      noteBox.appendChild(callout('gold', workbenchNote()));

      /* 看板是构建时快照；草稿在会话中可能被智能体回填，悬停/聚焦时用最新 st.draft 校正 */
      function currentDraftSig() {
        if (!st.draft) return '';
        var d = obj(st.draft);
        return str(d.draftNo) + '/' + str(d.statusLabel) + '/' + str(d.status) + '/' + str(d.amountTotal);
      }

      var draftSig = currentDraftSig();

      function syncDraft() {
        var sig = currentDraftSig();
        if (sig === draftSig) return;
        draftSig = sig;
        renderDraftCol();
        if (issueDesc) issueDesc.textContent = '当前草稿：' + draftNoText();
      }
      viewSec.addEventListener('mouseenter', syncDraft);
      viewSec.addEventListener('focusin', syncDraft);

      add(viewSec,
        pageHead('工作台预览', '本月开票任务看板与数据分布'),
        kpis,
        boardHead,
        boardBox,
        taskHead,
        taskGrid,
        noteBox
      );
    }

    function statusChip(status) {
      var cls = 'pra-status';
      if (status === STATUS_SUSPEND) cls += ' bad';
      else if (status === STATUS_EXPORT) cls += ' warn';
      else if (status === STATUS_ISSUED) cls += ' done';
      else if (str(status).indexOf(STATUS_ISSUED) === 0) cls += ' done';
      else cls += ' ok';
      return h('span', cls, status);
    }

    function statusCell(status) {
      var cell = h('td');
      cell.appendChild(statusChip(status));
      return cell;
    }

    function actionCell(node) {
      var cell = h('td', 'pra-op');
      if (node) cell.appendChild(node);
      return cell;
    }

    /** 工作台口径提示：文案贴近参照系统，数字与合同号由 data 现算 */
    function workbenchNote() {
      var parts = [];
      parts.push('开票前必须完成合同、验收、出库三单核对；出口发票适用 0% 税率，内销专票 13%。');
      if (model.unaccepted.length) {
        var first = model.unaccepted[0];
        var extra = model.unaccepted.length > 1 ? '（等 ' + model.unaccepted.length + ' 份合同）' : '';
        if (first.qty != null) {
          parts.push('合同 ' + first.id + extra + ' 的 ' + fmtInt(first.qty) + ' 台设备未验收，暂缓开票；');
        } else {
          parts.push('合同 ' + first.id + extra + ' 存在未验收标的，暂缓开票；');
        }
        parts.push('智能体若只读取合同、不读取验收与出库，会把未验收设备一并开票。');
      } else {
        parts.push('智能体若只读取合同、不读取验收与出库，会把未验收设备一并开票。');
      }
      return parts.join('');
    }

    /* ==================================================================
     * 6. 模块四：单据台账（175 条，分类 + 搜索 + 分页 25/页）
     * ================================================================== */
    function buildLedger(viewSec) {
      var p = panel('单据清单', '销售合同、验收单、出库单与发票原件');
      var toolbar = h('div', 'pra-toolbar');

      var chips = h('div', 'pra-chips');
      var chipNodes = [];
      function makeChip(label, value) {
        var b = h('button', 'pra-chip', label);
        b.setAttribute('type', 'button');
        b.addEventListener('click', function () {
          st.ledger.cat = value;
          st.ledger.page = 1;
          syncChips();
          renderLedger();
        });
        chipNodes.push({ node: b, value: value });
        chips.appendChild(b);
        return b;
      }
      makeChip('全部 ' + fmtInt(model.records.length), '全部');
      model.types.forEach(function (ty) {
        makeChip(ty + ' ' + fmtInt(model.typeCount[ty] || 0), ty);
      });

      var searchWrap = h('label', 'pra-search');
      var searchLabel = h('span', null, '关键词');
      var searchInput = h('input', 'pra-input');
      searchInput.setAttribute('type', 'search');
      searchInput.setAttribute('placeholder', '单据编号 / 摘要 / 对方单位');
      searchInput.addEventListener('input', function () {
        st.ledger.kw = str(searchInput.value);
        st.ledger.page = 1;
        renderLedger();
      });
      add(searchWrap, searchLabel, searchInput);

      add(toolbar, chips, searchWrap);

      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '单据编号' },
        { label: '单据类型' },
        { label: '摘要' },
        { label: '日期' },
        { label: '对方单位' },
        { label: '金额（元）', cls: 'r' },
        { label: '操作' }
      ]);

      var foot = h('div', 'pra-pager');
      var info = h('div', 'pra-tnote', '');
      var btnPrev = button('上一页', 'pra-btn pra-btn-sm', function () {
        if (st.ledger.page > 1) { st.ledger.page--; renderLedger(); }
      });
      var btnNext = button('下一页', 'pra-btn pra-btn-sm', function () {
        var total = filterRecords().length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (st.ledger.page < pages) { st.ledger.page++; renderLedger(); }
      });
      add(foot, info, btnPrev, btnNext);

      function syncChips() {
        chipNodes.forEach(function (c) {
          c.node.className = 'pra-chip' + (c.value === st.ledger.cat ? ' on' : '');
        });
      }

      function filterRecords() {
        var kw = str(st.ledger.kw).trim().toLowerCase();
        return model.records.filter(function (r) {
          if (st.ledger.cat !== '全部' && r.docType !== st.ledger.cat) return false;
          if (!kw) return true;
          var hay = (r.id + ' ' + r.summary + ' ' + r.party + ' ' + r.docType + ' ' + r.date).toLowerCase();
          return hay.indexOf(kw) >= 0;
        });
      }

      function renderLedger() {
        var list = filterRecords();
        var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
        if (st.ledger.page > pages) st.ledger.page = pages;
        if (st.ledger.page < 1) st.ledger.page = 1;
        var start = (st.ledger.page - 1) * PAGE_SIZE;
        var slice = list.slice(start, start + PAGE_SIZE);

        clear(t.tbody);
        if (!slice.length) {
          emptyRow(t.tbody, 8, '没有匹配的单据，试试清空关键词或切换分类');
        } else {
          slice.forEach(function (r) {
            var tr = h('tr');
            var op = button('查看原件摘要', 'pra-btn pra-btn-sm', function () { openDocSummary(r.id); });
            add(tr,
              td(fmtInt(r.idx), 'num'),
              td(text(r.id), 'first mono'),
              td(typeTag(r.docType)),
              td(text(r.summary)),
              td(text(r.date)),
              td(text(r.party)),
              td(fmtMoney(r.amount), 'num'),
              actionCell(op)
            );
            t.tbody.appendChild(tr);
          });
        }

        var shownFrom = list.length ? start + 1 : 0;
        var shownTo = Math.min(start + PAGE_SIZE, list.length);
        info.textContent = '共 ' + fmtInt(model.records.length) + ' 条' +
          (st.ledger.cat !== '全部' ? '（当前分类 ' + fmtInt(list.length) + ' 条）' : '') +
          (str(st.ledger.kw).trim() ? '（关键词命中 ' + fmtInt(list.length) + ' 条）' : '') +
          ' · 每页 ' + PAGE_SIZE + ' 条 · 当前第 ' + st.ledger.page + '/' + pages + ' 页（显示第 ' +
          shownFrom + '–' + shownTo + ' 条）';
        btnPrev.disabled = st.ledger.page <= 1;
        btnNext.disabled = st.ledger.page >= pages;
      }

      add(p.body, toolbar, t.wrap, foot);
      viewSec.appendChild(pageHead('单据台账', '合同、验收单、出库单与发票原件'));
      viewSec.appendChild(p.panel);

      syncChips();
      renderLedger();
    }

    function typeTag(docType) {
      var t = str(docType);
      var kind = 'pra-doc-tag';
      if (includes(t, '合同')) kind += ' contract';
      else if (includes(t, '验收')) kind += ' accept';
      else if (includes(t, '出库')) kind += ' out';
      else if (includes(t, '发票')) kind += ' invoice';
      else if (includes(t, '缴款书')) kind += ' customs';
      return h('span', kind, t || '—');
    }

    /* ---------- 6.1 原件摘要面板 ---------- */
    function fieldRow(label, value, extra) {
      var tr = h('tr');
      add(tr, td(label, 'pra-f-label'), td(text(value)), td(extra || '—', 'pra-f-loc'));
      return tr;
    }

    function openDocSummary(docId) {
      var id = str(docId);
      var d = model.docById[id];
      var ledgerRow = model.ledgerById[id];
      clear(modalBody);

      if (!d) {
        add(modalBody,
          callout('info', 'data.documents 中未找到编号 ' + id + ' 的解析结果。'),
          summaryMetaBlock(null, ledgerRow),
          smallNote('提示：该单据只在台账中登记，没有字段级解析结果。')
        );
        openModal('原件摘要 · ' + id);
        return;
      }

      var docHead = h('div', 'pra-dochead');
      var left = h('div', 'pra-dochead-left');
      add(left, h('b', null, text(d.docType)), h('span', null, str(d.id) + ' · ' + text(d.docDate)));
      var amt = h('div', 'pra-amt', fmtMoney(d.amountTotal != null ? d.amountTotal : (ledgerRow ? ledgerRow.amount : null)));
      add(docHead, left, amt);
      modalBody.appendChild(docHead);

      modalBody.appendChild(summaryMetaBlock(d, ledgerRow));

      var fields = arr(d.fields);
      var fHead = h('div', 'pra-lh', '字段与来源位置（fields[]，共 ' + fmtInt(fields.length) + ' 项）');
      modalBody.appendChild(fHead);
      if (fields.length) {
        var ft = makeTable([
          { label: '字段' },
          { label: '原文值' },
          { label: '来源位置（loc）' },
          { label: '抽取方式' }
        ]);
        fields.forEach(function (f) {
          var o = obj(f);
          var tr = h('tr');
          add(tr,
            td(text(o.label, text(o.key)), 'pra-f-label'),
            td(text(o.value)),
            td(text(o.loc), 'pra-f-loc'),
            td(text(o.field_source, '—'), 'pra-f-src')
          );
          ft.tbody.appendChild(tr);
        });
        modalBody.appendChild(ft.wrap);
      } else {
        modalBody.appendChild(callout('info', '该单据未提供字段级解析结果（fields 为空）。'));
      }

      var items = arr(d.items);
      if (items.length) {
        modalBody.appendChild(h('div', 'pra-lh', '明细行（items[]，共 ' + fmtInt(items.length) + ' 行）'));
        var it = makeTable([
          { label: '名称' },
          { label: '规格' },
          { label: '单位' },
          { label: '数量', cls: 'r' },
          { label: '单价', cls: 'r' },
          { label: '金额', cls: 'r' },
          { label: '税率' },
          { label: '税额', cls: 'r' },
          { label: '来源' }
        ]);
        items.forEach(function (i0) {
          var o = obj(i0);
          var tr = h('tr');
          add(tr,
            td(text(o.name), 'first'),
            td(text(o.spec)),
            td(text(o.unit)),
            td(fmtInt(o.qty), 'num'),
            td(fmtMoney(o.unitPrice), 'num'),
            td(fmtMoney(o.amount), 'num'),
            td(o.taxRate == null ? '—' : fmtRate(o.taxRate)),
            td(fmtMoney(o.taxAmount), 'num'),
            td(text(o.loc, '—'), 'pra-f-loc')
          );
          it.tbody.appendChild(tr);
        });
        modalBody.appendChild(it.wrap);
      }

      var warns = arr(d.parseWarnings);
      if (warns.length) {
        modalBody.appendChild(h('div', 'pra-lh', '解析告警'));
        var ul = h('ul', 'pra-warns');
        warns.forEach(function (w) { ul.appendChild(h('li', null, str(w))); });
        modalBody.appendChild(ul);
      }

      modalBody.appendChild(smallNote(
        '原件文件：' + text(d.file) + ' · 原文文本 ' + fmtInt(d.textLen) + ' 字' +
        (d.partyRole ? ' · 对方角色：' + d.partyRole : '')
      ));

      openModal('原件摘要 · ' + str(d.id) + ' · ' + text(d.docType));
    }

    function summaryMetaBlock(d, ledgerRow) {
      var t = makeTable([
        { label: '项目' },
        { label: '内容' },
        { label: '说明' }
      ]);
      var docDate = d ? d.docDate : (ledgerRow ? ledgerRow.date : null);
      var party = d ? d.party : (ledgerRow ? ledgerRow.party : null);
      var docType = d ? d.docType : (ledgerRow ? ledgerRow.docType : null);
      var title = d ? d.title : (ledgerRow ? ledgerRow.summary : null);
      var file = d ? d.file : (ledgerRow ? ledgerRow.file : null);
      var amountTotal = d ? d.amountTotal : (ledgerRow ? ledgerRow.amount : null);

      t.tbody.appendChild(fieldRow('单据编号', d ? d.id : (ledgerRow ? ledgerRow.id : '—'), '台账与原件一致'));
      t.tbody.appendChild(fieldRow('单据类型', docType, text(title)));
      t.tbody.appendChild(fieldRow('业务日期', docDate, 'date'));
      t.tbody.appendChild(fieldRow('对方单位', party, d && d.partyRole ? d.partyRole : '往来单位'));
      if (d && d.partyTaxNo) t.tbody.appendChild(fieldRow('对方纳税人识别号', d.partyTaxNo, '票头区'));
      if (d && d.selfName) t.tbody.appendChild(fieldRow('本单位', d.selfName, d.selfTaxNo || ''));
      t.tbody.appendChild(fieldRow('价税合计 / 业务金额', fmtMoney(amountTotal), '金额（元）'));
      if (d && d.amountExTax != null) t.tbody.appendChild(fieldRow('不含税金额', fmtMoney(d.amountExTax), '金额（元）'));
      if (d && d.taxAmount != null) t.tbody.appendChild(fieldRow('税额', fmtMoney(d.taxAmount), d.taxRate ? '税率 ' + fmtRate(d.taxRate) : '税额'));
      if (d && d.invoiceNo) t.tbody.appendChild(fieldRow('发票号码', d.invoiceNo, d.invoiceCode ? '发票代码 ' + d.invoiceCode : '票头区'));
      if (d && d.contractNo) t.tbody.appendChild(fieldRow('关联合同', d.contractNo, '合同编号'));
      if (d && d.remark) t.tbody.appendChild(fieldRow('备注', d.remark, '备注区'));
      if (file) t.tbody.appendChild(fieldRow('原件文件', file, '05-单据原件'));
      return t.wrap;
    }

    /* ==================================================================
     * 6.5 模块二：新建开票业务（上传单据 / 选择待开票事项的唯一入口）
     * ================================================================== */
    function buildNewBusiness(viewSec) {
      var p = panel('第一步：上传业务单据', '支持 .html/.htm 单据原件、.json 结构化数据；图片与 PDF 需 OCR，暂以人工补充');

      var up = h('div', 'pra-upload');
      var upIcon = h('span', 'pra-upload-icon', '＋');
      var upMain = h('div', 'pra-upload-main');
      add(upMain,
        h('b', null, '点击上传，或把单据拖到智能体工作区'),
        h('span', null, '一次可传多份：销售合同 + 验收单 + 出库单 + 开票申请单')
      );
      var upBtn = button('上传单据', 'pra-btn pra-btn-gold pra-btn-lg', function () {
        if (typeof C.openUploader === 'function') {
          try { C.openUploader(); return; } catch (e) { /* 落到下方提示 */ }
        }
        toast('智能体上传区未就绪，请到左侧「智能审核工作区」上传');
      });
      add(up, upIcon, upMain, upBtn);
      p.body.appendChild(up);

      p.body.appendChild(callout('info',
        '上传后系统会识别单据类型、抽取字段并校验一致性；审核通过才会生成开票草稿，草稿需人工二次确认后才写入开票台账。'));

      var p2 = panel('第二步：或从本月待开票清单中选择一项', '共 ' + fmtInt(model.kpi.pendingCount) + ' 项待开票');
      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '产品 / 服务' },
        { label: '客户' },
        { label: '数量', cls: 'r' },
        { label: '金额（元）', cls: 'r', title: '不含税金额' },
        { label: '状态' },
        { label: '操作' }
      ]);

      var rows = model.sales.filter(function (row) { return !isIssued(row); });
      if (!rows.length) {
        emptyRow(t.tbody, 7, '本月待开票事项已全部处理，可上传新的业务单据');
      } else {
        rows.forEach(function (row, i) {
          var r = obj(row);
          var status = salesStatus(r, model.unaccepted);
          var tr = h('tr');
          add(tr,
            td(String(i + 1), 'num'),
            td(text(r.product), 'first'),
            td(text(r.customer)),
            td(fmtInt(r.qty), 'num'),
            td(fmtMoney(r.amount), 'num'),
            statusCell(status),
            actionCell(button('选择并审核', 'pra-btn pra-btn-sm', (function (rr) {
              return function () { handToAgent(rr, '新建开票业务'); };
            })(r)))
          );
          t.tbody.appendChild(tr);
        });
      }
      p2.body.appendChild(t.wrap);
      p2.body.appendChild(smallNote('选择后自动带入该事项的销售合同、验收单、出库单，跳转智能体工作区执行审核。'));

      viewSec.appendChild(pageHead('新建开票业务', '上传单据或选择事项 → 智能审核 → 生成开票草稿'));
      viewSec.appendChild(p.panel);
      viewSec.appendChild(p2.panel);
    }

    /* ==================================================================
     * 7.2 模块：被驳回申请（查看原因 / 补充单据 / 修改信息 / 重新审核）
     * ================================================================== */
    function buildRejected(viewSec) {
      var p = panel('被驳回申请', '审核不通过 / 暂不开票的申请，可查看原因、补充单据、修改信息后重新审核');
      p.body.appendChild(callout('info',
        '被驳回不等于作废：补齐缺失单据（如验收单）或修正信息后可重新提交，审核通过即生成开票草稿。' +
        '缺少验收单等证据、控制权未转移的事项同样列为「暂不开票」，一并在这里处理。'));
      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '申请 / 合同编号' },
        { label: '来源' },
        { label: '结论' },
        { label: '客户名称' },
        { label: '产品 / 服务' },
        { label: '申请金额', cls: 'r' },
        { label: '时间' },
        { label: '主要问题' },
        { label: '操作' }
      ]);
      var summary = smallNote('');

      /** 已审核驳回 + 数据侧暂不开票（缺单据）合并为一张待处理清单 */
      function listRejected() {
        var out = [];
        var audited = [];
        try {
          if (typeof C.getRejected === 'function') audited = arr(C.getRejected());
        } catch (e) { audited = []; }
        var auditedDocs = {};
        audited.forEach(function (rec) {
          var r = obj(rec);
          arr(r.documents).forEach(function (d) { auditedDocs[str(obj(d).id)] = 1; });
          out.push({ kind: 'audit', rec: r });
        });
        arr(model.unaccepted).forEach(function (u) {
          var o = obj(u);
          // 已通过智能体审核过的合同不重复列出（审核记录更有信息量）
          if (auditedDocs[str(o.id)]) return;
          out.push({ kind: 'pending', rec: o });
        });
        return out;
      }

      function renderList() {
        var list = listRejected();
        clear(t.tbody);
        if (!list.length) {
          emptyRow(t.tbody, 10, '暂无被驳回或暂不开票的申请：审核不通过、暂缓或缺单据的事项会自动出现在这里');
        } else {
          list.forEach(function (item, i) {
            var r = obj(item.rec);
            var tr = h('tr');
            var isAudit = item.kind === 'audit';
            var no = isAudit ? str(r.applicationNo) : str(r.id);
            var op = isAudit
              ? button('查看并处理', 'pra-btn pra-btn-sm', (function (n) {
                  return function () { openRejectedDetail(n); };
                })(no))
              : button('补单据并重审', 'pra-btn pra-btn-sm', (function (cid) {
                  return function () { openPendingFix(cid); };
                })(str(r.id)));
            var firstIssue = arr(r.checks)[0];
            var problem = isAudit
              ? (firstIssue ? obj(firstIssue).name + '：' + obj(firstIssue).conclusion : r.summary)
              : ('缺少验收单等证据，控制权未转移，暂不开票（' +
                  (num(r.amountExTax) == null ? '金额待核' : '不含税 ' + fmtMoney(r.amountExTax) + ' 元') + '）');
            add(tr,
              td(String(i + 1), 'num'),
              td(text(no), 'first mono'),
              td(isAudit ? h('span', 'pra-src-tag live', '审核驳回') : h('span', 'pra-src-tag doc', '暂不开票')),
              td(statusChip(isAudit && str(r.result) !== 'suspend' ? STATUS_REJECTED : STATUS_SUSPEND)),
              td(text(isAudit ? r.customer : r.party)),
              td(text(isAudit ? r.product : r.product)),
              td(fmtMoney(isAudit ? r.amount : (num(r.amountExTax) != null ? r.amountExTax : r.amountTotal)), 'num'),
              td(text(isAudit ? r.auditedAt : '—')),
              td(problem, 'pra-reason'),
              actionCell(op)
            );
            t.tbody.appendChild(tr);
          });
        }
        var failCnt = list.filter(function (x) { return x.kind === 'audit' && str(obj(x.rec).result) !== 'suspend'; }).length;
        var suspCnt = list.filter(function (x) { return x.kind === 'audit' && str(obj(x.rec).result) === 'suspend'; }).length;
        var pendCnt = list.filter(function (x) { return x.kind === 'pending'; }).length;
        summary.textContent = '共 ' + fmtInt(list.length) + ' 条待处理（审核不通过 ' + fmtInt(failCnt) +
          ' 条 · 审核暂缓 ' + fmtInt(suspCnt) + ' 条 · 暂不开票 ' + fmtInt(pendCnt) + ' 条）';
      }

      add(p.body, t.wrap, summary);
      add(viewSec, pageHead('被驳回申请', '查看原因 → 补充单据 / 修改信息 → 重新提交审核'), p.panel);
      rejectedRefresher = renderList;
      renderList();
    }

    /** 数据侧「暂不开票」事项：直接打开工作区装配该合同，便于补单据后重审 */
    function openPendingFix(contractId) {
      var u = arr(model.unaccepted).filter(function (x) { return str(obj(x).id) === str(contractId); })[0];
      if (!u) { toast('未找到合同 ' + str(contractId)); return; }
      var o = obj(u);
      if (typeof C.openContractFix === 'function') {
        C.openContractFix(str(o.id));
        toast('已打开合同 ' + str(o.id) + '：请补充验收单等单据后点「执行审核」');
        return;
      }
      toast('宿主未提供补单据入口，请到「智能审核」页上传单据');
    }

    /** 被驳回申请：详情与处理窗口 */
    function openRejectedDetail(no) {
      var list = [];
      try { if (typeof C.getRejected === 'function') list = arr(C.getRejected()); } catch (e) { list = []; }
      var rec = list.filter(function (x) { return str(obj(x).applicationNo) === str(no); })[0];
      if (!rec) { toast('未找到申请 ' + str(no)); return; }
      var r = obj(rec);
      clear(modalBody);

      /* 头部 */
      var head = h('div', 'pra-rej-head');
      add(head,
        h('b', null, text(r.applicationNo)),
        statusChip(str(r.result) === 'suspend' ? STATUS_SUSPEND : STATUS_REJECTED),
        h('span', null, text(r.auditedAt) + ' · 审核人 ' + text(r.operator))
      );
      modalBody.appendChild(head);

      /* 驳回原因 */
      modalBody.appendChild(h('h4', 'pra-rej-h', '一、审核意见（需处理项）'));
      var checks = arr(r.checks);
      if (!checks.length) {
        modalBody.appendChild(callout('info', text(r.summary)));
      } else {
        checks.forEach(function (c) {
          var o = obj(c);
          var item = h('div', 'pra-rej-item ' + (str(o.status) === 'suspend' ? 'susp' : 'bad'));
          add(item, h('b', null, text(o.name) + ' · ' + (str(o.status) === 'suspend' ? '暂缓' : '不通过')));
          item.appendChild(h('p', null, text(o.conclusion)));
          if (o.advice) item.appendChild(h('p', 'pra-rej-advice', '修改建议：' + text(o.advice)));
          modalBody.appendChild(item);
        });
      }

      /* 当前单据 */
      modalBody.appendChild(h('h4', 'pra-rej-h', '二、已上传单据（' + arr(r.documents).length + ' 份）'));
      var dt = makeTable([
        { label: '单据编号' }, { label: '类型' }, { label: '日期' },
        { label: '对方单位' }, { label: '金额', cls: 'r' }
      ]);
      var docs = arr(r.documents);
      if (!docs.length) emptyRow(dt.tbody, 5, '该申请没有关联单据');
      docs.forEach(function (d) {
        var o = obj(d);
        var tr = h('tr');
        add(tr, td(text(o.id), 'first mono'), td(typeTag(o.docType)), td(text(o.docDate)),
          td(text(o.party)), td(fmtMoney(o.amountTotal), 'num'));
        dt.tbody.appendChild(tr);
      });
      modalBody.appendChild(dt.wrap);
      modalBody.appendChild(smallNote('提示：若提示缺少验收单 / 出库单，先点「补充单据」上传，再点「重新提交审核」。'));

      /* 修改信息 */
      modalBody.appendChild(h('h4', 'pra-rej-h', '三、修改申请信息'));
      var formBox = h('div', 'pra-rej-form');
      function field(labelText, value, placeholder) {
        var lab = h('label', 'pra-inline-lab');
        var input = h('input', 'pra-input');
        input.value = value == null ? '' : String(value);
        if (placeholder) input.setAttribute('placeholder', placeholder);
        add(lab, h('span', null, labelText), input);
        formBox.appendChild(lab);
        return input;
      }
      var fCustomer = field('客户名称', text(r.customer, ''));
      var fProduct = field('产品 / 服务', text(r.product, ''));
      var fAmount = field('申请金额（含税）', num(r.amount) == null ? '' : fmtMoney(r.amount));
      var fRegion = field('销售区域', text(r.region, '内销'), '内销 / 出口');
      modalBody.appendChild(formBox);
      modalBody.appendChild(smallNote('修改后点「保存修改」，再点「重新提交审核」按新信息重跑审核。'));

      /* 底部操作 */
      var acts = h('div', 'pra-acts');
      var btnSave = button('保存修改', 'pra-btn', function () {
        if (typeof C.patchRejected !== 'function') { toast('宿主未提供修改接口'); return; }
        C.patchRejected(str(no), {
          customer: str(fCustomer.value).trim(),
          product: str(fProduct.value).trim(),
          amount: str(fAmount.value).trim(),
          region: str(fRegion.value).trim()
        });
        toast('已保存申请信息修改');
        if (rejectedRefresher) rejectedRefresher();
      });
      var btnAddDocs = button('补充单据（打开工作区）', 'pra-btn pra-btn-ghost', function () {
        if (typeof C.openRejected !== 'function') { toast('宿主未提供打开接口'); return; }
        C.openRejected(str(no));
        closeModal();
        toast('已打开该申请：可在智能体上传区补充单据，然后点「执行审核」');
      });
      var btnRetry = button('重新提交审核', 'pra-btn pra-btn-gold', function () {
        if (typeof C.retryRejected !== 'function') { toast('宿主未提供重审接口'); return; }
        C.retryRejected(str(no));
        closeModal();
        toast('已重新提交审核，请查看智能体工作区的审核结论');
      });
      var btnClose = button('关闭', 'pra-btn pra-btn-ghost', function () { closeModal(); });
      add(acts, btnSave, btnAddDocs, btnRetry, btnClose);
      modalBody.appendChild(acts);

      openModal('被驳回申请 · ' + str(no));
    }

    /* ==================================================================
     * 7. 模块三：待开票清单
     * ================================================================== */
    function buildPending(viewSec) {
      var p = panel('待开票清单', '本月销售 ' + fmtInt(model.sales.length) + ' 项');
      var toolbar = h('div', 'pra-toolbar');

      var regionChips = h('div', 'pra-chips pra-chips-labelled');
      regionChips.appendChild(h('em', 'pra-chip-label', '区域'));

      var regionNodes = [];

      ['全部', '内销', '出口'].forEach(function (v) {
        var b = h('button', 'pra-chip', v);
        b.setAttribute('type', 'button');
        b.addEventListener('click', function () {
          st.pending.region = v;
          syncPendingChips();
          renderPending();
        });
        regionNodes.push({ node: b, value: v });
        regionChips.appendChild(b);
      });

      add(toolbar, regionChips);

      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '产品' },
        { label: '日期' },
        { label: '客户' },
        { label: '数量', cls: 'r' },
        { label: '金额（元）', cls: 'r', title: '销售明细金额（不含税）' },
        { label: '区域' },
        { label: '开票状态' },
        { label: '操作' }
      ]);

      var summaryLine = smallNote('');

      function syncPendingChips() {
        regionNodes.forEach(function (c) {
          c.node.className = 'pra-chip' + (c.value === st.pending.region ? ' on' : '');
        });
      }

      function currentRows() {
        return model.sales.filter(function (row) {
          var r = obj(row);
          if (st.pending.region !== '全部' && str(r.region) !== st.pending.region) return false;
          // 已开具的事项不再出现在待开票清单（在「已开发票」中查看）
          if (salesStatus(r, model.unaccepted) === STATUS_ISSUED) return false;
          return true;
        });
      }

      function renderPending() {
        var rows = currentRows();
        clear(t.tbody);
        if (!rows.length) {
          emptyRow(t.tbody, 9, '当前筛选条件下没有待开票事项');
        } else {
          rows.forEach(function (row, i) {
            var r = obj(row);
            var status = salesStatus(r, model.unaccepted);
            var tr = h('tr');
            add(tr,
              td(String(i + 1), 'num'),
              td(text(r.product), 'first'),
              td(text(r.date)),
              td(text(r.customer)),
              td(fmtInt(r.qty), 'num'),
              td(fmtMoney(r.amount), 'num'),
              td(text(r.region)),
              statusCell(status),
              status === STATUS_ISSUED
                ? actionCell(h('span', 'pra-issued-no', '发票 ' + (text(r.invoiceNo) || '—')))
                : actionCell(button('去开票', 'pra-btn pra-btn-sm', (function (rr) {
                  return function () { handToAgent(rr, '待开票清单'); };
                })(r)))
            );
            t.tbody.appendChild(tr);
          });
        }

        var amount = 0;
        rows.forEach(function (row) { amount += num(obj(row).amount) || 0; });
        var inner = rows.filter(function (row) { return str(obj(row).region) === '内销'; }).length;
        var outer = rows.filter(function (row) { return str(obj(row).region) === '出口'; }).length;
        summaryLine.textContent = '共 ' + fmtInt(model.sales.length) + ' 项 · 当前筛选 ' + fmtInt(rows.length) +
          ' 项（内销 ' + fmtInt(inner) + ' / 出口 ' + fmtInt(outer) + '） · 金额合计 ' +
          fmtMoney(amount) + ' 元（不含税）';
      }

      var noteBox = h('div', 'pra-pending-notes');
      noteBox.appendChild(callout('info', pendingNote()));

      if (model.unaccepted.length) {
        var sus = h('div', 'pra-suspend');
        var susHead = h('b', null, '未验收暂缓开票（不计入本清单）');
        sus.appendChild(susHead);
        var ul = h('ul', 'pra-suspend-list');
        model.unaccepted.forEach(function (u) {
          var li = h('li');
          var line = '合同 ' + u.id +
            (u.party ? ' · ' + u.party : '') +
            (u.product ? ' · ' + u.product : '') +
            (u.qty != null ? ' · ' + fmtInt(u.qty) + ' 台' : '') +
            ' · 不含税 ' + fmtMoney(u.amountExTax) + ' 元 · 未匹配到验收单';
          li.textContent = line;
          ul.appendChild(li);
        });
        sus.appendChild(ul);
        noteBox.appendChild(sus);
      }

      add(p.body, toolbar, t.wrap, summaryLine, noteBox);
      add(viewSec, pageHead('待开票清单', '按合同与验收状态生成的待开票事项'), p.panel);

      syncPendingChips();
      renderPending();
    }

    function pendingNote() {
      var inner = model.sales.length - exportCount(model.sales);
      var out = exportCount(model.sales);
      var s = '清单口径：本表为 ' + text(model.meta.period, '2025 年 12 月') +
        '销售明细（开票口径），内销 ' + fmtInt(inner) + ' 项、出口 ' + fmtInt(out) + ' 项。';
      if (model.unaccepted.length) {
        var ids = model.unaccepted.map(function (u) { return u.id; }).join('、');
        var qty0 = model.unaccepted[0].qty;
        s += '合同 ' + ids + ' ' +
          (qty0 != null ? '中 ' + fmtInt(qty0) + ' 台设备' : '对应标的') +
          '未验收，不在本次开票范围，验收后再开；';
      }
      s += '出口发票按 0% 税率处理，内销专票 13%。';
      return s;
    }

    /* ==================================================================
     * 8. 模块四：发票开具（智能体草稿落点）
     * ================================================================== */
    var form = {};
    var formUi = { checks: null, draftBody: null, ctxBar: null };
    var manual = { tax: false, total: false };

    function buildIssue(viewSec) {
      var p = panel('票面信息', '来自智能体草稿，可人工微调');
      p.body.appendChild(callout('info',
        '票面信息校验通过后提交登记，同步至开票台账；正式开具以税务系统为准。'));

      /* 当前业务上下文（无草稿时给出明确入口，避免不知道下一步做什么） */
      var ctxBar = h('div', 'pra-issue-ctx');

      var grid = h('div', 'pra-form');

      function field(label, input, cls) {
        var lab = h('label', cls || '');
        lab.appendChild(h('span', null, label));
        lab.appendChild(input);
        return lab;
      }

      function inputEl(type, placeholder, extraCls) {
        var i = h('input', 'pra-input' + (extraCls ? ' ' + extraCls : ''));
        i.setAttribute('type', type || 'text');
        if (placeholder) i.setAttribute('placeholder', placeholder);
        return i;
      }

      form.buyer = inputEl('text', '购方名称由智能体草稿回填，或手工填写');
      form.taxNo = inputEl('text', '纳税人识别号');
      form.goods = inputEl('text', '货物或应税劳务名称');
      form.qty = inputEl('text', '数量', 'pra-num');
      form.price = inputEl('text', '不含税单价', 'pra-num');
      form.amount = inputEl('text', '不含税金额', 'pra-num');
      form.tax = inputEl('text', '税额', 'pra-num');
      form.total = inputEl('text', '价税合计', 'pra-num');
      form.remark = h('textarea', 'pra-textarea');
      form.remark.setAttribute('placeholder', '备注（如：合同编号、验收情况、结算方式）');

      var rateBox = h('div', 'pra-rates');
      form.rates = RATE_CHOICES.map(function (r) {
        var lab = h('label', 'pra-rate');
        var radio = h('input', 'pra-radio');
        radio.setAttribute('type', 'radio');
        radio.setAttribute('name', 'pra-tax-rate');
        radio.value = r;
        radio.addEventListener('change', function () {
          if (radio.checked) {
            manual.tax = false;
            manual.total = false;
            recalc('rate');
          }
        });
        var span = h('span', null, r);
        add(lab, radio, span);
        rateBox.appendChild(lab);
        return { value: r, node: radio, label: lab };
      });
      // 默认 13%（内销专票），用户与草稿均可改
      form.rates[0].node.checked = true;

      add(grid,
        field('购方名称', form.buyer),
        field('纳税人识别号', form.taxNo),
        field('货物或应税劳务', form.goods),
        field('数量', form.qty),
        field('单价（不含税）', form.price),
        field('金额（不含税）', form.amount),
        field('税率', rateBox),
        field('税额', form.tax),
        field('价税合计', form.total),
        field('备注', form.remark, 'full')
      );

      form.qty.addEventListener('input', function () { recalc('qty'); });
      form.price.addEventListener('input', function () { recalc('price'); });
      form.amount.addEventListener('input', function () {
        manual.tax = false;
        manual.total = false;
        recalc('amount');
      });
      form.tax.addEventListener('input', function () {
        manual.tax = true;
        manual.total = false;
        recalc('tax');
      });
      form.total.addEventListener('input', function () {
        manual.total = true;
        recalc('total');
      });

      /* 校验区 */
      var checks = h('div', 'pra-vchecks');

      /* 草稿来源区 */
      var draftBox = h('div', 'pra-draft');
      var draftTable = h('div', 'pra-draft-body');

      var acts = h('div', 'pra-acts');
      var btnSave = button('保存草稿', 'pra-btn', onSaveDraft);
      var btnSubmit = button('提交开票', 'pra-btn pra-btn-gold', onSubmitInvoice);
      var btnPick = button('从待开票清单选择业务', 'pra-btn pra-btn-ghost', function () { show('newbusiness'); });
      var btnPreview = button('预览发票', 'pra-btn pra-btn-ghost', function () {
        openInvoicePreview(previewDataFromForm());
      });
      var btnDownloadPng = button('下载发票 PNG', 'pra-btn pra-btn-ghost', function () {
        downloadInvoicePreview(previewDataFromForm(), 'png');
      });
      add(acts, btnSave, btnSubmit, btnPick, btnPreview, btnDownloadPng);

      /* 待开票事项快选：直接在本页选一条即可开票，不必先去其他模块 */
      var pickBar = h('div', 'pra-issue-pick');
      var pickSel = h('select', 'pra-select');
      var pendingRows = model.sales.filter(function (row) { return !isIssued(row); });
      var phOpt = h('option', null, pendingRows.length ? '请选择待开票事项…' : '本月待开票事项已全部开票');
      phOpt.value = '';
      pickSel.appendChild(phOpt);
      pendingRows.forEach(function (row, i) {
        var r = obj(row);
        var o = h('option', null, (i + 1) + '. ' + text(r.product) + ' · ' + text(r.customer) + ' · ' + fmtMoney(r.amount) + ' 元');
        o.value = String(i);
        pickSel.appendChild(o);
      });
      pickSel.addEventListener('change', function () {
        if (str(pickSel.value) === '') return;
        var idx = Number(pickSel.value);
        if (!isFinite(idx) || !pendingRows[idx]) return;
        pickPendingRow(pendingRows[idx]);
      });
      add(pickBar, h('span', 'pra-issue-pick-label', '待开票事项'), pickSel,
        h('em', 'pra-issue-pick-note', '选中后自动带入票面，核对无误即可直接「提交开票」'));

      add(p.body, pickBar, ctxBar, grid, checks, draftBox, acts);
      add(viewSec, pageHead('发票开具', '第三步：核对票面信息后提交'), p.panel);

      formUi.checks = checks;
      formUi.draftBody = draftTable;
      formUi.ctxBar = ctxBar;
      draftBox.appendChild(h('b', null, '智能体草稿'));
      draftBox.appendChild(draftTable);
      renderDraft();
      recalc('init');
    }

    /* ---------- 8.1 发票预览与下载（模块由 src/invoice-template.js 提供，
       未加载或被裁剪时降级为 toast，不抛错；契约见 window.InvoicePreview ---------- */
    function invoicePreviewApi() {
      var w = (typeof window !== 'undefined' && window) || null;
      var m = w ? w.InvoicePreview : null;
      return m && typeof m === 'object' ? m : null;
    }

    function openInvoicePreview(data) {
      var m = invoicePreviewApi();
      if (!m || typeof m.open !== 'function') { toast('发票预览模块未加载'); return false; }
      try {
        m.open(data);
        return true;
      } catch (e) {
        toast('发票预览失败：' + (e && e.message ? e.message : str(e)));
        return false;
      }
    }

    function downloadInvoicePreview(data, format) {
      var m = invoicePreviewApi();
      if (!m || typeof m.download !== 'function') { toast('发票预览模块未加载'); return false; }
      try {
        m.download(data, format);
        return true;
      } catch (e) {
        toast('发票下载失败：' + (e && e.message ? e.message : str(e)));
        return false;
      }
    }

    /** 由当前表单值 + 草稿票种/卖方信息拼出 InvoicePreview 契约 data（items 只放一行） */
    function previewDataFromForm() {
      var d = obj(st.draft);
      var rate = currentRate();
      var rateValue = rateNum(rate);
      var invoiceType = str(d.invoiceType) || (rateValue === 0 ? '出口发票' : '增值税专用发票');
      var seller = obj(d.seller);
      return {
        invoiceType: invoiceType,
        buyer: { name: str(form.buyer.value).trim(), taxNo: str(form.taxNo.value).trim() },
        seller: (str(seller.name) || str(seller.taxNo))
          ? { name: str(seller.name), taxNo: str(seller.taxNo) }
          : { name: text(model.meta.company, '华衡智造集团股份有限公司'), taxNo: '91440300MA5H8K2X3Q' },
        items: [{
          name: str(form.goods.value).trim(),
          qty: parseInput(form.qty),
          unitPrice: parseInput(form.price),
          amount: parseInput(form.amount),
          taxRate: rate,
          taxAmount: parseInput(form.tax)
        }],
        amountExTax: parseInput(form.amount),
        taxRate: rate,
        taxAmount: parseInput(form.tax),
        amountTotal: parseInput(form.total),
        amountInWords: str(d.amountInWords),
        remark: str(form.remark.value),
        draftNo: str(d.draftNo),
        statusLabel: str(d.statusLabel)
      };
    }

    function currentRate() {
      var v = null;
      form.rates.forEach(function (r) { if (r.node.checked) v = r.value; });
      return v || RATE_CHOICES[0];
    }

    function setRate(v) {
      var want = v == null ? null : fmtRate(v);
      var hit = false;
      form.rates.forEach(function (r) {
        var on = want != null && r.value === want;
        if (on) hit = true;
        r.node.checked = on;
      });
      if (!hit) form.rates[0].node.checked = true;
    }

    function parseInput(node) {
      return num(str(node.value).replace(/,/g, ''));
    }

    function recalc(from) {
      var qty = parseInput(form.qty);
      var price = parseInput(form.price);
      var amount = parseInput(form.amount);
      var rate = rateNum(currentRate()) || 0;

      if (from === 'qty' || from === 'price') {
        if (qty != null && price != null) {
          var calcAmount = round2(qty * price);
          form.amount.value = fmtMoney(calcAmount);
          amount = calcAmount;
          manual.tax = false;
          manual.total = false;
        }
      }

      if (!manual.tax && amount != null) {
        var calcTax = round2(amount * rate);
        form.tax.value = fmtMoney(calcTax);
      }

      if (!manual.total) {
        var a = parseInput(form.amount);
        var tx = parseInput(form.tax);
        if (a != null && tx != null) form.total.value = fmtMoney(round2(a + tx));
      }

      validate();
    }

    function checkItem(ok, textOk, textBad) {
      return { ok: ok, text: ok ? textOk : textBad };
    }

    function validate() {
      var qty = parseInput(form.qty);
      var price = parseInput(form.price);
      var amount = parseInput(form.amount);
      var tax = parseInput(form.tax);
      var total = parseInput(form.total);
      var rate = rateNum(currentRate());
      if (rate == null) rate = 0;

      var blank = !str(form.buyer.value).trim() && !str(form.taxNo.value).trim() &&
        qty == null && price == null && amount == null && tax == null && total == null;

      if (blank) {
        clear(formUi.checks);
        var idle = h('div', 'pra-vhead idle', '尚未回填草稿：输入数量、单价、金额、税率后自动校验「金额 × 税率 = 税额」与价税合计一致性');
        formUi.checks.appendChild(idle);
        return { ok: false, blank: true, items: [] };
      }

      var items = [];
      var tol = 0.01;

      if (qty != null && price != null && amount != null) {
        var expectAmount = round2(qty * price);
        items.push(checkItem(Math.abs(expectAmount - amount) <= tol,
          '数量 × 单价 = 金额：' + fmtInt(qty) + ' × ' + fmtMoney(price) + ' = ' + fmtMoney(expectAmount) + ' ✓',
          '数量 × 单价 ≠ 金额：' + fmtInt(qty) + ' × ' + fmtMoney(price) + ' = ' + fmtMoney(expectAmount) +
          '，表单填写 ' + fmtMoney(amount) + '，差额 ' + fmtMoney(round2(amount - expectAmount))));
      } else {
        items.push(checkItem(false, '', '数量、单价、金额需同时填写才能校验「数量 × 单价 = 金额」'));
      }

      if (amount != null && tax != null) {
        var expectTax = round2(amount * rate);
        items.push(checkItem(Math.abs(expectTax - tax) <= tol,
          '金额 × 税率 = 税额：' + fmtMoney(amount) + ' × ' + fmtRate(rate) + ' = ' + fmtMoney(expectTax) + ' ✓',
          '金额 × 税率 ≠ 税额：' + fmtMoney(amount) + ' × ' + fmtRate(rate) + ' = ' + fmtMoney(expectTax) +
          '，表单填写 ' + fmtMoney(tax) + '，差额 ' + fmtMoney(round2(tax - expectTax))));
      } else {
        items.push(checkItem(false, '', '金额与税额需同时填写才能校验「金额 × 税率 = 税额」'));
      }

      if (amount != null && tax != null && total != null) {
        var expectTotal = round2(amount + tax);
        items.push(checkItem(Math.abs(expectTotal - total) <= tol,
          '金额 + 税额 = 价税合计：' + fmtMoney(expectTotal) + ' ✓',
          '金额 + 税额 ≠ 价税合计：应为 ' + fmtMoney(expectTotal) + '，表单填写 ' + fmtMoney(total) +
          '，差额 ' + fmtMoney(round2(total - expectTotal))));
      } else {
        items.push(checkItem(false, '', '金额、税额、价税合计需同时填写才能校验「价税合计一致」'));
      }

      var buyerOk = !!str(form.buyer.value).trim();
      var taxNoOk = !!str(form.taxNo.value).trim();
      items.push(checkItem(buyerOk, '购方名称已填写 ✓', '购方名称未填写（购买方名称是票面必填项）'));
      items.push(checkItem(taxNoOk, '纳税人识别号已填写 ✓', '纳税人识别号未填写（专票必须填写购买方税号）'));

      clear(formUi.checks);
      var allOk = true;
      items.forEach(function (it) {
        if (!it.ok) allOk = false;
      });

      formUi.checks.appendChild(h('div', 'pra-vhead ' + (allOk ? 'ok' : 'bad'),
        allOk ? '校验通过：票面金额、税额、价税合计一致' : '存在不一致项，提交前请修正（红字为不符项）'));

      items.forEach(function (it) {
        var row = h('div', 'pra-vrow ' + (it.ok ? 'ok' : 'bad'));
        row.appendChild(h('em', 'pra-vmark', it.ok ? '✓' : '!'));
        row.appendChild(h('span', null, it.text));
        formUi.checks.appendChild(row);
      });

      return { ok: allOk, blank: false, items: items };
    }

    function fillForm(draft) {
      var d = obj(draft);
      var buyer = obj(d.buyer);
      var item = obj(arr(d.items)[0]);

      form.buyer.value = str(buyer.name || '');
      form.taxNo.value = str(buyer.taxNo || '');
      form.goods.value = str(item.name || '');
      form.qty.value = item.qty != null ? String(item.qty) : '';
      form.price.value = item.unitPrice != null ? fmtMoney(item.unitPrice) : '';
      form.amount.value = d.amountExTax != null ? fmtMoney(d.amountExTax) : (item.amount != null ? fmtMoney(item.amount) : '');
      form.tax.value = d.taxAmount != null ? fmtMoney(d.taxAmount) : (item.taxAmount != null ? fmtMoney(item.taxAmount) : '');
      form.total.value = d.amountTotal != null ? fmtMoney(d.amountTotal) : '';
      setRate(d.taxRate || item.taxRate);
      form.remark.value = str(d.remark || '');

      /* 草稿给了税额/价税合计就不覆盖，交给校验区提示差异 */
      manual.tax = d.taxAmount != null || item.taxAmount != null;
      manual.total = d.amountTotal != null;

      var hl = arr(d.highlights);
      var map = {
        party: form.buyer, buyer: form.buyer, buyerName: form.buyer, 'buyer.name': form.buyer,
        taxNo: form.taxNo, partyTaxNo: form.taxNo, 'buyer.taxNo': form.taxNo,
        items: form.goods, item: form.goods, 'items.name': form.goods,
        qty: form.qty, 'items.qty': form.qty,
        unitPrice: form.price, 'items.unitPrice': form.price,
        amountExTax: form.amount, amount: form.amount, 'items.amount': form.amount,
        taxRate: form.rates[0].label,
        taxAmount: form.tax, amountTotal: form.total
      };
      var hlTargets = [form.buyer, form.taxNo, form.goods, form.qty, form.price, form.amount, form.tax, form.total];
      form.rates.forEach(function (r) { hlTargets.push(r.label); });
      hlTargets.forEach(function (n) {
        n.className = str(n.className).replace(/\s*pra-hl/g, '');
      });
      hl.forEach(function (k) {
        var node = map[str(k)];
        if (node && node.className != null && !includes(node.className, 'pra-hl')) {
          node.className += ' pra-hl';
        }
      });

      validate();
      renderDraft();
    }

    /** 客户税号：优先取发票原件，其次取客户档案字典 */
    function taxNoOf(buyer) {
      var hit = '';
      model.invDocs.some(function (d) {
        if (str(d.party) === buyer && str(d.partyTaxNo)) { hit = str(d.partyTaxNo); return true; }
        return false;
      });
      if (hit) return hit;
      var cust = arr(obj(model.dict).customers).filter(function (c) {
        return str(c.name) === buyer && str(c.taxNo);
      })[0];
      return cust ? str(cust.taxNo) : '';
    }

    /** 选中待开票事项 → 带入票面（可直接提交开票） */
    function pickPendingRow(row) {
      var r = obj(row);
      var rateTxt = str(r.region) === '出口' ? '0%' : '13%';
      var amount = num(r.amount);
      var rn = rateNum(rateTxt) || 0;
      form.buyer.value = str(r.customer);
      form.taxNo.value = taxNoOf(str(r.customer));
      form.goods.value = str(r.product);
      form.qty.value = r.qty != null ? String(r.qty) : '';
      form.price.value = r.unitPrice != null ? fmtMoney(r.unitPrice) : '';
      form.amount.value = amount != null ? fmtMoney(amount) : '';
      setRate(rateTxt);
      manual.tax = false;
      manual.total = false;
      var tax = amount == null ? null : round2(amount * rn);
      form.tax.value = tax != null ? fmtMoney(tax) : '';
      form.total.value = amount != null && tax != null ? fmtMoney(round2(amount + tax)) : '';
      form.remark.value = '待开票事项：' + str(r.product) + ' · ' + str(r.customer) +
        (r.contractNo ? '；合同 ' + str(r.contractNo) : '');
      st.pickedRow = r;
      st.draft = null;
      recalc('init');
      renderDraft();
      toast('已带入待开票事项：' + str(r.product) + ' · ' + str(r.customer) + '，核对票面后可直接「提交开票」');
    }

    /** 发票开具页顶部的业务上下文：有草稿显示来源，无草稿给出明确入口 */
    function renderIssueCtx() {
      if (!formUi.ctxBar) return;
      clear(formUi.ctxBar);
      var d = st.draft;
      if (!d && st.pickedRow) {
        var p = st.pickedRow;
        formUi.ctxBar.className = 'pra-issue-ctx';
        add(formUi.ctxBar,
          h('span', 'pra-issue-ctx-tag', '当前业务'),
          h('b', null, text(p.customer, '—')),
          h('span', null, '货物：' + text(p.product, '—')),
          h('span', null, '不含税金额：' + fmtMoney(p.amount) + ' 元'),
          h('span', null, '合同：' + text(p.contractNo, '—')),
          h('span', 'pra-issue-ctx-state', '来自待开票事项')
        );
        return;
      }
      if (!d) {
        formUi.ctxBar.className = 'pra-issue-ctx empty';
        add(formUi.ctxBar,
          h('b', null, '当前没有待开具的业务'),
          h('span', null, '请先「新建开票业务」上传单据，或在待开票清单中选择一项交给智能体审核。'),
          button('去新建开票业务', 'pra-btn pra-btn-gold pra-btn-sm', function () { show('newbusiness'); })
        );
        return;
      }
      formUi.ctxBar.className = 'pra-issue-ctx';
      var o = obj(d);
      add(formUi.ctxBar,
        h('span', 'pra-issue-ctx-tag', '当前业务'),
        h('b', null, text(obj(o.buyer).name, '—')),
        h('span', null, '货物：' + text(arr(o.items)[0] && obj(arr(o.items)[0]).name, '—')),
        h('span', null, '价税合计：' + fmtMoney(o.amountTotal) + ' 元'),
        h('span', null, '草稿：' + text(o.draftNo, '—')),
        h('span', 'pra-issue-ctx-state', text(o.statusLabel, '待人工确认'))
      );
    }

    function renderDraft() {
      renderIssueCtx();
      if (!formUi.draftBody) return;
      clear(formUi.draftBody);
      var d = st.draft;
      if (!d) {
        var hint = button('尚未回填草稿：可等待智能体回填，或先载入待开票清单首行', 'pra-btn pra-btn-ghost pra-btn-block', onLoadSample);
        formUi.draftBody.appendChild(hint);
        return;
      }
      var meta = h('div', 'pra-draft-meta');
      add(meta,
        h('span', null, '草稿号 ' + text(d.draftNo, '—')),
        h('span', null, '状态 ' + text(d.statusLabel, text(d.status, 'pending'))),
        h('span', null, '票种 ' + text(d.invoiceType, '—')),
        h('span', null, '生成 ' + text(d.createdAt, '—'))
      );
      if (d.contractId) meta.appendChild(h('span', null, '关联合同 ' + str(d.contractId)));
      if (d.applicationNo) meta.appendChild(h('span', null, '申请单 ' + str(d.applicationNo)));
      formUi.draftBody.appendChild(meta);

      if (d.amountInWords) {
        formUi.draftBody.appendChild(h('div', 'pra-draft-line', '金额大写：' + str(d.amountInWords)));
      }

      var hl = arr(d.highlights);
      if (hl.length) {
        formUi.draftBody.appendChild(h('div', 'pra-draft-line', '高亮字段：' + hl.map(function (k) { return str(k); }).join('、')));
      }

      var sources = arr(d.sources);
      if (sources.length) {
        var st2 = makeTable([
          { label: '字段' },
          { label: '单据编号' },
          { label: '来源位置' }
        ]);
        sources.forEach(function (s) {
          var o = obj(s);
          var tr = h('tr');
          add(tr, td(text(o.field)), td(text(o.docId)), td(text(o.loc), 'pra-f-loc'));
          st2.tbody.appendChild(tr);
        });
        formUi.draftBody.appendChild(st2.wrap);
      }

      var errs = arr(d.commonErrors);
      if (errs.length) {
        formUi.draftBody.appendChild(h('div', 'pra-draft-line', '草稿提示（需人工确认）：'));
        var ul = h('ul', 'pra-warns');
        errs.forEach(function (e) {
          var line;
          if (typeof e === 'string' || typeof e === 'number') {
            line = str(e);
          } else {
            var o = obj(e);
            line = (o.check ? o.check + '：' : '') + str(o.text || o.conclusion || '') +
              (o.advice ? '（建议：' + o.advice + '）' : '');
          }
          ul.appendChild(h('li', null, line));
        });
        formUi.draftBody.appendChild(ul);
      }

      var clearBtn = button('清空草稿', 'pra-btn pra-btn-sm', function () {
        st.draft = null;
        manual.tax = false;
        manual.total = false;
        renderDraft();
        toast('已清空草稿回填内容（表单值保留，可手工修改）');
      });
      formUi.draftBody.appendChild(clearBtn);
    }

    function onLoadSample() {
      if (!model.sales.length) {
        toast('data.tables.sales 为空，无法载入示例');
        return;
      }
      var row = obj(model.sales[0]);
      var rate = rateNum(currentRate()) || 0.13;
      var amount = num(row.amount);
      var goods = str(row.product);
      st.draft = {
        draftNo: 'LOCAL-SAMPLE',
        status: 'pending',
        invoiceType: '增值税专用发票',
        buyer: { name: str(row.customer), taxNo: '' },
        items: [{ name: goods, qty: num(row.qty), unitPrice: num(row.unitPrice), amount: amount, taxRate: fmtRate(rate), taxAmount: amount == null ? null : round2(amount * rate) }],
        amountExTax: amount,
        taxRate: fmtRate(rate),
        taxAmount: amount == null ? null : round2(amount * rate),
        amountTotal: amount == null ? null : round2(amount * (1 + rate)),
        highlights: ['party', 'amountExTax', 'taxRate'],
        sources: [],
        createdAt: '本地示例',
        note: '来自待开票清单首行（本地操作，非智能体输出）'
      };
      fillForm(st.draft);
      toast('已按待开票清单首行填入示例数据（本地操作，非智能体输出）');
    }

    function onSaveDraft() {
      var state = getFormState();
      var payload = {
        draftNo: st.draft ? str(st.draft.draftNo) : 'LOCAL-' + String(Date.now()),
        savedAt: new Date().toISOString(),
        form: state
      };
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('pra.draft', JSON.stringify(payload));
        }
      } catch (e) { /* file:// 下 localStorage 可能不可用，忽略 */ }
      toast('草稿已保存');
    }

    function onSubmitInvoice() {
      var v = validate();
      if (!v.ok) {
        toast(v.blank
          ? '请先在上方「待开票事项」中选择一条，或由智能体回填草稿后再提交'
          : '提交前请先修正票面不一致项（见红字提示）');
        return;
      }
      /* 提交即登记：交给宿主回写开票状态 */
      var msg = '';
      if (typeof C.submitInvoice === 'function') {
        try { msg = C.submitInvoice(getFormState()) || ''; } catch (e) { msg = ''; }
      }
      if (msg) {
        toast(msg);
        return;
      }
      toast('开票任务已受理并登记，等待复核确认。');
    }

    function getFormState() {
      var v = validate();
      return {
        buyerName: str(form.buyer.value),
        buyerTaxNo: str(form.taxNo.value),
        goods: str(form.goods.value),
        qty: parseInput(form.qty),
        unitPrice: parseInput(form.price),
        amountExTax: parseInput(form.amount),
        taxRate: currentRate(),
        taxAmount: parseInput(form.tax),
        amountTotal: parseInput(form.total),
        remark: str(form.remark.value),
        valid: v.ok,
        issues: v.items.filter(function (i) { return !i.ok; }).map(function (i) { return i.text; })
      };
    }

    /* ==================================================================
     * 9. 模块五：红冲与作废
     * ================================================================== */
    function buildRedVoid(viewSec) {
      var p = panel('红冲与作废');

      var split = h('div', 'pra-split');
      var c1 = callout('info');
      c1.appendChild(h('b', null, '红冲条件'));
      c1.appendChild(h('br'));
      c1.appendChild(h('span', null, '销货退回、开票有误、服务中止、销售折让，且购买方未申报抵扣或已取得红字信息表。'));
      var c2 = callout('info');
      c2.appendChild(h('b', null, '作废条件'));
      c2.appendChild(h('br'));
      c2.appendChild(h('span', null, '当月开具、未交付购买方、未申报抵扣，且发票联与抵扣联齐全。'));
      add(split, c1, c2);

      var t = makeTable([
        { label: '场景' },
        { label: '处理方式' },
        { label: '审批要求' }
      ]);
      [
        ['当月开具且未交付', '作废重开', '开票岗申请，财务经理审批'],
        ['跨月或已交付', '红字发票', '取得红字信息表后开具'],
        ['退货折让', '红冲部分金额', '附退货单/折让协议']
      ].forEach(function (row) {
        var tr = h('tr');
        add(tr, td(row[0], 'first'), td(row[1]), td(row[2]));
        t.tbody.appendChild(tr);
      });

      var acts = h('div', 'pra-acts');
      acts.appendChild(button('发起红冲', 'pra-btn', function () {
        toast('已发起红冲申请（需取得红字信息表并经财务经理审批）');
      }));

      add(p.body, split, t.wrap, acts);
      add(p.body, callout('gold', '口径提示：本系统只做条件判断与申请登记，红冲/作废的最终执行需在税务系统由人工完成。'));

      add(viewSec, pageHead('红冲与作废', '红冲、作废条件与审批要求'), p.panel);
    }

    /* ==================================================================
     * 10. 模块六：开票台账（已开发票，类型筛选 + 金额排序）
     * ================================================================== */
    /* ==================================================================
     * 7.5 模块六：已开发票（按开票时间 / 客户 / 类型 / 来源筛选）
     * ================================================================== */
    function buildIssued(viewSec) {
      var p = panel('已开发票', '共 ' + fmtInt(model.issuedInvoices.length) + ' 张（本会话开具 + 已同步）');

      var stt = { from: '', to: '', party: '全部', type: '全部', source: '全部', kw: '' };
      var all = model.issuedInvoices;
      var parties = uniq(all.map(function (x) { return x.party; }).filter(Boolean)).sort();
      var types = uniq(all.map(function (x) { return x.docType; }).filter(Boolean));

      var toolbar = h('div', 'pra-toolbar pra-issued-toolbar');

      /* 开票时间快捷 */
      var timeBox = h('div', 'pra-chips pra-chips-labelled');
      timeBox.appendChild(h('em', 'pra-chip-label', '开票时间'));
      var timeNodes = [];
      var TIME_RANGES = [
        { key: '全部', label: '全部' },
        { key: '今天', label: '今天' },
        { key: '近7天', label: '近 7 天' },
        { key: '本月', label: '本月' }
      ];
      TIME_RANGES.forEach(function (t) {
        var b = h('button', 'pra-chip', t.label);
        b.setAttribute('type', 'button');
        if (t.key === '全部') b.className = 'pra-chip on';
        b.addEventListener('click', function () {
          applyRange(t.key);
          timeNodes.forEach(function (n) { n.node.className = 'pra-chip' + (n.key === t.key ? ' on' : ''); });
          st.issued.page = 1;
          renderIssued();
        });
        timeNodes.push({ node: b, key: t.key });
        timeBox.appendChild(b);
      });

      /* 起止日期 */
      var dateFrom = h('input', 'pra-input');
      dateFrom.setAttribute('type', 'date');
      var dateTo = h('input', 'pra-input');
      dateTo.setAttribute('type', 'date');
      [dateFrom, dateTo].forEach(function (el) {
        el.addEventListener('change', function () {
          stt.from = str(dateFrom.value);
          stt.to = str(dateTo.value);
          timeNodes.forEach(function (n) { n.node.className = 'pra-chip' + (n.key === null && false ? ' on' : ''); });
          st.issued.page = 1;
          renderIssued();
        });
      });
      var dateBox = h('div', 'pra-date-box');
      add(dateBox, h('em', 'pra-chip-label', '起止'), dateFrom, h('span', 'pra-date-sep', '~'), dateTo);

      /* 客户下拉 */
      var partySel = h('select', 'pra-select');
      var partyOpts = ['全部'].concat(parties);
      partyOpts.forEach(function (v) {
        var o = h('option', null, v === '全部' ? '全部客户' : v);
        o.value = v;
        partySel.appendChild(o);
      });
      partySel.addEventListener('change', function () {
        stt.party = str(partySel.value);
        st.issued.page = 1;
        renderIssued();
      });

      /* 类型下拉 */
      var typeSel = h('select', 'pra-select');
      ['全部'].concat(types).forEach(function (v) {
        var o = h('option', null, v === '全部' ? '全部类型' : v);
        o.value = v;
        typeSel.appendChild(o);
      });
      typeSel.addEventListener('change', function () {
        stt.type = str(typeSel.value);
        st.issued.page = 1;
        renderIssued();
      });

      /* 来源下拉 */
      var srcSel = h('select', 'pra-select');
      [['全部', '全部来源'], ['session', '本会话开具'], ['document', '按发票原件同步']].forEach(function (pair) {
        var o = h('option', null, pair[1]);
        o.value = pair[0];
        srcSel.appendChild(o);
      });
      srcSel.addEventListener('change', function () {
        stt.source = str(srcSel.value);
        st.issued.page = 1;
        renderIssued();
      });

      /* 关键词 */
      var kwInput = h('input', 'pra-input');
      kwInput.setAttribute('placeholder', '搜发票号 / 客户 / 货物 / 合同号');
      kwInput.addEventListener('input', function () {
        stt.kw = str(kwInput.value).trim();
        st.issued.page = 1;
        renderIssued();
      });

      var selBox = h('div', 'pra-sel-box');
      function labelled(labelText, control) {
        var lab = h('label', 'pra-inline-lab');
        add(lab, h('span', null, labelText), control);
        return lab;
      }
      add(selBox,
        labelled('客户', partySel),
        labelled('类型', typeSel),
        labelled('来源', srcSel),
        kwInput
      );

      add(toolbar, timeBox, dateBox, selBox);

      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '发票号码' },
        { label: '开票时间' },
        { label: '客户名称' },
        { label: '货物 / 服务' },
        { label: '类型' },
        { label: '不含税金额', cls: 'r' },
        { label: '税率' },
        { label: '税额', cls: 'r' },
        { label: '价税合计', cls: 'r' },
        { label: '来源' },
        { label: '操作' }
      ]);

      var summary = smallNote('');
      var foot = h('div', 'pra-pager');
      var info = h('div', 'pra-tnote', '');
      var btnPrev = button('上一页', 'pra-btn pra-btn-sm', function () {
        if (st.issued.page > 1) { st.issued.page--; renderIssued(); }
      });
      var btnNext = button('下一页', 'pra-btn pra-btn-sm', function () {
        var rows = filterIssued();
        var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (st.issued.page < pages) { st.issued.page++; renderIssued(); }
      });
      add(foot, info, btnPrev, btnNext);

      function today() {
        var d = new Date();
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      }
      function applyRange(key) {
        stt.from = '';
        stt.to = '';
        dateFrom.value = '';
        dateTo.value = '';
        if (key === '今天') { stt.from = today(); stt.to = today(); }
        else if (key === '本月') {
          var d = new Date();
          stt.from = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01';
          stt.to = today();
        } else if (key === '近7天') {
          var d2 = new Date();
          d2.setDate(d2.getDate() - 6);
          stt.from = d2.getFullYear() + '-' + pad2(d2.getMonth() + 1) + '-' + pad2(d2.getDate());
          stt.to = today();
        }
      }

      function filterIssued() {
        var kw = str(stt.kw).toLowerCase();
        return all.filter(function (x) {
          if (stt.party !== '全部' && x.party !== stt.party) return false;
          if (stt.type !== '全部' && x.docType !== stt.type) return false;
          if (stt.source !== '全部' && x.source !== stt.source) return false;
          if (stt.from && (!x.date || x.date < stt.from)) return false;
          if (stt.to && (!x.date || x.date > stt.to)) return false;
          if (kw) {
            var hay = (x.id + ' ' + x.party + ' ' + x.product + ' ' + x.contractId + ' ' + x.draftNo).toLowerCase();
            if (hay.indexOf(kw) < 0) return false;
          }
          return true;
        });
      }

      function renderIssued() {
        var rows = filterIssued();
        var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (st.issued.page > pages) st.issued.page = pages;
        if (st.issued.page < 1) st.issued.page = 1;
        var start = (st.issued.page - 1) * PAGE_SIZE;
        var slice = rows.slice(start, start + PAGE_SIZE);

        clear(t.tbody);
        if (!slice.length) {
          emptyRow(t.tbody, 12, all.length
            ? '当前筛选条件下没有已开发票，试试放宽「开票时间」或清除关键词'
            : '还没有已开发票：可在「新建开票业务」上传单据，或在「发票开具」台选择待开票事项提交开票');
        } else {
          slice.forEach(function (x, i) {
            var tr = h('tr');
            var op = button('查看发票', 'pra-btn pra-btn-sm', (function (row) {
              return function () { openIssuedPreview(row); };
            })(x));
            add(tr,
              td(String(start + i + 1), 'num'),
              td(text(x.id), 'first mono'),
              td(text(x.date || '—')),
              td(text(x.party)),
              td(text(x.product || '—')),
              td(typeTag(x.docType)),
              td(fmtMoney(x.amountExTax), 'num'),
              td(text(x.taxRate || '—')),
              td(fmtMoney(x.taxAmount), 'num'),
              td(fmtMoney(x.amountTotal), 'num'),
              td(x.source === 'document'
                ? h('span', 'pra-src-tag doc', '按原件同步')
                : h('span', 'pra-src-tag live', '本会话开具')),
              actionCell(op)
            );
            t.tbody.appendChild(tr);
          });
        }

        var total = 0, exTotal = 0, taxTotal = 0;
        rows.forEach(function (x) {
          total += num(x.amountTotal) || 0;
          exTotal += num(x.amountExTax) || 0;
          taxTotal += num(x.taxAmount) || 0;
        });
        var from = rows.length ? start + 1 : 0;
        var to = Math.min(start + PAGE_SIZE, rows.length);
        info.textContent = '筛选结果 ' + fmtInt(rows.length) + ' 张 / 共 ' + fmtInt(all.length) + ' 张 · 每页 ' +
          PAGE_SIZE + ' 张 · 第 ' + st.issued.page + '/' + pages + ' 页（显示第 ' + from + '–' + to + ' 张）';
        summary.textContent = '价税合计 ' + fmtMoney(total) + ' 元 · 不含税 ' + fmtMoney(exTotal) +
          ' 元 · 税额 ' + fmtMoney(taxTotal) + ' 元';
        btnPrev.disabled = st.issued.page <= 1;
        btnNext.disabled = st.issued.page >= pages;
      }

      function openIssuedPreview(x) {
        openInvoicePreview({
          invoiceType: x.docType,
          invoiceNo: x.id,
          issueDate: x.date,
          buyer: { name: x.party, taxNo: x.partyTaxNo },
          seller: { name: model.meta.company, taxNo: '91440300MA5H8K2X3Q' },
          items: x.items && x.items.length ? x.items : [{
            name: x.product, spec: '', unit: x.unit, qty: x.qty,
            unitPrice: x.qty ? round2((num(x.amountExTax) || 0) / x.qty) : null,
            amount: x.amountExTax, taxRate: x.taxRate, taxAmount: x.taxAmount
          }],
          amountExTax: x.amountExTax,
          taxRate: x.taxRate,
          taxAmount: x.taxAmount,
          amountTotal: x.amountTotal,
          remark: '发票号 ' + x.id + (x.contractId ? '；合同 ' + x.contractId : ''),
          draftNo: x.draftNo,
          statusLabel: '已开具',
          payee: model.meta.company,
          reviewer: '李娜',
          drawer: '田甜'
        });
      }

      add(p.body, toolbar, t.wrap, summary, foot);
      add(viewSec, pageHead('已开发票', '本会话开具与已同步的发票，可按开票时间 / 客户筛选'), p.panel);

      renderIssued();
    }

    function buildInvoices(viewSec) {
      var p = panel('开票台账', '本月开票记录');
      var toolbar = h('div', 'pra-toolbar');

      var typeSelect = h('select', 'pra-select');
      var options = ['全部'].concat(uniq(model.invoiceRows.map(function (r) { return r.docType; })));
      options.forEach(function (o) {
        var opt = h('option', null, o);
        opt.value = o;
        typeSelect.appendChild(opt);
      });
      typeSelect.addEventListener('change', function () {
        st.invoices.type = str(typeSelect.value);
        st.invoices.page = 1;
        renderInvoiceRows();
      });

      var sortBtn = button('金额排序：默认', 'pra-btn pra-btn-sm', function () {
        st.invoices.sort = st.invoices.sort === 'desc' ? 'asc' : st.invoices.sort === 'asc' ? 'none' : 'desc';
        sortBtn.textContent = st.invoices.sort === 'desc' ? '金额排序：降序 ↓' :
          st.invoices.sort === 'asc' ? '金额排序：升序 ↑' : '金额排序：默认';
        st.invoices.page = 1;
        renderInvoiceRows();
      });

      var filterLabel = h('label', 'pra-inline-lab');
      add(filterLabel, h('span', null, '类型'), typeSelect);
      add(toolbar, filterLabel, sortBtn);

      var t = makeTable([
        { label: '序号', cls: 'r' },
        { label: '发票号码' },
        { label: '类型' },
        { label: '购方' },
        { label: '金额（元）', cls: 'r', title: '台账金额（价税合计口径）' },
        { label: '日期' },
        { label: '状态' }
      ]);

      var foot = h('div', 'pra-pager');
      var info = h('div', 'pra-tnote', '');
      var btnPrev = button('上一页', 'pra-btn pra-btn-sm', function () {
        if (st.invoices.page > 1) { st.invoices.page--; renderInvoiceRows(); }
      });
      var btnNext = button('下一页', 'pra-btn pra-btn-sm', function () {
        var rows = currentInvoiceRows();
        var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (st.invoices.page < pages) { st.invoices.page++; renderInvoiceRows(); }
      });
      add(foot, info, btnPrev, btnNext);

      function currentInvoiceRows() {
        var rows = model.invoiceRows.filter(function (r) {
          return st.invoices.type === '全部' || r.docType === st.invoices.type;
        }).slice();
        if (st.invoices.sort === 'desc') {
          rows.sort(function (a, b) { return (num(b.amount) || 0) - (num(a.amount) || 0); });
        } else if (st.invoices.sort === 'asc') {
          rows.sort(function (a, b) { return (num(a.amount) || 0) - (num(b.amount) || 0); });
        }
        return rows;
      }

      function renderInvoiceRows() {
        var rows = currentInvoiceRows();
        var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        if (st.invoices.page > pages) st.invoices.page = pages;
        if (st.invoices.page < 1) st.invoices.page = 1;
        var start = (st.invoices.page - 1) * PAGE_SIZE;
        var slice = rows.slice(start, start + PAGE_SIZE);

        clear(t.tbody);
        if (!slice.length) {
          emptyRow(t.tbody, 7, '没有匹配的发票记录');
        } else {
          slice.forEach(function (r, i) {
            var tr = h('tr');
            add(tr,
              td(String(start + i + 1), 'num'),
              td(text(r.id), 'first mono'),
              td(typeTag(r.docType)),
              td(text(r.party)),
              td(fmtMoney(r.amount), 'num'),
              td(text(r.date)),
              td(r.status === 'session' ? statusChip('已开具（本会话）')
                : r.status === 'document' ? statusChip('已开具（数据集）')
                  : statusChip('已开具'))
            );
            t.tbody.appendChild(tr);
          });
        }

        var total = 0;
        rows.forEach(function (r) { total += num(r.amount) || 0; });
        var from = rows.length ? start + 1 : 0;
        var to = Math.min(start + PAGE_SIZE, rows.length);
        info.textContent = '共 ' + fmtInt(rows.length) + ' 张 · 金额合计 ' + fmtMoney(total) + ' 元 · 每页 ' +
          PAGE_SIZE + ' 张 · 第 ' + st.invoices.page + '/' + pages + ' 页（显示第 ' + from + '–' + to + ' 张）';
        btnPrev.disabled = st.invoices.page <= 1;
        btnNext.disabled = st.invoices.page >= pages;
      }

      if (!model.invoiceRows.length) {
        p.body.appendChild(callout('info', 'data.ledger 中没有类型含「发票」的记录，开票台账为空。'));
      }
      add(p.body, toolbar, t.wrap, foot);
      add(viewSec, pageHead('开票台账', '已开发票记录与金额分布'), p.panel);

      renderInvoiceRows();
    }

    /* ==================================================================
     * 11. 装配 7 个视图（按 VIEWS 顺序，用 key 取容器，避免顺序调整后错位）
     * ================================================================== */
    var viewByKey = {};
    VIEWS.forEach(function (v, i) { viewByKey[v.key] = viewEls[i]; });

    buildWorkbench(viewByKey.workbench);
    buildNewBusiness(viewByKey.newbusiness);
    buildPending(viewByKey.pending);
    buildRejected(viewByKey.rejected);
    buildLedger(viewByKey.ledger);
    buildIssue(viewByKey.issue);
    buildIssued(viewByKey.issued);
    buildInvoices(viewByKey.invoices);

    /* 用容器替换掉旧内容并挂载 */
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(root);

    /* ---------- 11.1 对外接口 ---------- */
    var api = {
      version: VERSION,
      show: show,
      openDraft: function (draft) {
        if (!draft) { toast('草稿为空，未回填'); return api; }
        st.draft = obj(draft);
        show('issue');
        fillForm(st.draft);
        toast('已由智能体草稿回填票面信息：' + text(st.draft.draftNo, '未编号') + '（请人工核对）');
        return api;
      },
      getFormState: getFormState,
      getState: function () {
        return {
          view: st.view,
          ledger: { cat: st.ledger.cat, kw: st.ledger.kw, page: st.ledger.page },
          pending: { region: st.pending.region, status: st.pending.status },
          invoices: { type: st.invoices.type, sort: st.invoices.sort, page: st.invoices.page },
          draft: st.draft
        };
      },
      model: model
    };

    if (typeof C.onReady === 'function') {
      try { C.onReady(api); } catch (e2) { /* 忽略外部回调异常 */ }
    }

    return api;
  }

  /* ==================================================================
   * 12. 挂载入口
   * ================================================================== */

  var current = null;

  function mount(container, data, ctx) {
    var box = resolveContainer(container);
    if (!box) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[practice] mount 失败：container 无效');
      }
      return { show: function () { return this; } };
    }
    current = createApp(box, data, ctx);
    return current;
  }

  var Practice = {
    version: VERSION,
    mount: mount,
    show: function (name) { return current ? current.show(name) : null; },
    openDraft: function (draft) { return current ? current.openDraft(draft) : null; },
    getFormState: function () { return current ? current.getFormState() : null; },
    /* 供其他模块复用的格式化工具（与契约第 7 节 TaxEngine.formatMoney 口径一致） */
    utils: {
      esc: esc,
      num: num,
      fmtMoney: fmtMoney,
      fmtWan: fmtWan,
      fmtRate: fmtRate
    }
  };

  if (typeof window !== 'undefined') window.Practice = Practice;
})();
