/**
 * @inflow/contracts — 全项目共享的类型与事件协议。
 * 前端、服务端、网关、编排核心都只依赖这里，保证解耦并行开发。
 */

// ---------- 组织模型 ----------

export type AgentKind = 'main' | 'department' | 'employee';
export type EmployeeType = 'human' | 'digital';

export interface AgentProfile {
  id: string;
  kind: AgentKind;
  name: string;
  /** 头衔/职责一句话，展示在头像下方 */
  title: string;
  avatar: string; // emoji 或图片路径
  departmentId?: string; // employee/department 归属
  employeeType?: EmployeeType; // kind=employee 时有效
  /** 系统提示词（数字员工/部门/主 agent 的人格与职责） */
  systemPrompt?: string;
  /** 可用技能 id 列表 */
  skills?: string[];
  /** 可用连接器 id 列表 */
  connectors?: string[];
}

export interface Department {
  id: string;
  name: string;
  icon: string;
  /** 部门指标卡（演示用） */
  metrics: { label: string; value: string; trend?: 'up' | 'down' | 'flat' }[];
}

/** 团队协作模式（对齐 Accio：群聊模式 / 调度模式） */
export type TeamMode = 'group-chat' | 'dispatch';

// ---------- 任务与会话 ----------

export type TaskStatus =
  | 'created'
  | 'assigned'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  /** 发起者（用户或上级 agent） */
  requesterId: string;
  /** 当前负责的 agent */
  assigneeId?: string;
  departmentId?: string;
  parentTaskId?: string;
  /** 任务产出物 */
  outputs: TaskOutput[];
}

export interface TaskOutput {
  id: string;
  type: 'markdown' | 'table' | 'file' | 'memory';
  title: string;
  /** markdown 正文或文件相对路径 */
  content: string;
  createdAt: number;
}

// ---------- 事件协议（编排器 → WebSocket → 前端） ----------

export type AgentEventType =
  | 'task_created'
  | 'task_assigned'
  | 'session_started'
  | 'session_progress' // 增量 token / 阶段说明
  | 'output_produced'
  | 'approval_required'
  | 'approval_decided'
  | 'task_completed'
  | 'task_failed'
  | 'ledger_updated';

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  ts: number;
  taskId: string;
  agentId?: string;
  /** session_progress 的增量文本；其他事件的说明 */
  message?: string;
  output?: TaskOutput;
  ledger?: LedgerEntry;
  approval?: ApprovalItem;
}

// ---------- 成本账本 ----------

export interface LedgerEntry {
  id: number;
  ts: number;
  model: string;
  agentId: string;
  taskId: string;
  promptTokens: number;
  completionTokens: number;
  costCny: number;
  /** 离线演示模型的调用：token 为估算，金额按真实价目模拟 */
  simulated?: boolean;
}

export interface LedgerSummary {
  totalCny: number;
  totalCalls: number;
  simulatedCalls: number;
  spentTodayCny: number;
  dailyBudgetCny: number;
  byAgent: { agentId: string; name: string; department: string; costCny: number; calls: number }[];
  byModel: { model: string; costCny: number; calls: number }[];
}

// ---------- 模型网关 ----------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AdapterInfo {
  id: string; // demo | deepseek | codex | claude-code | proxy
  name: string;
  /** ready=可用；needs_key=界面显示「配置后启用」 */
  status: 'ready' | 'needs_key' | 'coming_soon';
  models: string[];
  /** 获取 Key 的引导链接 */
  keyUrl?: string;
}

// ---------- 插件生态 ----------

export interface PluginManifest {
  id: string;
  name: string;
  vendor: string; // 官方 / @作者
  industry: string; // cross-border-ecommerce | finance | indie-site | general
  description: string;
  icon: string;
  skills: SkillDef[];
  connectors: ConnectorDef[];
  /** 场景快捷入口（新任务页底部） */
  quickActions: { label: string; prompt: string }[];
  /** 定时任务模板 */
  scheduleTemplates: { icon: string; name: string; description: string; category: string }[];
}

export interface SkillDef {
  id: string;
  name: string;
  category: string; // 数据分析与财务 / 内容创作与营销 / ...
  description: string;
  /** 技能=提示词+流程+验收标准 */
  prompt: string;
}

export type ConnectorStatus = 'connected' | 'not_connected' | 'coming_soon' | 'auth_pending';

export interface ConnectorDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  status: ConnectorStatus;
  /** already_available=已有接口（agent 协助接入）；diy=非现成（DIY 配置） */
  onboarding: 'already_available' | 'diy';
}

// ---------- Onboard 与方案对比 ----------

export interface CompanyProfile {
  name: string;
  industry: string;
  revenueRange: string;
  headcount: number;
  opsModel: string; // 运营模式描述
  workflows: string[]; // 现有工作流描述
  people: string[]; // 涉及人员/岗位
  dataStorage: ('local' | 'cloud' | 'private' | 'saas')[];
  existingSystems: string[];
}

export interface ComparisonPlan {
  current: { title: string; points: string[]; pros: string[]; cons: string[] };
  optimized: { title: string; points: string[]; pros: string[]; cons: string[] };
  efficiencyGain: string; // 提效估值描述
  priceCny: number; // mock 定价 68888
}

// ---------- 工作流管理 ----------

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  owner: string; // 岗位
  /** AI 标注：可重复/机械程度 0-100 */
  repeatScore?: number;
  aiSuggestion?: string;
  status: 'manual' | 'analyzed' | 'agent_ready' | 'agent_running';
}

// ---------- 审批收件箱（AI 出建议，人拍板） ----------

export type ApprovalKind = 'refund' | 'budget' | 'settlement' | 'price';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalItem {
  id: string;
  taskId: string;
  /** 提出建议的数字员工 */
  agentId: string;
  kind: ApprovalKind;
  title: string;
  /** 依据：由代码从业务数据算出，不是模型编的 */
  reason: string;
  /** 涉及金额（元） */
  amountCny?: number;
  risk: 'low' | 'medium' | 'high';
  status: ApprovalStatus;
  createdAt: number;
  decidedAt?: number;
  /** 审批人备注 */
  note?: string;
}

// ---------- 操作留痕 ----------

export interface AuditEntry {
  id: number;
  ts: number;
  /** user | system | agent id */
  actor: string;
  /** 例如 approval.approved、settings.updated、workflow.adopted */
  action: string;
  target: string;
  detail: string;
}

// ---------- 设置 ----------

/** auto：有 Key 用 DeepSeek，没有就用离线演示模型 */
export type ModelMode = 'auto' | 'demo' | 'deepseek';

export interface AppSettings {
  mode: ModelMode;
  model: string;
  /** 每日预算（元），超出后网关拒绝新的调用 */
  dailyBudgetCny: number;
  maxTokensPerCall: number;
  /** 每百万 token 的价格（元），按官方最新价目表填写 */
  pricing: Record<string, { input: number; output: number }>;
  /** 已启用的定时任务模板名 */
  enabledSchedules: string[];
}

export interface AppStatus {
  mode: ModelMode;
  /** 实际在用的适配器 */
  activeAdapter: 'demo' | 'deepseek';
  keyConfigured: boolean;
  /** 在线静态演示：只能用离线演示模型 */
  staticDemo: boolean;
  pendingApprovals: number;
  spentTodayCny: number;
  dailyBudgetCny: number;
  dataRange: string;
}

// ---------- 演示数据 ----------

export interface StoreOrder {
  store: string;
  platform: string;
  orderNo: string;
  sku: string;
  revenue: number;
  /** 采购 + 头程 */
  cogs: number;
  /** 平台佣金 + 支付手续费 */
  platformFee: number;
  /** 分摊的投流费 */
  adCost: number;
  /** 达人佣金 */
  influencerFee: number;
  refund: number;
  orderDate: string;
}
