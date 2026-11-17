//! Money and rate helpers. Business amounts are compared to the cent.

pub const EPS: f64 = 0.005;

/// Round to two decimals, absorbing binary floating point noise the same way
/// the reference engine does.
pub fn round2(n: f64) -> f64 {
    ((n + f64::EPSILON) * 100.0).round() / 100.0
}

pub fn is_zero(n: f64) -> bool {
    n.abs() <= EPS
}

pub fn same_amount(a: Option<f64>, b: Option<f64>) -> Option<bool> {
    match (a, b) {
        (Some(a), Some(b)) => Some((round2(a) - round2(b)).abs() <= EPS),
        _ => None,
    }
}

/// Format with thousands separators and exactly two decimals.
pub fn fmt_money(n: Option<f64>) -> String {
    match n {
        None => "—".to_string(),
        Some(v) if !v.is_finite() => "—".to_string(),
        Some(v) => {
            let v = round2(v);
            let neg = v < 0.0;
            let abs = v.abs();
            let fixed = format!("{:.2}", abs);
            let (int_part, dec_part) = fixed.split_once('.').unwrap_or((fixed.as_str(), "00"));
            let mut grouped = String::new();
            let digits: Vec<char> = int_part.chars().collect();
            for (i, ch) in digits.iter().enumerate() {
                if i > 0 && (digits.len() - i) % 3 == 0 {
                    grouped.push(',');
                }
                grouped.push(*ch);
            }
            format!("{}{}.{}", if neg { "-" } else { "" }, grouped, dec_part)
        }
    }
}

pub fn fmt_short(n: Option<f64>) -> String {
    match n {
        None => "—".to_string(),
        Some(v) if v.abs() >= 10_000.0 => {
            let s = fmt_money(Some(v / 10_000.0)).replace(".00", "");
            format!("{} 万元", s)
        }
        Some(v) => format!("{} 元", fmt_money(Some(v))),
    }
}

pub fn parse_amount(s: &str) -> Option<f64> {
    let cleaned: String = s
        .chars()
        .filter(|c| !matches!(c, '¥' | '￥' | ',' | '元') && !c.is_whitespace())
        .collect();
    if cleaned.is_empty() || cleaned == "—" || cleaned == "-" {
        return None;
    }
    let start = cleaned.find(|c: char| c.is_ascii_digit() || c == '-')?;
    let tail = &cleaned[start..];
    let end = tail
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .unwrap_or(tail.len());
    tail[..end].parse::<f64>().ok()
}

/// Parse a rate such as "13%" or "0%" into 0.13 / 0.0.
pub fn parse_rate(s: &str) -> Option<f64> {
    let pct = s.find('%')?;
    let head = &s[..pct];
    let digits: String = head
        .chars()
        .rev()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse::<f64>().ok().map(|v| v / 100.0)
}

pub fn rate_str(rate: f64) -> String {
    let pct = (rate * 10_000.0).round() / 100.0;
    if (pct - pct.round()).abs() < f64::EPSILON {
        format!("{}%", pct.round() as i64)
    } else {
        format!("{}%", pct)
    }
}

pub fn fmt_qty(q: Option<f64>) -> String {
    match q {
        None => "—".to_string(),
        Some(v) if (v - v.round()).abs() < 1e-9 => format!("{}", v.round() as i64),
        Some(v) => format!("{}", v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_money() {
        assert_eq!(fmt_money(Some(113000.0)), "113,000.00");
        assert_eq!(fmt_money(Some(10170000.0)), "10,170,000.00");
        assert_eq!(fmt_money(Some(0.0)), "0.00");
        assert_eq!(fmt_money(None), "—");
    }

    #[test]
    fn parses_rates() {
        assert_eq!(parse_rate("13%"), Some(0.13));
        assert_eq!(parse_rate("0%"), Some(0.0));
        assert_eq!(parse_rate("—"), None);
        assert_eq!(rate_str(0.13), "13%");
    }

    #[test]
    fn compares_amounts() {
        assert_eq!(same_amount(Some(113000.0), Some(113000.0)), Some(true));
        assert_eq!(same_amount(Some(113000.0), Some(113000.01)), Some(false));
    }
}
