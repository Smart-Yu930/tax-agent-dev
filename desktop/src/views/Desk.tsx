import { useState } from "react";
import type { Bootstrap } from "../types";
import { api } from "../api";
import { Card, Empty, FieldRow, StatusPill } from "../components/ui";
import { Icon } from "../components/Icons";
import { money, stamp } from "../format";

export function Desk({
  boot,
  refresh,
  notify,
}: {
  boot: Bootstrap;
  refresh: () => Promise<unknown>;
  notify: (text: string) => void;
}) {
  const pending = boot.board.filter((r) => r.status === "pending" || r.status === "suspended");
  const [form, setForm] = useState({
    buyerName: pending[0]?.customer ?? "",
    buyerTaxNo: boot.dict.customers.find((c) => c.name === pending[0]?.customer)?.taxNo ?? "",
    goods: pending[0]?.product ?? "",
    amountTotal: pending[0]?.gross ? String(pending[0].gross) : "",
    taxRate: pending[0]?.region === "出口" ? "0%" : "13%",
    contractId: pending[0]?.contractNo ?? "",
    invoiceType: pending[0]?.region === "出口" ? "出口发票" : "增值税专用发票",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<number | "">("");

  const set = (key: keyof typeof form, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const applyRow = (index: string) => {
    setSelected(index === "" ? "" : Number(index));
    const row = boot.board[Number(index)];
    if (!row) return;
    setForm({
      buyerName: row.customer,
      buyerTaxNo: boot.dict.customers.find((c) => c.name === row.customer)?.taxNo ?? "",
      goods: row.product,
      amountTotal: row.gross.toFixed(2),
      taxRate: row.region === "出口" ? "0%" : "13%",
      contractId: row.contractNo,
      invoiceType: row.region === "出口" ? "出口发票" : "增值税专用发票",
    });
  };

  const submit = async () => {
    setError("");
    if (!form.buyerName || !form.goods || !form.amountTotal) {
      setError("购买方、货物名称与价税合计为必填项。");
      return;
    }
    setBusy(true);
    try {
      const invoice = await api.issueInvoice({
        ...form,
        amountTotal: Number(form.amountTotal),
      });
      notify("已开具 " + invoice.invoiceNo + "，并回写待开票清单。");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    try {
      const count = await api.syncHistory();
      notify("已同步 " + count + " 张历史发票至待开票清单。");
      await refresh();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">开票台 · 人工复核</p>
          <h1>开具发票</h1>
          <p className="lede">人工开票与智能审核共用同一套编号与台账；开具后立即回写销售行，重复开票会被拦截。</p>
        </div>
        <button className="btn ghost" onClick={sync} disabled={busy}><Icon name="sync" /> 同步历史发票</button>
      </div>

      <div className="desk-grid">
        <Card title="开票表单" subtitle="可从待开票清单带入，再按实际业务调整">
          <div className="form-grid one">
            <FieldRow label="从待开票清单带入" hint="选择后自动填充购买方、货物、金额与合同号">
              <select value={selected} onChange={(e) => applyRow(e.target.value)}>
                <option value="">手动录入</option>
                {pending.map((row) => (
                  <option key={row.index} value={row.index}>{row.customer} · {row.product} · ¥ {money(row.gross)}</option>
                ))}
              </select>
            </FieldRow>
            <div className="form-grid">
              <FieldRow label="购买方名称"><input value={form.buyerName} onChange={(e) => set("buyerName", e.target.value)} /></FieldRow>
              <FieldRow label="购买方税号"><input value={form.buyerTaxNo} onChange={(e) => set("buyerTaxNo", e.target.value)} /></FieldRow>
              <FieldRow label="货物 / 服务名称"><input value={form.goods} onChange={(e) => set("goods", e.target.value)} /></FieldRow>
              <FieldRow label="价税合计"><input type="number" value={form.amountTotal} onChange={(e) => set("amountTotal", e.target.value)} /></FieldRow>
              <FieldRow label="税率">
                <select value={form.taxRate} onChange={(e) => set("taxRate", e.target.value)}>
                  {boot.dict.taxRates.map((r) => <option key={r.rate} value={r.rate}>{r.rate} · {r.label}</option>)}
                </select>
              </FieldRow>
              <FieldRow label="发票类型">
                <select value={form.invoiceType} onChange={(e) => set("invoiceType", e.target.value)}>
                  <option>增值税专用发票</option>
                  <option>增值税普通发票</option>
                  <option>出口发票</option>
                </select>
              </FieldRow>
              <FieldRow label="关联合同号"><input value={form.contractId} onChange={(e) => set("contractId", e.target.value)} /></FieldRow>
            </div>
          </div>
          {error && <div className="notice bad">{error}</div>}
          <button className="btn primary wide" onClick={submit} disabled={busy}>
            {busy ? "正在开具…" : "开具并回写台账"}
          </button>
          <p className="form-foot">开票人：张伟 · 复核：李娜 · 编号规则 FP-SESSION-001 递增</p>
        </Card>

        <Card title="本期已开具" subtitle={"本会话共 " + boot.session.invoices.length + " 张，历史回写标记为 dataset"}>
          {boot.session.invoices.length === 0 ? (
            <Empty title="还没有本会话开票记录" detail="完成一笔审核确认或手工开票后会出现在这里。" />
          ) : (
            <div className="invoice-list">
              {boot.session.invoices.map((inv) => (
                <div className="invoice-row" key={inv.id}>
                  <span className="invoice-icon"><Icon name="sample" size={18} /></span>
                  <div className="invoice-main">
                    <strong>{inv.invoiceNo}<span className="mini-tag">{inv.invoiceType}</span></strong>
                    <p>{inv.buyerName} · {inv.goods}</p>
                    <small>{stamp(inv.issuedAt)} · {inv.poolKind === "document" ? "历史样本回写" : "本会话开具"}</small>
                  </div>
                  <div className="invoice-amount"><strong>¥ {money(inv.amountTotal)}</strong><span>{inv.taxRate}</span></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="待开票提醒" subtitle="按含税金额降序，未验收业务会标注暂缓原因">
        <div className="reminder-grid">
          {pending.slice(0, 4).map((row) => (
            <button key={row.index} className="reminder" onClick={() => applyRow(String(row.index))}>
              <span className="reminder-top"><StatusPill status={row.status} label={row.statusLabel} /><small>{row.date}</small></span>
              <strong>{row.product}</strong>
              <p>{row.customer} · {row.contractNo || "无合同号"}</p>
              <span className="reminder-amount">¥ {money(row.gross)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
