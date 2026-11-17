import type { Bootstrap } from "../types";
import { Card } from "../components/ui";
import { Icon } from "../components/Icons";

const LEVEL_LABEL: Record<string, string> = { high: "高", mid: "中", low: "低", info: "提示" };

export function Quality({ boot }: { boot: Bootstrap }) {
  const dq = boot.dataQuality;
  const passed = boot.acceptance.metrics.filter((m) => m.pass).length;

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">数据质量 · 上线前体检</p>
          <h1>数据质量与验收</h1>
          <p className="lede">对账异常、字段缺失与口径冲突在这里集中呈现；不影响规则引擎运行，但会影响结论的解释力。</p>
        </div>
        <span className={"pill " + (boot.acceptance.allPass ? "ok" : "bad")}><i className="dot" />{passed} / {boot.acceptance.metrics.length} 项验收达标</span>
      </div>

      <div className="quality-grid">
        <div className="quality-hero">
          <div className="quality-score">
            <span>{Math.round((passed / Math.max(1, boot.acceptance.metrics.length)) * 100)}</span>
            <small>验收得分</small>
          </div>
          <div className="quality-hero-body">
            <strong>{boot.acceptance.allPass ? "本期数据可用于开票审核" : "存在未达标指标，请先复核"}</strong>
            <p>共 {dq.docCount} 份单据、{dq.ledgerCount} 条台账记录；对账异常 {dq.reconcile.exceptions} 条，解析告警 {dq.reconcile.parseWarnings} 条。</p>
            <div className="quality-bars">
              <div><span>字段提取</span><i><b style={{ width: (boot.acceptance.details.fieldExtraction.ok / Math.max(1, boot.acceptance.details.fieldExtraction.total)) * 100 + "%" }} /></i><em>{boot.acceptance.details.fieldExtraction.ok}/{boot.acceptance.details.fieldExtraction.total}</em></div>
              <div><span>来源追溯</span><i><b style={{ width: (boot.acceptance.details.traceability.locFields / Math.max(1, boot.acceptance.details.traceability.allFields)) * 100 + "%" }} /></i><em>{boot.acceptance.details.traceability.locFields}/{boot.acceptance.details.traceability.allFields}</em></div>
              <div><span>单据分类</span><i><b style={{ width: (boot.acceptance.details.classification.ok / Math.max(1, boot.acceptance.details.classification.total)) * 100 + "%" }} /></i><em>{boot.acceptance.details.classification.ok}/{boot.acceptance.details.classification.total}</em></div>
            </div>
          </div>
        </div>

        <Card title="验收指标" subtitle="逐项对照目标值" className="quality-metrics">
          {boot.acceptance.metrics.map((m) => (
            <div className="metric-line" key={m.name}>
              <span className={"metric-status " + (m.pass ? "ok" : "bad")}><Icon name={m.pass ? "check" : "close"} size={13} /></span>
              <div><strong>{m.name}</strong><small>目标 {m.target}</small></div>
              <b>{m.value}</b>
            </div>
          ))}
        </Card>
      </div>

      <Card title="数据体检发现" subtitle={"共 " + dq.findings.length + " 项，按影响面排序"} className="findings-card">
        {dq.findings.length === 0 ? (
          <p className="foot-note">本次体检未发现异常。</p>
        ) : (
          <div className="findings">
            {dq.findings.map((f, i) => (
              <article className={"finding " + (f.level || "info")} key={i}>
                <span className="finding-level">{LEVEL_LABEL[f.level] || f.level}</span>
                <div>
                  <header><strong>{f.title}</strong>{f.count > 0 && <span className="mini-tag">{f.count}</span>}</header>
                  <p>{f.detail}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      <Card title="复核建议" subtitle="按优先级处理即可让审核结论更稳定">
        <div className="advice-grid">
          <div><span>01</span><strong>补全购买方税号</strong><p>税号缺失会触发抬头校验提示；批量补录后再跑一次本期申请。</p></div>
          <div><span>02</span><strong>统一征收率口径</strong><p>3% 征收率不在字典内，建议在字典中单列并注明适用范围。</p></div>
          <div><span>03</span><strong>修正验收单品名</strong><p>品名「设备安装验收单」应改为实际设备名称，避免范围校验误判。</p></div>
          <div><span>04</span><strong>核对暂缓业务</strong><p>未验收销售合同先登记为待开票事项，验收完成后再提交审核。</p></div>
        </div>
      </Card>
    </div>
  );
}
