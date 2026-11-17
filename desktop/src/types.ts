export interface Meta {
  case: string;
  period: string;
  company: string;
  selfTaxNo: string;
  project: string;
  dataset: string;
  docCount: number;
  tableCount: number;
  caseCount: number;
  generatedAt: string;
}

export interface KpiRow {
  no: number;
  item: string;
  value: string;
  unit: string;
  note: string;
}

export interface Stats {
  documents: number;
  invoices: number;
  contracts: number;
  acceptances: number;
  sales: number;
  cases: number;
  policies: number;
  salesTotal: number;
  salesTotalText: string;
}

export interface Customer {
  name: string;
  taxNo: string;
  region: string;
  note?: string;
}

export interface ScopeItem {
  product: string;
  category: string;
  unit: string;
  note?: string;
}

export interface DocTypeDef {
  name: string;
  role: string;
  auditRequired: boolean;
  evidence: string[];
  count: number;
}

export interface Dict {
  taxRates: { rate: string; label: string; scope: string; note?: string }[];
  customers: Customer[];
  scope: ScopeItem[];
  docTypes: DocTypeDef[];
  fieldDefs: unknown[];
}

export interface PolicyClause {
  no: string;
  title: string;
  text: string;
  loc: string;
}

export interface Policy {
  id: string;
  file: string;
  name: string;
  dept: string;
  rules: string[];
  note?: string;
  clauses: PolicyClause[];
}

export interface MetricRow {
  name: string;
  value: string;
  target: string;
  pass: boolean;
}

export interface Acceptance {
  generatedAt: string;
  allPass: boolean;
  metrics: MetricRow[];
  details: {
    classification: { total: number; ok: number };
    fieldExtraction: { total: number; ok: number };
    traceability: { allFields: number; locFields: number };
    applications: unknown[];
  };
}

export interface DataQuality {
  docCount: number;
  ledgerCount: number;
  reconcile: { exceptions: number; parseWarnings: number };
  findings: { level: string; title: string; count: number; detail: string }[];
}

export interface Item {
  name: string;
  spec: string;
  unit: string;
  qty?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  taxRate?: string | null;
  taxAmount?: number | null;
  extra?: Record<string, unknown>;
  loc: string;
}

export interface Field {
  key?: string | null;
  label: string;
  value: unknown;
  loc?: string | null;
  fieldSource?: string | null;
}

export interface Document {
  idx?: number;
  id: string;
  file: string;
  docType: string;
  title: string;
  docTypeRaw: string;
  docDate: string;
  party: string;
  partyRole: string;
  partyTaxNo?: string | null;
  selfName: string;
  selfTaxNo: string;
  amountExTax?: number | null;
  taxAmount?: number | null;
  amountTotal?: number | null;
  amountInWords?: string | null;
  taxRate?: string | null;
  invoiceCode?: string | null;
  invoiceNo?: string | null;
  checkCode?: string | null;
  contractNo?: string | null;
  remark?: string | null;
  items: Item[];
  fields: Field[];
}

export interface Evidence {
  docId: string;
  docType: string;
  docDate: string;
  field: string;
  value: string;
  loc: string;
}

export interface Check {
  key: string;
  name: string;
  desc: string;
  match: string;
  rule: string;
  status: "pass" | "fail" | "warn" | "suspend";
  conclusion: string;
  evidence: Evidence[];
  advice?: string;
  diff?: { left: string; right: string; gap: number };
}

export interface Party {
  name: string;
  taxNo: string;
}

export interface DraftItem {
  name: string;
  spec: string;
  unit: string;
  qty?: number | null;
  unitPrice?: number | null;
  amount?: number | null;
  taxRate: string;
  taxAmount?: number | null;
  loc: string;
}

export interface DraftSource {
  label: string;
  docId: string;
  docType: string;
  field: string;
  value: string;
  loc: string;
}

export interface Draft {
  draftNo: string;
  invoiceType: string;
  buyer: Party;
  seller: Party;
  amountExTax: number;
  taxRate: string;
  taxAmount: number;
  amountTotal: number;
  items: DraftItem[];
  remark: string;
  highlights: string[];
  commonErrors: { level: string; check: string; text: string; advice: string }[];
  sources: DraftSource[];
  createdAt: string;
  status: string;
  statusLabel: string;
  contractId: string;
  acceptanceId: string;
  applicationNo: string;
}

export interface AuditResult {
  applicationNo: string;
  auditedAt: string;
  operator: string;
  applicant: string;
  result: "pass" | "fail" | "suspend";
  resultLabel: string;
  riskLevel: string;
  checks: Check[];
  evidenceTable: {
    check: string;
    checkKey: string;
    checkStatus: string;
    docId: string;
    docType: string;
    field: string;
    value: string;
    loc: string;
  }[];
  ruleMode: string;
  summary: string;
  documents: {
    id: string;
    docType: string;
    classified: string;
    confidence: number;
    reason: string;
    docDate: string;
    party: string;
    amount?: number | null;
  }[];
}

export interface AuditOutcome {
  audit: AuditResult;
  draft?: Draft;
}

export interface Application {
  applicationNo: string;
  applicant: string;
  applyDate: string;
  region: string;
  declaredAmount?: number | null;
  declaredCustomer: string;
  customer: string;
  product: string;
  source: string;
  documents: Document[];
}

export interface IssuedInvoice {
  id: string;
  invoiceNo: string;
  invoiceType: string;
  buyerName: string;
  buyerTaxNo: string;
  goods: string;
  amountTotal: number;
  taxRate: string;
  issuedAt: string;
  contractId: string;
  source: string;
  poolKind: string;
}

export interface LogEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

export interface RejectedRecord {
  id: string;
  applicationNo: string;
  buyer: string;
  product: string;
  amountTotal?: number | null;
  result: string;
  summary: string;
  auditedAt: string;
  checks: Check[];
  application: Application;
}

export interface SessionState {
  drafts: Draft[];
  invoices: IssuedInvoice[];
  rejected: RejectedRecord[];
  logs: LogEntry[];
  seq: { invoice: number; draft: number };
}

export interface BoardRow {
  index: number;
  product: string;
  date: string;
  customer: string;
  qty?: number | null;
  unitPrice?: number | null;
  amount: number;
  gross: number;
  region: string;
  contractNo: string;
  acceptStatus: string;
  status: "pending" | "suspended" | "issued" | "draft";
  statusLabel: string;
  invoiceNo: string;
  draftNo: string;
  issueSource: string;
}

export interface Bootstrap {
  meta: Meta;
  kpi: KpiRow[];
  stats: Stats;
  dict: Dict;
  policies: Policy[];
  acceptance: Acceptance;
  dataQuality: DataQuality;
  checks: { key: string; name: string; desc: string; rule: string }[];
  session: SessionState;
  board: BoardRow[];
}
