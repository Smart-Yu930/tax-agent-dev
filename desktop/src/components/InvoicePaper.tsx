import type { Document, Draft } from "../types";
import { money, rmbUpper } from "../format";

const COLS = [
  { x: 30, w: 188, key: "name", label: "货物或应税劳务名称" },
  { x: 218, w: 70, key: "spec", label: "规格型号" },
  { x: 288, w: 44, key: "unit", label: "单位" },
  { x: 332, w: 56, key: "qty", label: "数量" },
  { x: 388, w: 84, key: "unitPrice", label: "单价" },
  { x: 472, w: 96, key: "amount", label: "金额" },
  { x: 568, w: 48, key: "taxRate", label: "税率" },
  { x: 616, w: 77, key: "taxAmount", label: "税额" },
];

function clip(text: string, max: number): string {
  const chars = Array.from(text ?? "");
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : money(value);
}

export function InvoicePaper({ doc, draft }: { doc?: Document | null; draft?: Draft | null }) {
  const source = doc ?? null;
  const items = draft
    ? draft.items.map((it) => ({
        name: it.name,
        spec: it.spec,
        unit: it.unit,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
        taxRate: it.taxRate,
        taxAmount: it.taxAmount,
      }))
    : (source?.items ?? []).map((it) => ({
        name: it.name,
        spec: it.spec,
        unit: it.unit,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
        taxRate: it.taxRate,
        taxAmount: it.taxAmount,
      }));
  const rows = items.slice(0, 5);
  const title = source?.title || (draft ? "增值税专用发票" : "增值税发票");
  const invoiceNo = source?.invoiceNo || draft?.draftNo || "—";
  const invoiceCode = source?.invoiceCode || "—";
  const date = source?.docDate || (draft ? draft.createdAt.slice(0, 10) : "—");
  const buyer = draft ? draft.buyer : { name: source?.party || "—", taxNo: source?.partyTaxNo || "—" };
  const seller = draft ? draft.seller : { name: source?.selfName || "—", taxNo: source?.selfTaxNo || "—" };
  const total = draft ? draft.amountTotal : source?.amountTotal;
  const ex = draft ? draft.amountExTax : source?.amountExTax;
  const tax = draft ? draft.taxAmount : source?.taxAmount;
  const words = source?.amountInWords || (draft ? rmbUpper(draft.amountTotal) : "—");
  const remark = draft?.remark || source?.remark || "";
  const rate = draft?.taxRate || source?.taxRate || items[0]?.taxRate || "—";

  return (
    <div className="invoice-paper">
      <svg viewBox="0 0 712 478" role="img" aria-label={title}>
        <rect width="712" height="478" fill="#fffdf8" />
        <rect x="14" y="13" width="693" height="461" fill="none" stroke="#b4232a" strokeWidth="2" />
        <rect x="30" y="112" width="663" height="309.5" fill="none" stroke="#b4232a" strokeWidth="1" />
        <line x1="30" y1="111.5" x2="693" y2="111.5" stroke="#b4232a" strokeWidth="1" />
        <line x1="30" y1="184.5" x2="693" y2="184.5" stroke="#b4232a" strokeWidth="1" />
        <line x1="30" y1="329.5" x2="693" y2="329.5" stroke="#b4232a" strokeWidth="1" />
        <line x1="30" y1="355.5" x2="693" y2="355.5" stroke="#b4232a" strokeWidth="1" />
        <line x1="30" y1="421.5" x2="693" y2="421.5" stroke="#b4232a" strokeWidth="1" />
        <line x1="361" y1="111.5" x2="361" y2="184.5" stroke="#b4232a" strokeWidth="1" />

        <text x="42" y="48" className="ip-title">{clip(title, 14)}</text>
        <text x="42" y="66" className="ip-sub">发票联</text>
        <text x="670" y="38" textAnchor="end" className="ip-small">发票代码：{clip(invoiceCode, 18)}</text>
        <text x="670" y="58" textAnchor="end" className="ip-small">发票号码：{clip(invoiceNo, 18)}</text>
        <text x="670" y="78" textAnchor="end" className="ip-small">开票日期：{date}</text>

        <text x="42" y="130" className="ip-side">购买方</text>
        <text x="374" y="130" className="ip-side">销售方</text>
        <text x="86" y="132" className="ip-label">名称：{clip(buyer.name, 20)}</text>
        <text x="86" y="154" className="ip-label">纳税人识别号：{clip(buyer.taxNo, 22)}</text>
        <text x="86" y="176" className="ip-label">地址、电话：—</text>
        <text x="417" y="132" className="ip-label">名称：{clip(seller.name, 20)}</text>
        <text x="417" y="154" className="ip-label">纳税人识别号：{clip(seller.taxNo, 22)}</text>
        <text x="417" y="176" className="ip-label">地址、电话：—</text>

        <rect x="30" y="184.5" width="663" height="25" fill="#fdf2f2" />
        {COLS.map((c) => (
          <g key={c.key}>
            <line x1={c.x} y1="184.5" x2={c.x} y2="329.5" stroke="#b4232a" strokeWidth="0.7" />
            <text x={c.x + c.w / 2} y="201.5" textAnchor="middle" className="ip-th">{c.label}</text>
          </g>
        ))}
        <line x1="693" y1="184.5" x2="693" y2="329.5" stroke="#b4232a" strokeWidth="0.7" />

        {Array.from({ length: 5 }).map((_, row) => {
          const y = 213 + row * 27;
          const item = rows[row];
          return (
            <g key={row}>
              {row > 0 && <line x1="30" y1={y - 8} x2="693" y2={y - 8} stroke="#e7c9c9" strokeWidth="0.6" />}
              {item && (
                <>
                  <text x="36" y={y} className="ip-cell">{clip(item.name || "", 25)}</text>
                  <text x={COLS[1].x + 4} y={y} className="ip-cell">{clip(item.spec || "", 8)}</text>
                  <text x={COLS[2].x + COLS[2].w / 2} y={y} textAnchor="middle" className="ip-cell">{clip(item.unit || "", 4)}</text>
                  <text x={COLS[3].x + COLS[3].w - 4} y={y} textAnchor="end" className="ip-cell">{item.qty ?? ""}</text>
                  <text x={COLS[4].x + COLS[4].w - 4} y={y} textAnchor="end" className="ip-cell">{num(item.unitPrice)}</text>
                  <text x={COLS[5].x + COLS[5].w - 4} y={y} textAnchor="end" className="ip-cell">{num(item.amount)}</text>
                  <text x={COLS[6].x + COLS[6].w / 2} y={y} textAnchor="middle" className="ip-cell">{item.taxRate || rate}</text>
                  <text x={COLS[7].x + COLS[7].w - 4} y={y} textAnchor="end" className="ip-cell">{num(item.taxAmount)}</text>
                </>
              )}
            </g>
          );
        })}

        <text x="42" y="346" className="ip-label">合计</text>
        <text x={COLS[5].x + COLS[5].w - 4} y="346" textAnchor="end" className="ip-strong">{num(ex)}</text>
        <text x={COLS[7].x + COLS[7].w - 4} y="346" textAnchor="end" className="ip-strong">{num(tax)}</text>

        <text x="42" y="374" className="ip-label">价税合计（大写）</text>
        <text x="160" y="374" className="ip-strong">{clip(words, 26)}</text>
        <text x="600" y="374" className="ip-label">（小写）</text>
        <text x="680" y="374" textAnchor="end" className="ip-strong">¥{num(total)}</text>

        <text x="42" y="398" className="ip-label">备注</text>
        <text x="88" y="398" className="ip-note">{clip(remark, 44)}</text>

        <text x="42" y="448" className="ip-small">收款人：李娜</text>
        <text x="182" y="448" className="ip-small">复核：张伟</text>
        <text x="302" y="448" className="ip-small">开票人：王敏</text>
        <text x="530" y="448" className="ip-small">销售方：（章）</text>
        <ellipse cx="655" cy="448" rx="25" ry="25" fill="none" stroke="#b4232a" strokeWidth="1" strokeDasharray="3 3" />
        <text x="655" y="446" textAnchor="middle" className="ip-seal">发票</text>
        <text x="655" y="458" textAnchor="middle" className="ip-seal">专用章</text>
      </svg>
    </div>
  );
}
