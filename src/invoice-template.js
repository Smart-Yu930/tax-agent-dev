/**
 * 发票预览与下载（纯原生 JS，IIFE 挂 window.InvoicePreview）
 * ---------------------------------------------------------------
 * 版式依据「发票模板.png」（712 × 478）实测几何，标准增值税专用发票版式：
 *   外框 14,13 → 707,474（2px 暗红 #b4232a）
 *   内框 30,112 → 693,421.5（1.5px，表体区；下边线即 y=421.5 分隔线）
 *   水平分隔线：y=111.5（标题区下）、184.5（双方区下）、329.5（明细下）、
 *              355.5（合计下）、421.5（价税合计下）
 *   竖直参考：x=14 / 30 / 693 / 707；双方区中缝 x=361
 * 所有样式内联、无外部字体/图片/网络请求；不依赖项目 CSS。
 */
(function (root) {
  'use strict';

  /* ----------------------------- 几何常量 ----------------------------- */
  var CANVAS_W = 712;
  var CANVAS_H = 478;

  var FRAME = { l: 14, t: 13, r: 707, b: 474, sw: 2 };
  var INNER = { l: 30, t: 112, r: 693, b: 421.5 };

  var BANDS = {
    titleTop: 13,
    partyTop: 111.5,   // 标题区 / 双方区
    detailTop: 184.5,  // 双方区 / 明细区
    detailBottom: 329.5,
    totalBottom: 355.5,
    sumBottom: 421.5,
    bottom: 474.5,
    partyMid: 361
  };

  var ROW_H = 22;          // 表头与明细行统一行高
  var MAX_ROWS = 5;        // 明细最多画 5 行
  var COLS = [188, 70, 44, 56, 84, 96, 48, 77]; // 合计 663 = 内框宽度
  var HEADERS = ['货物或应税劳务名称', '规格型号', '单位', '数量', '单价', '金额', '税率', '税额'];
  var ALIGN = ['left', 'left', 'center', 'right', 'right', 'right', 'center', 'right'];
  var MONO_COLS = [4, 5, 7]; // 单价 / 金额 / 税额 用等宽

  var C = {
    /* 外框色：按 Lead 给定规格为暗红；实测模板图为灰色描边（见回报中的像素证据），
       如需贴合模板图，只改这一行即可（其余框线/表体线不受影响）。 */
    outer: '#4a4a4a',
    frame: '#b4232a',
    head: '#b4232a',
    ink: '#1f2937',
    gray: '#5b6470',
    light: '#8a939e',
    headBg: '#fdf2f2',
    white: '#ffffff'
  };

  var F = {
    sans: "'Microsoft YaHei','PingFang SC','Hiragino Sans GB',sans-serif",
    mono: "Consolas,'Courier New',monospace",
    serif: "SimSun,'Songti SC',serif"
  };

  /* ----------------------------- 小工具 ----------------------------- */
  function n(v) {
    var x = Math.round((Number(v) || 0) * 100) / 100;
    return String(x);
  }

  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }

  function isNil(v) {
    return v === null || v === undefined || v === '';
  }

  function dash(v) {
    return isNil(v) ? '—' : String(v);
  }

  function toNum(v) {
    if (isNil(v)) return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).replace(/[,，\s¥￥]/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    var num = parseFloat(s);
    return isFinite(num) ? num : null;
  }

  /** 千分位 + 2 位小数；无法解析时原样/破折号 */
  function money(v) {
    var num = toNum(v);
    if (num === null) return dash(v);
    var neg = num < 0;
    var fixed = Math.abs(num).toFixed(2).split('.');
    fixed[0] = fixed[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + fixed[0] + '.' + fixed[1];
  }

  function moneyY(v) {
    var num = toNum(v);
    return num === null ? dash(v) : '¥' + money(num);
  }

  /** 数量：最多 4 位小数，去掉无意义的尾零 */
  function qty(v) {
    var num = toNum(v);
    if (num === null) return dash(v);
    return String(Math.round(num * 10000) / 10000);
  }

  /** 粗略估算文本宽度（中文按 1em，西文按 0.56em） */
  function textWidth(s, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) > 255 ? size : size * 0.56;
    }
    return w;
  }

  function fit(s, maxW, size) {
    s = String(s);
    if (textWidth(s, size) <= maxW) return s;
    var out = '';
    var w = size; // 预留省略号
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      var cw = c.charCodeAt(0) > 255 ? size : size * 0.56;
      if (w + cw > maxW) break;
      out += c;
      w += cw;
    }
    return out.replace(/\s+$/, '') + '…';
  }

  /* ----------------------------- SVG 元素拼装 ----------------------------- */
  function textEl(x, y, content, opt) {
    opt = opt || {};
    var family = opt.serif ? F.serif : (opt.mono ? F.mono : F.sans);
    var a = ' x="' + n(x) + '" y="' + n(y) + '"';
    a += ' font-family="' + family + '" font-size="' + (opt.size || 11) + '"';
    a += ' fill="' + (opt.fill || C.ink) + '"';
    if (opt.bold) a += ' font-weight="700"';
    if (opt.anchor) a += ' text-anchor="' + opt.anchor + '"';
    if (opt.ls) a += ' letter-spacing="' + opt.ls + '"';
    if (opt.opacity !== undefined && opt.opacity !== null) a += ' opacity="' + opt.opacity + '"';
    return '<text' + a + '>' + esc(content) + '</text>';
  }

  function lineEl(x1, y1, x2, y2, opt) {
    opt = opt || {};
    var a = ' x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '"';
    a += ' stroke="' + (opt.stroke || C.frame) + '" stroke-width="' + (opt.sw || 1) + '"';
    if (opt.opacity !== undefined && opt.opacity !== null) a += ' stroke-opacity="' + opt.opacity + '"';
    if (opt.dash) a += ' stroke-dasharray="' + opt.dash + '"';
    return '<line' + a + '/>';
  }

  function rectEl(x, y, w, h, opt) {
    opt = opt || {};
    var a = ' x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '"';
    a += ' fill="' + (opt.fill || 'none') + '"';
    if (opt.stroke) a += ' stroke="' + opt.stroke + '" stroke-width="' + (opt.sw || 1) + '"';
    if (opt.opacity !== undefined && opt.opacity !== null) a += ' fill-opacity="' + opt.opacity + '"';
    return '<rect' + a + '/>';
  }

  /** 合计行：右对齐单行（标签灰、金额等宽加粗），避免两条基线在 26px 行高内挤压 */
  function totalLine(y, exLabel, exVal, taxLabel, taxVal) {
    return '<text x="687" y="' + n(y) + '" text-anchor="end" font-family="' + F.sans + '" font-size="10.5" fill="' + C.gray + '">' +
      '<tspan>' + esc(exLabel) + '</tspan>' +
      '<tspan dx="4" font-family="' + F.mono + '" font-size="11" font-weight="700" fill="' + C.ink + '">' + esc(exVal) + '</tspan>' +
      '<tspan dx="26">' + esc(taxLabel) + '</tspan>' +
      '<tspan dx="4" font-family="' + F.mono + '" font-size="11" font-weight="700" fill="' + C.ink + '">' + esc(taxVal) + '</tspan>' +
      '</text>';
  }

  function subtitleOf(type) {
    return String(type).indexOf('出口') >= 0 ? '出 口 发 票' : '销 售 发 票';
  }

  function columnX() {
    var xs = [];
    var acc = INNER.l;
    for (var i = 0; i < COLS.length; i++) {
      xs.push(acc);
      acc += COLS[i];
    }
    return xs;
  }

  /* ----------------------------- 主渲染 ----------------------------- */
  function buildSVG(data) {
    var d = data && typeof data === 'object' ? data : {};
    var buyer = d.buyer && typeof d.buyer === 'object' ? d.buyer : {};
    var seller = d.seller && typeof d.seller === 'object' ? d.seller : {};
    var items = Array.isArray(d.items) ? d.items.filter(function (x) { return x && typeof x === 'object'; }) : [];
    var type = isNil(d.invoiceType) ? '增值税专用发票' : String(d.invoiceType);

    var out = [];
    var i, r, c;

    out.push('<svg xmlns="http://www.w3.org/2000/svg" width="712" height="478" viewBox="0 0 712 478" role="img" aria-label="' + esc(type) + '">');
    out.push('<title>' + esc(type) + ' ' + esc(dash(d.invoiceNo)) + '</title>');

    /* 底：白纸 */
    out.push(rectEl(0, 0, CANVAS_W, CANVAS_H, { fill: C.white }));

    /* 1. 框线：外框 / 内框 / 水平分隔线 / 双方区中缝 */
    out.push(rectEl(FRAME.l, FRAME.t, FRAME.r - FRAME.l, FRAME.b - FRAME.t, { fill: 'none', stroke: C.outer, sw: FRAME.sw }));
    out.push(rectEl(INNER.l, INNER.t, INNER.r - INNER.l, INNER.b - INNER.t, { fill: 'none', stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(FRAME.l, BANDS.partyTop, FRAME.r, BANDS.partyTop, { stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(INNER.l, BANDS.detailTop, INNER.r, BANDS.detailTop, { stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(INNER.l, BANDS.detailBottom, INNER.r, BANDS.detailBottom, { stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(INNER.l, BANDS.totalBottom, INNER.r, BANDS.totalBottom, { stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(FRAME.l, BANDS.sumBottom, FRAME.r, BANDS.sumBottom, { stroke: C.frame, sw: 1.5 }));
    out.push(lineEl(BANDS.partyMid, BANDS.partyTop, BANDS.partyMid, BANDS.detailTop, { stroke: C.frame, sw: 1, opacity: 0.55 }));

    /* 2. 明细区：表头底色 + 网格 */
    var headBottom = BANDS.detailTop + ROW_H;
    out.push(rectEl(INNER.l + 0.75, BANDS.detailTop + 0.75, INNER.r - INNER.l - 1.5, ROW_H - 0.75, { fill: C.headBg }));

    var xs = columnX();
    var gridBottom = headBottom + MAX_ROWS * ROW_H; // 316.5：其下 13px 为表体框内留白带
    for (i = 1; i < xs.length; i++) {
      out.push(lineEl(xs[i], BANDS.detailTop, xs[i], gridBottom, { stroke: C.frame, sw: 1, opacity: 0.45 }));
    }
    /* 表头下沿 + 5 行明细的横线（末行线 316.5，其下 13px 为表体框内留白带，用于行数溢出提示） */
    for (i = 0; i <= MAX_ROWS; i++) {
      var ly = headBottom + i * ROW_H;
      out.push(lineEl(INNER.l, ly, INNER.r, ly, { stroke: C.frame, sw: 1, opacity: 0.45 }));
    }

    /* 3. 标题区（13 – 111.5） */
    out.push(textEl(360.5, 55, type, { size: 26, bold: true, fill: C.head, anchor: 'middle', ls: 6 }));
    out.push(textEl(360.5, 76, subtitleOf(type), { size: 11, fill: C.gray, anchor: 'middle', ls: 4 }));

    var meta = [
      ['发票代码', d.invoiceCode],
      ['发票号码', d.invoiceNo],
      ['开票日期', d.issueDate]
    ];
    for (i = 0; i < meta.length; i++) {
      out.push(textEl(692, 30 + i * 15, meta[i][0] + '：' + dash(meta[i][1]), { size: 10, fill: C.gray, anchor: 'end' }));
    }

    /* 4. 双方区（111.5 – 184.5） */
    out.push(textEl(38, 126, '购买方', { size: 10.5, bold: true, fill: C.head }));
    out.push(textEl(38, 147, '名　　称：' + fit(dash(buyer.name), 255, 11), { size: 11 }));
    out.push(textEl(38, 170, '纳税人识别号：' + fit(dash(buyer.taxNo), 232, 11), { size: 11 }));

    out.push(textEl(369, 126, '销售方', { size: 10.5, bold: true, fill: C.head }));
    out.push(textEl(369, 147, '名　　称：' + fit(dash(seller.name), 250, 11), { size: 11 }));
    out.push(textEl(369, 170, '纳税人识别号：' + fit(dash(seller.taxNo), 232, 11), { size: 11 }));

    /* 5. 明细区表头（184.5 – 206.5） */
    for (c = 0; c < COLS.length; c++) {
      var hx = xs[c] + COLS[c] / 2;
      out.push(textEl(hx, 200, HEADERS[c], { size: 10.5, bold: true, anchor: 'middle' }));
    }

    /* 明细行（行高 22，最多 5 行；无数据也保留网格） */
    var shown = Math.min(items.length, MAX_ROWS);
    for (r = 0; r < shown; r++) {
      var it = items[r];
      var baseY = headBottom + r * ROW_H + 15;
      var cells = [
        dash(it.name), dash(it.spec), dash(it.unit), qty(it.qty),
        money(it.unitPrice), money(it.amount), dash(it.taxRate), money(it.taxAmount)
      ];
      for (c = 0; c < COLS.length; c++) {
        var fs = 10.5;
        var content, tx, anchor;
        if (ALIGN[c] === 'left') {
          tx = xs[c] + 6; anchor = 'start';
          content = fit(cells[c], COLS[c] - 12, fs);
        } else if (ALIGN[c] === 'right') {
          tx = xs[c] + COLS[c] - 6; anchor = 'end';
          content = fit(cells[c], COLS[c] - 12, fs);
        } else {
          tx = xs[c] + COLS[c] / 2; anchor = 'middle';
          content = fit(cells[c], COLS[c] - 8, fs);
        }
        out.push(textEl(tx, baseY, content, { size: fs, anchor: anchor, mono: MONO_COLS.indexOf(c) >= 0 }));
      }
    }
    if (items.length > MAX_ROWS) {
      out.push(textEl(687, BANDS.detailBottom - 3.5, '…（共 ' + items.length + ' 行，详见明细）', { size: 8.5, anchor: 'end', fill: C.light }));
    }

    /* 6. 合计行（329.5 – 355.5）：单行右对齐，金额等宽 */
    out.push(totalLine(343, '合计金额', moneyY(d.amountExTax), '合计税额', moneyY(d.taxAmount)));

    /* 7. 价税合计区（355.5 – 421.5） */
    out.push(textEl(38, 375, '价税合计（大写）', { size: 11, bold: true, fill: C.head }));
    out.push(textEl(150, 376, fit(dash(d.amountInWords), 320, 13), { size: 13, serif: true }));
    out.push(textEl(500, 396, '（小写）', { size: 10.5, anchor: 'end', fill: C.gray }));
    out.push(textEl(687, 397, moneyY(d.amountTotal), { size: 13, anchor: 'end', mono: true, bold: true, fill: C.head }));
    if (!isNil(d.remark)) {
      out.push(textEl(38, 414, fit('备注：' + String(d.remark), 640, 9.5), { size: 9.5, fill: C.gray }));
    }

    /* 8. 底部签署（421.5 – 474.5） */
    out.push(textEl(38, 448, '收款人：' + fit(dash(d.payee), 140, 10.5), { size: 10.5 }));
    out.push(textEl(238, 448, '复核：' + fit(dash(d.reviewer), 120, 10.5), { size: 10.5 }));
    out.push(textEl(408, 448, '开票人：' + fit(dash(d.drawer), 120, 10.5), { size: 10.5 }));
    if (!isNil(d.draftNo) || !isNil(d.statusLabel)) {
      out.push(textEl(38, 466, '草稿号：' + dash(d.draftNo) + ' · ' + dash(d.statusLabel), { size: 9, fill: C.light }));
    }
    /* 销售方发票专用章位（虚线圆，直径 50 以适配 53px 高的签署带） */
    out.push('<circle cx="655" cy="448" r="25" fill="none" stroke="' + C.frame + '" stroke-width="2" stroke-dasharray="5 4" opacity="0.55"/>');
    out.push(textEl(655, 448, '发票专用章', { size: 8.5, anchor: 'middle', fill: C.frame, opacity: 0.7 }));

    out.push('</svg>');
    return out.join('');
  }

  /* ----------------------------- 文件名 ----------------------------- */
  function stamp() {
    var d = new Date();
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function baseName(data) {
    var d = data && typeof data === 'object' ? data : {};
    var src = '';
    if (!isNil(d.draftNo)) src = String(d.draftNo);
    else if (!isNil(d.invoiceNo)) src = String(d.invoiceNo);
    src = src.replace(/[\\/:*?"<>|\r\n\t ]+/g, '_').replace(/^_+|_+$/g, '');
    return '发票_' + (src || stamp());
  }

  function hasDocument() {
    return typeof document !== 'undefined' && !!document && typeof document.createElement === 'function' && !!document.body;
  }

  function notify(msg) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(msg);
  }

  function triggerDownload(url, name, revoke) {
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
      if (revoke) { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } }
    }, 1500);
  }

  /* ----------------------------- 下载：PNG ----------------------------- */
  function downloadPNG(data) {
    if (!hasDocument() || typeof Image === 'undefined') return;
    var svg = buildSVG(data);
    var name = baseName(data) + '.png';
    var scale = 2; // 1424 × 956
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = CANVAS_W * scale;
        canvas.height = CANVAS_H * scale;
        var ctx = canvas.getContext('2d');
        if (!ctx) { notify('当前浏览器无法创建画布，请改用「下载 SVG」。'); return; }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (typeof canvas.toBlob !== 'function') { notify('当前浏览器不支持 PNG 导出，请改用「下载 SVG」。'); return; }
        canvas.toBlob(function (blob) {
          if (!blob) { notify('PNG 生成失败，请改用「下载 SVG」。'); return; }
          var url = URL.createObjectURL(blob);
          triggerDownload(url, name, true);
        }, 'image/png');
      } catch (e) {
        notify('PNG 导出异常：' + (e && e.message ? e.message : e) + '，请改用「下载 SVG」。');
      }
    };
    img.onerror = function () {
      notify('发票图片渲染失败，请改用「下载 SVG」。');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ----------------------------- 下载：SVG ----------------------------- */
  function downloadSVG(data) {
    if (!hasDocument()) return;
    try {
      var svg = buildSVG(data);
      var blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      triggerDownload(url, baseName(data) + '.svg', true);
    } catch (e) {
      notify('SVG 导出异常：' + (e && e.message ? e.message : e));
    }
  }

  /* ----------------------------- 打印 / 另存为 PDF ----------------------------- */
  function printDoc(data) {
    if (typeof window === 'undefined' || typeof window.open !== 'function') return;
    var svg = buildSVG(data);
    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }
    if (!w) {
      open(data);
      notify('浏览器拦截了打印窗口，已打开预览：可点「下载 PNG」后打印，或改用「下载 SVG」。');
      return;
    }
    var html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(baseName(data)) + '</title>' +
      '<style>@page{size:712px 478px;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:712px;height:478px}</style>' +
      '</head><body>' + svg + '</body></html>';
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
      setTimeout(function () {
        try { w.focus(); w.print(); } catch (e) { /* 用户可手动打印 */ }
      }, 240);
    } catch (e) {
      notify('打印窗口写入失败：' + (e && e.message ? e.message : e));
    }
  }

  /* ----------------------------- 预览层 ----------------------------- */
  var ui = { overlay: null, keyHandler: null };

  function close() {
    if (ui.keyHandler && hasDocument()) document.removeEventListener('keydown', ui.keyHandler, false);
    ui.keyHandler = null;
    if (ui.overlay && ui.overlay.parentNode) ui.overlay.parentNode.removeChild(ui.overlay);
    ui.overlay = null;
  }

  function makeButton(label, primary, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'padding:8px 14px;border-radius:8px;font-size:13px;line-height:1.2;cursor:pointer;font-family:inherit;' +
      'border:1px solid ' + (primary ? '#b4232a' : '#cfd8e3') + ';' +
      'background:' + (primary ? '#b4232a' : '#ffffff') + ';' +
      'color:' + (primary ? '#ffffff' : '#243043') + ';';
    b.addEventListener('click', onClick, false);
    return b;
  }

  function open(data) {
    if (!hasDocument()) return;
    close();

    var svg = buildSVG(data);
    var overlay = document.createElement('div');
    overlay.setAttribute('data-invoice-preview', '1');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;' +
      'padding:20px;box-sizing:border-box;background:rgba(15,23,42,0.62);font-family:' + F.sans + ';';

    var card = document.createElement('div');
    card.style.cssText = 'width:100%;max-width:960px;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;' +
      'background:#ffffff;border-radius:12px;box-shadow:0 24px 64px rgba(2,6,23,0.4);';

    var head = document.createElement('div');
    head.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:12px 16px;border-bottom:1px solid #e6ebf2;background:#fbfcfe;';

    var titleText = '发票预览';
    if (data && typeof data === 'object') {
      var tag = !isNil(data.draftNo) ? data.draftNo : (!isNil(data.invoiceNo) ? data.invoiceNo : '');
      if (!isNil(tag)) titleText += ' · ' + tag;
    }
    var title = document.createElement('div');
    title.textContent = titleText;
    title.style.cssText = 'font-size:14px;font-weight:700;color:#15202b;';

    var xBtn = document.createElement('button');
    xBtn.type = 'button';
    xBtn.textContent = '×';
    xBtn.setAttribute('aria-label', '关闭');
    xBtn.style.cssText = 'width:30px;height:30px;padding:0;border:0;border-radius:8px;background:#eef2f7;color:#42526b;' +
      'font-size:18px;line-height:1;cursor:pointer;font-family:inherit;';
    xBtn.addEventListener('click', close, false);

    head.appendChild(title);
    head.appendChild(xBtn);

    var body = document.createElement('div');
    body.style.cssText = 'flex:1 1 auto;overflow:auto;padding:16px;background:#f1f5f9;';
    var holder = document.createElement('div');
    holder.innerHTML = svg;
    var svgEl = holder.querySelector ? holder.querySelector('svg') : null;
    if (svgEl) {
      svgEl.setAttribute('style', 'display:block;width:100%;max-width:900px;height:auto;margin:0 auto;background:#ffffff;box-shadow:0 6px 20px rgba(15,42,74,0.12);');
    }
    body.appendChild(holder);

    var foot = document.createElement('div');
    foot.style.cssText = 'flex:0 0 auto;display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;' +
      'padding:12px 16px;border-top:1px solid #e6ebf2;background:#ffffff;';
    foot.appendChild(makeButton('下载 PNG', true, function () { download(data, 'png'); }));
    foot.appendChild(makeButton('下载 SVG', false, function () { download(data, 'svg'); }));
    foot.appendChild(makeButton('打印 / 另存为 PDF', false, function () { download(data, 'print'); }));
    foot.appendChild(makeButton('关闭', false, close));

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(foot);
    overlay.appendChild(card);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); }, false);
    card.addEventListener('click', function (e) { e.stopPropagation(); }, false);

    document.body.appendChild(overlay);
    ui.overlay = overlay;

    ui.keyHandler = function (e) { if (e && (e.key === 'Escape' || e.keyCode === 27)) close(); };
    document.addEventListener('keydown', ui.keyHandler, false);
  }

  /* ----------------------------- 对外 API ----------------------------- */
  function download(data, format) {
    var fmt = String(format || 'png').toLowerCase();
    if (fmt === 'print') { printDoc(data); return; }
    if (fmt === 'svg') { downloadSVG(data); return; }
    if (fmt === 'png') { downloadPNG(data); return; }
    notify('未知的导出格式：' + format + '（仅支持 png / svg / print）');
  }

  root.InvoicePreview = {
    version: '1.0.0',
    buildSVG: buildSVG,
    open: open,
    download: download,
    _meta: { width: CANVAS_W, height: CANVAS_H }
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
