# 税务智能体开发

税务领域智能体（Tax Agent）开发项目。

当前交付：

- **桌面版（主）**：`desktop/`，Rust + Tauri 2 + React 19，业务内核与界面分离。
- **单文件旧版（保留参考）**：`index.html`，零依赖直接打开，用于对照旧交互与验收结果。

## 桌面版（Rust + Tauri 2 + React 19）

`desktop/` 用 Rust 重写业务内核、React 重做界面：单据分类、字段提取、六项校验、结论分级、草稿生成、编号与台账全部在 `crates/tax-core` 纯库中，Tauri 只负责命令桥和本机会话文件。175 份单据与 5 项制度通过 `include_str!` 嵌入二进制，运行时不联网、不读外部数据目录。

### 快速开始

```bash
cd desktop
npm install
npm run tauri dev
```

需要 Node.js 20+、Rust stable 与 Tauri 2 对应平台依赖（macOS 装 Xcode Command Line Tools）。只跑前端可 `npm run dev`，但页面会提示需要在 Tauri 窗口内运行。

### 校验

```bash
cd desktop
cargo fmt --all -- --check
cargo test --workspace
npm run build
```

`crates/tax-core/tests/parity.rs` 把 TC-001 / TC-002 / TC-022 与 22 条销售审核结果逐条对齐原验收报告；CI 在每次 push / PR 检查 Rust 格式、跑 tax-core 测试并构建前端。

### 目录

```
desktop/src-tauri                  Tauri 命令桥、窗口配置、会话持久化
desktop/crates/tax-core/           纯 Rust 业务内核（分类 / 提取 / 校验 / 草稿 / 台账）
desktop/crates/tax-core/tests/     parity 验收测试
desktop/src/                       React 视图与样式
```

## 旧版单文件（保留参考）

以下为旧版说明，保留用于对照原始交互与验收结果；桌面版以 `desktop/` 为准。

## 这是什么

一个用于实际业务的「发票审核 + 开票草稿生成」系统：把一叠开票申请单据变成一张可人工确认的开票草稿，中间完成识别、提取、审核、生成、回填五件事。

- **交付形态**：单文件 `index.html`，双击即开，无需安装依赖、无需服务器、无需联网。
- **界面**：左侧复刻「增值税发票开具系统」顶部一级导航 7 个页签：**业务流程**（端到端流程总览，8 节点 + 3 类异常分支）· **开票工作台**（工作台预览 / 新建开票业务 / 待开票清单 / 被驳回申请 / 发票开具 / 已开发票）· **台账单据**（单据台账 / 开票台账）· **智能审核** · **审核日志** · **制度依据** · **验收指标**；业务分组时侧栏显示该组模块，进入智能体页面时侧栏自动隐藏、内容满宽；再叠加智能体能力（智能审核工作区 / 测试示例 / 制度依据 / 审核日志 / 验收指标）。
- **被驳回申请**：审核不通过、审核暂缓、以及数据侧「暂不开票」（缺验收单等证据、控制权未转移）三类事项统一进入待处理；可查看逐项审核意见与修改建议、补充单据、修改客户/金额/产品等信息后**重新提交审核**，通过即移出并生成草稿。
- **已开发票**：独立查看本次开具的发票（与数据集历史台账分开），支持按**开票时间**（今天/近 7 天/本月/起止日期）、**客户名称**、**发票类型**、**来源**、**关键词**筛选，每行可直接「查看发票」预览图。
- **发票预览与下载**：草稿确认区与发票开具台均可「预览发票图」，支持下载 PNG（2 倍分辨率）/ SVG、打印或另存 PDF；版式按 发票模板.png 复刻（712×478），样例见 docs/发票预览示例.png。
- **内置数据**：P1-01-发票开具-勾选数据集（华衡智造 2025 年 12 月，175 张单据原件 / 175 行台账 / 4 张业务表 / 22 条用例 / 5 项企业制度）已内联进 HTML。

## 快速开始

1. 双击 `index.html`（推荐 Chrome / Edge）。
2. 顶部会提示「当前为教学测试密钥」。若要接大模型，点右上角「大模型API设置」填入服务商、模型、Key、Base URL；不配置则使用**规则引擎**，功能完整可用。
3. 左侧「新建开票业务」：点「上传单据」（跳到智能体上传区）或在 22 项快选表里点「选择并审核」→ 智能审核工作区点「执行审核」→ 查看结论与开票草稿 → 「确认开具」二次确认 → 自动回到待开票清单（该事项已移除）。

直达链接（可分享）：

| 链接 | 说明 |
|---|---|
| `index.html#demo/1` | 装配第 1 项待开票事项并立即审核（通过场景） |
| `index.html#demo/tc022` | 未验收 2 台 → 暂缓开票场景 |
| `index.html#selftest` | 浏览器全链路自检（20 项断言，结果写入隐藏节点与控制台） |
| `index.html#agent/metrics` | 验收指标与数据质量发现 |

## 审核能力

5 项核心检查 + 1 项附加校验，全部精确匹配、金额精确到分：

| 检查项 | 说明 |
|---|---|
| 抬头一致性 `check_title` | 购买方名称/纳税人识别号在申请单、合同、验收单、出库单间精确一致 |
| 税率正确性 `check_tax_rate` | 对照 `tax_rates` 字典与业务性质；税额＝不含税×税率；出口 0% 不得计列税额 |
| 金额一致性 `check_amount` | 价税合计＝不含税＋税额；验收金额与合同对应金额精确一致（不含税或含税口径均可，但须精确到分） |
| 开票范围 `check_scope` | 品名与合同标的一致、在经营范围内、出口须开出口发票、购买方已建档 |
| 日期合理性 `check_date` | 合同→验收→开票时序；未验收（控制权未转移）**暂缓开票** |
| 重复开票校验 `check_duplicate` | 同一业务不得重复开票，需先红冲再重开 |

结论三态：**通过 / 暂缓（证据不齐备）/ 不通过**。证据冲突判不通过，证据缺失判暂缓，避免误拒。

## 目录结构

```
index.html              交付物（构建产物，勿手改）
CHANGELOG.md            版本日志
useractivity.log        用户使用日志
docs/DATA_CONTRACT.md   数据契约（模块间唯一接口）
docs/验收报告.md         验收报告（9 项指标实测 + 数据质量发现 + 差异说明）
src/                    源码（engine / agent / practice / styles / boot）
tools/                  构建与测试脚本
data/                   构建产物 JSON（documents / ledger / tables / dict / policies）
input/                  原始输入（交付包与数据集解包结果，不入库）
```

## 数据更新与重新构建

```powershell
# 1. 把交付包与数据集解包到 input/交付包 与 input/数据集
# 2. 重建数据
python tools\build_data.py
python tools\parse_policies.py
python tools\data_quality.py
# 3. 跑验收（指标不退化再继续）
node tools\acceptance.mjs
node tools\smoke_practice.mjs
# 4. 打包成单文件
python tools\build.py
```

> `node` 可用 DSH 自带运行时：`C:\Users\37601\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe`

## 验收结论

9 项指标全部达标（单据分类 100%、字段提取 99.86%、来源追溯 100%、审核覆盖 100%、草稿生成 100%、日志完整 100%、误拒/漏放 0、负向用例 6/6、内嵌示例 2/2）。详见 [docs/验收报告.md](docs/验收报告.md)。

未完成/未验证项（OCR、真实大模型联调、MySQL 后端、视觉验收）已在验收报告 §五 中逐条说明。

## 开发环境

- 操作系统：Windows
- 终端：PowerShell
- 版本控制：Git（远程托管于 GitHub）
