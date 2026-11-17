import { invoke } from "@tauri-apps/api/core";
import type {
  Application,
  AuditOutcome,
  Bootstrap,
  Document,
  Draft,
  IssuedInvoice,
  SessionState,
} from "./types";

export const isTauri = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("当前页面需要在 Tauri 桌面窗口内运行（npm run tauri dev）。");
  }
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new Error(typeof error === "string" ? error : error instanceof Error ? error.message : String(error));
  }
}

export interface DocumentPage {
  total: number;
  page: number;
  pageSize: number;
  pages: number;
  items: Document[];
}

export const api = {
  bootstrap: () => call<Bootstrap>("bootstrap"),
  documents: (docType = "", keyword = "", page = 1, pageSize = 18) =>
    call<DocumentPage>("documents", { docType, keyword, page, pageSize }),
  document: (id: string) => call<Document | null>("document", { id }),
  pendingApplication: (index: number) => call<Application>("pending_application", { index }),
  runAudit: (application: Application, operator = "李娜") =>
    call<AuditOutcome>("run_audit", { application, operator }),
  confirmDraft: (draftNo: string, operator = "张伟") =>
    call<IssuedInvoice>("confirm_draft", { draftNo, operator }),
  issueInvoice: (form: Record<string, unknown>, operator = "张伟") =>
    call<IssuedInvoice>("issue_invoice", { form, operator }),
  syncHistory: () => call<number>("sync_history"),
  resetSession: () => call<SessionState>("reset_session"),
  policies: () => call<unknown[]>("policies"),
  cases: () => call<unknown[]>("cases"),
  invoiceSamples: () => call<Document[]>("invoice_samples"),
  drafts: () => call<Draft[]>("drafts"),
};
