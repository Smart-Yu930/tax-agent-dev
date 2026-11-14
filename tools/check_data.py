# -*- coding: utf-8 -*-
"""抽查 data/documents.json 解析质量。"""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
docs = json.load(open(os.path.join(ROOT, "data", "documents.json"), encoding="utf-8"))
by_id = {d["id"]: d for d in docs}

want = ["FP-202512-001", "HT-202512-001", "YS-202512-001", "FP-202512-002",
        "FP-202512-075", "WS-202512-001", "CG-202512-001", "CK-202512-001",
        "FP-202512-023", "HT-202512-002", "YS-202512-023"]
for i in want:
    d = by_id.get(i)
    if not d:
        print(i, "MISSING")
        continue
    print("%s | %-14s | %-12s | %s | taxNo=%s | ex=%s tax=%s total=%s | rate=%s | items=%d | fields=%d"
          % (i, d["docType"], d["partyRole"], d["party"], d["partyTaxNo"],
             d["amountExTax"], d["taxAmount"], d["amountTotal"], d["taxRate"],
             len(d["items"]), len(d["fields"])))

print()
d = by_id["FP-202512-001"]
print("字段来源样例（FP-202512-001 前 12 条）:")
for f in d["fields"][:12]:
    print("  [%s] %s = %s  ← %s" % (f.get("key") or "-", f["label"], f["value"], f["loc"]))

print()
print("覆盖统计：")
n_no_taxno = sum(1 for d in docs if d["docType"].endswith("发票") and not d["partyTaxNo"])
n_no_rate = sum(1 for d in docs if d["docType"].endswith("发票") and not d["taxRate"])
n_no_items = sum(1 for d in docs if not d["items"])
n_no_amount = sum(1 for d in docs if d["amountTotal"] is None)
n_no_loc = sum(1 for d in docs if any(not f.get("loc") for f in d["fields"]))
print("  发票缺购买方税号: %d（数据集原文为「—」，属真实缺失）" % n_no_taxno)
print("  发票缺税率: %d" % n_no_rate)
print("  无明细行单据: %d" % n_no_items)
print("  无业务金额单据: %d" % n_no_amount)
print("  存在无来源定位字段的单据: %d" % n_no_loc)
print("  字段总数: %d" % sum(len(d["fields"]) for d in docs))
