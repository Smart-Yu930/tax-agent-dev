export type ViewKey =
  | "dashboard"
  | "flow"
  | "pending"
  | "audit"
  | "desk"
  | "documents"
  | "samples"
  | "policies"
  | "quality";

export const NAV: { key: ViewKey; label: string; icon: string; desc: string }[] = [
  { key: "dashboard", label: "工作台", icon: "dashboard", desc: "本期开票任务总览" },
  { key: "flow", label: "业务流程", icon: "flow", desc: "开票审核全链路" },
  { key: "pending", label: "待开票清单", icon: "pending", desc: "22 项销售待开票" },
  { key: "audit", label: "开票审核", icon: "audit", desc: "六项规则智能校验" },
  { key: "desk", label: "开票台", icon: "desk", desc: "人工复核与开具" },
  { key: "documents", label: "单据库", icon: "docs", desc: "175 份业务单据" },
  { key: "samples", label: "发票样本", icon: "sample", desc: "历史发票版式" },
  { key: "policies", label: "制度依据", icon: "policy", desc: "5 项制度 42 条条款" },
  { key: "quality", label: "数据质量", icon: "quality", desc: "验收指标与数据体检" },
];

export const VIEW_TITLE: Record<ViewKey, string> = {
  dashboard: "工作台",
  flow: "业务流程",
  pending: "待开票清单",
  audit: "开票审核",
  desk: "开票台",
  documents: "单据库",
  samples: "发票样本",
  policies: "制度依据",
  quality: "数据质量",
};
