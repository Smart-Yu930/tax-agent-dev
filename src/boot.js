/* ==========================================================================
 * boot.js —— 应用外壳与路由
 * 顶部：品牌 / 系统名 / 大模型API设置 / 测试示例
 * 左侧：实务系统 6 模块 + 智能体 5 项
 * 右侧：内容区（实务系统 或 智能体视图）
 * ========================================================================== */
(function (root) {
  'use strict';

  var DATA = root.TAX_DATA || {};
  /* 实务系统按业务性质分成两组，顶部切换，避免台账与开票窗口混在一起 */
  var PRACTICE_GROUPS = [
    {
      key: 'biz', name: '开票工作台', desc: '开票业务全流程',
      views: [
        { key: 'workbench', name: '工作台预览', icon: 'grid' },
        { key: 'newbusiness', name: '新建开票业务', icon: 'plusfile' },
        { key: 'pending', name: '待开票清单', icon: 'list' },
        { key: 'rejected', name: '被驳回申请', icon: 'undo' },
        { key: 'issue', name: '发票开具', icon: 'receipt' },
        { key: 'issued', name: '已开发票', icon: 'checkdoc' }
      ]
    },
    {
      key: 'archive', name: '台账单据', desc: '单据与发票台账查询',
      views: [
        { key: 'ledger', name: '单据台账', icon: 'doc' },
        { key: 'invoices', name: '开票台账', icon: 'book' }
      ]
    }
  ];
  /* ---------- 统一图标（24×24 描边，round cap，currentColor） ---------- */
  var ICONS = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    plusfile: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v6M9 15h6"/>',
    list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1.2"/><circle cx="4" cy="12" r="1.2"/><circle cx="4" cy="18" r="1.2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12H9"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    checkdoc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="m9 15 2 2 4-4"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2z"/><path d="M8 7h8M8 11h8"/>',
    spark: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v3.4M12 17.6V21M3 12h3.4M17.6 12H21"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bookopen: '<path d="M12 6c-2-1.6-4.5-2-7-2v13c2.5 0 5 .4 7 2 2-1.6 4.5-2 7-2V4c-2.5 0-5 .4-7 2z"/><path d="M12 6v13"/>',
    chart: '<path d="M4 19V9M10 19V5M16 19v-6"/><path d="M2 21h20"/>',
    flow: '<rect x="3" y="4" width="6" height="5" rx="1.6"/><rect x="15" y="15" width="6" height="5" rx="1.6"/><path d="M9 6.5h4.5a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2H15"/>',
    dot: '<circle cx="12" cy="12" r="3"/>'
  };

  function iconSvg(name, cls) {
    var path = ICONS[name] || ICONS.dot;
    return '<svg class="ico' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' + path + '</svg>';
  }

  var PRACTICE_VIEWS = PRACTICE_GROUPS.reduce(function (acc, g) { return acc.concat(g.views); }, []);

  /* 顶部一级导航：业务分组 + 智能体页面平铺，取消左侧「智能体」独立区间 */
  var TOP_TABS = [
    { key: 'biz', name: '开票工作台', icon: 'grid', area: 'practice', view: 'workbench', group: 'biz', title: '开票业务全流程' },
    { key: 'archive', name: '台账单据', icon: 'book', area: 'practice', view: 'ledger', group: 'archive', title: '单据与发票台账查询' },
    { key: 'agentWork', name: '智能审核', icon: 'spark', area: 'agent', view: 'workspace', title: '单据上传、识别、审核与草稿' },
    { key: 'logs', name: '审核日志', icon: 'clock', area: 'agent', view: 'logs', title: '审核留痕与追溯' },
    { key: 'policies', name: '制度依据', icon: 'bookopen', area: 'agent', view: 'policies', title: '企业制度库与审核项映射' },
    { key: 'flow', name: '业务流程', icon: 'flow', area: 'app', view: 'flow', title: '开票系统工作流程总览' }
  ];
  var AGENT_VIEWS = [
    { key: 'workspace', name: '智能审核工作区' },
    { key: 'testExample', name: '测试示例' },
    { key: 'policies', name: '制度依据' },
    { key: 'logs', name: '审核日志' },
    { key: 'metrics', name: '验收指标' }
  ];

  var practiceApi = null;
  var practiceRoot = null;
  var current = { area: 'practice', view: 'workbench' };
  var ISSUED_KEY = 'dsh_issued_v1';
  var SESSION_KEY = 'dsh_session_v1';
  var suppressSave = false;          // 自检期间不落库
  var saveTimer = null;

  function dataSig() {
    var m = DATA.meta || {};
    return String(m.docCount || 0) + '|' + String(m.generatedAt || '');
  }

  /** 读取上次会话（数据指纹不一致说明数据已重建，旧状态作废） */
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var objS = JSON.parse(raw);
      if (!objS || objS.sig !== dataSig()) return null;
      return objS;
    } catch (e) { return null; }
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* 忽略 */ }
  }

  function saveSession() {
    if (suppressSave) return;
    try {
      var st = null;
      if (practiceApi && practiceApi.getState) {
        try { st = practiceApi.getState(); } catch (e2) { st = null; }
      }
      var rej = [];
      if (root.Agent && root.Agent.getRejected) {
        try { rej = root.Agent.getRejected() || []; } catch (e3) { rej = []; }
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        sig: dataSig(),
        savedAt: new Date().toISOString(),
        area: current.area,
        view: current.view,
        practice: st,
        rejected: rej
      }));
    } catch (e) { /* file:// 或隐私模式下忽略 */ }
  }

  function saveSessionSoon() {
    if (suppressSave) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSession, 350);
  }

  /** 视图别名：兼容分享链接与旧参数写法（invoiceLedger / desk / new / testExample …） */
  var PRACTICE_ALIAS = {
    workbench: 'workbench', desk: 'workbench', home: 'workbench',
    new: 'newbusiness', create: 'newbusiness', upload: 'newbusiness',
    topending: 'pending', list: 'pending',
    contracts: 'ledger', docs: 'ledger',
    invoice: 'issue', make: 'issue',
    invoiceledger: 'invoices', issueledger: 'invoices'
  };
  var AGENT_ALIAS = { audit: 'workspace', review: 'workspace', test: 'testExample', testexample: 'testExample', policy: 'policies' };

  /* 应用级页面（不属于实务系统与智能体） */
  var APP_VIEWS = [
    { key: 'flow', name: '业务流程' }
  ];

  function viewList(area) {
    if (area === 'agent') return AGENT_VIEWS;
    if (area === 'app') return APP_VIEWS;
    return PRACTICE_VIEWS;
  }

  /** 把任意视图写法归一为侧栏 key，未知/空值退回该区域默认视图 */
  function normalizeView(area, view) {
    var a = area === 'agent' ? 'agent' : (area === 'app' ? 'app' : 'practice');
    var raw = String(view === undefined || view === null ? '' : view).trim();
    var fallback = a === 'agent' ? 'workspace' : (a === 'app' ? 'flow' : 'workbench');
    if (!raw) return fallback;
    var list = viewList(a);
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === raw || list[i].name === raw) return list[i].key;
    }
    var alias = a === 'agent' ? AGENT_ALIAS : PRACTICE_ALIAS;
    return alias[raw.toLowerCase()] || fallback;
  }

  function isAgentViewKey(k) {
    var raw = String(k === undefined || k === null ? '' : k).trim();
    if (!raw) return false;
    for (var i = 0; i < AGENT_VIEWS.length; i++) if (AGENT_VIEWS[i].key === raw) return true;
    return !!AGENT_ALIAS[raw.toLowerCase()];
  }

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return s === null || s === undefined ? '' : String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function toast(msg, kind, ms) {
    var t = $('#appToast');
    if (!t) return;
    t.className = 'ag-toast on ' + (kind || '');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.style.display = 'none'; }, ms || 3200);
  }

  function buildShell() {
    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML =
      '<header class="top">' +
        '<div class="brand"><div class="logo">衡</div>' +
          '<div><b>华衡智造集团股份有限公司</b><em>' + esc(DATA.meta ? DATA.meta.period : '') + ' · 发票开具管理</em></div>' +
        '</div>' +
        '<div class="sysname">智能发票审核与开发助手<i>P1-01</i></div>' +
        '<div class="top-tabs" id="topTabs">' +
          TOP_TABS.map(function (t) {
            return '<button data-tab="' + t.key + '" title="' + esc(t.title || '') + '">' +
              iconSvg(t.icon || 'dot') + '<span>' + esc(t.name) + '</span></button>';
          }).join('') +
        '</div>' +
        '<div class="top-right">' +
          '<div class="top-user"><span>开票岗</span>李娜</div>' +
          '<button class="ag-btn ghost" id="topSync" title="用数据集内的发票原件反推本月已开具事项">同步已开票</button>' +
          '<button class="ag-btn ghost" id="topReset" style="display:none" title="清除本机保存的会话与已开具状态，恢复到初始数据">重置本机数据</button>' +
          '<button class="ag-btn ghost" id="topLlm">大模型API设置</button>' +
          '<button class="ag-btn gold" id="topTest">测试示例</button>' +
        '</div>' +
      '</header>' +
      '<div class="main">' +
        '<aside class="side" id="side"></aside>' +
        '<main class="content" id="content"></main>' +
      '</div>' +
      '<div class="ag-toast" id="appToast" style="display:none"></div>';
    return app;
  }

  /** 侧栏只显示当前实务分组；智能体页面为整页，隐藏侧栏 */
  function renderSide() {
    var side = $('#side');
    var main = document.querySelector('.main');
    if (!side) return;
    var showSide = current.area === 'practice';
    if (main) main.classList.toggle('side-hidden', !showSide);
    side.style.display = showSide ? '' : 'none';
    if (!showSide) { markNav(); return; }
    var g = currentGroup();
    var html = '<h4>' + esc(g ? g.name : '实务系统') + '</h4>';
    (g ? g.views : []).forEach(function (v) {
      html += '<button data-area="practice" data-view="' + v.key + '">' +
        iconSvg(v.icon || 'dot') + '<span>' + esc(v.name) + '</span></button>';
    });
    html += '<div class="side-note">实务系统负责岗位操作；识别、校验、回填与留痕由「智能审核」页签提供。</div>';
    side.innerHTML = html;
    Array.prototype.forEach.call(side.querySelectorAll('button'), function (b) {
      b.onclick = function () { go(b.dataset.area, b.dataset.view); };
    });
    markNav();
  }

  function groupOfView(view) {
    for (var i = 0; i < PRACTICE_GROUPS.length; i++) {
      var g = PRACTICE_GROUPS[i];
      for (var j = 0; j < g.views.length; j++) {
        if (g.views[j].key === view) return g;
      }
    }
    return PRACTICE_GROUPS[0];
  }

  function currentGroup() {
    return groupOfView(current.view);
  }

  function activeTabKey() {
    if (current.area === 'app') {
      var hit0 = TOP_TABS.filter(function (t) { return t.area === 'app' && t.view === current.view; })[0];
      return hit0 ? hit0.key : '';
    }
    if (current.area === 'agent') {
      // 验收指标已并入「制度依据」页，高亮仍落在制度依据
      var v = current.view === 'metrics' ? 'policies' : current.view;
      var hit = TOP_TABS.filter(function (t) { return t.area === 'agent' && t.view === v; })[0];
      return hit ? hit.key : '';
    }
    var g = currentGroup();
    var hit2 = TOP_TABS.filter(function (t) { return t.area === 'practice' && t.group === (g && g.key); })[0];
    return hit2 ? hit2.key : '';
  }

  function markNav() {
    Array.prototype.forEach.call(document.querySelectorAll('#side button'), function (b) {
      b.classList.toggle('on', b.dataset.area === current.area && b.dataset.view === current.view);
    });
    var active = activeTabKey();
    Array.prototype.forEach.call(document.querySelectorAll('#topTabs button'), function (b) {
      b.classList.toggle('on', b.dataset.tab === active);
    });
    var testBtn = document.getElementById('topTest');
    if (testBtn) testBtn.classList.toggle('on', current.area === 'agent' && current.view === 'testExample');
  }

  function go(area, view) {
    var prevGroup = currentGroup();
    var prevArea = current.area;
    current.area = area === 'agent' ? 'agent' : (area === 'app' ? 'app' : 'practice');
    current.view = normalizeView(current.area, view);
    var nextGroup = currentGroup();
    if (prevArea !== current.area || !prevGroup || !nextGroup || prevGroup.key !== nextGroup.key) renderSide();
    markNav();
    renderCurrent();
    saveSessionSoon();
    return current;
  }

  function renderCurrent() {
    var content = $('#content');
    if (!content) return;
    content.classList.remove('nopad');
    content.innerHTML = '';

    if (current.area === 'practice') {
      if (!practiceApi) {
        content.innerHTML = '<div class="ag-page"><div class="ag-empty big">实务系统模块未就绪（src/practice.js 未加载）</div></div>';
        return;
      }
      content.classList.add('nopad');
      content.appendChild(practiceRoot);
      practiceApi.show(current.view);
      return;
    }

    if (current.area === 'app') {
      renderFlowPage(content);
      return;
    }

    var holder = document.createElement('div');
    content.appendChild(holder);
    root.Agent.show(current.view, holder);
  }

  /**
   * 业务流程页：把开票系统的端到端流程、角色、输入输出与异常分支讲清楚
   */
  function renderFlowPage(container) {
    var STEPS = [
      { no: '01', name: '业务受理', icon: 'list', desc: '确认本月待开票事项（销售明细 / 合同），区分内销与出口业务。', module: '开票工作台 · 待开票清单', out: '待开票事项清单' },
      { no: '02', name: '单据上传', icon: 'plusfile', desc: '上传销售合同、验收单、出库单、开票申请单等原始单据，可多份同时上传。', module: '开票工作台 · 新建开票业务', out: '单据集合' },
      { no: '03', name: '识别与提取', icon: 'doc', desc: '按格式分流识别，抽取抬头、税号、金额、税率、日期等关键字段，并记录来源位置。', module: '智能审核 · 上传与识别', out: '字段 + 来源追溯' },
      { no: '04', name: '合规审核', icon: 'checkdoc', desc: '执行抬头一致性、税率正确性、金额一致性、开票范围、日期合理性五项检查，另做重复开票校验。', module: '智能审核 · 审核工作区', out: '通过 / 暂缓 / 不通过' },
      { no: '05', name: '草稿生成', icon: 'receipt', desc: '审核通过后自动全量回填开票要素，生成待确认开票草稿并高亮关键字段。', module: '智能审核 · 草稿确认区', out: '待确认草稿' },
      { no: '06', name: '人工确认开具', icon: 'spark', desc: '核对票面并二次确认，登记为已开具并写入发票池，防止同业务重复开票。', module: '智能审核 · 二次确认', out: '已开具发票' },
      { no: '07', name: '台账登记', icon: 'book', desc: '发票进入开票台账与「已开发票」清单，可按开票时间、客户、类型筛选与预览下载。', module: '开票工作台 · 已开发票', out: '发票台账' },
      { no: '08', name: '归档与追溯', icon: 'clock', desc: '审核日志全程留痕（时间、结果、操作人、依据单据、草稿号），支持导出审核报告与发票图。', module: '审核日志 / 制度依据', out: '审计留痕' }
    ];
    var BRANCHES = [
      { kind: 'bad', name: '审核不通过', desc: '金额、抬头、税率等冲突', action: '进入「被驳回申请」，修改申请信息后重新提交审核' },
      { kind: 'warn', name: '审核暂缓', desc: '证据缺失（如缺验收单），控制权未转移', action: '进入「被驳回申请」，补充单据后重新审核' },
      { kind: 'info', name: '暂不开票', desc: '数据侧判定未验收', action: '「补单据并重审」直接打开该合同装配单据' }
    ];
    var wrap = document.createElement('div');
    wrap.className = 'ag-page flow-page';

    var stepsHtml = STEPS.map(function (s) {
      return '<div class="flow-step">' +
        '<div class="flow-no">' + s.no + '</div>' +
        '<div class="flow-ico">' + iconSvg(s.icon || 'dot') + '</div>' +
        '<div class="flow-body">' +
          '<b>' + esc(s.name) + '</b>' +
          '<p>' + esc(s.desc) + '</p>' +
          '<div class="flow-meta"><span>模块：' + esc(s.module) + '</span><span>产出：' + esc(s.out) + '</span></div>' +
        '</div>' +
      '</div>';
    }).join('');

    var branchHtml = BRANCHES.map(function (b) {
      return '<div class="flow-branch ' + b.kind + '">' +
        '<b>' + esc(b.name) + '</b>' +
        '<span>' + esc(b.desc) + '</span>' +
        '<em>' + esc(b.action) + '</em>' +
      '</div>';
    }).join('');

    wrap.innerHTML =
      '<div class="ag-page-head"><b>业务流程</b><em>从业务受理到台账归档的端到端流程，共 8 个节点 · 3 类异常分支</em></div>' +
      '<div class="flow-lane">' + stepsHtml + '</div>' +
      '<h4 class="flow-h">异常分支（不影响主流程，处理后回到审核节点）</h4>' +
      '<div class="flow-branches">' + branchHtml + '</div>' +
      '<h4 class="flow-h">参与角色与产出</h4>' +
      '<div class="flow-roles">' +
        '<div><b>开票岗（销售会计）</b><span>受理业务、上传单据、核对票面、确认开具</span></div>' +
        '<div><b>财务复核</b><span>复核票面与台账，处理红冲与差异</span></div>' +
        '<div><b>系统（智能体）</b><span>识别提取、五项校验、草稿回填、留痕</span></div>' +
        '<div><b>审计/合规</b><span>调阅审核日志与制度依据，追溯证据链</span></div>' +
      '</div>' +
      '<div class="flow-cta">' +
        '<button class="ag-btn gold" id="flowGoBiz">进入开票工作台</button>' +
        '<button class="ag-btn ghost" id="flowGoArchive">查看台账单据</button>' +
        '<button class="ag-btn ghost" id="flowGoLogs">查看审核日志</button>' +
      '</div>';

    container.appendChild(wrap);
    var b1 = wrap.querySelector('#flowGoBiz');
    var b2 = wrap.querySelector('#flowGoArchive');
    var b3 = wrap.querySelector('#flowGoLogs');
    if (b1) b1.onclick = function () { go('practice', 'workbench'); };
    if (b2) b2.onclick = function () { go('practice', 'ledger'); };
    if (b3) b3.onclick = function () { go('agent', 'logs'); };
  }

  /** 实务系统与智能体共用同一份宿主上下文（toast / 导航 / 草稿回填 / 开具回写） */
  var appCtx = null;

  function buildAppCtx() {
    return {
      toast: toast,
      // 单参调用兼容：CTX.go('testExample') 视为智能体视图；CTX.go('agent','workspace') 视为完整坐标
      go: function (area, view) {
        if (view === undefined || view === null) {
          var only = String(area === undefined || area === null ? '' : area).trim();
          if (isAgentViewKey(only)) return go('agent', only);
          if (only === 'agent') return go('agent', 'workspace');
          if (only === 'practice') return go('practice', 'workbench');
          if (!only) return go('practice', 'workbench');
          return go('practice', only);
        }
        return go(area, view);
      },
      // 实务系统「工作台预览」模块任务卡：C.goView('agent','workspace')
      goView: function (area, view) { return go(area, view); },
      goAgent: function (filter) {
        // 实务系统 → 智能体：把待开票事项装配为一次开票申请
        var row = null;
        if (filter && filter.row) row = filter.row;
        else if (filter && filter.product) row = filter;
        go('agent', 'workspace');
        if (!row) return;
        setTimeout(function () {
          var app = assembleFromRow(row);
          // 实务系统匹配不到证据时，退回按它提供的单据（排除已开具发票——那是答案，不是本次开票证据）
          if (!app.documents.length && filter && filter.documents) {
            app.documents = filter.documents.filter(function (d) {
              return d && d.id && !/发票$/.test(d.docType || '');
            });
          }
          if (root.Agent.loadApplication && app.documents.length) {
            root.Agent.loadApplication(app);
            toast('已装配申请：' + row.product + ' · ' + row.customer + '（' + app.documents.length + ' 份单据）', '', 4200);
          } else {
            toast('该事项未匹配到合同/验收单，请在智能体工作区手动选择单据', 'warn', 4600);
          }
        }, 60);
      },
      openDraft: function (draft) {
        if (!draft) { toast('草稿为空，未回填', 'warn'); return; }
        if (!root.Practice || !practiceApi) { toast('实务系统未就绪，无法回填', 'warn'); return; }
        // 先切到开票台，再在下一拍回填：renderCurrent() 只重挂容器、不重建实例，
        // 但若期间发生过 initPractice()，practiceApi 已被替换，这里取最新实例并用 show('issue') 兜底。
        go('practice', 'issue');
        setTimeout(function () {
          var inst = practiceApi;
          if (!inst) { toast('实务系统未就绪，无法回填', 'warn'); return; }
          if (inst.show) inst.show('issue');
          var done = false;
          if (typeof inst.openDraft === 'function') { inst.openDraft(draft); done = true; }
          else if (root.Practice && typeof root.Practice.openDraft === 'function') { root.Practice.openDraft(draft); done = true; }
          if (!done) toast('实务系统未提供回填入口，请手工录入票面', 'warn');
        }, 30);
      },
      // 实务系统「发票开具」台提交 → 同一套开票状态回写链路
      submitInvoice: function (form) {
        return submitInvoiceFromPractice(form);
      },
      // 实务系统「新建开票业务」→ 智能体上传区
      openUploader: function () {
        go('agent', 'workspace');
        setTimeout(function () {
          if (root.Agent && root.Agent.focusUpload) {
            root.Agent.focusUpload();
            // 工作区刚重挂时上传区可能还没落 DOM，一拍后补一次聚焦
            if (!$('#zoneUp')) setTimeout(function () { if (root.Agent.focusUpload) root.Agent.focusUpload(); }, 120);
          } else {
            toast('已切换到智能审核工作区，请在上方「上传与识别」区选择单据', '', 4200);
          }
        }, 80);
      },
      // 实务系统内任何筛选/页签/表单变更 → 防抖落库
      onStateChange: function () { saveSessionSoon(); },
      // 实务系统内部切视图（看板任务卡 / 开具台跳转）→ 同步左侧导航高亮，不重挂内容
      onShow: function (view) {
        var v = normalizeView('practice', view);
        if (v) { current.area = 'practice'; current.view = v; markNav(); saveSessionSoon(); }
      },
      // 智能体「确认开具」→ 回写实务系统状态（待开票清单移除 + 开票台账新增）
      onIssued: function (issued) {
        applyIssued(issued);
      },
      /* ---------- 被驳回申请：查看 / 补充单据 / 修改信息 / 重新审核 ---------- */
      getRejected: function () {
        return (root.Agent && root.Agent.getRejected) ? root.Agent.getRejected() : [];
      },
      openRejected: function (no) {
        if (!root.Agent || !root.Agent.openRejected) { toast('智能体未就绪', 'warn'); return false; }
        var ok = root.Agent.openRejected(no);
        if (ok) go('agent', 'workspace');
        return ok;
      },
      patchRejected: function (no, patch) {
        if (!root.Agent || !root.Agent.patchRejected) return null;
        return root.Agent.patchRejected(no, patch);
      },
      // 数据侧「暂不开票」事项：装配该合同 + 到货签收单 + 出库单，进入工作区补单据
      openContractFix: function (contractId) {
        var docs = DATA.documents || [];
        var contract = docs.filter(function (d) { return d.id === contractId; })[0];
        if (!contract) { toast('未找到合同 ' + contractId, 'warn'); return false; }
        var party = contract.party;
        var it = (contract.items && contract.items[0]) || {};
        var sign = docs.filter(function (d) { return d.docType === '到货签收单' && d.party === party; })[0];
        var stockOut = docs.filter(function (d) {
          return d.docType === '出库单' && d.party === party && d.items && d.items[0] && d.items[0].qty === it.qty;
        })[0];
        var app = {
          applicationNo: 'INV-' + contractId,
          applicant: '李娜',
          applyDate: contract.docDate,
          region: /越南|境外|HMC 制造/.test(party) ? '出口' : '内销',
          declaredAmount: contract.amountTotal,
          declaredCustomer: party,
          customer: party,
          product: it.name || '',
          documents: [contract, sign, stockOut].filter(Boolean),
          source: '被驳回申请 · 暂不开票 · ' + contractId
        };
        go('agent', 'workspace');
        setTimeout(function () {
          if (root.Agent && root.Agent.loadApplication) root.Agent.loadApplication(app);
        }, 60);
        return true;
      },
      retryRejected: function (no) {
        if (!root.Agent || !root.Agent.retryRejected) { toast('智能体未就绪', 'warn'); return false; }
        var ok = root.Agent.retryRejected(no);
        if (ok) go('agent', 'workspace');
        return ok;
      },
      getState: function () { return { pool: root.Agent.getPool(), logs: root.Agent.getLogs() }; }
    };
  }

  function initPractice() {
    if (!root.Practice) {
      console.warn('[boot] window.Practice 未加载，实务系统不可用');
      return;
    }
    if (!appCtx) appCtx = buildAppCtx();
    // 重挂前把当前筛选/页码带过去（草稿与手选项不带，避免过期数据回流）
    if (practiceApi && practiceApi.getState) {
      try {
        var carry = practiceApi.getState();
        carry.draft = null;
        carry.pickedRow = null;
        DATA.__session = carry;
      } catch (e3) { /* 忽略 */ }
    }
    practiceRoot = document.createElement('div');
    practiceApi = root.Practice.mount(practiceRoot, DATA, appCtx);
    // 智能体与实务系统共用上下文，确保「确认开具」能回写到待开票清单
    if (root.Agent && root.Agent.setContext) root.Agent.setContext(appCtx);
  }

  /* ------------------------------------------ 已开具状态的持久化与重置 */

  function loadIssued() {
    try {
      var raw = localStorage.getItem(ISSUED_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveIssued(list) {
    try { localStorage.setItem(ISSUED_KEY, JSON.stringify(list || [])); } catch (e) { /* file:// 下可能不可用 */ }
  }

  /** 只持久化本会话开具的记录：数据集反推的（poolKind==='document'）不入库，每次启动重新反推即可 */
  function sessionOnlyIssued() {
    return (DATA.sessionInvoices || []).filter(function (x) {
      return x && x.id && x.poolKind !== 'document';
    });
  }

  /** 顶部「重置开票状态」只在有可持久化记录时显示 */
  function refreshTopReset() {
    var btn = $('#topReset');
    if (!btn) return;
    btn.style.display = (loadIssued().length || sessionOnlyIssued().length) ? '' : 'none';
  }

  /** 启动时恢复已开具状态：回写销售明细行 + 回填发票池（保证重复开票拦截跨刷新有效） */
  function restoreIssued() {
    var list = loadIssued();
    if (!list.length) return 0;
    DATA.sessionInvoices = DATA.sessionInvoices || [];
    list.forEach(function (inv) {
      if (!inv || !inv.id) return;
      if (!DATA.sessionInvoices.some(function (x) { return x.id === inv.id; })) DATA.sessionInvoices.push(inv);
      var row = findSalesRowFor(inv);
      if (row) {
        row.issueStatus = '已开具';
        row.invoiceNo = inv.id;
        row.issuedAt = inv.docDate;
        row.draftNo = inv.draftNo || null;
      }
    });
    if (root.Agent && root.Agent.seedPool) root.Agent.seedPool(list);
    return list.length;
  }

  function clearIssuedState() {
    try { localStorage.removeItem(ISSUED_KEY); } catch (e) { /* 忽略 */ }
    DATA.sessionInvoices = [];
    (DATA.tables && DATA.tables.sales ? DATA.tables.sales : []).forEach(function (r) {
      delete r.issueStatus; delete r.invoiceNo; delete r.issuedAt; delete r.draftNo;
      delete r.issueSource; // 数据集反推的标记一并清掉
    });
    if (root.Agent && root.Agent.resetPool) root.Agent.resetPool();
    refreshTopReset();
  }

  /** 在销售明细行定位本次开具对应的待开票事项 */
  function findSalesRowFor(issued) {
    var sales = (DATA.tables && DATA.tables.sales) || [];
    if (issued.contractId) {
      var byContract = sales.filter(function (r) {
        return r.evidence && r.evidence.contract === issued.contractId;
      })[0];
      if (byContract) return byContract;
    }
    var name = issued.product || (issued.items && issued.items[0] ? issued.items[0].name : null);
    return sales.filter(function (r) {
      if (r.customer !== issued.party) return false;
      if (name && r.product !== name) return false;
      var want = Math.round(r.amount * (r.region === '出口' ? 1 : 1.13) * 100) / 100;
      return Math.abs(want - issued.amountTotal) <= 1;
    })[0] || null;
  }

  /** 按实务系统「发票开具」台的表单值定位待开票事项 */
  function findSalesRowByForm(form) {
    var f = form || {};
    var sales = (DATA.tables && DATA.tables.sales) || [];
    var buyer = String(f.buyerName || '').trim();
    if (!buyer) return null;
    var cand = sales.filter(function (r) { return r.customer === buyer; });
    var goods = String(f.goods || '').trim();
    if (goods && cand.length > 1) {
      var byGoods = cand.filter(function (r) {
        return r.product === goods || r.product.indexOf(goods) >= 0 || goods.indexOf(r.product) >= 0;
      });
      if (byGoods.length) cand = byGoods;
    }
    var total = f.amountTotal;
    if (cand.length > 1 && total != null) {
      var byAmt = cand.filter(function (r) {
        var want = Math.round(r.amount * (r.region === '出口' ? 1 : 1.13) * 100) / 100;
        return Math.abs(want - total) <= 1;
      });
      if (byAmt.length) cand = byAmt;
    }
    return cand[0] || null;
  }

  function nextInvoiceNo() {
    var n = (DATA.sessionInvoices || []).filter(function (x) {
      return String(x.id || '').indexOf('FP-SESSION-') === 0;
    }).length + 1;
    return 'FP-SESSION-' + String(n).padStart(3, '0');
  }

  /** 实务系统「发票开具」台提交：与智能体「确认开具」走同一套回写 */
  function submitInvoiceFromPractice(form) {
    var f = form || {};
    var row = findSalesRowByForm(f);
    if (!row) {
      return '票面校验通过并已登记。该业务未匹配到本月销售明细，待开票状态未变更。';
    }
    if (row.issueStatus === '已开具') {
      return '该业务已开具（发票 ' + (row.invoiceNo || '—') + '），无需重复登记。';
    }
    var rateTxt = String(f.taxRate || '');
    var isExport = row.region === '出口' || /^0%?$/.test(rateTxt);
    var issued = {
      id: nextInvoiceNo(),
      docType: isExport ? '出口发票' : '增值税专用发票',
      party: row.customer, docDate: row.date,
      amountTotal: f.amountTotal, amountExTax: f.amountExTax, taxAmount: f.taxAmount,
      taxRate: f.taxRate,
      items: [{ name: row.product, qty: row.qty, amount: f.amountExTax }],
      poolKind: 'session', draftNo: null,
      contractId: row.evidence ? row.evidence.contract : null,
      customer: row.customer, product: row.product, source: '发票开具台提交'
    };
    if (root.Agent && root.Agent.addPool) root.Agent.addPool(issued);
    var msg = applyIssued(issued);
    // applyIssued 会重挂实务系统，实务系统自己的提示条随之失效，回执由宿主统一提示
    toast(msg);
    return msg;
  }

  /**
   * 按数据集内的发票原件同步开票状态（显式操作，不自动执行）
   * 匹配口径：购买方 + 开票品名 + 价税合计（±1 元）
   */
  function syncIssuedFromDocuments() {
    var docs = DATA.documents || [];
    var sales = (DATA.tables && DATA.tables.sales) || [];
    var invoices = docs.filter(function (d) {
      return d.docType === '增值税专用发票' || d.docType === '出口发票';
    });
    var matched = 0;
    sales.forEach(function (row) {
      if (row.issueStatus === '已开具') return;
      var want = Math.round(row.amount * (row.region === '出口' ? 1 : 1.13) * 100) / 100;
      var hit = invoices.filter(function (d) {
        if (d.party !== row.customer) return false;
        if (d.amountTotal === null || Math.abs(d.amountTotal - want) > 1) return false;
        var name = d.items && d.items[0] ? d.items[0].name : '';
        return !name || name === row.product;
      })[0];
      if (!hit) return;
      row.issueStatus = '已开具';
      row.invoiceNo = hit.invoiceNo || hit.id;
      row.issuedAt = hit.docDate;
      row.issueSource = 'dataset';
      DATA.sessionInvoices = DATA.sessionInvoices || [];
      if (!DATA.sessionInvoices.some(function (x) { return x.id === hit.id || x.invoiceDocId === hit.id; })) {
        DATA.sessionInvoices.push({
          id: hit.invoiceNo || hit.id, invoiceDocId: hit.id, docType: hit.docType,
          party: hit.party, docDate: hit.docDate, amountTotal: hit.amountTotal,
          amountExTax: hit.amountExTax, taxAmount: hit.taxAmount, taxRate: hit.taxRate,
          items: hit.items, poolKind: 'document'
        });
      }
      matched++;
    });
    return matched;
  }

  /** 把「已开具」写回数据并重挂实务系统（KPI / 待开票清单 / 开票台账一并刷新） */
  function applyIssued(issued) {
    var row = findSalesRowFor(issued);
    var first = !(DATA.sessionInvoices || []).some(function (x) { return x.id === issued.id; });
    if (row) {
      row.issueStatus = '已开具';
      row.invoiceNo = issued.id;
      row.issuedAt = issued.docDate;
      row.draftNo = issued.draftNo || null;
      delete row.issueSource; // 本会话真实开具，不再标记为数据集反推
    }
    DATA.sessionInvoices = DATA.sessionInvoices || [];
    if (first) DATA.sessionInvoices.push(issued);
    // 只持久化本会话开具的记录；数据集反推项（poolKind==='document'）不落库
    saveIssued(sessionOnlyIssued());
    refreshTopReset();

    // 重挂实务系统并自动跳转到待开票清单，避免用户以为开票状态未生效
    if (root.Practice && practiceRoot) {
      initPractice();
      go('practice', 'pending');
    }
    saveSessionSoon();
    if (row) {
      return '开具完成：' + row.product + ' · ' + row.customer + ' · 发票 ' + issued.id + ' 已登记；待开票列表已更新。';
    }
    return '已开具 ' + issued.id + '，但未找到对应销售明细行；已写入开票台账。';
  }

  /** 供实务系统调用：把一条待开票事项装配为一次开票申请 */
  function assembleFromRow(row, seq) {
    var E = root.TaxEngine;
    var docs = DATA.documents;
    var byId = {};
    docs.forEach(function (d) { byId[d.id] = d; });

    // 优先用构建期预计算的证据；无 evidence 时按「客户 + 产品 + 数量 + 金额」匹配
    if (row.evidence && row.evidence.docs && row.evidence.docs.length) {
      var ev = row.evidence;
      var evDocs = [byId[ev.contract], byId[ev.acceptance], byId[ev.stockOut]].filter(Boolean);
      return {
        applicationNo: 'INV-2025-12-' + String((seq || 0) + 1).padStart(3, '0'),
        applicant: '李娜', applyDate: row.date, region: row.region,
        declaredAmount: byId[ev.contract] ? byId[ev.contract].amountTotal : null,
        declaredCustomer: row.customer, customer: row.customer, product: row.product,
        documents: evDocs,
        source: '待开票清单 · ' + row.product + ' · ' + row.customer
      };
    }

    var wantTotal = E.r2(row.amount * (row.region === '出口' ? 1 : 1.13));
    var cand = docs.filter(function (d) { return d.party === row.customer; });
    function byAmount(types, target) {
      return cand.filter(function (d) { return types.indexOf(d.docType) >= 0 && d.amountTotal !== null && Math.abs(d.amountTotal - target) < 0.01; });
    }
    var contracts = byAmount(['销售合同'], wantTotal).filter(function (d) { return d.items[0] && d.items[0].name === row.product; });
    if (!contracts.length) contracts = byAmount(['销售合同'], wantTotal);
    if (contracts.length > 1) contracts = contracts.filter(function (d) { return d.items[0] && d.items[0].qty === row.qty; });
    var accs = byAmount(['验收单'], row.amount);
    if (accs.length > 1) {
      var named = accs.filter(function (d) { return d.items[0] && d.items[0].name === row.product; });
      if (named.length) accs = named;
    }
    var cks = cand.filter(function (d) { return d.docType === '出库单' && d.items[0] && d.items[0].qty === row.qty; });
    if (cks.length > 1) {
      var byDate = cks.filter(function (d) { return d.docDate === row.date; });
      if (byDate.length) cks = byDate;
    }
    var contract = contracts[0] || null;
    return {
      applicationNo: 'INV-2025-12-' + String((seq || 0) + 1).padStart(3, '0'),
      applicant: '李娜', applyDate: row.date, region: row.region,
      declaredAmount: contract ? contract.amountTotal : null,
      declaredCustomer: row.customer, customer: row.customer, product: row.product,
      documents: [contract, accs[0] || null, cks[0] || null].filter(Boolean),
      source: '待开票清单 · ' + row.product + ' · ' + row.customer
    };
  }
  root.__assembleFromRow = assembleFromRow;

  function bindTop() {
    $('#topLlm').onclick = function () {
      // 复用智能体的设置弹窗
      go('agent', 'workspace');
      setTimeout(function () {
        var btn = document.querySelector('#btnLlm');
        if (btn) btn.click();
        else toast('请先在「智能审核工作区」中打开大模型设置', 'warn');
      }, 60);
    };
    $('#topTest').onclick = function () { go('agent', 'testExample'); };
    // 顶部一级导航切换（业务分组 + 智能体页面）
    Array.prototype.forEach.call(document.querySelectorAll('#topTabs button'), function (b) {
      b.onclick = function () {
        var t = TOP_TABS.filter(function (x) { return x.key === b.dataset.tab; })[0];
        if (!t) return;
        go(t.area, t.view);
      };
    });
    // 顶部「同步已开票」：用数据集内的发票原件反推本月已开具（显式操作，不入 localStorage）
    var topSync = $('#topSync');
    if (topSync) {
      topSync.onclick = function () {
        var n = syncIssuedFromDocuments();
        refreshTopReset();
        if (root.Practice) initPractice(); // 重挂实务系统，KPI / 待开票清单按新状态重算
        go('practice', 'pending');
        if (n > 0) {
          toast('已按发票原件同步 ' + n + ' 项为「已开具」，已从待开票清单移除（仅本次会话，刷新可恢复初始清单）', '', 6200);
        } else {
          toast('没有可同步的发票（可能已全部同步，或本月开票已全部完成）', 'warn');
        }
        return n;
      };
    }
    var topReset = $('#topReset');
    if (topReset) {
      refreshTopReset();
      topReset.onclick = function () {
        clearIssuedState();
        clearSession();
        toast('已清除已开具状态，正在恢复初始待开票清单…');
        setTimeout(function () { location.reload(); }, 400);
      };
    }
    Array.prototype.forEach.call(document.querySelectorAll('#side button'), function (b) {
      b.onclick = function () { go(b.dataset.area, b.dataset.view); };
    });
  }

  root.App = { boot: boot, go: go, assembleFromRow: assembleFromRow, selftest: selftest };

  /* ------------------------------------------------- 路由（支持分享链接） */

  /** 解析分享链接；hashStr 省略时读 location.hash（自检里可传入样例串校验） */
  function parseHash(hashStr) {
    var src = hashStr === undefined || hashStr === null ? (location.hash || '') : String(hashStr);
    var raw = src.replace(/^#\/?/, '');
    if (!raw) return null;
    var parts = raw.split('/');
    if (parts[0] === 'demo') return { area: 'agent', view: 'workspace', demo: parts[1] || '1' };
    // #selftest 只触发自检，不改变落地视图（避免 current.view 与侧栏高亮脱节）
    if (parts[0] === 'selftest') return { area: 'practice', view: 'workbench', selftest: true };
    var area = parts[0] === 'agent' ? 'agent' : (parts[0] === 'app' ? 'app' : 'practice');
    // 未知/穿越的视图名统一退回该区域默认视图，保证 current 与高亮一致
    return { area: area, view: normalizeView(area, parts[1]) };
  }

  /** 演示直达：装配一条待开票事项并立即审核（便于分享与截图） */
  function runDemo(which) {
    var app;
    if (String(which) === 'tc022') {
      var ht = DATA.documents.filter(function (d) { return d.id === 'HT-202512-002'; })[0];
      var sg = DATA.documents.filter(function (d) { return d.docType === '到货签收单'; })[0];
      var ck = DATA.documents.filter(function (d) {
        return d.docType === '出库单' && d.party === '上海衡远机电设备有限公司' && d.items[0] && d.items[0].qty === 2;
      })[0];
      app = {
        applicationNo: 'INV-2025-12-023', applicant: '李娜', applyDate: '2025-12-05', region: '内销',
        declaredAmount: ht.amountTotal, declaredCustomer: '上海衡远机电设备有限公司',
        customer: '上海衡远机电设备有限公司', product: '五轴数控机床 HMC-800',
        documents: [ht, sg, ck].filter(Boolean), source: 'TC-022 · 未验收 2 台（暂缓开票场景）'
      };
    } else {
      var idx = Math.max(0, Math.min(DATA.tables.sales.length - 1, Number(which) - 1 || 0));
      app = assembleFromRow(DATA.tables.sales[idx], idx);
    }
    go('agent', 'workspace');
    setTimeout(function () {
      root.Agent.loadApplication(app);
      setTimeout(function () {
        var b = document.querySelector('#btnAudit');
        if (b) b.click();
      }, 120);
    }, 80);
  }

  window.addEventListener('hashchange', function () {
    var p = parseHash();
    if (p && !p.selftest) go(p.area, p.view);
  });

  /* ------------------------------------------------------------ 自检脚本 */

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /**
   * 浏览器端全链路自检：6 个实务模块渲染 + 22 项待开票事项 + TC-022 暂缓 + 测试示例
   * 结果写入 #selftestResult（供无头浏览器抓取）
   */
  async function selftest() {
    var res = { steps: [], failed: 0, startedAt: new Date().toISOString() };
    function step(name, ok, detail) {
      res.steps.push({ name: name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
      if (!ok) res.failed++;
    }

    // 0. 干净起点：清空会话与已开具的持久化，并暂停落库，保证断言可重复
    suppressSave = true;
    clearSession();
    clearIssuedState();
    (DATA.tables && DATA.tables.sales ? DATA.tables.sales : []).forEach(function (r) {
      delete r.issueStatus; delete r.invoiceNo; delete r.issuedAt; delete r.draftNo;
    });
    DATA.sessionInvoices = [];
    if (root.Agent.resetPool) root.Agent.resetPool();
    initPractice();
    step('自检起点：开票状态已重置', true, '已清空 localStorage 与内存标记');

    // 1. 实务系统 6 模块
    for (var i = 0; i < PRACTICE_VIEWS.length; i++) {
      var v = PRACTICE_VIEWS[i];
      go('practice', v.key);
      await sleep(20);
      var c = $('#content');
      var act = c ? c.querySelector('.pra-view.on') : null;
      var len = act ? act.textContent.replace(/\s+/g, '').length : 0;
      var rows = act ? act.querySelectorAll('tbody tr').length : 0;
      step('实务模块 · ' + v.name, len > 80, '文本 ' + len + ' 字 / 表格行 ' + rows);
    }

    // 2. 测试示例模块
    go('agent', 'testExample');
    await sleep(40);
    var tst = root.Agent._runTestExamples();
    step('测试示例 · testCase1 通过场景', tst.ok1, tst.a.r.resultLabel);
    step('测试示例 · testCase2 不通过场景', tst.ok2, tst.b.r.resultLabel);

    // 3. 22 项待开票事项 + TC-022，走真实 UI 流程
    var rowsData = DATA.tables.sales;
    var passCnt = 0, draftCnt = 0;
    for (var k = 0; k < rowsData.length; k++) {
      var app = assembleFromRow(rowsData[k], k);
      go('agent', 'workspace');
      await sleep(15);
      root.Agent.loadApplication(app);
      await sleep(40);
      var btn = document.querySelector('#btnAudit');
      if (btn) btn.click(); else { step('审核按钮缺失 · 第' + (k + 1) + '项', false, '未找到 #btnAudit'); continue; }
      await sleep(200);
      var st = root.Agent._state;
      var okRow = st.audit && st.audit.result === 'pass' && st.draft;
      if (st.audit && st.audit.result === 'pass') passCnt++;
      if (st.draft) draftCnt++;
      if (!okRow) step('待开票事项 ' + (k + 1) + ' · ' + rowsData[k].product, false, st.audit ? st.audit.summary : '无审核结果');
    }
    step('22 项待开票事项全部通过并生成草稿', passCnt === rowsData.length && draftCnt === rowsData.length, '通过 ' + passCnt + '/' + rowsData.length + '，草稿 ' + draftCnt);

    // 4. TC-022 暂缓
    var ht = DATA.documents.filter(function (d) { return d.id === 'HT-202512-002'; })[0];
    var sg = DATA.documents.filter(function (d) { return d.docType === '到货签收单'; })[0];
    var ck = DATA.documents.filter(function (d) {
      return d.docType === '出库单' && d.party === '上海衡远机电设备有限公司' && d.items[0] && d.items[0].qty === 2;
    })[0];
    var app22 = {
      applicationNo: 'INV-2025-12-023', applicant: '李娜', applyDate: '2025-12-05', region: '内销',
      declaredAmount: ht.amountTotal, declaredCustomer: '上海衡远机电设备有限公司',
      documents: [ht, sg, ck].filter(Boolean)
    };
    go('agent', 'workspace');
    await sleep(15);
    root.Agent.loadApplication(app22);
    await sleep(40);
    var b22 = document.querySelector('#btnAudit');
    if (b22) { b22.click(); await sleep(200); }
    var st22 = root.Agent._state;
    step('TC-022 未验收 → 暂缓开票', st22.audit && st22.audit.result === 'suspend' && !st22.draft,
      st22.audit ? st22.audit.resultLabel + ' · 草稿' + (st22.draft ? '已生成' : '未生成') : '无结果');

    // 5. 草稿确认 → 二次确认 → 正式开具 → 发票池
    go('agent', 'workspace');
    await sleep(15);
    root.Agent.loadApplication(assembleFromRow(rowsData[0], 0));
    await sleep(40);
    var b0 = document.querySelector('#btnAudit');
    if (b0) { b0.click(); await sleep(250); }
    var confirmBtn = document.querySelector('#btnConfirmIssue');
    if (confirmBtn) {
      confirmBtn.click();
      await sleep(60);
      var ckb = document.querySelector('#ckConfirm');
      var doBtn = document.querySelector('#btnDoIssue');
      if (ckb && doBtn) {
        ckb.checked = true;
        ckb.dispatchEvent(new Event('change'));
        await sleep(20);
        doBtn.click();
        await sleep(120);
      }
      step('二次确认开具 → 写入发票池', root.Agent.getPool().length === 1, '发票池 ' + root.Agent.getPool().length + ' 张');
    } else {
      step('二次确认按钮存在', false, '未找到 #btnConfirmIssue');
    }

    // 5b. 开具后自动跳转至待开票列表，并验证状态联动
    var issuedId = root.Agent.getPool().length ? root.Agent.getPool()[0].id : '';
    step('开具完成后自动跳转待开票列表', current.area === 'practice' && current.view === 'pending', current.area + '/' + current.view);
    var lsOK = true;
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch (e) { lsOK = false; }
    res.localStorage = lsOK;
    if (lsOK) {
      step('已开具状态已持久化到本机', loadIssued().length === 1, 'localStorage 记录 ' + loadIssued().length + ' 条');
    } else {
      step('localStorage 不可用（file:// 限制）→ 降级为刷新前有效', true, '已按 try/catch 降级，不影响当前会话');
    }
    // 工作台正在改造为看板：此处只校验 KPI，不再依赖工作台表格行数（行数校验改到「待开票清单」）
    go('practice', 'workbench');
    await sleep(70);
    var kpiCards = Array.prototype.slice.call(document.querySelectorAll('#content .pra-view.on .pra-kpi'));
    var kpiCard = kpiCards.filter(function (c) { return (c.textContent || '').indexOf('待开票事项') >= 0; })[0];
    var kpiBox = kpiCard ? kpiCard.querySelector('b') : null;
    var kpiTxt = kpiBox ? kpiBox.textContent.trim() : '';
    step('工作台「待开票事项」KPI 已减 1', kpiTxt === String(rowsData.length - 1),
      'KPI=' + kpiTxt + '，期望 ' + (rowsData.length - 1));

    go('practice', 'pending');
    await sleep(70);
    var pv = document.querySelector('#content .pra-view.on');
    var plist = pv ? pv.querySelectorAll('tbody tr').length : -1;
    step('待开票清单已移除该事项', plist === rowsData.length - 1, '行数 ' + plist + '，期望 ' + (rowsData.length - 1));
    // 待开票清单只保留「区域」筛选，不再提供开票状态筛选
    var pendingChips = pv ? Array.prototype.slice.call(pv.querySelectorAll('.pra-chip')).map(function (b) {
      return b.textContent.trim();
    }) : [];
    var pendingLabels = pv ? Array.prototype.slice.call(pv.querySelectorAll('.pra-chip-label')).map(function (e) {
      return e.textContent.trim();
    }) : [];
    step('待开票清单已删除「开票状态」筛选（仅保留区域）',
      pendingLabels.length === 1 && pendingLabels[0] === '区域' &&
      pendingChips.indexOf('已开具') < 0 &&
      pendingChips.indexOf('未验收暂缓') < 0,
      '筛选项 ' + pendingLabels.join('+') + '：' + pendingChips.join(' / '));

    go('practice', 'invoiceLedger');
    await sleep(70);
    var iv = document.querySelector('#content .pra-view.on');
    step('开票台账已新增本会话发票', !!iv && !!issuedId && iv.textContent.indexOf(issuedId) >= 0,
      iv ? (iv.textContent.indexOf(issuedId) >= 0 ? '含 ' + issuedId : '未含 ' + issuedId) : '无视图');
    step('开票台账标注「已开具（本会话）」', !!iv && iv.textContent.indexOf('已开具（本会话）') >= 0, '状态标记存在');

    // 6. 审核日志
    step('审核日志已记录', root.Agent.getLogs().length >= rowsData.length, root.Agent.getLogs().length + ' 条');

    // 7. 其他视图渲染
    ['policies', 'logs', 'metrics'].forEach(function (vname) {
      // 同步检查在下面统一做
    });
    go('agent', 'policies'); await sleep(30);
    step('制度依据视图', ($('#content').textContent || '').indexOf('数据管理制度') >= 0, '含制度正文');
    go('agent', 'logs'); await sleep(30);
    step('审核日志视图', ($('#content').textContent || '').indexOf('申请编号') >= 0, '含日志表');
    go('agent', 'metrics'); await sleep(30);
    var mtxt = $('#content').textContent || '';
    step('验收指标视图', mtxt.indexOf('单据分类识别准确率') >= 0, '含 9 项指标');

    // 7b. 新建开票业务 → 上传入口连通性 + 字号
    go('practice', 'newbusiness');
    await sleep(60);
    var nbView = document.querySelector('#content .pra-view.on');
    var upBtn = nbView ? Array.prototype.slice.call(nbView.querySelectorAll('.pra-btn')).filter(function (b) {
      return b.textContent === '上传单据';
    })[0] : null;
    if (upBtn) { upBtn.click(); await sleep(200); }
    step('「新建开票业务」上传入口直达智能体上传区',
      current.area === 'agent' && current.view === 'workspace', current.area + '/' + current.view);

    go('practice', 'workbench');
    await sleep(60);
    var praRoot = document.querySelector('.pra-root');
    var bodyFs = parseFloat(getComputedStyle(document.body).fontSize) || 0;
    var praFs = praRoot ? parseFloat(getComputedStyle(praRoot).fontSize) || 0 : 0;
    var praMin = window.innerWidth <= 600 ? 13 : 14;   // 窄屏按媒体查询允许降到 13px
    step('字号已放大（正文 ' + bodyFs + 'px / 实务 ' + praFs + 'px）', bodyFs >= 13.5 && praFs >= praMin,
      '正文 ' + bodyFs + 'px，实务系统 ' + praFs + 'px（阈值 ' + praMin + 'px）');

    // 7c. 发票预览渲染模块（SVG 生成 / 下载入口）
    try {
      var IP = root.InvoicePreview;
      step('发票预览模块已加载（InvoicePreview）',
        !!IP && typeof IP.buildSVG === 'function' && typeof IP.download === 'function' && !!IP._meta,
        IP ? 'version ' + IP.version + ' / ' + IP._meta.width + '×' + IP._meta.height : '未加载');
      if (IP && typeof IP.buildSVG === 'function') {
        // 用一条尚未开具的事项（第 3 项），避免被前面的「确认开具」污染为重复开票
        var demoApp = assembleFromRow(rowsData[2], 2);
        var demoAudit = root.TaxEngine.runAudit(demoApp, { operator: '自检', pool: [] });
        var demoDraft = root.TaxEngine.buildDraft(demoAudit, demoApp);
        var svg = IP.buildSVG(demoDraft || {});
        var svgOK = typeof svg === 'string' && svg.indexOf('<svg') === 0 && svg.indexOf('</svg>') > 0 &&
          svg.indexOf('viewBox="0 0 712 478"') > 0 && svg.indexOf('undefined') < 0 && svg.indexOf('NaN') < 0;
        step('发票预览 SVG 可生成且无 undefined/NaN', svgOK,
          svgOK ? ('长度 ' + svg.length + ' 字符，含价税合计 ' + (svg.indexOf('30,510,000.00') > 0 ? '是' : '否')) : '生成异常');
        var emptySvg = IP.buildSVG({});
        step('空数据也能渲染空白发票模板',
          typeof emptySvg === 'string' && emptySvg.indexOf('<svg') === 0 && emptySvg.indexOf('NaN') < 0,
          '空模板长度 ' + (emptySvg ? emptySvg.length : 0));

        // 智能体草稿区按钮
        go('agent', 'workspace');
        await sleep(50);
        root.Agent.loadApplication(demoApp);
        await sleep(50);
        var bAudit3 = document.querySelector('#btnAudit');
        if (bAudit3) { bAudit3.click(); await sleep(280); }
        var pvBtn = document.getElementById('btnDraftPreview');
        var pngBtn = document.getElementById('btnDraftPng');
        step('智能体草稿区已接入「预览发票图」「下载发票 PNG」', !!pvBtn && !!pngBtn,
          '按钮 ' + (pvBtn ? '预览✓' : '预览✗') + ' / ' + (pngBtn ? '下载✓' : '下载✗'));

        // 实务系统发票开具台按钮
        go('practice', 'issue');
        await sleep(60);
        var issueBtns = Array.prototype.slice.call(document.querySelectorAll('#content .pra-view.on .pra-btn')).map(function (b) {
          return (b.textContent || '').trim();
        });
        step('实务系统发票开具台已接入「预览发票」「下载发票 PNG」',
          issueBtns.indexOf('预览发票') >= 0 && issueBtns.indexOf('下载发票 PNG') >= 0,
          '按钮：' + issueBtns.join(' / '));
      }
    } catch (ePreview) {
      step('发票预览模块自检', false, ePreview.message);
    }

    // 8. 布局度量（无视觉模型时用 DOM 度量替代人工看图）
    try {
      var de = document.documentElement;      step('页面无横向溢出（当前视口 ' + window.innerWidth + 'px）', de.scrollWidth <= window.innerWidth + 2,
        'scrollWidth ' + de.scrollWidth + ' / innerWidth ' + window.innerWidth);
      var topEl = document.querySelector('.top');
      var cs = topEl ? getComputedStyle(topEl) : null;
      step('样式表已生效（顶部渐变背景）', !!cs && /gradient/.test(cs.backgroundImage || cs.background || ''),
        cs ? (cs.backgroundImage || '').slice(0, 60) : '未取到 .top');
      var overflowViews = [];
      var measureViews = [['practice', 'workbench'], ['practice', 'ledger'], ['practice', 'pending'], ['practice', 'invoiceLedger'], ['agent', 'workspace'], ['agent', 'logs'], ['agent', 'policies'], ['agent', 'metrics'], ['agent', 'testExample']];
      for (var mi = 0; mi < measureViews.length; mi++) {
        go(measureViews[mi][0], measureViews[mi][1]);
        await sleep(30);
        var cdiv = $('#content');
        if (!cdiv) { overflowViews.push(measureViews[mi][1] + ':无内容区'); continue; }
        if (cdiv.scrollWidth > cdiv.clientWidth + 2) {
          overflowViews.push(measureViews[mi][1] + '（' + cdiv.scrollWidth + '>' + cdiv.clientWidth + '）');
        }
        if (cdiv.clientHeight < 200) overflowViews.push(measureViews[mi][1] + ':高度异常 ' + cdiv.clientHeight);
      }
      step('各视图内容区无横向溢出/高度正常', overflowViews.length === 0, overflowViews.length ? overflowViews.join('，') : '9 个视图全部正常');
      var zeroBox = [];
      var checkSel = ['.top', '#content'].concat(current.area === 'practice' ? ['.side'] : []);
      checkSel.forEach(function (sel) {
        var e = document.querySelector(sel);
        if (!e || e.getBoundingClientRect().width < 40) zeroBox.push(sel);
      });
      step('外壳三区尺寸正常', zeroBox.length === 0, zeroBox.length ? zeroBox.join(',') : '顶栏/侧栏/内容区均有尺寸');
    } catch (e2) {
      step('布局度量', false, e2.message);
    }

    // 9. 上传解析（用数据集原件文本走一遍浏览器端解析器）
    try {
      var sample = null;
      var d0 = DATA.documents.filter(function (d) { return d.id === 'FP-202512-001'; })[0];
      var html = '<html><body><div class="q2-doc2"><div class="q2-doc2-no"><b>' + d0.id + '</b>' + d0.docDate + '</div>' +
        '<div class="q2-doc2-title"><h2>' + d0.docType + '</h2><p>' + d0.title + '</p></div>' +
        '<div class="q2-doc2-invmeta"><div><span>发票代码</span><b>' + d0.invoiceCode + '</b></div><div><span>校验码</span><b>' + d0.checkCode + '</b></div></div>' +
        '<div class="q2-doc2-parties"><div><label>购买方</label><b>' + d0.party + '</b><span>纳税人识别号 ' + d0.partyTaxNo + '</span></div>' +
        '<div><label>销售方</label><b>' + d0.selfName + '</b><span>纳税人识别号 ' + d0.selfTaxNo + '</span></div></div>' +
        '<table class="q2-doc2-grid"><thead><tr><th>货物或应税劳务名称</th><th>数量</th><th>单价</th><th>金额</th><th>税率</th><th>税额</th></tr></thead>' +
        '<tbody><tr><td>' + d0.items[0].name + '</td><td>' + d0.items[0].qty + '</td><td>4,500,000.00</td><td>27,000,000.00</td><td>13%</td><td>3,510,000.00</td></tr></tbody></table>' +
        '<div class="q2-doc2-total"><div>合计金额：<b>¥27,000,000.00</b></div><div>合计税额：<b>¥3,510,000.00</b></div>' +
        '<div class="big">价税合计（大写）：<b>人民币叁仟零伍拾壹万元整</b><em>（小写 ¥30,510,000.00）</em></div></div></div></body></html>';
      sample = root.Agent._parseDocHtml(html, 'FP-202512-001-增值税专用发票-销售发票.html');
      var okParse = sample && sample.id === 'FP-202512-001' && sample.amountTotal === 30510000 &&
        sample.party === '上海衡远机电设备有限公司' && sample.taxRate === '13%' && sample.docType === '增值税专用发票';
      step('浏览器端单据 HTML 解析', okParse, okParse ? '编号/购买方/金额/税率/类型 全部正确' : JSON.stringify({ id: sample && sample.id, amount: sample && sample.amountTotal, party: sample && sample.party, rate: sample && sample.taxRate, type: sample && sample.docType }));
    } catch (e) {
      step('浏览器端单据 HTML 解析', false, e.message);
    }

    // 10. 分享链接语法（不改动 location，只校验解析口径）
    var hashCases = [
      { h: '#practice/pending', area: 'practice', view: 'pending' },
      { h: '#practice/invoiceLedger', area: 'practice', view: 'invoices' },
      { h: '#agent/logs', area: 'agent', view: 'logs' },
      { h: '#agent/no-such-view', area: 'agent', view: 'workspace' },
      { h: '#practice/no-such-view', area: 'practice', view: 'workbench' },
      { h: '#demo/3', area: 'agent', view: 'workspace', demo: '3' },
      { h: '#demo/tc022', area: 'agent', view: 'workspace', demo: 'tc022' },
      { h: '#selftest', area: 'practice', view: 'workbench', selftest: true }
    ];
    var hashBad = [];
    hashCases.forEach(function (hc) {
      var p = parseHash(hc.h);
      var okH = !!p && p.area === hc.area && p.view === hc.view &&
        (hc.demo === undefined || p.demo === hc.demo) &&
        (hc.selftest === undefined || !!p.selftest === !!hc.selftest);
      if (!okH) hashBad.push(hc.h + ' → ' + (p ? p.area + '/' + p.view + (p.demo ? ' · demo=' + p.demo : '') : 'null'));
    });
    step('分享链接解析（#practice / #agent / #demo / #selftest）', hashBad.length === 0,
      hashBad.length ? hashBad.join('；') : hashCases.length + ' 种写法全部落到正确视图');

    // 11. 导航完整性：8 个实务视图 + 5 个智能体视图逐个 go()，校验内容区非空 + current 正确 + 导航高亮唯一
    var navTargets = [];
    APP_VIEWS.forEach(function (v) { navTargets.push({ area: 'app', key: v.key, name: v.name }); });
    PRACTICE_VIEWS.forEach(function (v) { navTargets.push({ area: 'practice', key: v.key, name: v.name }); });
    AGENT_VIEWS.forEach(function (v) { navTargets.push({ area: 'agent', key: v.key, name: v.name }); });
    for (var ni = 0; ni < navTargets.length; ni++) {
      var nt = navTargets[ni];
      go(nt.area, nt.key);
      await sleep(60);
      var nc = $('#content');
      var navLen = nc ? nc.textContent.replace(/\s+/g, '').length : 0;
      var curOK = current.area === nt.area && current.view === nt.key;
      var onOK = false;
      var onCount = 0;
      var sideHidden = false;
      if (nt.area === 'app') {
        var appTab = document.querySelector('#topTabs button.on');
        onOK = !!appTab && appTab.dataset.tab === 'flow';
        onCount = document.querySelectorAll('#topTabs button.on').length;
        var sideApp = document.querySelector('#side');
        sideHidden = !!sideApp && sideApp.style.display === 'none';
      } else if (nt.area === 'practice') {
        var navBtn = document.querySelector('#side button[data-area="practice"][data-view="' + nt.key + '"]');
        onOK = !!navBtn && navBtn.classList.contains('on');
        onCount = document.querySelectorAll('#side button.on').length;
      } else {
        // 智能体页面已平铺到顶部页签，左侧不再有独立区间
        var tabKey = nt.key === 'metrics' ? 'policies' : nt.key;
        var wantTab = TOP_TABS.filter(function (t) { return t.area === 'agent' && t.view === tabKey; })[0];
        if (wantTab) {
          var tab = document.querySelector('#topTabs button.on');
          onOK = !!tab && tab.dataset.tab === wantTab.key;
          onCount = document.querySelectorAll('#topTabs button.on').length;
        } else {
          // 测试示例没有一级页签，由右上按钮承载高亮
          var tbtn = document.getElementById('topTest');
          onOK = !!tbtn && tbtn.classList.contains('on');
          onCount = onOK ? 1 : 0;
        }
        var sideEl = document.querySelector('#side');
        sideHidden = !!sideEl && sideEl.style.display === 'none';
      }
      var viewOK = nt.area === 'practice' ? (!!nc && !!nc.querySelector('.pra-view.on')) : true;
      var areaOK = nt.area === 'practice' ? !sideHidden : sideHidden;
      step('导航 · ' + nt.name, navLen > 80 && curOK && onOK && onCount === 1 && viewOK && areaOK,
        '内容 ' + navLen + ' 字 / current ' + current.area + '/' + current.view +
        ' / 高亮 ' + (onOK ? '有' : '无') + ' ×' + onCount + (viewOK ? '' : ' / 无 .pra-view.on') +
        (nt.area === 'agent' ? (sideHidden ? ' / 侧栏已隐藏' : ' / 侧栏未隐藏') : ''));
    }

    // 11b. 业务流程页：8 个节点 + 3 类异常分支 + 角色与跳转
    go('app', 'flow');
    await sleep(80);
    var flowEl = document.querySelector('#content .flow-page');
    var stepEls = flowEl ? flowEl.querySelectorAll('.flow-step') : [];
    var branchEls = flowEl ? flowEl.querySelectorAll('.flow-branch') : [];
    var roleEls = flowEl ? flowEl.querySelectorAll('.flow-roles > div') : [];
    var flowTxt = flowEl ? flowEl.textContent : '';
    step('「业务流程」页罗列 8 个节点 + 3 类异常分支 + 4 类角色',
      !!flowEl && stepEls.length === 8 && branchEls.length === 3 && roleEls.length === 4 &&
      flowTxt.indexOf('业务受理') >= 0 && flowTxt.indexOf('合规审核') >= 0 &&
      flowTxt.indexOf('台账登记') >= 0 && flowTxt.indexOf('归档与追溯') >= 0,
      '节点 ' + stepEls.length + ' 个 / 分支 ' + branchEls.length + ' 类 / 角色 ' + roleEls.length + ' 类');
    var flowBtn = flowEl ? flowEl.querySelector('#flowGoBiz') : null;
    step('业务流程页可一键跳到开票工作台', !!flowBtn, flowBtn ? flowBtn.textContent.trim() : '未找到入口按钮');
    if (flowBtn) {
      flowBtn.click();
      await sleep(90);
      step('业务流程 → 开票工作台 跳转生效',
        current.area === 'practice' && current.view === 'workbench',
        '落到 ' + current.area + '/' + current.view);
    }

    // 12. 状态联动：顶部「同步已开票」与「重置开票状态」
    var syncBtn = document.getElementById('topSync');
    step('顶部「同步已开票」按钮存在且默认显示', !!syncBtn && syncBtn.style.display !== 'none',
      syncBtn ? '#' + syncBtn.id + '「' + (syncBtn.textContent || '').trim() + '」' : '未找到 #topSync');
    var resetBtn = document.getElementById('topReset');
    var persistedBefore = loadIssued().length;
    var resetVisible = !!resetBtn && resetBtn.style.display !== 'none' &&
      (typeof getComputedStyle === 'function' ? getComputedStyle(resetBtn).display !== 'none' : true);
    if (lsOK) {
      step('顶部「重置开票状态」在本机有记录时可见', !!resetBtn && persistedBefore > 0 && resetVisible,
        'localStorage ' + persistedBefore + ' 条 / 可见 ' + resetVisible);
    } else {
      step('顶部「重置开票状态」在本机有记录时可见', true, 'localStorage 不可用（file:// 限制），按 try/catch 降级跳过');
    }

    var datasetMarks = 0;
    if (syncBtn) {
      // 重挂实务系统，确保待开票清单的筛选条件回到「全部」，否则行数基线不准
      if (root.Practice) initPractice();
      go('practice', 'pending');
      await sleep(90);
      var rowsBefore = document.querySelectorAll('#content .pra-view.on tbody tr').length;
      var issuedBefore = (DATA.tables.sales || []).filter(function (r) { return r.issueStatus === '已开具'; }).length;
      syncBtn.click();
      await sleep(150);
      var rowsAfter = document.querySelectorAll('#content .pra-view.on tbody tr').length;
      var issuedAfter = (DATA.tables.sales || []).filter(function (r) { return r.issueStatus === '已开具'; }).length;
      datasetMarks = (DATA.tables.sales || []).filter(function (r) { return r.issueSource === 'dataset'; }).length;
      var syncedN = issuedAfter - issuedBefore;
      var landOK = current.area === 'practice' && current.view === 'pending';
      if (syncedN > 0) {
        step('「同步已开票」后待开票清单行数减少', landOK && rowsAfter < rowsBefore,
          '行数 ' + rowsBefore + ' → ' + rowsAfter + '（同步 ' + syncedN + ' 项 · 落到 ' + current.area + '/' + current.view + '）');
      } else {
        step('「同步已开票」无可同步项时保持清单不变', landOK && rowsAfter === rowsBefore,
          '已开具 ' + issuedAfter + ' 项无新增，行数 ' + rowsBefore + ' → ' + rowsAfter);
      }
      step('「同步已开票」不入库（数据集反推不写 localStorage）', loadIssued().length === persistedBefore,
        'localStorage ' + loadIssued().length + ' 条（同步前 ' + persistedBefore + '）');
    }

    // 12b. 重置链路：issueSource 标记可被清掉，清空后 #topSync 仍在
    clearIssuedState();
    if (root.Practice) initPractice();   // 重挂，使 UI 回到「全部待开票」基线
    go('practice', 'pending');
    await sleep(80);
    var leftMarks = (DATA.tables.sales || []).filter(function (r) {
      return r.issueStatus || r.issueSource || r.invoiceNo || r.issuedAt || r.draftNo;
    }).length;
    step('「重置开票状态」清掉已开具与数据集反推标记（issueSource）', leftMarks === 0,
      '同步标记 ' + datasetMarks + ' 行 → 清除后残留 ' + leftMarks + ' 行');
    step('已开具状态清空后顶部「同步已开票」仍可用', !!document.getElementById('topSync') && (DATA.sessionInvoices || []).length === 0,
      'sessionInvoices ' + (DATA.sessionInvoices || []).length + ' 条 / 按钮 ' + (document.getElementById('topSync') ? '在' : '丢失'));

    // 13. 跳转完整性：实务「去开票」→ 智能体装配；智能体草稿 → 开具台回填
    // 13a. 看板任务卡点击 → 左侧导航高亮必须同步
    go('practice', 'workbench');
    await sleep(60);
    var taskCards = document.querySelectorAll('#content .pra-taskcard');
    var navSyncOK = false;
    var navSyncDetail = '未找到任务卡';
    if (taskCards.length) {
      // 点第 2 张（待开票清单），断言 current 与侧栏高亮一起变
      taskCards[1].click();
      await sleep(70);
      var onBtn = document.querySelector('#side button.on');
      navSyncOK = current.area === 'practice' && current.view === 'pending' &&
        !!onBtn && onBtn.dataset.view === 'pending';
      navSyncDetail = 'current ' + current.area + '/' + current.view + '，侧栏高亮 ' +
        (onBtn ? onBtn.dataset.view : '无');
    }
    step('看板任务卡点击后左侧导航同步高亮', navSyncOK, navSyncDetail);

    // 13b. 发票开具台直接提交开票（选事项 → 提交 → 状态回写 + 跳转）
    go('practice', 'issue');
    await sleep(70);
    var issueView = document.querySelector('#content .pra-view.on');
    var pickSel = issueView ? issueView.querySelector('.pra-issue-pick .pra-select') : null;
    step('发票开具台提供「待开票事项」快选下拉', !!pickSel,
      pickSel ? ('可选 ' + (pickSel.options ? pickSel.options.length - 1 : 0) + ' 项') : '未找到下拉');
    if (pickSel) {
      pickSel.value = '0';
      if (pickSel.dispatchEvent) pickSel.dispatchEvent(new Event('change'));
      await sleep(90);
      var submitBtn = Array.prototype.slice.call(issueView.querySelectorAll('.pra-btn')).filter(function (b) {
        return (b.textContent || '').trim() === '提交开票';
      })[0];
      var issuedBeforeSubmit = (DATA.tables.sales || []).filter(function (r) { return r.issueStatus === '已开具'; }).length;
      if (submitBtn) { submitBtn.click(); await sleep(320); }
      var issuedAfterSubmit = (DATA.tables.sales || []).filter(function (r) { return r.issueStatus === '已开具'; }).length;
      var landed = current.area === 'practice' && current.view === 'pending';
      step('发票开具台「提交开票」直接生效（回写状态 + 跳待开票清单）',
        issuedAfterSubmit === issuedBeforeSubmit + 1 && landed,
        '已开具 ' + issuedBeforeSubmit + ' → ' + issuedAfterSubmit + '，落到 ' + current.area + '/' + current.view);
    }

    // 13c. 已开发票模块：新开的票要能查到，且筛选可用
    go('practice', 'issued');
    await sleep(80);
    var issuedView = document.querySelector('#content .pra-view.on');
    var issuedTxt = issuedView ? issuedView.textContent : '';
    var issuedTableRows = issuedView ? issuedView.querySelectorAll('tbody tr').length : 0;
    step('「已开发票」模块能查到刚开具的发票', issuedTableRows >= 1 && issuedTxt.indexOf('本会话开具') >= 0,
      '行数 ' + issuedTableRows + ' / 含来源标记 ' + (issuedTxt.indexOf('本会话开具') >= 0));
    var issuedControls = issuedView ? {
      party: issuedView.querySelector('.pra-sel-box .pra-select'),
      kw: issuedView.querySelector('.pra-sel-box .pra-input'),
      chips: issuedView.querySelectorAll('.pra-chips .pra-chip').length,
      dates: issuedView.querySelectorAll('.pra-date-box .pra-input').length
    } : null;
    step('「已开发票」提供开票时间（快捷 + 起止）与客户/类型/来源/关键词筛选',
      !!issuedControls && issuedControls.chips >= 4 && issuedControls.dates === 2 && !!issuedControls.party && !!issuedControls.kw,
      issuedControls ? ('时间快捷 ' + issuedControls.chips + ' 个 / 起止日期 ' + issuedControls.dates + ' 个 / 客户下拉 ' + (issuedControls.party ? '有' : '无') + ' / 关键词 ' + (issuedControls.kw ? '有' : '无')) : '未找到筛选控件');
    if (issuedControls && issuedControls.kw) {
      var rowsBeforeKw = issuedView.querySelectorAll('tbody tr').length;
      issuedControls.kw.value = '不存在的发票号ZZZ';
      issuedControls.kw.dispatchEvent(new Event('input'));
      await sleep(80);
      var rowsAfterKw = issuedView.querySelectorAll('tbody tr').length;
      step('「已开发票」关键词筛选生效（无命中时只剩空态行）', rowsAfterKw <= 1 && rowsBeforeKw >= 1,
        '行数 ' + rowsBeforeKw + ' → ' + rowsAfterKw);
      issuedControls.kw.value = '';
      issuedControls.kw.dispatchEvent(new Event('input'));
      await sleep(60);
    }

    go('practice', 'pending');
    await sleep(70);
    var handBtns = Array.prototype.slice.call(document.querySelectorAll('#content .pra-view.on .pra-btn')).filter(function (b) {
      var t = (b.textContent || '').trim();
      return t === '去开票' || t === '选择并审核';
    });
    if (handBtns.length) {
      handBtns[0].click();
      await sleep(320);
      var loadedApp = root.Agent._state.application;
      step('实务系统「去开票 / 选择并审核」→ 智能体工作区并装配申请',
        current.area === 'agent' && current.view === 'workspace' && !!loadedApp,
        '落到 ' + current.area + '/' + current.view + ' / 申请 ' +
          (loadedApp ? loadedApp.applicationNo + '，单据 ' + ((loadedApp.documents || []).length) + ' 份' : '未装配'));
    } else {
      step('实务系统「去开票 / 选择并审核」按钮存在', false, '待开票清单未找到操作按钮');
    }

    go('agent', 'workspace');
    await sleep(60);
    root.Agent.loadApplication(assembleFromRow(rowsData[1], 1));
    await sleep(60);
    var bAudit2 = document.querySelector('#btnAudit');
    if (bAudit2) { bAudit2.click(); await sleep(260); }
    var toFormBtn = document.querySelector('#btnDraftToForm');
    if (toFormBtn) {
      toFormBtn.click();
      await sleep(220);
      var fs = practiceApi && practiceApi.getFormState ? practiceApi.getFormState() : null;
      var backOK = current.area === 'practice' && current.view === 'issue' &&
        !!fs && !!(fs.buyerName || '').trim() && fs.amountTotal != null;
      step('智能体草稿「回填到发票开具台」切视图后仍生效', backOK,
        '落到 ' + current.area + '/' + current.view + ' / 回填购买方 ' +
          (fs && fs.buyerName ? fs.buyerName : '空') + ' / 价税合计 ' + (fs ? String(fs.amountTotal) : '—'));
    } else {
      step('智能体草稿「回填到发票开具台」按钮存在', false, '未找到 #btnDraftToForm');
    }

    // 12d. 顶部一级导航（业务分组 + 智能体页面）与侧栏隔离
    var topTabs = Array.prototype.slice.call(document.querySelectorAll('#topTabs button'));
    var tabNames = topTabs.map(function (b) { return b.textContent.trim(); });
    var wantTabs = ['开票工作台', '台账单据', '智能审核', '审核日志', '制度依据', '业务流程'];
    step('顶部精简为 6 个一级页签（验收指标已并入制度依据）',
      tabNames.length === 6 && wantTabs.every(function (n, i) { return tabNames[i] === n; }) &&
      tabNames.indexOf('验收指标') < 0,
      tabNames.join(' / '));
    // 点「审核日志」页签
    var logsTab = topTabs.filter(function (b) { return b.textContent.trim() === '审核日志'; })[0];
    if (logsTab) {
      logsTab.click();
      await sleep(90);
      var sideEl2 = document.querySelector('#side');
      var logsTabOn = document.querySelector('#topTabs button.on');
      step('点顶部「审核日志」→ 切到日志页、侧栏隐藏、页签高亮',
        current.area === 'agent' && current.view === 'logs' &&
        !!sideEl2 && sideEl2.style.display === 'none' &&
        !!logsTabOn && logsTabOn.textContent.trim() === '审核日志',
        'current ' + current.area + '/' + current.view + ' / 侧栏 ' + (sideEl2 && sideEl2.style.display === 'none' ? '隐藏' : '显示') +
          ' / 页签 ' + (logsTabOn ? logsTabOn.textContent.trim() : '无'));
    }
    // 点「制度依据」页签
    var polTab = topTabs.filter(function (b) { return b.textContent.trim() === '制度依据'; })[0];
    if (polTab) {
      polTab.click();
      await sleep(90);
      var polTabOn = document.querySelector('#topTabs button.on');
      step('点顶部「制度依据」→ 切到制度库页并高亮',
        current.area === 'agent' && current.view === 'policies' && !!polTabOn && polTabOn.textContent.trim() === '制度依据',
        'current ' + current.area + '/' + current.view);
    }
    // 制度依据页内子页签：制度库 / 验收指标
    var polTabBtn = topTabs.filter(function (b) { return b.textContent.trim() === '制度依据'; })[0];
    if (polTabBtn) {
      polTabBtn.click();
      await sleep(110);
      var hubBtns = Array.prototype.slice.call(document.querySelectorAll('.hub-tabs button'));
      var hubNames = hubBtns.map(function (b) { return b.textContent.trim(); });
      var hubBody = document.querySelector('#hubBody');
      step('「制度依据」页内提供「制度库 / 验收指标」子页签',
        hubNames.length === 2 && hubNames[0] === '制度库' && hubNames[1] === '验收指标' &&
        !!hubBody && hubBody.textContent.indexOf('数据管理制度') >= 0,
        '子页签 ' + hubNames.join(' / '));
      var metricBtn = hubBtns.filter(function (b) { return b.textContent.trim() === '验收指标'; })[0];
      if (metricBtn) {
        metricBtn.click();
        await sleep(100);
        var mb = document.querySelector('#hubBody');
        step('切到「验收指标」子页签显示 9 项指标与数据质量',
          !!mb && mb.textContent.indexOf('单据分类识别准确率') >= 0,
          mb ? ('含指标表 ' + (mb.textContent.indexOf('单据分类识别准确率') >= 0)) : '未找到内容');
        // 复位到制度库
        var backHub = document.querySelector('.hub-tabs button');
        if (backHub) { backHub.click(); await sleep(60); }
      }
    }

    if (topTabs.length) {
      var archiveTab = topTabs.filter(function (b) { return b.textContent.trim() === '台账单据'; })[0];
      (archiveTab || topTabs[2]).click();
      await sleep(90);
      var sideItems = Array.prototype.slice.call(document.querySelectorAll('#side button[data-area="practice"]')).map(function (b) {
        return b.dataset.view;
      });
      var tabOn2 = document.querySelector('#topTabs button.on');
      step('切到「台账单据」后侧栏只显示台账类模块',
        sideItems.length === 2 && sideItems.indexOf('ledger') >= 0 && sideItems.indexOf('invoices') >= 0 &&
        sideItems.indexOf('issue') < 0 && !!tabOn2 && tabOn2.textContent.trim() === '台账单据',
        '侧栏 ' + sideItems.join(',') + ' / 页签 ' + (tabOn2 ? tabOn2.textContent.trim() : '无'));
      var bizTab = topTabs.filter(function (b) { return b.textContent.trim() === '开票工作台'; })[0];
      (bizTab || topTabs[1]).click();
      await sleep(90);
      var bizItems = Array.prototype.slice.call(document.querySelectorAll('#side button[data-area="practice"]')).map(function (b) {
        return b.dataset.view;
      });
      step('切回「开票工作台」后侧栏只显示开票类模块',
        bizItems.indexOf('rejected') >= 0 && bizItems.indexOf('issue') >= 0 &&
        bizItems.indexOf('ledger') < 0 && bizItems.indexOf('invoices') < 0,
        '侧栏 ' + bizItems.join(','));
    }

    // 12e. 被驳回申请：审核不通过 → 进入待处理 → 可查看/改信息/补单据/重审
    go('agent', 'workspace');
    await sleep(60);
    var badApp = assembleFromRow(rowsData[3], 3);
    badApp.declaredAmount = 1;              // 金额与合同不符 → 必然不通过
    root.Agent.loadApplication(badApp);
    await sleep(60);
    var bBad = document.querySelector('#btnAudit');
    if (bBad) { bBad.click(); await sleep(300); }
    var rejectedList = (root.Agent.getRejected ? root.Agent.getRejected() : []) || [];
    step('审核不通过后自动进入「被驳回申请」待处理',
      rejectedList.length >= 1 && rejectedList[0].applicationNo === badApp.applicationNo,
      '待处理 ' + rejectedList.length + ' 条 / 首条 ' + (rejectedList[0] ? rejectedList[0].applicationNo : '无'));

    go('practice', 'rejected');
    await sleep(80);
    var rejView = document.querySelector('#content .pra-view.on');
    var rejRows = rejView ? rejView.querySelectorAll('tbody tr').length : 0;
    step('「被驳回申请」列表能看到该申请与驳回原因',
      rejRows >= 1 && rejView.textContent.indexOf(badApp.applicationNo) >= 0 && rejView.textContent.indexOf('不通过') >= 0,
      '行数 ' + rejRows + ' / 含申请号 ' + (rejView && rejView.textContent.indexOf(badApp.applicationNo) >= 0));

    // 数据侧「暂不开票」条目也必须在列表里（缺验收单 → 暂不开票）
    var pendingRowBtn = rejView ? Array.prototype.slice.call(rejView.querySelectorAll('.pra-btn')).filter(function (b) {
      return b.textContent.indexOf('补单据并重审') >= 0;
    })[0] : null;
    step('缺单据的「暂不开票」事项也列入被驳回申请',
      !!pendingRowBtn && rejView.textContent.indexOf('暂不开票') >= 0,
      pendingRowBtn ? '列表含「补单据并重审」入口' : '未找到暂不开票条目');
    if (pendingRowBtn) {
      pendingRowBtn.click();
      await sleep(260);
      var fixApp = root.Agent._state.application;
      step('「补单据并重审」可打开该合同并装配单据',
        current.area === 'agent' && current.view === 'workspace' && !!fixApp && (fixApp.documents || []).length >= 1,
        '落到 ' + current.area + '/' + current.view + ' / 申请 ' + (fixApp ? fixApp.applicationNo : '无') +
          ' / 单据 ' + (fixApp ? (fixApp.documents || []).length : 0) + ' 份');
      go('practice', 'rejected');
      await sleep(80);
      rejView = document.querySelector('#content .pra-view.on');
    }

    var detailBtn = rejView ? Array.prototype.slice.call(rejView.querySelectorAll('.pra-btn')).filter(function (b) {
      return b.textContent.indexOf('查看并处理') >= 0;
    })[0] : null;
    if (detailBtn) {
      detailBtn.click();
      await sleep(90);
      var rejModal = document.querySelector('.pra-modal.on');
      var mtxt = rejModal ? rejModal.textContent : '';
      var mInputs = rejModal ? rejModal.querySelectorAll('.pra-input').length : 0;
      step('被驳回申请详情窗口含审核意见 / 单据 / 修改表单 / 三个处理入口',
        !!rejModal && mtxt.indexOf('修改申请信息') >= 0 && mtxt.indexOf('已上传单据') >= 0 &&
        mtxt.indexOf('补充单据') >= 0 && mtxt.indexOf('重新提交审核') >= 0 && mInputs >= 4,
        '表单字段 ' + mInputs + ' 个 / 入口 ' + (mtxt.indexOf('补充单据') >= 0 ? '补充✓' : '补充✗') +
          (mtxt.indexOf('重新提交审核') >= 0 ? ' 重审✓' : ' 重审✗'));
      var custInput = rejModal ? rejModal.querySelector('.pra-input') : null;
      var saveBtn = rejModal ? Array.prototype.slice.call(rejModal.querySelectorAll('.pra-btn')).filter(function (b) {
        return b.textContent === '保存修改';
      })[0] : null;
      if (custInput && saveBtn) {
        custInput.value = '测试客户名称-已修改';
        saveBtn.click();
        await sleep(80);
        var after = (root.Agent.getRejected ? root.Agent.getRejected() : [])[0];
        step('「保存修改」把信息写回申请并刷新列表',
          !!after && after.customer === '测试客户名称-已修改',
          '客户字段 ' + (after ? after.customer : '无'));
      }
      var closeBtn = rejModal ? Array.prototype.slice.call(rejModal.querySelectorAll('.pra-btn')).filter(function (b) {
        return b.textContent === '关闭';
      })[0] : null;
      if (closeBtn) closeBtn.click();
      await sleep(50);
    } else {
      step('「被驳回申请」详情入口存在', false, '未找到「查看并处理」按钮');
    }
    if (root.Agent.clearRejected) root.Agent.clearRejected();

    // 12f. 会话持久化：视图 / 筛选 / 看板页签写入 localStorage，并可被重新读出
    go('practice', 'pending');
    await sleep(90);
    var regionChip = Array.prototype.slice.call(document.querySelectorAll('#content .pra-view.on .pra-chip')).filter(function (b) {
      return b.textContent.trim() === '出口';
    })[0];
    if (regionChip) { regionChip.click(); await sleep(70); }
    go('practice', 'workbench');
    await sleep(90);
    var wbTab2 = Array.prototype.slice.call(document.querySelectorAll('.pra-board-tab')).filter(function (b) {
      return (b.textContent || '').indexOf('已开具') >= 0;
    })[0];
    if (wbTab2) { wbTab2.click(); await sleep(60); }
    suppressSave = false;
    saveSession();
    var savedSess = loadSession();
    step('界面状态可写入本机会话缓存（视图 / 筛选 / 看板页签）',
      !!savedSess && savedSess.area === 'practice' && savedSess.view === 'workbench' &&
      !!savedSess.practice && savedSess.practice.pending.region === '出口' &&
      savedSess.practice.workbenchTab === 'issued',
      savedSess ? ('视图 ' + savedSess.area + '/' + savedSess.view + '，区域筛选 ' +
        savedSess.practice.pending.region + '，看板页签 ' + savedSess.practice.workbenchTab) : '未写入');
    // 模拟「关掉再打开」：用缓存重新挂载并通过 api.getState 读回
    if (savedSess && savedSess.practice) {
      DATA.__session = savedSess.practice;
      initPractice();
      var backState = practiceApi && practiceApi.getState ? practiceApi.getState() : null;
      step('重新打开后筛选与看板页签被恢复',
        !!backState && backState.pending.region === '出口' && backState.workbenchTab === 'issued',
        backState ? ('区域 ' + backState.pending.region + ' / 页签 ' + backState.workbenchTab) : '无状态');
    }
    suppressSave = true;
    clearSession();

    // 12c. 收尾：清掉本次自检写入的开票状态，回到初始工作台（自检可重复执行）
    clearIssuedState();
    if (root.Agent && root.Agent.resetPool) root.Agent.resetPool();
    initPractice();
    go('practice', 'workbench');
    await sleep(60);
    step('自检收尾：开票状态与会话已复位并回到工作台',
      (DATA.sessionInvoices || []).length === 0 && loadIssued().length === 0 &&
      !loadSession() && current.area === 'practice' && current.view === 'workbench',
      'sessionInvoices ' + (DATA.sessionInvoices || []).length + ' 条 / 已开具缓存 ' + loadIssued().length +
        ' 条 / 会话缓存 ' + (loadSession() ? '有' : '无') + ' / ' + current.area + '/' + current.view);
    suppressSave = false;
    clearSession();

    res.ok = res.failed === 0;
    res.finishedAt = new Date().toISOString();
    var sink = document.getElementById('selftestResult');
    if (!sink) {
      sink = document.createElement('div');
      sink.id = 'selftestResult';
      sink.style.display = 'none';
      document.body.appendChild(sink);
    }
    sink.textContent = JSON.stringify(res);
    console.log('[selftest] ' + (res.ok ? '全部通过' : res.failed + ' 项失败'), res);
    return res;
  }

  function boot() {
    document.body.innerHTML = '';
    document.body.appendChild(buildShell());
    bindTop();
    var restored = restoreIssued();
    var h = parseHash();
    var sess = loadSession();
    var useSession = !!sess && !(h && (h.selftest || h.demo));
    if (useSession && sess.practice) DATA.__session = sess.practice;
    if (useSession && sess.rejected && root.Agent && root.Agent.setRejected) {
      root.Agent.setRejected(sess.rejected);
    }
    initPractice();
    renderSide();
    go(h ? h.area : (useSession ? sess.area : 'practice'),
      h ? h.view : (useSession ? sess.view : 'workbench'));
    if (useSession) {
      setTimeout(function () {
        toast('已恢复上次会话：' + (PRACTICE_VIEWS.concat(AGENT_VIEWS).filter(function (v) {
          return v.key === current.view;
        })[0] || { name: current.view }).name + '（可在顶部「重置本机数据」清除）', '', 5200);
      }, 1200);
    }
    if (h && h.demo) setTimeout(function () { runDemo(h.demo); }, 200);
    if (restored) {
      setTimeout(function () {
        toast('已恢复本机保存的已开具状态：' + restored + ' 项发票，相应待开票事项已从清单移除（顶部可「重置开票状态」）', 'warn', 8000);
      }, 1100);
    }
    // 启动提示（Prompt 要求）
    setTimeout(function () {
      toast('尚未配置大模型密钥，当前以规则引擎执行审核；可在「大模型API设置」中填写服务商、模型与密钥启用 AI 辅助。', 'warn', 8000);
    }, 900);
    // 控制台自检信息
    try {
      var E = root.TaxEngine;
      E.configure(DATA);
      console.log('[自检] 单据 ' + DATA.documents.length + ' 张 / 台账 ' + DATA.ledger.length + ' 行 / 用例 ' + DATA.tables.cases.length + ' 条 / 制度 ' + (DATA.policies || []).length + ' 项');
      console.log('[自检] 引擎分类自检：' + DATA.documents.filter(function (d) { return E.classifyDoc(d).docType === d.docType; }).length + '/' + DATA.documents.length + ' 与台账一致');
    } catch (e) { console.warn('[自检] 失败', e); }
    if ((h && h.selftest) || /selftest/.test(location.hash || '')) {
      setTimeout(function () { selftest(); }, 300);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof globalThis !== 'undefined' ? globalThis : this);
