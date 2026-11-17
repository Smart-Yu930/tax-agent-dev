import type { Bootstrap } from "../types";
import { Card } from "../components/ui";
import { Icon } from "../components/Icons";

const NODES = [
  { title: "待开票清单", desc: "销售台账锁定本期 22 项待开票业务", tag: "输入" },
  { title: "申请单组装", desc: "按证据索引匹配合同、验收单与出库单", tag: "自动" },
  { title: "单据分类", desc: "按字段标签识别 9 类单据，不看文件名", tag: "规则" },
  { title: "字段提取", desc: "7 个关键字段带 loc 位置回溯", tag: "规则" },
  { title: "六项校验", desc: "抬头、税率、金额、范围、日期、重复", tag: "核心" },
  { title: "结论分级", desc: "通过 / 不通过 / 暂缓，附风险等级", tag: "决策" },
  { title: "草稿与复核", desc: "通过即生成待确认开票草稿", tag: "人工" },
  { title: "开具与留痕", desc: "发票编号递增，操作日志与证据归档", tag: "归档" },
];

const EXCEPTIONS = [
  { title: "证据不齐 · 暂缓", desc: "缺验收单时挂起申请，登记为待开票事项，不直接拒绝。", tone: "hold" },
  { title: "抬头 / 税率不符 · 不通过", desc: "购买方与合同不一致或税率偏离业务性质，退回补正。", tone: "bad" },
  { title: "重复开票 · 红冲", desc: "同购买方、同金额命中已开具发票，提示红冲后再开。", tone: "warn" },
];

const ROLES = [
  { role: "开票岗", duty: "发起申请、补齐证据、确认草稿" },
  { role: "财务复核", duty: "复核金额、税率与购买方信息" },
  { role: "系统智能体", duty: "分类、提取、六项规则校验与留痕" },
  { role: "审计合规", duty: "抽查证据链、制度依据与操作日志" },
];

export function Flow({ boot }: { boot: Bootstrap }) {
  return (
    <div className="view flow-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">业务流程 · 规则引擎</p>
          <h1>从待开票清单到发票归档</h1>
          <p className="lede">八个节点串起申请、校验、复核与归档；异常分支不阻断主流程，而是给出可执行的处理建议。</p>
        </div>
        <div className="flow-badge"><Icon name="flow" size={18} /> 规则模式 · 本地执行</div>
      </div>

      <Card title="主流程" subtitle="每一步都留下可追溯的单据与字段位置">
        <div className="flow-track">
          {NODES.map((node, i) => (
            <div className="flow-node" key={node.title}>
              <div className="flow-index">{String(i + 1).padStart(2, "0")}</div>
              <span className="flow-tag">{node.tag}</span>
              <strong>{node.title}</strong>
              <p>{node.desc}</p>
              {i < NODES.length - 1 && <span className="flow-arrow"><Icon name="arrow" size={15} /></span>}
            </div>
          ))}
        </div>
      </Card>

      <div className="two-col">
        <Card title="异常分支" subtitle="三类典型例外与处置方式">
          <div className="exception-list">
            {EXCEPTIONS.map((ex) => (
              <div className={"exception " + ex.tone} key={ex.title}>
                <span className="exception-mark"><Icon name={ex.tone === "hold" ? "hold" : ex.tone === "bad" ? "close" : "alert"} size={16} /></span>
                <div><strong>{ex.title}</strong><p>{ex.desc}</p></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="角色分工" subtitle="人机协同，责任边界清晰">
          <div className="role-list">
            {ROLES.map((r) => (
              <div key={r.role}><span className="avatar small">{r.role.slice(0, 1)}</span><div><strong>{r.role}</strong><p>{r.duty}</p></div></div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="六项校验规则" subtitle={"规则参数来自字典与制度库 · 共 " + boot.checks.length + " 项"}>
        <div className="check-def-grid">
          {boot.checks.map((c, i) => (
            <div className="check-def" key={c.key}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <strong>{c.name}</strong>
              <p>{c.desc}</p>
              <code>{c.rule}</code>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
