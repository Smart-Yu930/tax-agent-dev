import type { ReactNode } from "react";
import { Icon } from "./Icons";
import { statusClass } from "../format";

export function StatusPill({ status, label, dot = true }: { status: string; label: string; dot?: boolean }) {
  return (
    <span className={"pill " + statusClass(status)}>
      {dot && <i className="dot" />}
      {label}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  extra,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={"card " + className}>
      {(title || extra) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="sub">{subtitle}</p>}
          </div>
          {extra && <div className="card-extra">{extra}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark"><Icon name="doc" size={28} /></div>
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "正在载入本地数据" }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spinner" />
      {label}
    </div>
  );
}

export function FieldRow({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function CheckIcon({ status, size = 15 }: { status: string; size?: number }) {
  const name = status === "pass" ? "check" : status === "fail" ? "close" : status === "suspend" ? "hold" : "alert";
  return <Icon name={name} size={size} />;
}
