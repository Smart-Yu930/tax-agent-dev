import { useMemo, useState } from "react";
import type { Bootstrap, BoardRow } from "../types";
import type { ViewKey } from "../nav";
import { Card, Empty, StatusPill } from "../components/ui";
import { Icon } from "../components/Icons";
import { money, shortMoney } from "../format";

const TABS = [
  { key: "pending", label: "待开票" },
  { key: "suspended", label: "未验收暂缓" },
  { key: "issued", label: "已开具" },
  { key: "draft", label: "待确认草稿" },
] as const;

export function Dashboard({
  boot,
  onAudit,
  go,
}: {
  boot: Bootstrap;
  onAudit: (index: number) => void;
  go: (view: ViewKey) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending");
  const counts = useMemo(() => {
    const c = { pending: 0, suspended: 0, issued: 0, draft: 0 };
    for (const row of boot.board) c[row.status] += 1;
    return c;
  }, [boot.board]);

  const rows = boot.board.filter((row) => row.status === tab).slice(0, 7);
  const issued = counts.issued;
  const completion = boot.board.length ? issued / boot.board.length : 0;
  const pendingRows = boot.board.filter((r) => r.status === "pending");
  const pendingAmount = pendingRows.reduce((sum, r) => sum + r.gross, 0);

  const kpis = [
    { label: "待开票", value: String(counts.pending), unit: "项", note: "清单内待处理销售", icon: "pending", tone: "amber" },
    { label: "合同样本", value: String(boot.stats.contracts), unit: "份", note: "销售与采购合同", icon: "docs", tone: "plum" },
    { label: "发票样本", value: String(boot.stats.invoices), unit: "张", note: "专票 / 普票 / 出口", icon: "sample", tone: "teal" },
    { label: "已开具", value: String(issued), unit: "张", note: "本会话开具与回写", icon: "check", tone: "green" },
    { label: "完成率", value: (completion * 100).toFixed(1), unit: "%", note: "已开具 / 全部待开票", icon: "quality", tone: "ink" },
  ];

  return (
    <div className="view dashboard">
      <div className="page-head">
        <div>
          <p className="eyebrow">P1-01 发票开具 · {boot.meta.period}</p>
          <h1>工作台</h1>
          <p className="lede">
            {boot.meta.case} · {boot.meta.company}，本地规则引擎已完成本期 {boot.stats.documents} 份单据的结构化。
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => go("pending")}><Icon name="pending" /> 查看待开票清单</button>
          <button className="btn primary" onClick={() => go("audit")}><Icon name="audit" /> 发起开票审核</button>
        </div>
      </div>

      <div className="kpi-grid">
        {kpis.map((kpi) => (
          <div className={"kpi " + kpi.tone} key={kpi.label}>
            <div className="kpi-top">
              <span>{kpi.label}</span>
              <span className="kpi-icon"><Icon name={kpi.icon} size={17} /></span>
            </div>
            <div className="kpi-value">{kpi.value}<em>{kpi.unit}</em></div>
            <p>{kpi.note}</p>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <Card
          className="board-card"
          title="任务看板"
          subtitle="按开票状态跟踪本期销售，逐单进入智能审核"
          extra={<button className="link" onClick={() => go("pending")}>全部 {boot.board.length} 项 <Icon name="arrow" size={14} /></button>}
        >
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
                {t.label}<span>{counts[t.key]}</span>
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <Empty title="这个状态下暂无任务" detail="切换到其他页签查看。" />
          ) : (
            <table className="table compact">
              <thead>
                <tr><th>产品 / 客户</th><th>日期</th><th className="num">价税合计</th><th>状态</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <BoardLine key={row.index} row={row} onAudit={onAudit} />
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="side-stack">
          <Card title="本期开票盘" subtitle="待开票金额按 13% 含税口径估算">
            <div className="big-number">¥ {shortMoney(pendingAmount)}</div>
            <div className="progress"><i style={{ width: Math.max(2, completion * 100) + "%" }} /></div>
            <div className="progress-meta"><span>已开具 {issued} / {boot.board.length}</span><span>{(completion * 100).toFixed(1)}%</span></div>
            <ul className="stat-list">
              <li><span>销售清单合计</span><strong>¥ {shortMoney(boot.stats.salesTotal)}</strong></li>
              <li><span>未验收暂缓</span><strong>{counts.suspended} 项</strong></li>
              <li><span>验收指标</span><strong className="ok-text">{boot.acceptance.allPass ? "全部达标" : "存在偏差"}</strong></li>
              <li><span>制度条款</span><strong>{boot.stats.policies} 项 / {boot.policies.reduce((n, p) => n + p.clauses.length, 0)} 条</strong></li>
            </ul>
          </Card>
          <Card title="审核规则" subtitle="规则引擎在本地逐项执行，结论可追溯">
            <div className="rule-mini">
              {boot.checks.map((c, i) => (
                <div key={c.key}><span>{String(i + 1).padStart(2, "0")}</span><div><strong>{c.name}</strong><p>{c.desc}</p></div></div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="module-grid">
        {[
          { key: "audit" as ViewKey, title: "开票审核", desc: "六项规则校验申请单与证据链，输出可追溯结论。", icon: "audit", tag: "核心" },
          { key: "desk" as ViewKey, title: "开票台", desc: "复核草稿并开具发票，编号自动递增、留痕。", icon: "desk", tag: "人工" },
          { key: "documents" as ViewKey, title: "单据库", desc: "175 份合同、验收、出库与发票，按标签检索。", icon: "docs", tag: "证据" },
          { key: "samples" as ViewKey, title: "发票样本", desc: "按历史版式渲染专票、普票与出口发票。", icon: "sample", tag: "版式" },
          { key: "policies" as ViewKey, title: "制度依据", desc: "5 项制度 42 条条款，支撑每一条审核规则。", icon: "policy", tag: "依据" },
          { key: "quality" as ViewKey, title: "数据质量", desc: "对账、字段覆盖与验收指标一屏体检。", icon: "quality", tag: "体检" },
        ].map((m) => (
          <button key={m.key} className="module-card" onClick={() => go(m.key)}>
            <span className="module-icon"><Icon name={m.icon} size={20} /></span>
            <span className="module-tag">{m.tag}</span>
            <strong>{m.title}</strong>
            <p>{m.desc}</p>
            <span className="module-link">进入 <Icon name="arrow" size={13} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardLine({ row, onAudit }: { row: BoardRow; onAudit: (index: number) => void }) {
  return (
    <tr>
      <td>
        <strong className="cell-title">{row.product}</strong>
        <span className="cell-sub">{row.customer} · {row.region}</span>
      </td>
      <td className="muted">{row.date}</td>
      <td className="num">{money(row.gross)}</td>
      <td><StatusPill status={row.status} label={row.statusLabel} /></td>
      <td className="right">
        <button className="link" onClick={() => onAudit(row.index)}>审核 <Icon name="chevron" size={12} /></button>
      </td>
    </tr>
  );
}
