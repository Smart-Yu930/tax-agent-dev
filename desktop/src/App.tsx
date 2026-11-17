import { useCallback, useEffect, useState } from "react";
import { api, isTauri } from "./api";
import type { Application, AuditOutcome, Bootstrap } from "./types";
import { NAV, VIEW_TITLE, type ViewKey } from "./nav";
import { Icon } from "./components/Icons";
import { Loading } from "./components/ui";
import { Dashboard } from "./views/Dashboard";
import { Flow } from "./views/Flow";
import { Pending } from "./views/Pending";
import { Audit } from "./views/Audit";
import { Desk } from "./views/Desk";
import { Documents } from "./views/Documents";
import { Samples } from "./views/Samples";
import { Policies } from "./views/Policies";
import { Quality } from "./views/Quality";

const PRIMARY: ViewKey[] = ["dashboard", "flow", "pending", "audit", "desk"];
const SUPPORT: ViewKey[] = ["documents", "samples", "policies", "quality"];

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [view, setView] = useState<ViewKey>("dashboard");
  const [application, setApplication] = useState<Application | null>(null);
  const [outcome, setOutcome] = useState<AuditOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const refresh = useCallback(async () => {
    const next = await api.bootstrap();
    setBoot(next);
    return next;
  }, []);

  useEffect(() => {
    refresh()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => undefined);
  }, [refresh]);

  const notify = useCallback((text: string) => setToast(text), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const go = useCallback((next: ViewKey) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const openAudit = useCallback(async (index: number) => {
    setBusy(true);
    try {
      const app = await api.pendingApplication(index);
      setApplication(app);
      setOutcome(null);
      setView("audit");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [notify]);

  const runAudit = useCallback(async (app: Application) => {
    setBusy(true);
    try {
      const result = await api.runAudit(app, "李娜");
      setApplication(app);
      setOutcome(result);
      await refresh();
      notify(result.audit.resultLabel + " · " + result.audit.applicationNo);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [notify, refresh]);

  const confirmDraft = useCallback(async (draftNo: string) => {
    setBusy(true);
    try {
      const invoice = await api.confirmDraft(draftNo, "张伟");
      await refresh();
      setOutcome((prev) =>
        prev && prev.draft
          ? { ...prev, draft: { ...prev.draft, status: "confirmed", statusLabel: "已确认" } }
          : prev,
      );
      notify("已开具 " + invoice.invoiceNo + "，台账已回写。");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [notify, refresh]);

  const reset = useCallback(async () => {
    if (!window.confirm("重置本会话？草稿、开票记录、驳回台账与日志都会清空，数据集不受影响。")) return;
    try {
      await api.resetSession();
      setApplication(null);
      setOutcome(null);
      await refresh();
      notify("会话已重置。");
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }, [notify, refresh]);

  if (error) {
    return (
      <div className="boot-error">
        <div className="boot-mark">衡</div>
        <h1>桌面运行时未就绪</h1>
        <p>{error}</p>
        {!isTauri() && (
          <pre>cd desktop{"\n"}npm run tauri dev</pre>
        )}
        <button className="btn primary" onClick={() => window.location.reload()}>重新载入</button>
      </div>
    );
  }

  if (!boot) {
    return (
      <div className="boot-loading">
        <div className="boot-mark">衡</div>
        <Loading label="正在载入 175 份单据与规则字典" />
      </div>
    );
  }

  const active = view;
  const pendingCount = boot.board.filter((r) => r.status === "pending").length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">衡</div>
          <div className="brand-text">
            <strong>发票开具智能体</strong>
            <span>华衡智造 · 财务共享</span>
          </div>
        </div>

        <div className="side-section">
          <p className="side-label">业务</p>
          {PRIMARY.map((key) => {
            const item = NAV.find((n) => n.key === key)!;
            return (
              <button key={key} className={"nav-item" + (active === key ? " active" : "")} onClick={() => go(key)}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
                {key === "pending" && pendingCount > 0 && <b className="nav-badge">{pendingCount}</b>}
                {key === "audit" && outcome && <i className={"nav-dot " + outcome.audit.result} />}
              </button>
            );
          })}
        </div>

        <div className="side-section">
          <p className="side-label">支撑</p>
          {SUPPORT.map((key) => {
            const item = NAV.find((n) => n.key === key)!;
            return (
              <button key={key} className={"nav-item" + (active === key ? " active" : "")} onClick={() => go(key)}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="side-foot">
          <div className="engine-card">
            <span className="engine-dot" />
            <div>
              <strong>本地规则引擎</strong>
              <small>Rust · tax-core 1.0</small>
            </div>
          </div>
          <button className="side-link" onClick={reset}><Icon name="reset" size={14} /> 重置本会话</button>
          <p className="side-note">数据与结论均在本机处理，不上传外部服务。</p>
        </div>
      </aside>

      <div className="shell">
        <header className="topbar">
          <div className="crumbs">
            <span>P1-01 发票开具</span>
            <Icon name="chevron" size={12} />
            <strong>{VIEW_TITLE[view]}</strong>
          </div>
          <div className="top-right">
            <span className="top-chip">{boot.meta.period}</span>
            <span className="top-chip quiet">{boot.meta.case}</span>
            <span className="operator"><i>李</i> 李娜</span>
          </div>
        </header>

        <main className="content">
          {view === "dashboard" && <Dashboard boot={boot} onAudit={openAudit} go={go} />}
          {view === "flow" && <Flow boot={boot} />}
          {view === "pending" && <Pending boot={boot} onAudit={openAudit} />}
          {view === "audit" && (
            <Audit
              boot={boot}
              application={application}
              outcome={outcome}
              busy={busy}
              onRun={runAudit}
              onConfirm={confirmDraft}
              goPending={() => go("pending")}
              goDesk={() => go("desk")}
            />
          )}
          {view === "desk" && <Desk boot={boot} refresh={refresh} notify={notify} />}
          {view === "documents" && <Documents boot={boot} />}
          {view === "samples" && <Samples notify={notify} />}
          {view === "policies" && <Policies boot={boot} />}
          {view === "quality" && <Quality boot={boot} />}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={15} />
          {toast}
        </div>
      )}
    </div>
  );
}
