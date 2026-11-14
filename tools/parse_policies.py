# -*- coding: utf-8 -*-
"""制度原文 -> data/policies.json（严格按 docs/DATA_CONTRACT.md 第 6 节 Policy 结构）。

设计要点
--------
1. 条文不进模型"自由生成"，全部来自原文逐行摘录：
   脚本按「条文号 + 唯一锚点字符串」在原文中定位唯一一行，
   取该行原文作为 text（仅做空白规整与超长截断），不做任何改写。
2. 出处 loc 用程序核对，不靠人工誊抄：
   定位到条文行后，向上回溯最近的小节标题 / 章名，断言其与本条 config 里
   声明的 section 一致，并断言所在部分名称与 loc 声明的部分一致。
3. 任何一条定位失败、或校验不通过，脚本直接报错退出，不产出半成品 JSON。

用法（Windows PowerShell，项目根目录）：
    python tools\\parse_policies.py            # 生成并自检 data\\policies.json
    python tools\\parse_policies.py --check    # 只读回已有 JSON 做结构自检
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "input" / "交付包"
OUT_PATH = ROOT / "data" / "policies.json"

MAX_TEXT = 200  # 契约要求：原文摘录 <= 200 字

# 固定的审核项枚举（契约/需求给定，不得扩展）
RULES = {
    "check_title",    # 抬头一致性（购买方名称/税号）
    "check_tax_rate", # 税率正确性
    "check_amount",   # 金额一致性（不含税/税额/价税合计）
    "check_scope",    # 开票范围（标的、商品、业务边界）
    "check_date",     # 日期合理性
    "log",            # 审核记录留痕与日志留存
    "trace",          # 来源追溯（字段级证据链）
    "access",         # 访问控制与密钥管理
}

PART_RE = re.compile(r"^第[一二三四五六七八九十]+部分\s*\S")
CHAPTER_RE = re.compile(r"^第[一二三四五六七八九十]+章\s*\S")
# 小节标题：单个整数编号 + 空白 + 标题（不含小数点，用于与「3.3」这类条文区分）
SECTION_RE = re.compile(r"^\d+\s+\S")


def norm(s: str) -> str:
    """空白规整：把连续空白压成一个半角空格并去首尾空白（不改动任何汉字/标点）。"""
    return re.sub(r"\s+", " ", s).strip()


def read_lines(path: Path) -> list[str]:
    raw = path.read_text(encoding="utf-8")
    if "\ufffd" in raw:  # U+FFFD：解码失败的替换字符，说明编码不是 UTF-8
        raise UnicodeDecodeError("utf-8", raw.encode("utf-8", "replace"), 0, 1, "发现替换字符")
    return raw.splitlines()


def clause_text(line: str) -> str:
    """原文行 -> text：规整空白，超过 200 字按字截断并以「…」结尾。"""
    text = norm(line)
    if len(text) > MAX_TEXT:
        text = text[: MAX_TEXT - 1].rstrip() + "…"
    return text


def locate(lines: list[str], spec: dict) -> tuple[int, str]:
    """按条文号前缀 + 唯一锚点定位条文行，返回 (行号, 归一化原文)。"""
    prefix = norm(spec.get("prefix", spec["no"]))
    anchor = spec["anchor"]
    hits = [
        (i, norm(line))
        for i, line in enumerate(lines)
        if line.strip() and norm(line).startswith(prefix) and anchor in norm(line)
    ]
    if not hits:
        raise LookupError(
            f"{spec['id']} {spec['no']}: 原文中未找到同时满足 前缀「{prefix}」与 锚点「{anchor}」的行"
        )
    if len(hits) > 1:
        detail = "；".join(f"第{i + 1}行" for i, _ in hits)
        raise LookupError(f"{spec['id']} {spec['no']}: 定位不唯一（{detail}），锚点需加长")
    return hits[0]


def context(lines: list[str], idx: int) -> tuple[str, str]:
    """返回条文行所处的 (部分名, 最近的小节/章标题)。"""
    part = ""
    locator = ""
    for i in range(idx, -1, -1):
        line = norm(lines[i])
        if not locator and (SECTION_RE.match(line) or CHAPTER_RE.match(line)):
            locator = line
        if not part and PART_RE.match(line):
            part = line
        if part and locator:
            break
    if not part or not locator:
        raise LookupError(f"第{idx + 1}行：未能回溯出所在部分或小节/章标题")
    return part, locator


def build_policy(policy: dict) -> dict:
    path = SOURCE_DIR / policy["file"]
    if not path.is_file():
        raise FileNotFoundError(f"制度原文不存在：{path}")
    lines = read_lines(path)
    full_text = "\n".join(lines)

    out_clauses: list[dict] = []
    for spec in policy["clauses"]:
        idx, line = locate(lines, {**spec, "id": policy["id"]})
        part, locator = context(lines, idx)

        # —— 出处双重校验：部分名 & 小节/章标题必须与 config 声明一致 ——
        if part != norm(spec["part"]):
            raise AssertionError(
                f"{policy['id']} {spec['no']}: 实际所在部分为「{part}」，与声明的「{spec['part']}」不符"
            )
        if not locator.startswith(norm(spec["section"])):
            raise AssertionError(
                f"{policy['id']} {spec['no']}: 实际最近标题为「{locator}」，与声明的「{spec['section']}」不符"
            )

        # —— 条文号必须出现在原文行首（防止编造条文号）——
        # 分项条文（如 2.1 的第（5）项）原文行首是「（5）」，其 no 记为「父条文号+分项号」，
        # 故用 prefix 校验行首，尚未拼造的父号由 loc 与部分/章节断言保证对应关系。
        head = norm(spec.get("prefix", spec["no"]))
        if not line.startswith(head):
            raise AssertionError(
                f"{policy['id']} {spec['no']}: 原文「{line[:40]}…」并非以「{head}」开头"
            )

        # —— 标题必须能在原文中找到（防止编造标题）——
        if spec["title"] not in full_text:
            raise AssertionError(f"{policy['id']} {spec['no']}: 标题「{spec['title']}」在原文中不存在")

        for rule in spec["rules"]:
            if rule not in RULES:
                raise ValueError(f"{policy['id']} {spec['no']}: 审核项「{rule}」不在固定枚举内")

        out_clauses.append(
            {
                "no": spec["no"],
                "title": spec["title"],
                "text": clause_text(line),
                "loc": spec["loc"],
            }
        )

    if not 6 <= len(out_clauses) <= 10:
        raise AssertionError(f"{policy['id']}: 精选条文数量 {len(out_clauses)} 不在 6–10 条区间")

    rules: list[str] = []
    for spec in policy["clauses"]:
        for rule in spec["rules"]:
            if rule not in rules:
                rules.append(rule)

    return {
        "id": policy["id"],
        "file": policy["file"],
        "name": policy["name"],
        "dept": policy["dept"],
        "clauses": out_clauses,
        "rules": rules,
        "note": policy["note"],
    }


# =============================================================================
# 精选条文配置：每条均由人工通读原文后指定「条文号 + 锚点 + 出处 + 标题 + 审核项」
# =============================================================================

P1 = "第一部分 数据治理组织体系"
P2 = "第二部分 数据分类分级管理"
P3 = "第三部分 数据采集与录入规范"
P5 = "第五部分 数据存储与生命周期管理"
P7 = "第七部分 数据质量管理"
P9 = "第九部分 数据安全与隐私保护"
P10 = "第十部分 数据目录与数据平台建设"

POLICIES: list[dict] = [
    {
        "id": "sys44",
        "file": "44-数据管理制度.txt",
        "name": "数据管理制度",
        "dept": "信息管理部",
        "note": "本制度只规定分级、质量校验与留痕要求，未给出任何具体税率数值与开票范围清单，税率比对须以税率字典（dict.taxRates）为准。",
        "clauses": [
            {
                "no": "1.2",
                "anchor": "分级结果作为访问控制",
                "title": "数据分类框架",
                "part": P2,
                "section": "1 数据分类框架",
                "loc": f"{P2} · 1 数据分类框架",
                "rules": ["access", "trace"],
            },
            {
                "no": "1.3",
                "anchor": "同一事实数据原则上由唯一权威源系统产生",
                "title": "一数一源",
                "part": P3,
                "section": "1 采集基本原则",
                "loc": f"{P3} · 1 采集基本原则",
                "rules": ["check_title"],
            },
            {
                "no": "3.3",
                "anchor": "金额、编码、日期等采用系统自动带出",
                "title": "录入校验",
                "part": P3,
                "section": "3 录入规范",
                "loc": f"{P3} · 3 录入规范",
                "rules": ["check_title", "check_amount", "check_date"],
            },
            {
                "no": "3.5",
                "anchor": "原记录不可物理删除",
                "title": "修改与冲正",
                "part": P3,
                "section": "3 录入规范",
                "loc": f"{P3} · 3 录入规范",
                "rules": ["log", "trace"],
            },
            {
                "no": "2.1（5）",
                "prefix": "（5）",
                "anchor": "安全审计日志不少于6个月",
                "title": "日志类数据",
                "part": P5,
                "section": "2 数据留存期",
                "loc": f"{P5} · 2 数据留存期",
                "rules": ["log"],
            },
            {
                "no": "2.1",
                "anchor": "阻断非法提交",
                "title": "源头校验",
                "part": P7,
                "section": "2 质量校验机制",
                "loc": f"{P7} · 2 质量校验机制",
                "rules": ["check_title", "check_amount"],
            },
            {
                "no": "2.4",
                "anchor": "对业务合理性采用规则+人工复核",
                "title": "自动与人工结合",
                "part": P7,
                "section": "2 质量校验机制",
                "loc": f"{P7} · 2 质量校验机制",
                "rules": ["check_amount", "check_date"],
            },
            {
                "no": "3.1",
                "anchor": "最小权限+角色授权（RBAC）",
                "title": "访问控制",
                "part": P9,
                "section": "3 访问控制",
                "loc": f"{P9} · 3 访问控制",
                "rules": ["access"],
            },
            {
                "no": "6.1",
                "anchor": "用户行为分析（UEBA）",
                "title": "安全监测与应急响应",
                "part": P9,
                "section": "6 安全监测与应急响应",
                "loc": f"{P9} · 6 安全监测与应急响应",
                "rules": ["access", "log"],
            },
            {
                "no": "3.2",
                "anchor": "关键数据须可追溯至源系统",
                "title": "元数据与血缘管理",
                "part": P10,
                "section": "3 元数据与血缘管理",
                "loc": f"{P10} · 3 元数据与血缘管理",
                "rules": ["trace"],
            },
        ],
    },
    {
        "id": "sys42",
        "file": "42-信息化建设管理制度.txt",
        "name": "信息化建设管理制度",
        "dept": "信息管理部",
        "note": "本制度面向系统建设与运维，未规定发票票面要素、税率取值与开票范围，只能为系统取数、接口留痕与变更审批提供流程性依据。",
        "clauses": [
            {
                "no": "第三条",
                "anchor": "配置管理数据库（CMDB）",
                "title": "配置管理数据库",
                "part": "第六部分  信息系统运维管理",
                "section": "第一章 运维组织与模式",
                "loc": "第六部分 信息系统运维管理 · 第一章 运维组织与模式",
                "rules": ["trace"],
            },
            {
                "no": "第四条",
                "anchor": "重大事件即时上报",
                "title": "事件管理",
                "part": "第六部分  信息系统运维管理",
                "section": "第二章 事件、问题、变更与配置管理",
                "loc": "第六部分 信息系统运维管理 · 第二章 事件、问题、变更与配置管理",
                "rules": ["log"],
            },
            {
                "no": "第六条",
                "anchor": "《信息系统变更申请单》（附表6）",
                "title": "变更管理",
                "part": "第六部分  信息系统运维管理",
                "section": "第二章 事件、问题、变更与配置管理",
                "loc": "第六部分 信息系统运维管理 · 第二章 事件、问题、变更与配置管理",
                "rules": ["log", "trace"],
            },
            {
                "no": "3.1",
                "anchor": "核心数据异地备份、加密存储、最小授权访问",
                "title": "数据安全与个人信息保护",
                "part": "第七部分  网络安全与等级保护管理",
                "section": "3 数据安全与个人信息保护",
                "loc": "第七部分 网络安全与等级保护管理 · 3 数据安全与个人信息保护",
                "rules": ["access"],
            },
            {
                "no": "1.3",
                "anchor": "《系统数据接口登记表》（附表8）",
                "title": "集成总体要求",
                "part": "第八部分  系统集成与数据贯通管理",
                "section": "1 集成总体要求",
                "loc": "第八部分 系统集成与数据贯通管理 · 1 集成总体要求",
                "rules": ["trace"],
            },
            {
                "no": "2.2",
                "anchor": "一处录入、全局共享、权威认定",
                "title": "主数据与主数据管理",
                "part": "第八部分  系统集成与数据贯通管理",
                "section": "2 主数据与主数据管理",
                "loc": "第八部分 系统集成与数据贯通管理 · 2 主数据与主数据管理",
                "rules": ["check_title"],
            },
            {
                "no": "3.2",
                "anchor": "禁止线下台账替代系统核算",
                "title": "与ERP、财务及生产系统的衔接",
                "part": "第八部分  系统集成与数据贯通管理",
                "section": "3 与ERP、财务及生产系统的衔接",
                "loc": "第八部分 系统集成与数据贯通管理 · 3 与ERP、财务及生产系统的衔接",
                "rules": ["check_amount"],
            },
            {
                "no": "3.3",
                "anchor": "数据贯通须保证同源、同义、同步",
                "title": "与ERP、财务及生产系统的衔接",
                "part": "第八部分  系统集成与数据贯通管理",
                "section": "3 与ERP、财务及生产系统的衔接",
                "loc": "第八部分 系统集成与数据贯通管理 · 3 与ERP、财务及生产系统的衔接",
                "rules": ["check_title", "check_amount"],
            },
        ],
    },
    {
        "id": "sys43",
        "file": "43-信息安全管理规定.txt",
        "name": "信息安全管理规定",
        "dept": "信息管理部",
        "note": "本规定只管账号、密钥与操作留痕，未规定业务审核口径（税率、开票范围），其作用是证明审核操作与证据不可抵赖。",
        "clauses": [
            {
                "no": "1.3",
                "anchor": "账号行为与责任人一一对应、可追溯",
                "title": "账号实名制",
                "part": "第五部分 访问控制与身份认证",
                "section": "1 账号实名制",
                "loc": "第五部分 访问控制与身份认证 · 1 账号实名制",
                "rules": ["access", "trace"],
            },
            {
                "no": "2.1",
                "anchor": "默认无权限",
                "title": "最小权限与 RBAC",
                "part": "第五部分 访问控制与身份认证",
                "section": "2 最小权限与 RBAC",
                "loc": "第五部分 访问控制与身份认证 · 2 最小权限与 RBAC",
                "rules": ["access"],
            },
            {
                "no": "2.1",
                "anchor": "对核心、重要数据实施加密存储与传输",
                "title": "数据分类分级保护",
                "part": "第八部分 应用与数据安全",
                "section": "2 数据分类分级保护",
                "loc": "第八部分 应用与数据安全 · 2 数据分类分级保护",
                "rules": ["access", "log"],
            },
            {
                "no": "2.3",
                "anchor": "重要（客户清单、合同金额）",
                "title": "数据分类分级保护",
                "part": "第八部分 应用与数据安全",
                "section": "2 数据分类分级保护",
                "loc": "第八部分 应用与数据安全 · 2 数据分类分级保护",
                "rules": ["check_amount"],
            },
            {
                "no": "3.3",
                "anchor": "建立数据流转台账",
                "title": "数据全生命周期安全",
                "part": "第八部分 应用与数据安全",
                "section": "3 数据全生命周期安全",
                "loc": "第八部分 应用与数据安全 · 3 数据全生命周期安全",
                "rules": ["trace", "log"],
            },
            {
                "no": "2.2",
                "anchor": "密钥按期轮换",
                "title": "密钥全生命周期",
                "part": "第九部分 密码与密钥管理",
                "section": "2 密钥全生命周期",
                "loc": "第九部分 密码与密钥管理 · 2 密钥全生命周期",
                "rules": ["access"],
            },
            {
                "no": "1.2",
                "anchor": "操作记录留存不少于 6 个月",
                "title": "运维账号与操作审计",
                "part": "第十部分 安全运维与变更管理",
                "section": "1 运维账号与操作审计",
                "loc": "第十部分 安全运维与变更管理 · 1 运维账号与操作审计",
                "rules": ["log", "trace"],
            },
            {
                "no": "2.1",
                "anchor": "《变更审批单》（HC-IS-004）",
                "title": "变更管理流程",
                "part": "第十部分 安全运维与变更管理",
                "section": "2 变更管理流程",
                "loc": "第十部分 安全运维与变更管理 · 2 变更管理流程",
                "rules": ["log", "trace"],
            },
        ],
    },
    {
        "id": "sys39",
        "file": "39-内部审计制度.txt",
        "name": "内部审计制度",
        "dept": "审计监察部",
        "note": "本制度只把税务合规列为审计关注点，未规定增值税税率具体数值与税额计算口径，税率正确性判定依赖税率字典。",
        "clauses": [
            {
                "no": "2.1",
                "anchor": "资料调阅权",
                "title": "审计权限",
                "part": "第二部分 审计职责与权限",
                "section": "2 审计权限",
                "loc": "第二部分 审计职责与权限 · 2 审计权限",
                "rules": ["trace", "access"],
            },
            {
                "no": "3.2",
                "anchor": "《审计资料真实性承诺书》",
                "title": "被审计单位及人员的义务",
                "part": "第二部分 审计职责与权限",
                "section": "3 被审计单位及人员的义务",
                "loc": "第二部分 审计职责与权限 · 3 被审计单位及人员的义务",
                "rules": ["log", "trace"],
            },
            {
                "no": "2.6",
                "anchor": "出口退税申报真实性",
                "title": "审计内容",
                "part": "第四部分 审计类型",
                "section": "2 审计内容。",
                "loc": "第四部分 审计类型 第一章 财务收支审计 · 2 审计内容",
                "rules": ["check_tax_rate"],
            },
            {
                "no": "2.7",
                "anchor": "关联交易定价公允性",
                "title": "审计内容",
                "part": "第四部分 审计类型",
                "section": "2 审计内容。",
                "loc": "第四部分 审计类型 第一章 财务收支审计 · 2 审计内容",
                "rules": ["check_amount"],
            },
            {
                "no": "3.1",
                "anchor": "凭证与账簿抽查",
                "title": "实质性审计程序",
                "part": "第五部分 审计程序",
                "section": "3 实质性审计程序。",
                "loc": "第五部分 审计程序 第二章 审计实施 · 3 实质性审计程序",
                "rules": ["check_title", "check_amount"],
            },
            {
                "no": "4",
                "anchor": "重要证据应经提供方确认",
                "title": "审计证据",
                "part": "第五部分 审计程序",
                "section": "4 审计证据。",
                "loc": "第五部分 审计程序 第二章 审计实施 · 4 审计证据",
                "rules": ["trace", "log"],
            },
            {
                "no": "5",
                "anchor": "底稿应要素齐全",
                "title": "审计工作底稿",
                "part": "第五部分 审计程序",
                "section": "5 审计工作底稿。",
                "loc": "第五部分 审计程序 第二章 审计实施 · 5 审计工作底稿",
                "rules": ["trace", "log"],
            },
            {
                "no": "4.3",
                "anchor": "保管期限不少于30年",
                "title": "审计报告报送与归档",
                "part": "第六部分 审计报告与结论",
                "section": "4 审计报告报送与归档",
                "loc": "第六部分 审计报告与结论 · 4 审计报告报送与归档",
                "rules": ["trace"],
            },
        ],
    },
    {
        "id": "sys35",
        "file": "35-合规管理制度.txt",
        "name": "合规管理制度",
        "dept": "法务合规部",
        "note": "本制度未规定具体税率与税额计算规则，只提供合规审查、预警分级与上报路径，不含任何量化税率阈值。",
        "clauses": [
            {
                "no": "5.2",
                "anchor": "将关键管控措施嵌入信息系统",
                "title": "合规风险管控措施",
                "part": "第三部分 合规义务清单与合规风险库",
                "section": "5 合规风险管控措施",
                "loc": "第三部分 合规义务清单与合规风险库 · 5 合规风险管控措施",
                "rules": ["check_title", "check_amount"],
            },
            {
                "no": "3.2",
                "anchor": "付款路径与币种是否触发反洗钱",
                "title": "重要合同合规审查",
                "part": "第四部分 制度、决策与合同合规审查",
                "section": "3 重要合同合规审查",
                "loc": "第四部分 制度、决策与合同合规审查 · 3 重要合同合规审查",
                "rules": ["check_scope", "check_title"],
            },
            {
                "no": "3.3",
                "anchor": "受限方筛查并留存记录",
                "title": "重要合同合规审查",
                "part": "第四部分 制度、决策与合同合规审查",
                "section": "3 重要合同合规审查",
                "loc": "第四部分 制度、决策与合同合规审查 · 3 重要合同合规审查",
                "rules": ["log", "trace"],
            },
            {
                "no": "3.2（2）",
                "prefix": "（2）",
                "anchor": "第三方代付等可疑交易线索",
                "title": "风险预警机制",
                "part": "第五部分 合规风险识别、评估与预警",
                "section": "3 风险预警机制",
                "loc": "第五部分 合规风险识别、评估与预警 · 3 风险预警机制",
                "rules": ["check_amount"],
            },
            {
                "no": "4.1（1）",
                "prefix": "（1）",
                "anchor": "24小时内启动应急",
                "title": "预警分级与处置",
                "part": "第五部分 合规风险识别、评估与预警",
                "section": "4 预警分级与处置",
                "loc": "第五部分 合规风险识别、评估与预警 · 4 预警分级与处置",
                "rules": ["log"],
            },
            {
                "no": "4.2",
                "anchor": "预警处置实行闭环",
                "title": "预警分级与处置",
                "part": "第五部分 合规风险识别、评估与预警",
                "section": "4 预警分级与处置",
                "loc": "第五部分 合规风险识别、评估与预警 · 4 预警分级与处置",
                "rules": ["log", "trace"],
            },
            {
                "no": "1.1",
                "anchor": "了解受益所有人和交易目的",
                "title": "客户身份识别（KYC）",
                "part": "第九部分 专项合规管理",
                "section": "1 客户身份识别（KYC）",
                "loc": "第九部分 专项合规管理 第二章 反洗钱合规 · 1 客户身份识别（KYC）",
                "rules": ["check_title"],
            },
            {
                "no": "3.2",
                "anchor": "交易记录保存至少十年",
                "title": "制裁名单监控与记录保存",
                "part": "第九部分 专项合规管理",
                "section": "3 制裁名单监控与记录保存",
                "loc": "第九部分 专项合规管理 第二章 反洗钱合规 · 3 制裁名单监控与记录保存",
                "rules": ["trace"],
            },
        ],
    },
]

EXPECTED_IDS = ["sys44", "sys42", "sys43", "sys39", "sys35"]


def generate() -> list[dict]:
    policies = [build_policy(p) for p in POLICIES]
    if [p["id"] for p in policies] != EXPECTED_IDS:
        raise AssertionError(f"制度顺序/编号异常：{[p['id'] for p in policies]}")
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(policies, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return policies


def check_file() -> list[dict]:
    """读回落盘 JSON，做结构与内容自检（可独立运行）。"""
    data = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, list) and len(data) == 5, "顶层必须是 5 条制度记录"
    assert [p["id"] for p in data] == EXPECTED_IDS, "制度 id 与契约不一致"

    for p in data:
        for key in ("id", "file", "name", "dept", "clauses", "rules", "note"):
            assert key in p, f"{p.get('id')}: 缺字段 {key}"
        assert (SOURCE_DIR / p["file"]).is_file(), f"{p['id']}: file 指向的原文不存在"
        assert 6 <= len(p["clauses"]) <= 10, f"{p['id']}: clauses 数量越界"
        assert p["rules"] and set(p["rules"]) <= RULES, f"{p['id']}: rules 越界"
        seen = set()
        # 原文做同样的空白规整后再比对，确保摘录是原文（只允许空白差异，不允许改字）
        src = norm((SOURCE_DIR / p["file"]).read_text(encoding="utf-8"))
        for c in p["clauses"]:
            assert set(c) == {"no", "title", "text", "loc"}, f"{p['id']}: clause 字段不符契约"
            assert c["no"] and c["title"] and c["loc"], f"{p['id']}: clause 存在空字段"
            # 同一制度不同部分/章可能重复使用同一编号，故以「编号+出处」判重
            key = (c["no"], c["loc"])
            assert key not in seen, f"{p['id']}: 条文号与出处重复 {c['no']}"
            seen.add(key)
            assert len(c["text"]) <= MAX_TEXT, f"{p['id']} {c['no']}: text 超过 200 字"
            assert "…" not in c["text"] or c["text"].endswith("…"), f"{p['id']} {c['no']}: 截断标记位置错误"
            # 摘录必须能在原文中逐字找到（截断的只比对去掉结尾省略号后的正文）
            body = c["text"][:-1].strip() if c["text"].endswith("…") else c["text"]
            assert body in src, f"{p['id']} {c['no']}: 摘录无法在原文中逐字定位"
    return data


def report(data: list[dict]) -> None:
    print(f"[OK] {OUT_PATH.relative_to(ROOT)}  {OUT_PATH.stat().st_size} bytes, {len(data)} 条制度")
    for p in data:
        print(f"\n{p['id']}  {p['name']}（{p['dept']}）  条文 {len(p['clauses'])} 条")
        print(f"  rules: {', '.join(p['rules'])}")
        for c in p["clauses"]:
            print(f"  - {c['no']:<8} {c['title']:<14} {c['loc']}")
            print(f"    {c['text']}")


def main(argv: list[str] | None = None) -> int:
    # Windows 控制台默认非 UTF-8，中文输出会乱码，这里统一为 UTF-8（仅影响打印，不影响落盘）
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass

    ap = argparse.ArgumentParser(description="制度原文 -> data/policies.json")
    ap.add_argument("--check", action="store_true", help="只校验已有 data/policies.json，不重新生成")
    args = ap.parse_args(argv)

    try:
        data = check_file() if args.check else generate()
        if not args.check:
            check_file()
        report(data)
    except (LookupError, AssertionError, ValueError, FileNotFoundError) as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
