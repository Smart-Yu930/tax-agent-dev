export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function shortMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 10000) return (value / 10000).toFixed(1) + " 万";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

export function qty(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return (value * 100).toFixed(1) + "%";
}

export function rateLabel(rate: string | null | undefined): string {
  if (!rate) return "—";
  return rate.includes("%") ? rate : rate;
}

export function stamp(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 16 ? value.slice(0, 16) : value;
}

export function statusClass(status: string): string {
  switch (status) {
    case "pass":
    case "issued":
      return "ok";
    case "fail":
      return "bad";
    case "warn":
    case "draft":
      return "warn";
    case "suspend":
    case "suspended":
      return "hold";
    default:
      return "muted";
  }
}

export function rmbUpper(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (Math.abs(value) < 0.005) return "零元整";
  const digits = "零壹贰叁肆伍陆柒捌玖";
  const units = ["分", "角", "元", "拾", "佰", "仟", "万", "拾", "佰", "仟", "亿", "拾", "佰", "仟"];
  let n = Math.round(Math.abs(value) * 100);
  let out = "";
  let zero = false;
  for (let i = 0; n > 0 && i < units.length; i++) {
    const d = n % 10;
    if (d === 0) {
      if (!zero && out.length > 0) {
        out = digits[0] + out;
        zero = true;
      }
    } else {
      out = digits[d] + units[i] + out;
      zero = false;
    }
    n = Math.floor(n / 10);
  }
  out = out
    .replace(/零+元/g, "元")
    .replace(/零+万/g, "万")
    .replace(/零+亿/g, "亿")
    .replace(/零+/g, "零")
    .replace(/零$/, "");
  if (!out.includes("角") && !out.includes("分")) out = out.replace(/元?$/, "元整");
  return (value < 0 ? "负" : "") + out;
}
