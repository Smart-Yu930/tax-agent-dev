import { useEffect, useState } from "react";
import type { Bootstrap, Document } from "../types";
import { api, type DocumentPage } from "../api";
import { Card, Empty, Loading } from "../components/ui";
import { Icon } from "../components/Icons";
import { money } from "../format";

export function Documents({ boot }: { boot: Bootstrap }) {
  const [docType, setDocType] = useState("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<DocumentPage | null>(null);
  const [detail, setDetail] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .documents(docType, query, page, 18)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError("");
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [docType, query, page]);

  const open = async (doc: Document) => {
    setDetail(doc);
    try {
      const full = await api.document(doc.id);
      if (full) setDetail(full);
    } catch {
      /* the list payload is already enough for a preview */
    }
  };

  return (
    <div className="view docs-view">
      <div className="page-head">
        <div>
          <p className="eyebrow">单据库 · {boot.stats.documents} 份</p>
          <h1>业务单据</h1>
          <p className="lede">合同、验收、出库、发票与海关缴款书统一检索；分类由字段标签决定，可点开核对原文位置。</p>
        </div>
        <div className="doc-type-chips">
          {boot.dict.docTypes.slice(0, 5).map((t) => (
            <span key={t.name} className="chip">{t.name} <b>{t.count}</b></span>
          ))}
        </div>
      </div>

      <div className="docs-layout">
        <Card
          className="docs-list-card"
          title="单据清单"
          subtitle={data ? "共 " + data.total + " 条 · 第 " + data.page + " / " + data.pages + " 页" : "载入中"}
          extra={
            <label className="search">
              <Icon name="search" size={15} />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                    setQuery(keyword);
                  }
                }}
                placeholder="单号 / 单位 / 标题，回车搜索"
              />
            </label>
          }
        >
          <div className="filter-row">
            <button className={docType === "" ? "chip active" : "chip"} onClick={() => { setDocType(""); setPage(1); }}>全部</button>
            {boot.dict.docTypes.map((t) => (
              <button key={t.name} className={docType === t.name ? "chip active" : "chip"} onClick={() => { setDocType(t.name); setPage(1); }}>
                {t.name}<b>{t.count}</b>
              </button>
            ))}
          </div>

          {error ? (
            <div className="notice bad">{error}</div>
          ) : loading ? (
            <Loading label="正在筛选本地单据" />
          ) : !data || data.items.length === 0 ? (
            <Empty title="没有匹配的单据" detail="调整类型或关键词后重试。" />
          ) : (
            <>
              <table className="table docs-table">
                <thead><tr><th>单据编号</th><th>类型</th><th>对方单位</th><th>日期</th><th className="num">价税合计</th><th /></tr></thead>
                <tbody>
                  {data.items.map((doc) => (
                    <tr key={doc.id} className={detail?.id === doc.id ? "selected" : ""} onClick={() => open(doc)}>
                      <td className="mono">{doc.id}</td>
                      <td><span className="mini-tag">{doc.docType}</span></td>
                      <td>{doc.party}</td>
                      <td className="muted">{doc.docDate}</td>
                      <td className="num">{money(doc.amountTotal)}</td>
                      <td className="right"><Icon name="chevron" size={14} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="pager">
                <button className="btn tiny ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</button>
                <span>{page} / {data.pages}</span>
                <button className="btn tiny ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>下一页</button>
              </div>
            </>
          )}
        </Card>

        <Card className="doc-detail" title="单据详情" subtitle={detail ? detail.id : "从左侧选择一份单据"}>
          {!detail ? (
            <Empty title="未选择单据" detail="点击清单中的任意一行查看结构化字段。" />
          ) : (
            <div className="detail-body">
              <div className="detail-title">
                <div><span className="mini-tag">{detail.docType}</span><h3>{detail.title}</h3><p>{detail.party} · {detail.docDate}</p></div>
                <strong>¥ {money(detail.amountTotal)}</strong>
              </div>
              <div className="detail-grid">
                <div><small>本方名称</small><span>{detail.selfName || "—"}</span></div>
                <div><small>本方税号</small><span className="mono">{detail.selfTaxNo || "—"}</span></div>
                <div><small>对方税号</small><span className="mono">{detail.partyTaxNo || "—"}</span></div>
                <div><small>不含税金额</small><span>{money(detail.amountExTax)}</span></div>
                <div><small>税额</small><span>{money(detail.taxAmount)}</span></div>
                <div><small>税率</small><span>{detail.taxRate || "—"}</span></div>
                <div><small>合同号</small><span className="mono">{detail.contractNo || "—"}</span></div>
                <div><small>发票号</small><span className="mono">{detail.invoiceNo || "—"}</span></div>
              </div>
              {detail.items.length > 0 && (
                <table className="mini-table">
                  <thead><tr><th>品名</th><th>规格</th><th className="num">数量</th><th className="num">单价</th><th className="num">金额</th><th>位置</th></tr></thead>
                  <tbody>
                    {detail.items.map((item, i) => (
                      <tr key={i}><td>{item.name}</td><td>{item.spec || "—"}</td><td className="num">{item.qty ?? "—"}</td><td className="num">{money(item.unitPrice)}</td><td className="num">{money(item.amount)}</td><td className="mono muted">{item.loc}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <details className="fields-detail" open>
                <summary>结构化字段（{detail.fields.length}）</summary>
                <div className="field-table">
                  {detail.fields.map((f, i) => (
                    <div key={i}><span>{f.label}</span><b>{String(f.value ?? "—")}</b><small>{f.loc || "—"}</small></div>
                  ))}
                </div>
              </details>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
