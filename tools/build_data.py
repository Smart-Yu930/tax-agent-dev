# -*- coding: utf-8 -*-
"""
构建 data/*.json —— 智能发票审核与开发助手的数据底座。

输入：
  input/数据集/05-单据原件/*.html   175 张单据原件
  input/数据集/04-单据台账/01-单据台账.xlsx
  input/数据集/02-业务表格/01-销售明细表.xlsx
  input/数据集/02-业务表格/02-关键业务数据表.xlsx
  input/数据集/03-测试用例/01-智能体测试用例表.xlsx
  input/数据集/manifest.json
输出：
  data/documents.json  data/ledger.json  data/tables.json  data/dict.json
  data/_reconcile_report.json（台账 vs 原件 对账结果，供数据质量报告使用）

运行：python tools/build_data.py
"""
import json
import os
import re
import sys
from collections import OrderedDict, Counter

from lxml import html as LH
import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DS = os.path.join(ROOT, "input", "数据集")
DOCS_DIR = os.path.join(DS, "05-单据原件")
OUT = os.path.join(ROOT, "data")

SELF_NAME = "华衡智造集团股份有限公司"
SELF_TAXNO = "91440300MA5H8K2X3Q"

# 单据类型 → 角色口径
DOC_TYPES = OrderedDict([
    ("增值税专用发票", {"role": "销项", "auditRequired": True, "evidence": ["销售合同", "验收单", "出库单"]}),
    ("增值税普通发票", {"role": "费用/进项", "auditRequired": False, "evidence": []}),
    ("出口发票", {"role": "销项-出口", "auditRequired": True, "evidence": ["销售合同", "验收单", "出库单"]}),
    ("销售合同", {"role": "收入依据", "auditRequired": True, "evidence": []}),
    ("采购合同", {"role": "成本依据", "auditRequired": False, "evidence": []}),
    ("验收单", {"role": "控制权转移证据", "auditRequired": True, "evidence": ["销售合同"]}),
    ("到货签收单", {"role": "交付证据", "auditRequired": True, "evidence": ["销售合同"]}),
    ("出库单", {"role": "出库证据", "auditRequired": True, "evidence": ["销售合同"]}),
    ("海关进口增值税专用缴款书", {"role": "进项-进口", "auditRequired": False, "evidence": []}),
])

# 单据类型别名 → 标准枚举（原始标题保留在 docTypeRaw）
DOC_TYPE_ALIAS = {
    "出口货物商业发票": "出口发票",
}

# 台账金额口径：不同单据类型金额含义不同（已在数据质量报告中说明）
LEDGER_BASIS = {
    "增值税专用发票": "价税合计", "增值税普通发票": "价税合计", "出口发票": "价税合计",
    "销售合同": "价税合计", "采购合同": "合同总价",
    "验收单": "明细金额合计（不含税）", "到货签收单": "明细金额合计（不含税）",
    "出库单": "成本金额合计", "海关进口增值税专用缴款书": "进口增值税",
}

GRID_COLUMNS = {
    "货物或应税劳务名称": "name", "规格型号": "spec", "单位": "unit", "数量": "qty",
    "单价": "unitPrice", "金额": "amount", "税率": "taxRate", "税额": "taxAmount",
    "货物名称": "name", "货物": "name",
    "项目": "name", "物料编码": "code", "名称": "name",
    "物料 / 产品": "name", "商品名称": "name",
    "应收 / 账面数量": "qtyBook", "实收 / 实盘数量": "qtyActual",
    "单价（元）": "unitPrice", "金额（元）": "amount", "质检结果": "quality",
    "成本单价": "unitPrice", "成本金额": "amount",
    "状态": "status", "已入库": "status",
    "计税价格（CIF+关税）": "base", "关税税率": "tariffRate",
    "关税": "tariff", "进口增值税": "vat",
}


def txt(el):
    if el is None:
        return ""
    return re.sub(r"\s+", " ", (el.text_content() or "")).strip()


def num(s):
    """'4,500,000.00 元' → 4500000.0；'13%' → 0.13；'—' → None"""
    if s is None:
        return None
    s = str(s).strip()
    if s in ("", "—", "-", "—（另由关税缴款书征收）"):
        return None
    s = s.replace("¥", "").replace("元", "").replace(",", "").strip()
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def rate_of(s):
    """'13%' → '13%'；0.13 → '13%'"""
    if s is None:
        return None
    s = str(s).strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
    if m:
        v = float(m.group(1))
        return ("%g%%" % v)
    return None


def by_class(root, cls):
    return root.xpath("//*[contains(concat(' ', normalize-space(@class), ' '), ' %s ')]" % cls)


def first_class(root, cls):
    els = by_class(root, cls)
    return els[0] if els else None


def kv_block(block, loc_prefix, fields, label_tag="span"):
    """解析 <div><span|label>标签</span><b>值</b></div> 网格区块"""
    if block is None:
        return []
    out = []
    for i, d in enumerate(block.findall("div")):
        lab = d.find(label_tag)
        if lab is None:
            lab = d.find("label")
        b = d.find("b")
        label = txt(lab) if lab is not None else ""
        value = txt(b) if b is not None else txt(d)
        if not label:
            # 形如「经办人：王磊」
            t = txt(d)
            m = re.match(r"^([^：:]{1,10})[：:]\s*(.*)$", t)
            if m:
                label, value = m.group(1), m.group(2)
            else:
                continue
        out.append({
            "label": label, "value": value,
            "loc": "%s · 第%d项「%s」" % (loc_prefix, i + 1, label),
        })
    return out


def parse_doc(path, idx):
    raw = open(path, "r", encoding="utf-8").read()
    root = LH.fromstring(raw)
    fname = os.path.basename(path)

    doc_id = ""
    no_el = first_class(root, "q2-doc2-no")
    if no_el is not None:
        bs = no_el.findall("b")
        if bs:
            doc_id = txt(bs[0])
    if not doc_id:
        m = re.match(r"^\d{3}-([A-Z]{2}-\d{6}-\d{3})", fname)
        doc_id = m.group(1) if m else ""

    title_el = first_class(root, "q2-doc2-title")
    doc_type_raw = txt(title_el.find("h2")) if (title_el is not None and title_el.find("h2") is not None) else ""
    doc_type = DOC_TYPE_ALIAS.get(doc_type_raw, doc_type_raw)
    sub_title = txt(title_el.find("p")) if (title_el is not None and title_el.find("p") is not None) else ""

    fields = []
    warnings = []

    # ---- 头部信息区
    doc_date = ""
    if no_el is not None:
        t = txt(no_el)
        m = re.search(r"(\d{4}-\d{2}-\d{2})", t)
        if m:
            doc_date = m.group(1)
        fields.append({"key": "id", "label": "单据编号", "value": doc_id,
                       "loc": "页眉区 · 单据编号", "field_source": "rule"})
    if sub_title:
        fields.append({"key": "title", "label": "单据二级标题", "value": sub_title,
                       "loc": "标题区 · 副标题", "field_source": "rule"})

    # ---- 票据信息区 / 业务信息区
    invmeta = {}
    for block_cls, prefix in (("q2-doc2-invmeta", "票据信息区"), ("q2-doc2-whbar", "业务信息区"),
                              ("q2-doc2-orderbar", "业务信息区"), ("q2-doc2-formbar", "业务信息区"),
                              ("q2-doc2-custombar", "业务信息区")):
        blk = first_class(root, block_cls)
        for kv in kv_block(blk, prefix, fields):
            invmeta[kv["label"]] = kv["value"]
            fields.append({"key": None, "label": kv["label"], "value": kv["value"],
                           "loc": kv["loc"], "field_source": "rule"})

    if not doc_date:
        doc_date = invmeta.get("开票日期") or invmeta.get("业务日期") or ""

    # ---- 往来方
    party = party_role = party_taxno = ""
    parties = first_class(root, "q2-doc2-parties")
    party_list = []
    if parties is not None:
        for i, d in enumerate(parties.findall("div")):
            role = txt(d.find("label"))
            name = txt(d.find("b"))
            extra = txt(d.find("span"))
            m = re.search(r"纳税人识别号\s*([0-9A-Z]{15,20})", extra)
            taxno = m.group(1) if m else None
            party_list.append({"role": role, "name": name, "taxNo": taxno})
            fields.append({"key": None, "label": role + "名称", "value": name,
                           "loc": "往来方区 · 第%d方「%s」" % (i + 1, role), "field_source": "rule"})
            if taxno:
                fields.append({"key": None, "label": role + "纳税人识别号", "value": taxno,
                               "loc": "往来方区 · 第%d方「%s」纳税人识别号" % (i + 1, role),
                               "field_source": "rule"})

    if party_list:
        # 对方 = 非本企业的一方
        other = [p for p in party_list if p["name"] and p["name"] != SELF_NAME]
        if other:
            party, party_role, party_taxno = other[0]["name"], other[0]["role"], (other[0]["taxNo"] or "")
        else:
            party, party_role, party_taxno = party_list[0]["name"], party_list[0]["role"], (party_list[0]["taxNo"] or "")

    # 业务单据（验收单/出库单/签收单）的往来单位
    if not party and invmeta.get("往来单位"):
        party = invmeta["往来单位"]
        party_role = "往来单位"

    # ---- 明细表
    items = []
    grid = first_class(root, "q2-doc2-grid")
    if grid is not None:
        headers = [txt(th) for th in grid.xpath(".//thead//th")]
        keys = []
        unknown = []
        for h in headers:
            k = GRID_COLUMNS.get(h)
            if k is None:
                unknown.append(h)
            keys.append(k)
        if unknown:
            warnings.append("未识别明细列：%s" % "/".join(unknown))
        for ri, tr in enumerate(grid.xpath(".//tbody/tr")):
            tds = [txt(td) for td in tr.findall("td")]
            if not tds:
                continue
            rec = OrderedDict()
            for ci, val in enumerate(tds):
                k = keys[ci] if ci < len(keys) else None
                if k:
                    rec[k] = val
            items.append({
                "name": rec.get("name") or rec.get("code") or "",
                "spec": rec.get("spec") or "",
                "unit": rec.get("unit") or "",
                "qty": num(rec.get("qty") or rec.get("qtyActual") or rec.get("qtyBook")),
                "unitPrice": num(rec.get("unitPrice")),
                "amount": num(rec.get("amount")),
                "taxRate": rate_of(rec.get("taxRate")),
                "taxAmount": num(rec.get("taxAmount")),
                "extra": {k2: v2 for k2, v2 in rec.items()
                          if k2 not in ("name", "spec", "unit", "qty", "unitPrice", "amount",
                                        "taxRate", "taxAmount") and v2},
                "loc": "明细表 第%d行" % (ri + 1),
            })
            # 明细关键列入字段表（来源追溯）
            for h, v in zip(headers, tds):
                fields.append({"key": None, "label": "明细·%s" % h, "value": v,
                               "loc": "明细表 第%d行「%s」" % (ri + 1, h), "field_source": "rule"})

    # ---- 合同条款表
    terms = OrderedDict()
    terms_el = first_class(root, "q2-doc2-terms")
    if terms_el is not None:
        for tr in terms_el.xpath(".//tbody/tr"):
            th = tr.find("th")
            td = tr.find("td")
            if th is None or td is None:
                continue
            lab, val = txt(th), txt(td)
            terms[lab] = val
            fields.append({"key": None, "label": lab, "value": val,
                           "loc": "合同要素表 · 「%s」" % lab, "field_source": "rule"})

    # ---- 合计区
    total_block = first_class(root, "q2-doc2-total")
    totals = OrderedDict()
    if total_block is not None:
        for i, d in enumerate(total_block.findall("div")):
            t = txt(d)
            m = re.match(r"^([^：:]{2,20})[：:]\s*(.*)$", t)
            if m:
                lab, val = m.group(1), m.group(2)
            else:
                lab, val = t[:12], t
            b = d.find("b")
            em = d.find("em")
            totals[lab] = txt(b) if b is not None else val
            if em is not None:
                totals[lab + "_小写"] = txt(em)
            fields.append({"key": None, "label": lab, "value": totals[lab],
                           "loc": "合计区 · 第%d项「%s」" % (i + 1, lab), "field_source": "rule"})
            if em is not None:
                fields.append({"key": None, "label": lab + "（小写）", "value": txt(em),
                               "loc": "合计区 · 第%d项「%s」小写行" % (i + 1, lab), "field_source": "rule"})

    # ---- 备注 / 说明
    remark = ""
    for cls in ("q2-doc2-note2", "q2-doc2-p"):
        el = first_class(root, cls)
        if el is not None and txt(el):
            remark = txt(el)
            break

    # ---- 页脚签署
    footers = OrderedDict()
    for cls in ("q2-doc2-foot", "q2-doc2-invfoot", "q2-doc2-sign"):
        el = first_class(root, cls)
        if el is None:
            continue
        for d in el.findall("div"):
            t = txt(d)
            m = re.match(r"^([^：:]{1,8})[：:]\s*(.*)$", t)
            if m and m.group(2):
                footers[m.group(1)] = m.group(2)
                fields.append({"key": None, "label": m.group(1), "value": m.group(2),
                               "loc": "签署区 · 「%s」" % m.group(1), "field_source": "rule"})

    # ---- 语义字段汇总
    amount_ex = tax_amt = amount_total = None
    amount_words = ""
    tax_rate = None

    if doc_type.endswith("发票"):
        amount_ex = num(totals.get("合计金额"))
        tax_amt = num(totals.get("合计税额"))
        amount_words = totals.get("价税合计（大写）") or ""
        amount_total = num(totals.get("价税合计（大写）_小写")) or num(totals.get("价税合计_小写"))
        tax_rate = next((it["taxRate"] for it in items if it.get("taxRate")), None)
        if amount_total is None and amount_ex is not None:
            amount_total = round(amount_ex + (tax_amt or 0), 2)
    elif doc_type in ("销售合同", "采购合同"):
        if doc_type == "销售合同":
            amount_ex = num(terms.get("金额（不含税）"))
            amount_total = num(terms.get("价税合计"))
            tax_rate = rate_of(terms.get("增值税率"))
            tax_amt = round(amount_total - amount_ex, 2) if (amount_total is not None and amount_ex is not None) else None
        else:
            amount_total = num(terms.get("合同总价"))
            amount_ex = amount_total
        if amount_total is None:
            m = None
            for p in by_class(root, "q2-doc2-clause"):
                mm = re.search(r"合同总价为人民币\s*([\d,\.]+)\s*元", txt(p))
                if mm:
                    m = mm
                    break
            if m:
                amount_total = num(m.group(1))
        # 数量 / 单价 / 标的
        if terms.get("数量"):
            q = re.match(r"([\d,\.]+)\s*(.*)", terms["数量"])
            if q:
                items = [{
                    "name": terms.get("标的", ""), "spec": "", "unit": q.group(2).strip(),
                    "qty": num(q.group(1)), "unitPrice": num(terms.get("单价（不含税）")),
                    "amount": amount_ex, "taxRate": tax_rate, "taxAmount": None,
                    "extra": {}, "loc": "合同要素表 · 标的/数量/单价行",
                }]
    elif doc_type in ("验收单", "到货签收单", "出库单"):
        amount_total = round(sum(it["amount"] or 0 for it in items), 2) or None
        amount_ex = amount_total
    elif doc_type == "海关进口增值税专用缴款书":
        amount_ex = num(totals.get("计税价格"))
        tax_amt = num(totals.get("进口增值税"))
        amount_words = ""
        amount_total = round(amount_ex + (tax_amt or 0), 2) if amount_ex is not None else None

    # 发票类补充：价税合计校验
    if doc_type.endswith("发票") and amount_total is not None and amount_ex is not None:
        gap = round(amount_total - (amount_ex + (tax_amt or 0)), 2)
        if abs(gap) > 0.01:
            warnings.append("价税合计与「不含税金额+税额」相差 %.2f 元" % gap)

    # 语义字段的来源定位登记
    def add_field(key, label, value, loc):
        if value is None or value == "":
            return
        fields.append({"key": key, "label": label, "value": str(value),
                       "num": num(value), "loc": loc, "field_source": "rule"})

    if amount_ex is not None:
        basis = metrics_loc = ""
        if doc_type.endswith("发票"):
            metrics_loc = "合计区 · 「合计金额」行"
        elif doc_type in ("销售合同", "采购合同"):
            metrics_loc = "合同要素表 · 「金额（不含税）」行" if doc_type == "销售合同" else "合同要素表 · 「合同总价」行"
        elif doc_type in ("验收单", "到货签收单", "出库单"):
            metrics_loc = "明细表 · 「金额」列合计"
        else:
            metrics_loc = "合计区 · 「计税价格」行"
        add_field("amountExTax", "不含税金额", "%.2f" % amount_ex, metrics_loc)
    if amount_total is not None:
        if doc_type.endswith("发票"):
            lt = "合计区 · 「价税合计（大写）」小写行"
        elif doc_type == "销售合同":
            lt = "合同要素表 · 「价税合计」行"
        elif doc_type == "采购合同":
            lt = "合同要素表 · 「合同总价」行"
        elif doc_type in ("验收单", "到货签收单", "出库单"):
            lt = "明细表 · 「金额」列合计"
        else:
            lt = "合计区 · 「计税价格」+「进口增值税」"
        add_field("amountTotal", "价税合计/业务金额", "%.2f" % amount_total, lt)
    if tax_amt is not None:
        add_field("taxAmount", "税额", "%.2f" % tax_amt,
                  "合计区 · 「合计税额」行" if doc_type.endswith("发票") else "合同要素表 · 价税合计与金额差额")
    if tax_rate:
        add_field("taxRate", "税率", tax_rate,
                  "明细表 第1行「税率」列" if doc_type.endswith("发票") else "合同要素表 · 「增值税率」行")

    return {
        "idx": idx,
        "id": doc_id,
        "file": fname,
        "docType": doc_type,
        "title": sub_title,
        "docTypeRaw": doc_type_raw,
        "docDate": doc_date,
        "party": party,
        "partyRole": party_role,
        "partyTaxNo": party_taxno or None,
        "selfName": SELF_NAME,
        "selfTaxNo": SELF_TAXNO,
        "amountExTax": round(amount_ex, 2) if amount_ex is not None else None,
        "taxAmount": round(tax_amt, 2) if tax_amt is not None else None,
        "amountTotal": round(amount_total, 2) if amount_total is not None else None,
        "amountInWords": amount_words or None,
        "taxRate": tax_rate,
        "currency": "CNY",
        "invoiceCode": invmeta.get("发票代码"),
        "invoiceNo": invmeta.get("发票号码"),
        "checkCode": invmeta.get("校验码"),
        "contractNo": terms.get("合同编号"),
        "remark": remark or None,
        "items": items,
        "terms": dict(terms) if terms else {},
        "totals": dict(totals) if totals else {},
        "footers": dict(footers) if footers else {},
        "fields": fields,
        "textLen": len(raw),
        "parseWarnings": warnings,
    }


def read_sheet(path, idx=0):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.worksheets[idx]
    rows = []
    for r in ws.iter_rows(values_only=True):
        rows.append([("" if c is None else c) for c in r])
    return rows


def enrich_sales(sales, docs):
    """为销售明细行补出合同/验收/出库证据与验收状态，避免前端各自推断。"""
    def cand(row):
        return [d for d in docs if d["party"] == row["customer"]]

    for row in sales:
        cs = cand(row)
        want_total = round(row["amount"] * (1 if row["region"] == "出口" else 1.13), 2)
        contracts = [d for d in cs if d["docType"] == "销售合同" and d["amountTotal"] is not None
                     and abs(d["amountTotal"] - want_total) < 0.01]
        name_hit = [d for d in contracts if d["items"] and d["items"][0]["name"] == row["product"]]
        if name_hit:
            contracts = name_hit
        if len(contracts) > 1:
            qty_hit = [d for d in contracts if d["items"] and d["items"][0]["qty"] == row["qty"]]
            if qty_hit:
                contracts = qty_hit
        accs = [d for d in cs if d["docType"] == "验收单" and d["amountTotal"] is not None
                and abs(d["amountTotal"] - row["amount"]) < 0.01]
        if len(accs) > 1:
            n2 = [d for d in accs if d["items"] and d["items"][0]["name"] == row["product"]]
            if n2:
                accs = n2
        if len(accs) > 1:
            # 验收单「物料/产品」列填的是单据名称，需按数量再区分（如越南 2 台 / 1 套）
            q2 = [d for d in accs if d["items"] and d["items"][0]["qty"] == row["qty"]]
            if q2:
                accs = q2
        cks = [d for d in cs if d["docType"] == "出库单" and d["items"] and d["items"][0]["qty"] == row["qty"]]
        if len(cks) > 1:
            d2 = [d for d in cks if d["docDate"] == row["date"]]
            if d2:
                cks = d2
        signs = [d for d in cs if d["docType"] == "到货签收单"]
        contract = contracts[0] if contracts else None
        acc = accs[0] if accs else None
        ck = cks[0] if cks else None
        row["contractNo"] = contract["id"] if contract else None
        row["acceptStatus"] = "已验收" if acc else "未验收"
        row["evidence"] = {
            "contract": contract["id"] if contract else None,
            "acceptance": acc["id"] if acc else None,
            "stockOut": ck["id"] if ck else None,
            "deliverySign": signs[0]["id"] if signs else None,
            "docs": [d["id"] for d in (contract, acc, ck) if d],
        }
    return sales


def build():
    os.makedirs(OUT, exist_ok=True)
    files = sorted(os.listdir(DOCS_DIR))
    docs = []
    for i, f in enumerate(files, 1):
        docs.append(parse_doc(os.path.join(DOCS_DIR, f), i))

    # ---------- 台账
    ledger_rows = read_sheet(os.path.join(DS, "04-单据台账", "01-单据台账.xlsx"))[1:]
    doc_by_id = {d["id"]: d for d in docs}
    ledger = []
    for r in ledger_rows:
        if not r or not str(r[1]).strip():
            continue
        lid = str(r[1]).strip()
        d = doc_by_id.get(lid)
        ledger.append({
            "idx": int(r[0]) if str(r[0]).strip().isdigit() else None,
            "id": lid, "docType": str(r[2]).strip(), "summary": str(r[3]).strip(),
            "date": str(r[4]).strip(), "party": str(r[5]).strip(),
            "amount": float(r[6]) if str(r[6]).strip() not in ("", "None") else None,
            "file": d["file"] if d else None,
            "inDataset": bool(d),
        })

    # ---------- 对账（台账金额 vs 原件金额，按各类型口径）
    exceptions = []
    for lr in ledger:
        d = doc_by_id.get(lr["id"])
        if not d:
            exceptions.append({"id": lr["id"], "reason": "台账有记录但数据集中无原件"})
            continue
        basis = LEDGER_BASIS.get(d["docType"], "")
        if basis == "价税合计":
            v = d["amountTotal"]
        elif basis == "合同总价":
            v = d["amountTotal"]
        elif basis == "明细金额合计（不含税）":
            v = d["amountTotal"]
        elif basis == "成本金额合计":
            v = d["amountTotal"]
        elif basis == "进口增值税":
            v = d["taxAmount"]
        else:
            v = d["amountTotal"]
        if v is None or lr["amount"] is None:
            exceptions.append({"id": lr["id"], "docType": d["docType"],
                               "reason": "金额缺失", "docAmount": v, "ledgerAmount": lr["amount"]})
            continue
        if abs(round(v, 2) - round(lr["amount"], 2)) > 0.01:
            exceptions.append({"id": lr["id"], "docType": d["docType"], "basis": basis,
                               "docAmount": v, "ledgerAmount": lr["amount"],
                               "gap": round(v - lr["amount"], 2),
                               "reason": "台账金额与原件口径不一致"})
    # 原件有、台账缺
    ledger_ids = {lr["id"] for lr in ledger}
    for d in docs:
        if d["id"] not in ledger_ids:
            exceptions.append({"id": d["id"], "reason": "原件存在但台账无记录"})

    reconcile = {
        "docCount": len(docs), "ledgerCount": len(ledger),
        "matched": len(docs) - len([e for e in exceptions if e.get("reason", "").startswith("原件存在")]),
        "exceptions": exceptions,
        "basisNote": LEDGER_BASIS,
        "warnings": [{"id": d["id"], "docType": d["docType"], "w": d["parseWarnings"]}
                     for d in docs if d["parseWarnings"]],
    }

    # ---------- 业务表格
    sales_rows = read_sheet(os.path.join(DS, "02-业务表格", "01-销售明细表.xlsx"))[1:]
    sales = []
    for r in sales_rows:
        if not r or not str(r[0]).strip() or str(r[0]).strip() == "合计":
            continue
        sales.append({"product": str(r[0]).strip(), "date": str(r[1]).strip(),
                      "customer": str(r[2]).strip(),
                      "qty": num(r[3]), "unitPrice": num(r[4]), "amount": num(r[5]),
                      "region": str(r[6]).strip()})

    kpi_rows = read_sheet(os.path.join(DS, "02-业务表格", "02-关键业务数据表.xlsx"))[1:]
    kpi = []
    for r in kpi_rows:
        if not r or not str(r[1]).strip():
            continue
        kpi.append({"no": r[0], "item": str(r[1]).strip(), "value": str(r[2]).strip(),
                    "unit": str(r[3]).strip(), "note": str(r[4]).strip()})

    case_rows = read_sheet(os.path.join(DS, "03-测试用例", "01-智能体测试用例表.xlsx"))[1:]
    cases = []
    for r in case_rows:
        if not r or not str(r[0]).strip():
            continue
        cases.append({"no": str(r[0]).strip(), "step": str(r[1]).strip(),
                      "scenario": str(r[2]).strip(), "input": str(r[3]).strip(),
                      "expected": str(r[4]).strip(), "criteria": str(r[5]).strip(),
                      "score": str(r[6]).strip(), "taskType": str(r[7]).strip()})

    tables = {"sales": enrich_sales(sales, docs), "kpi": kpi, "cases": cases}

    # ---------- 字典
    tax_rates = [
        {"rate": "13%", "code": 0.13, "scope": "销售或进口货物、加工修理修配劳务、有形动产租赁服务", "source": "tax_rates"},
        {"rate": "9%", "code": 0.09, "scope": "交通运输、邮政、基础电信、建筑、不动产租赁与销售、农产品等", "source": "tax_rates"},
        {"rate": "6%", "code": 0.06, "scope": "现代服务、金融服务、生活服务、无形资产销售（除土地使用权）", "source": "tax_rates"},
        {"rate": "0%", "code": 0.0, "scope": "出口货物、境内单位跨境应税行为（适用零税率）", "source": "tax_rates"},
        {"rate": "5%", "code": 0.05, "scope": "简易计税征收率（不动产经营租赁、劳务派遣差额等）", "source": "tax_rates"},
    ]

    cust_counter = Counter()
    cust_tax = {}
    for d in docs:
        if d["party"] and d["partyTaxNo"]:
            cust_counter[d["party"]] += 1
            cust_tax[d["party"]] = d["partyTaxNo"]
    customers = [{"name": n, "taxNo": cust_tax.get(n), "creditLevel": None,
                  "invoiceCount": c, "source": "document"}
                 for n, c in cust_counter.most_common()]

    prod_rates = {}
    for s in sales:
        prod_rates.setdefault(s["product"], set()).add(s["region"])
    scope = []
    for p in sorted(prod_rates):
        regions = prod_rates[p]
        scope.append({
            "product": p,
            "category": "应税货物-机械设备" if "机床" in p or "产线" in p or "机器人" in p else
                        ("应税货物-零部件" if "功能部件" in p else "应税服务-售后服务"),
            "defaultRate": "13%",
            "taxClass": "应税货物" if "服务" not in p else "应税服务",
            "regions": sorted(regions),
        })

    field_defs = [
        {"key": "party", "label": "购买方名称", "required": True, "check": "check_title",
         "kinds": ["增值税专用发票", "出口发票", "销售合同", "验收单", "出库单"]},
        {"key": "partyTaxNo", "label": "纳税人识别号", "required": True, "check": "check_title",
         "kinds": ["增值税专用发票", "出口发票"]},
        {"key": "amountTotal", "label": "价税合计", "required": True, "check": "check_amount",
         "kinds": ["增值税专用发票", "出口发票", "销售合同", "验收单"]},
        {"key": "amountExTax", "label": "不含税金额", "required": True, "check": "check_amount",
         "kinds": ["增值税专用发票", "出口发票", "销售合同"]},
        {"key": "taxRate", "label": "税率", "required": True, "check": "check_tax_rate",
         "kinds": ["增值税专用发票", "出口发票", "销售合同"]},
        {"key": "docDate", "label": "单据日期", "required": True, "check": "check_date",
         "kinds": ["增值税专用发票", "销售合同", "验收单", "出库单"]},
        {"key": "contractNo", "label": "合同编号", "required": False, "check": "check_scope",
         "kinds": ["销售合同"]},
        {"key": "items", "label": "货物/服务明细", "required": True, "check": "check_scope",
         "kinds": ["增值税专用发票", "出口发票", "销售合同"]},
    ]

    doc_types = [{"name": k, "role": v["role"], "auditRequired": v["auditRequired"],
                  "evidence": v["evidence"], "count": sum(1 for d in docs if d["docType"] == k)}
                 for k, v in DOC_TYPES.items()]

    manifest = json.load(open(os.path.join(DS, "manifest.json"), "r", encoding="utf-8"))
    meta = {
        "case": manifest["case"]["company"], "period": manifest["case"]["period"],
        "company": SELF_NAME, "selfTaxNo": SELF_TAXNO,
        "project": manifest["project"], "generatedAt": manifest["generatedAt"],
        "docCount": len(docs), "tableCount": 4, "caseCount": len(cases),
        "docTypeCounts": {k: v for k, v in Counter(d["docType"] for d in docs).items()},
        "dataset": "P1-01-发票开具-勾选数据集",
    }

    def dump(name, obj):
        p = os.path.join(OUT, name)
        with open(p, "w", encoding="utf-8", newline="\n") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=False)
        print("  %-20s %8.1f KB" % (name, os.path.getsize(p) / 1024))

    print("写出：")
    dump("documents.json", docs)
    dump("ledger.json", ledger)
    dump("tables.json", tables)
    dump("dict.json", {"taxRates": tax_rates, "customers": customers, "scope": scope,
                       "fieldDefs": field_defs, "docTypes": doc_types})
    dump("_reconcile_report.json", reconcile)

    # ---------- 控制台小结
    print("\n单据：%d 张  台账：%d 行  用例：%d 条" % (len(docs), len(ledger), len(cases)))
    print("单据类型分布：", dict(Counter(d["docType"] for d in docs)))
    print("解析告警：%d 条" % len(reconcile["warnings"]))
    for w in reconcile["warnings"][:12]:
        print("  !", w["id"], w["docType"], w["w"])
    print("对账异常：%d 条" % len(exceptions))
    for e in exceptions[:12]:
        print("  x", e)
    missing = [(d["id"], d["docType"]) for d in docs
               if d["amountTotal"] is None and d["docType"] not in ("出库单",)]
    print("金额缺失：", missing[:10], "共", len(missing))
    no_taxno = [d["id"] for d in docs if d["docType"].endswith("发票") and not d["partyTaxNo"]]
    print("发票缺购买方税号：", no_taxno[:10], "共", len(no_taxno))
    return docs, ledger, tables, reconcile


if __name__ == "__main__":
    build()
