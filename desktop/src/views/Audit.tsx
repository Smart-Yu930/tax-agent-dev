import { useEffect, useState } from "react";
import type { Application, AuditOutcome, Bootstrap, Check, Document, Draft } from "../types";
import { Card, CheckIcon, Empty, FieldRow, StatusPill } from "../components/ui";
import { Icon } from "../components/Icons";
import { InvoicePaper } from "../components/InvoicePaper";
import { money } from "../format";

const RESULT_LABEL: Record<string, string> = { pass: "审核通过", fail: "审核不通过", suspend: "暂缓开票" };

export function Audit({
  boot,
  application,
  outcome,
  busy,
  onRun,
  onConfirm,
  goPending,
  goDesk,
}: {
  boot: Bootstrap;
  application: Application | null;
  outcome: AuditOutcome | null;
  busy: boolean;
  onRun: (application: Application) => void;
  onConfirm: (draftNo: string) => void;
  goPending: () => void;
  goDesk: () => void;
}) {
  const [form, setForm] = useState<Application | null>(application);

  useEffect(() => {
    setForm(application);
  }, [application]);

  const patch = (key: keyof Application, value: unknown) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  if (!form) {
    const candidates = boot.board.filter((r) => r.status === "pending" || r.status === "suspended").slice(0, 4);
    return (
      <div className="view">
        <div className="page-head">
          <div>
            <p className="eyebrow">开票审核 · 申请单</p>
            <h1>先选择一笔待开票业务</h1>
            <p className="lede">审核以一个申请单为单位：系统按证据索引匹配合同、验收单与出库单，再执行六项规则。</p>
          </div>
          <button className="btn primary" onClick={goPending}><Icon name="pending" /> 打开待开票清单</button>
        </div>
        <Card title="可以立刻审核的业务" subtitle="取待开票清单前四项">
          <div className="pick-list">
            {candidates.map((row) => (
              <button key={row.index} className="pick-row" onClick={() => goPending()}>
                <span className="pick-icon"><Icon name="doc" /></span>
                <span><strong>{row.product}</strong><small>{row.customer} · {row.date} · ¥ {money(row.gross)}</small></span>
                <StatusPill status={row.status} label={row.statusLabel} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  const docs = form.documents;
  const result = outcome?.audit;
  const draft = outcome?.draft;

  return (
    <div className="view audit-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">开票审核 · {form.applicationNo}</p>
          <h1>申请单智能审核</h1>
          <p className="lede">申请单来自「{form.source}」，共 {docs.length} 份证据单据；所有字段位置可回溯到原单据。</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={goPending}><Icon name="close" /> 换一笔</button>
          <button className="btn primary" onClick={() => onRun(form)} disabled={busy}>
            {busy ? <span className="spinner light" /> : <Icon name="audit" />}
            {busy ? "正在校验…" : "开始审核"}
          </button>
        </div>
      </div>

      <div className="audit-grid">
        <div className="audit-left">
          <Card title="申请信息" subtitle="可直接修改后重跑，便于对比不同申报口径" className="form-card">
            <div className="form-grid">
              <FieldRow label="申请单号"><input value={form.applicationNo} onChange={(e) => patch("applicationNo", e.target.value)} /></FieldRow>
              <FieldRow label="申请人"><input value={form.applicant} onChange={(e) => patch("applicant", e.target.value)} /></FieldRow>
              <FieldRow label="拟开票日期"><input type="date" value={form.applyDate} onChange={(e) => patch("applyDate", e.target.value)} /></FieldRow>
              <FieldRow label="购买方名称"><input value={form.declaredCustomer} onChange={(e) => patch("declaredCustomer", e.target.value)} /></FieldRow>
              <FieldRow label="客户档案"><input value={form.customer} onChange={(e) => patch("customer", e.target.value)} /></FieldRow>
              <FieldRow label="业务区域">
                <select value={form.region} onChange={(e) => patch("region", e.target.value)}>
                  <option value="内销">内销</option>
                  <option value="出口">出口</option>
                </select>
              </FieldRow>
              <FieldRow label="货物 / 服务"><input value={form.product} onChange={(e) => patch("product", e.target.value)} /></FieldRow>
              <FieldRow label="申请金额（含税）">
                <input
                  type="number"
                  value={form.declaredAmount ?? ""}
                  onChange={(e) => patch("declaredAmount", e.target.value === "" ? null : Number(e.target.value))}
                />
              </FieldRow>
              <FieldRow label="规则模式"><input value="rule · 本地规则引擎" readOnly /></FieldRow>
            </div>
          </Card>

          <Card title="证据单据" subtitle="系统按字段标签分类，不依赖单据抬头">
            <div className="doc-stack">
              {docs.map((doc) => <DocCard key={doc.id} doc={doc} />)}
            </div>
          </Card>

          <div className="audit-actions">
            <button className="btn primary wide" onClick={() => onRun(form)} disabled={busy}>
              {busy ? "正在执行六项校验…" : "执行审核并生成结论"}
            </button>
            <p>审核会写入本会话的操作日志；不通过或暂缓的申请会进入驳回台账。</p>
          </div>
        </div>

        <div className="audit-right">
          <Card title="审核结论" subtitle={result ? result.auditedAt + " · " + result.operator : "等待执行"}>
            {!result ? (
              <div className="pending-result">
                <span className="pending-mark"><Icon name="audit" size={26} /></span>
                <strong>尚未审核</strong>
                <p>将依次检查抬头、税率、金额、范围、日期与重复开票。</p>
                <ol className="rule-order">
                  {boot.checks.map((c) => <li key={c.key}><span>{c.name}</span><small>{c.desc}</small></li>)}
                </ol>
              </div>
            ) : (
              <>
                <div className={"result-banner " + result.result}>
                  <span className="result-icon"><CheckIcon status={result.result === "pass" ? "pass" : result.result === "fail" ? "fail" : "suspend"} size={22} /></span>
                  <div>
                    <strong>{RESULT_LABEL[result.result] || result.resultLabel}</strong>
                    <p>风险等级：{result.riskLevel === "high" ? "高" : result.riskLevel === "mid" ? "中" : "低"} · 规则模式 {result.ruleMode}</p>
                  </div>
                </div>
                <p className="result-summary">{result.summary}</p>
                <div className="check-list">
                  {result.checks.map((check) => <CheckLine key={check.key} check={check} />)}
                </div>
              </>
            )}
          </Card>

          {result && result.documents.length > 0 && (
            <Card title="分类结果" subtitle="按字段标签识别，给出置信度与依据">
              <ul className="classify-list">
                {result.documents.map((d) => (
                  <li key={d.id}>
                    <span className="doc-id mono">{d.id}</span>
                    <div><strong>{d.classified}</strong><p>{d.reason}</p></div>
                    <span className="confidence">{Math.round(d.confidence * 100)}%</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      {draft && <DraftPanel draft={draft} onConfirm={onConfirm} goDesk={goDesk} />}
    </div>
  );
}

function DocCard({ doc }: { doc: Document }) {
  return (
    <details className="doc-card">
      <summary>
        <span className="doc-icon"><Icon name="doc" size={17} /></span>
        <span className="doc-main">
          <strong>{doc.docType}</strong>
          <small>{doc.id} · {doc.party || "—"} · {doc.docDate}</small>
        </span>
        <span className="doc-amount">¥ {money(doc.amountTotal)}</span>
        <Icon name="chevron" size={14} />
      </summary>
      <div className="doc-body">
        <div className="doc-meta">
          <span>销售方：{doc.selfName || "—"}</span>
          <span>购买方税号：{doc.partyTaxNo || "—"}</span>
          <span>不含税：{money(doc.amountExTax)}</span>
          <span>税额：{money(doc.taxAmount)}</span>
          <span>税率：{doc.taxRate || "—"}</span>
          <span>合同号：{doc.contractNo || "—"}</span>
        </div>
        {doc.items.length > 0 && (
          <table className="mini-table">
            <thead><tr><th>品名</th><th>规格</th><th className="num">数量</th><th className="num">金额</th><th>位置</th></tr></thead>
            <tbody>
              {doc.items.map((item, i) => (
                <tr key={i}><td>{item.name}</td><td>{item.spec || "—"}</td><td className="num">{item.qty ?? "—"}</td><td className="num">{money(item.amount)}</td><td className="mono muted">{item.loc}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function CheckLine({ check }: { check: Check }) {
  return (
    <div className={"check-line " + check.status}>
      <span className="check-mark"><CheckIcon status={check.status} size={16} /></span>
      <div className="check-body">
        <div className="check-head">
          <strong>{check.name}</strong>
          <StatusPill status={check.status} label={check.status === "pass" ? "通过" : check.status === "fail" ? "不通过" : check.status === "warn" ? "提示" : "暂缓"} />
        </div>
        <p>{check.conclusion}</p>
        {check.diff && (
          <div className="diff">
            <span>{check.diff.left}</span><b>≠</b><span>{check.diff.right}</span>
            {check.diff.gap !== 0 && <em>差额 {money(Math.abs(check.diff.gap))} 元</em>}
          </div>
        )}
        {check.advice && <p className="advice"><Icon name="alert" size={13} /> {check.advice}</p>}
        {check.evidence.length > 0 && (
          <details className="evidence">
            <summary>{check.evidence.length} 条证据 · 查看字段位置</summary>
            <ul>
              {check.evidence.map((e, i) => (
                <li key={i}>
                  <span className="mono">{e.docId}</span>
                  <span>{e.field}：{e.value}</span>
                  <small>{e.loc}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

function DraftPanel({ draft, onConfirm, goDesk }: { draft: Draft; onConfirm: (draftNo: string) => void; goDesk: () => void }) {
  return (
    <Card
      className="draft-panel"
      title="待确认开票草稿"
      subtitle={draft.draftNo + " · 生成于 " + draft.createdAt}
      extra={<StatusPill status="draft" label={draft.statusLabel} />}
    >
      <div className="draft-grid">
        <div className="draft-paper"><InvoicePaper draft={draft} /></div>
        <div className="draft-side">
          <div className="draft-facts">
            <div><small>发票类型</small><strong>{draft.invoiceType}</strong></div>
            <div><small>购买方</small><strong>{draft.buyer.name}</strong></div>
            <div><small>不含税金额</small><strong>¥ {money(draft.amountExTax)}</strong></div>
            <div><small>税率 / 税额</small><strong>{draft.taxRate} / ¥ {money(draft.taxAmount)}</strong></div>
            <div><small>价税合计</small><strong className="big">¥ {money(draft.amountTotal)}</strong></div>
          </div>
          {draft.commonErrors.length > 0 && (
            <div className="notice warn">
              <strong>需复核 {draft.commonErrors.length} 项</strong>
              <ul>{draft.commonErrors.map((e, i) => <li key={i}>{e.check}：{e.text}</li>)}</ul>
            </div>
          )}
          <div className="sources">
            <h4>字段来源</h4>
            {draft.sources.map((s, i) => (
              <div key={i}><span>{s.label}</span><b>{s.value}</b><small>{s.docId} · {s.loc}</small></div>
            ))}
          </div>
          <div className="draft-actions">
            <button className="btn primary wide" onClick={() => onConfirm(draft.draftNo)}>确认并开具发票</button>
            <button className="btn ghost wide" onClick={goDesk}>去开票台手工处理</button>
          </div>
        </div>
      </div>
    </Card>
  );
}
