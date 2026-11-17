import { useMemo, useState } from "react";
import type { Bootstrap } from "../types";
import { Card } from "../components/ui";
import { Icon } from "../components/Icons";

export function Policies({ boot }: { boot: Bootstrap }) {
  const [tab, setTab] = useState<"library" | "metrics">("library");
  const [selectedId, setSelectedId] = useState(boot.policies[0]?.id ?? "");
  const selected = useMemo(
    () => boot.policies.find((p) => p.id === selectedId) ?? boot.policies[0],
    [boot.policies, selectedId],
  );

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">制度依据 · 审计可追溯</p>
          <h1>制度与验收指标</h1>
          <p className="lede">六项校验的每条结论都能回指制度条款；验收指标由离线工具生成，数据与规则同源。</p>
        </div>
        <div className="segmented large">
          <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>制度库</button>
          <button className={tab === "metrics" ? "active" : ""} onClick={() => setTab("metrics")}>验收指标</button>
        </div>
      </div>

      {tab === "library" ? (
        <div className="policy-layout">
          <Card className="policy-list" title="制度清单" subtitle={boot.policies.length + " 项制度 · " + boot.policies.reduce((n, p) => n + p.clauses.length, 0) + " 条条款"}>
            {boot.policies.map((p) => (
              <button key={p.id} className={"policy-row" + (selected?.id === p.id ? " active" : "")} onClick={() => setSelectedId(p.id)}>
                <span className="policy-mark"><Icon name="policy" size={18} /></span>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.dept} · {p.clauses.length} 条</small>
                  <span className="rule-tags">{p.rules.slice(0, 3).map((r) => <i key={r}>{r}</i>)}</span>
                </span>
              </button>
            ))}
          </Card>

          {selected && (
            <Card
              className="policy-detail"
              title={selected.name}
              subtitle={selected.dept + " · " + selected.file}
              extra={<span className="mono muted">{selected.id}</span>}
            >
              {selected.note && <div className="notice info">{selected.note}</div>}
              <div className="rule-tags large">{selected.rules.map((r) => <i key={r}>{r}</i>)}</div>
              <div className="clause-list">
                {selected.clauses.map((c) => (
                  <article className="clause" key={c.no}>
                    <header><span className="mono">{c.no}</span><h3>{c.title}</h3></header>
                    <p>{c.text}</p>
                    <footer><Icon name="doc" size={13} /> {c.loc}</footer>
                  </article>
                ))}
              </div>
            </Card>
          )}
        </div>
      ) : (
        <div className="metrics-layout">
          <Card
            title="验收指标"
            subtitle={"生成于 " + boot.acceptance.generatedAt + " · 全部达标：" + (boot.acceptance.allPass ? "是" : "否")}
            extra={<span className={"pill " + (boot.acceptance.allPass ? "ok" : "bad")}><i className="dot" />{boot.acceptance.allPass ? "全部通过" : "存在偏差"}</span>}
          >
            <table className="table metrics-table">
              <thead><tr><th>指标</th><th>实测值</th><th>目标</th><th>结论</th></tr></thead>
              <tbody>
                {boot.acceptance.metrics.map((m) => (
                  <tr key={m.name}>
                    <td>{m.name}</td>
                    <td className="strong">{m.value}</td>
                    <td className="muted">{m.target}</td>
                    <td><span className={"pill " + (m.pass ? "ok" : "bad")}><i className="dot" />{m.pass ? "达标" : "未达标"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="验收口径" subtitle="离线验收脚本的可复核数据">
            <div className="metric-facts">
              <div><span>单据分类</span><strong>{boot.acceptance.details.classification.ok} / {boot.acceptance.details.classification.total}</strong></div>
              <div><span>字段提取</span><strong>{boot.acceptance.details.fieldExtraction.ok} / {boot.acceptance.details.fieldExtraction.total}</strong></div>
              <div><span>来源追溯</span><strong>{boot.acceptance.details.traceability.locFields} / {boot.acceptance.details.traceability.allFields}</strong></div>
              <div><span>实跑申请</span><strong>{boot.acceptance.details.applications.length} 条</strong></div>
            </div>
            <p className="foot-note">验收报告由 tools/acceptance.mjs 生成，桌面版 Rust 核心以同一批数据复核六项规则；报告中的逐条实跑结果保存在 data/_acceptance_report.json。</p>
          </Card>
        </div>
      )}
    </div>
  );
}
