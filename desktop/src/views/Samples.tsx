import { useEffect, useState } from "react";
import type { Document } from "../types";
import { api } from "../api";
import { Card, Empty, Loading } from "../components/ui";
import { Icon } from "../components/Icons";
import { InvoicePaper } from "../components/InvoicePaper";
import { money } from "../format";

export function Samples({ notify }: { notify: (text: string) => void }) {
  const [samples, setSamples] = useState<Document[]>([]);
  const [selected, setSelected] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api
      .invoiceSamples()
      .then((list) => {
        if (!alive) return;
        setSamples(list);
        setSelected(list[0] ?? null);
      })
      .catch((e) => alive && notify(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [notify]);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">发票样本 · 历史版式</p>
          <h1>发票版式预览</h1>
          <p className="lede">按 712 × 478 的票面坐标渲染，明细最多 5 行；数据来自数据集内的历史发票，不参与本期开票编号。</p>
        </div>
        <span className="stat-chip"><small>样本数量</small><strong>{samples.length} 张</strong></span>
      </div>

      {loading ? (
        <Loading label="正在读取发票样本" />
      ) : samples.length === 0 ? (
        <Empty title="没有可用的发票样本" detail="数据集中未找到专票、普票或出口发票。" />
      ) : (
        <div className="samples-layout">
          <Card className="sample-list" title="样本列表" subtitle="点击切换票面">
            {samples.map((doc) => (
              <button key={doc.id} className={"sample-row" + (selected?.id === doc.id ? " active" : "")} onClick={() => setSelected(doc)}>
                <span className="sample-icon"><Icon name="sample" size={17} /></span>
                <span className="sample-main">
                  <strong>{doc.docType}</strong>
                  <small>{doc.party}</small>
                  <small className="mono">{doc.invoiceNo || doc.id}</small>
                </span>
                <span className="sample-amount">¥ {money(doc.amountTotal)}</span>
              </button>
            ))}
          </Card>

          <Card
            className="sample-stage"
            title={selected ? selected.title : "票面预览"}
            subtitle={selected ? selected.id + " · " + selected.docDate : undefined}
            extra={selected ? <span className="mini-tag">{selected.docType}</span> : undefined}
          >
            {selected && (
              <>
                <InvoicePaper doc={selected} />
                <div className="sample-facts">
                  <div><small>购买方</small><strong>{selected.party}</strong></div>
                  <div><small>纳税人识别号</small><strong className="mono">{selected.partyTaxNo || "—"}</strong></div>
                  <div><small>不含税金额</small><strong>¥ {money(selected.amountExTax)}</strong></div>
                  <div><small>税额</small><strong>¥ {money(selected.taxAmount)}</strong></div>
                  <div><small>价税合计</small><strong>¥ {money(selected.amountTotal)}</strong></div>
                  <div><small>发票代码 / 号码</small><strong className="mono">{selected.invoiceCode || "—"} / {selected.invoiceNo || "—"}</strong></div>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
