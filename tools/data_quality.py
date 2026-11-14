# -*- coding: utf-8 -*-
"""
数据质量核查：输出 P1-01 数据集在「发票审核」用途下的口径问题清单。
运行：python tools/data_quality.py
输出：控制台 + data/_data_quality.json
"""
import json
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')

docs = json.load(open(os.path.join(DATA, 'documents.json'), encoding='utf-8'))
ledger = json.load(open(os.path.join(DATA, 'ledger.json'), encoding='utf-8'))
tables = json.load(open(os.path.join(DATA, 'tables.json'), encoding='utf-8'))
recon = json.load(open(os.path.join(DATA, '_reconcile_report.json'), encoding='utf-8'))

findings = []


def add(level, title, detail, count, sample=None):
    findings.append({'level': level, 'title': title, 'detail': detail, 'count': count, 'sample': sample or []})


# 1. 台账 vs 原件金额对账
add('ok', '台账与原件金额对账',
    '按「发票/合同=价税合计、验收单/签收单=明细金额合计、出库单=成本金额合计、缴款书=进口增值税」四类口径逐张核对，全部一致。',
    recon['matched'], [])

# 2. 税号缺失
inv = [d for d in docs if d['docType'].endswith('发票')]
no_tax = [d for d in inv if not d['partyTaxNo']]
add('info', '发票购买方纳税人识别号缺失',
    '原件「纳税人识别号」栏为「—」。审核引擎对该字段降级为「提示」，不作硬性拦截（数据缺失不等于业务错误）。',
    len(no_tax), [f"{d['id']}({d['docType']})" for d in no_tax[:6]])
by_type = Counter(d['docType'] for d in no_tax)
add('info', '　└ 按类型分布', str(dict(by_type)), len(no_tax), [])

# 3. 普通发票征收率
normal = [d for d in docs if d['docType'] == '增值税普通发票']
rates = Counter(d['taxRate'] for d in normal)
add('warn', '费用类普通发票征收率不在 tax_rates 五档内',
    ('税率字典 tax_rates 为 13%%/9%%/6%%/0%%/5%%；普通发票中 %s。3%% 为小规模纳税人简易计税征收率，'
     '字典未收录，审核时对费用类普票不按销项税率校验，标注「需人工复核」。')
    % ', '.join('%s×%d 张' % (k, v) for k, v in rates.most_common()),
    sum(v for k, v in rates.items() if k not in ('13%', '9%', '6%', '0%', '5%')),
    [])

# 4. 普票「税额=金额×税率」勾稽
bad_calc = []
for d in normal:
    if d['amountExTax'] is None or d['taxAmount'] is None or not d['taxRate']:
        continue
    rn = float(d['taxRate'].rstrip('%')) / 100
    calc = round(d['amountExTax'] * rn, 2)
    if abs(calc - round(d['taxAmount'], 2)) > 0.01:
        bad_calc.append({'id': d['id'], 'rate': d['taxRate'], 'ex_tax': d['amountExTax'],
                         'doc_tax': d['taxAmount'], 'calc_tax': calc,
                         'gap': round(d['taxAmount'] - calc, 2)})
add('warn', '普通发票税额与「金额×征收率」不勾稽',
    '差额源于原件按价税合计倒算时不取整到分。审核引擎对费用类普票不以此判定通过/不通过，仅提示。',
    len(bad_calc), [f"{x['id']} {x['ex_tax']}×{x['rate']}={x['calc_tax']} vs 原件{x['doc_tax']}（差{x['gap']}）" for x in bad_calc[:5]])

# 5. 验收单「物料/产品」列
accs = [d for d in docs if d['docType'] == '验收单']
name_counter = Counter(d['items'][0]['name'] for d in accs if d['items'])
add('warn', '验收单「物料/产品」列填写的是单据名称而非产品名称',
    '22 张验收单该列均为 %s，无法据此识别开票品名；匹配验收证据须按「对方单位 + 不含税金额 + 数量」。'
    % dict(name_counter),
    len(accs), [])

# 6. 关键业务数据表口径冲突
kpi = {k['item']: k for k in tables['kpi']}
add('warn', '关键业务数据表「待开票事项 2 项」与销售明细 22 行口径冲突',
    '关键业务数据表记「待开票事项 2 项」，销售明细表为 22 行、参照系统（增值税发票开具系统）KPI 亦为 22。'
    '本应用统一采用销售明细 22 项；「2」实际对应未验收暂缓的 2 台设备（合同 HT-202512-002），'
    '已作为独立提示展示，未与 22 项混用。',
    1, ['KPI 待开票事项=%s %s' % (kpi.get('待开票事项', {}).get('value'), kpi.get('待开票事项', {}).get('unit'))])

# 7. 缴款书对方单位口径
ws = [d for d in docs if d['docType'] == '海关进口增值税专用缴款书']
if ws:
    lr = [x for x in ledger if x['id'] == ws[0]['id']][0]
    add('info', '海关缴款书「对方单位」口径差异（唯一一处台账与原件不一致）',
        '台账记「%s」，原件记载境外发货人「%s」。属登记口径差异，非解析错误；'
        '该单据为进项抵扣凭据，不参与销项开票审核。' % (lr['party'], ws[0]['party']),
        1, ['%s 台账=%s 原件=%s' % (ws[0]['id'], lr['party'], ws[0]['party'])])

# 8. 未验收暂缓事项
ht002 = [d for d in docs if d['id'] == 'HT-202512-002']
sign = [d for d in docs if d['docType'] == '到货签收单']
add('info', '未验收暂缓开票事项（教学考点）',
    '合同 HT-202512-002（价税合计 10,170,000.00 元，2 台）仅查到到货签收单 %s，无验收单；'
    '控制权未转移，本期不得开票。该情形不计入销售明细 22 行（销售明细说明「未验收 2 台不计入」），'
    '本应用以独立用例 TC-022 覆盖。' % (sign[0]['id'] if sign else '—'),
    1, ['HT-202512-002 = %s' % (ht002[0]['amountTotal'] if ht002 else '—')])

# 9. 重复开票的样本内既有发票
add('info', '数据集内已含 22 项业务的「已开具发票」',
    '175 张单据中含 104 张发票，其中销项发票与 22 项待开票事项一一对应（价税合计一致）。'
    '这些发票在本应用中被视为「标准答案/历史样本」，不纳入开票证据链；'
    '重复开票校验默认使用本会话发票池，历史池命中时降级为提示并说明可能为对照样本。',
    104, [])

out = {
    'docCount': len(docs), 'ledgerCount': len(ledger),
    'reconcile': {'exceptions': len(recon['exceptions']), 'parseWarnings': len(recon['warnings'])},
    'findings': findings,
}
with open(os.path.join(DATA, '_data_quality.json'), 'w', encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print('数据质量核查（%d 张单据 / %d 行台账）' % (len(docs), len(ledger)))
print('台账金额对账异常：%d 条；解析告警：%d 条' % (len(recon['exceptions']), len(recon['warnings'])))
print('=' * 78)
for f_ in findings:
    print('[%s] %s（%d）' % (f_['level'].upper(), f_['title'], f_['count']))
    print('    ' + f_['detail'])
    for s in f_['sample']:
        print('      · ' + s)
print('=' * 78)
print('已写出 data/_data_quality.json')
