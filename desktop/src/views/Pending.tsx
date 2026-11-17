import { useMemo, useState } from "react";
import type { Bootstrap } from "../types";
import { Card, Empty, StatusPill } from "../components/ui";
import { Icon } from "../components/Icons";
import { money, qty } from "../format";

export function Pending({ boot, onAudit }: { boot: Bootstrap; onAudit: (index: number) => void }) {
  const [filter, setFilter] = useState("all");
  const [keyword, setKeyword] = useState("");

  const rows = useMemo(() => {
    const term = keyword.trim().toLowerCase();
    return boot.board.filter((row) => {
      const okStatus = filter === "all" || row.status === filter;
      const okTerm = !term || (row.product + row.customer + row.contractNo).toLowerCase().includes(term);
      return okStatus && okTerm;
    });
  }, [boot.board, filter, keyword]);

  const total = rows.reduce((sum, r) => sum + r.gross, 0);

  return (
    <div className="view">
      <div className="page-head">
        <div>
          <p className="eyebrow">销售台账 · {boot.meta.period}</p>
          <h1>待开票清单</h1>
          <p className="lede">每行对应一项销售业务，点击「智能审核」会按证据索引自动组装申请单与三份核心单据。</p>
        </div>
        <div className="head-actions">
          <span className="stat-chip"><small>筛选结果</small><strong>{rows.length} 项</strong></span>
          <span className="stat-chip"><small>含税合计</small><strong>¥ {money(total)}</strong></span>
        </div>
      </div>

      <Card
        title="销售清单"
        subtitle="已开具状态来自本会话开票记录或历史发票回写"
        extra={
          <div className="filters">
            <div className="segmented">
              {[
                ["all", "全部"],
                ["pending", "待开票"],
                ["suspended", "未验收"],
                ["issued", "已开具"],
              ].map(([key, label]) => (
                <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
            <label className="search">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="产品 / 客户 / 合同号" />
            </label>
          </div>
        }
      >
        {rows.length === 0 ? (
          <Empty title="没有匹配的销售行" detail="换个关键词或状态筛选试试。" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th><th>产品</th><th>客户 / 区域</th><th>销售日期</th>
                  <th className="num">数量</th><th className="num">不含税</th><th className="num">价税合计</th>
                  <th>合同号</th><th>验收</th><th>状态</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.index}>
                    <td className="muted mono">{String(row.index + 1).padStart(2, "0")}</td>
                    <td><strong className="cell-title">{row.product}</strong></td>
                    <td><span>{row.customer}</span><span className="cell-sub">{row.region}</span></td>
                    <td className="muted">{row.date}</td>
                    <td className="num">{qty(row.qty)}</td>
                    <td className="num">{money(row.amount)}</td>
                    <td className="num strong">{money(row.gross)}</td>
                    <td className="mono muted">{row.contractNo || "—"}</td>
                    <td>{row.acceptStatus ? <span className="mini-tag">{row.acceptStatus}</span> : <span className="muted">—</span>}</td>
                    <td><StatusPill status={row.status} label={row.statusLabel} /></td>
                    <td className="right">
                      <button className="btn tiny primary" onClick={() => onAudit(row.index)}>智能审核</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
