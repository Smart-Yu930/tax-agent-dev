# -*- coding: utf-8 -*-
"""
构建 index.html —— 把 src/* 与 data/* 全部内联成单文件应用（架构II：双击即开）。

运行：python tools/build.py
产物：index.html（项目根目录）
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'src')
DATA = os.path.join(ROOT, 'data')


def read(p):
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()


def read_json(name, required=True):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        if required:
            raise SystemExit('缺少数据文件：%s（请先运行 tools/build_data.py）' % p)
        return None
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)


def safe_json(obj):
    """内联 JSON：转义 </script 与行分隔符，避免提前闭合脚本标签"""
    s = json.dumps(obj, ensure_ascii=False, separators=(',', ':'))
    s = s.replace('</', '<\\/')
    s = s.replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    return s


def safe_js(code, name):
    if '</script' in code.lower():
        raise SystemExit('%s 中含有 </script 字面量，会破坏内联' % name)
    return code


def optional_css(name):
    p = os.path.join(SRC, name)
    if not os.path.exists(p):
        print('  ! 跳过缺失样式：%s' % name)
        return ''
    return read(p)


def main():
    print('读取源码与数据 …')
    documents = read_json('documents.json')
    ledger = read_json('ledger.json')
    tables = read_json('tables.json')
    dict_ = read_json('dict.json')
    policies = read_json('policies.json', required=False) or []
    acceptance = read_json('_acceptance_report.json', required=False)
    quality = read_json('_data_quality.json', required=False)

    # 台账中回填文件路径，便于前端展示
    doc_by_id = {d['id']: d for d in documents}
    for lr in ledger:
        d = doc_by_id.get(lr['id'])
        if d and not lr.get('file'):
            lr['file'] = d['file']

    data = {
        'meta': {
            'case': '华衡智造 2025.12',
            'period': '2025 年 12 月',
            'company': '华衡智造集团股份有限公司',
            'selfTaxNo': '91440300MA5H8K2X3Q',
            'project': 'P1-01 发票开具',
            'dataset': 'P1-01-发票开具-勾选数据集',
            'docCount': len(documents),
            'tableCount': 4,
            'caseCount': len(tables['cases']),
            'generatedAt': '2026-11-14T09:52:32Z',
        },
        'documents': documents,
        'ledger': ledger,
        'tables': tables,
        'policies': policies,
        'dict': dict_,
    }
    if quality:
        data['dataQuality'] = quality
    if acceptance:
        # 只保留界面要用的部分，控制体积
        data['acceptance'] = {
            'generatedAt': acceptance.get('generatedAt', ''),
            'allPass': acceptance.get('allPass', False),
            'metrics': acceptance.get('metrics', []),
            'details': {
                'classification': {k: v for k, v in acceptance.get('details', {}).get('classification', {}).items() if k != 'bad'},
                'fieldExtraction': {k: v for k, v in acceptance.get('details', {}).get('fieldExtraction', {}).items() if k != 'bad'},
                'traceability': acceptance.get('details', {}).get('traceability', {}),
                'applications': acceptance.get('details', {}).get('applications', []),
            },
        }

    css = read(os.path.join(SRC, 'styles.css')) + '\n' + optional_css('practice.css')
    engine = safe_js(read(os.path.join(SRC, 'engine.js')), 'engine.js')
    tpl_p = os.path.join(SRC, 'invoice-template.js')
    invoice = safe_js(read(tpl_p), 'invoice-template.js') if os.path.exists(tpl_p) else \
        '/* invoice-template.js 缺失：发票预览与下载不可用 */'
    practice_p = os.path.join(SRC, 'practice.js')
    practice = safe_js(read(practice_p), 'practice.js') if os.path.exists(practice_p) else \
        '/* practice.js 缺失：实务系统模块不可用 */'
    agent = safe_js(read(os.path.join(SRC, 'agent.js')), 'agent.js')
    boot = safe_js(read(os.path.join(SRC, 'boot.js')), 'boot.js')

    html = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>智能发票审核与开发助手 · 华衡智造 P1-01 发票开具</title>
<meta name="description" content="发票审核与开票草稿生成智能体：多格式单据识别、字段提取与来源追溯、合规/真实/一致性审核、草稿生成与回填。预加载 P1-01 数据集，双击即开。">
<style>
__CSS__
</style>
</head>
<body>
<noscript><div style="padding:24px;font:14px/1.7 sans-serif">本应用需要启用 JavaScript。</div></noscript>
<script>
/* ===== 运行期错误收集（放在最前，且挂在 documentElement 上，避免被 body 重建清除） ===== */
(function(){
  var sink = null;
  function getSink(){
    if (sink && sink.parentNode) return sink;
    sink = document.getElementById('jsErrorSink');
    if (!sink) {
      sink = document.createElement('div');
      sink.id = 'jsErrorSink';
      sink.style.display = 'none';
      document.documentElement.appendChild(sink);
    }
    return sink;
  }
  window.addEventListener('error', function(e){
    var s = getSink();
    s.setAttribute('data-count', String(Number(s.getAttribute('data-count')||0)+1));
    s.textContent += '[JS-ERROR] ' + (e.message||'') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'') + ':' + (e.colno||'') + '\\n';
  });
  window.addEventListener('unhandledrejection', function(e){
    var s = getSink();
    s.textContent += '[JS-REJECT] ' + (e.reason && e.reason.stack ? e.reason.stack : (e.reason && e.reason.message ? e.reason.message : e.reason)) + '\\n';
  });
})();
</script>
<script>
/* ===== 预加载数据（架构II：内联 JSON，file:// 双击即开） ===== */
window.TAX_DATA = __DATA__;
</script>
<script>
/* ===== 审核引擎 ===== */
__ENGINE__
</script>
<script>
/* ===== 发票预览渲染（SVG / PNG 下载） ===== */
__INVOICE__
</script>
<script>
/* ===== 实务系统（复刻 P1-01 增值税发票开具系统） ===== */
__PRACTICE__
</script>
<script>
/* ===== 智能体工作区 ===== */
__AGENT__
</script>
<script>
/* ===== 启动 ===== */
__BOOT__
</script>
</body>
</html>
'''

    for k, v in (('__CSS__', css), ('__ENGINE__', engine), ('__INVOICE__', invoice),
                 ('__PRACTICE__', practice), ('__AGENT__', agent), ('__BOOT__', boot)):
        html = html.replace(k, v)
    html = html.replace('__DATA__', safe_json(data))

    out = os.path.join(ROOT, 'index.html')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    size = os.path.getsize(out)
    print('写出 index.html：%.1f KB（%.2f MB）' % (size / 1024, size / 1024 / 1024))
    print('内联内容：CSS %.1fKB / 数据 %.1fKB / engine %.1fKB / practice %.1fKB / agent %.1fKB / boot %.1fKB'
          % (len(css) / 1024, len(safe_json(data)) / 1024, len(engine) / 1024,
             len(practice) / 1024, len(agent) / 1024, len(boot) / 1024))
    return out


if __name__ == '__main__':
    main()
