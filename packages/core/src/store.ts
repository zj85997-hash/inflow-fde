/**
 * 存储接口。服务端用 SQLite 实现（server/src/sqlite-store.ts），
 * 浏览器演示和测试用下面的 MemoryStore。编排核心只认这个接口。
 */
import type {
  AgentEvent, AppSettings, ApprovalItem, AuditEntry, CompanyProfile, LedgerEntry, StoreOrder, Task, TaskOutput, WorkflowItem,
} from '@inflow/contracts';

export type TaskRecord = Omit<Task, 'outputs' | 'parentTaskId'>;

export interface Store {
  insertTask(t: TaskRecord): void;
  updateTask(id: string, patch: Partial<TaskRecord>): void;
  getTask(id: string): TaskRecord | undefined;
  /** 新的在前 */
  listTasks(limit: number): TaskRecord[];
  insertOutput(taskId: string, o: TaskOutput): void;
  listOutputs(taskId: string): TaskOutput[];
  /** 只存关键事件（不存逐字流），用来回放历史任务 */
  insertEvent(ev: AgentEvent): void;
  listEvents(taskId: string): AgentEvent[];

  insertLedger(e: Omit<LedgerEntry, 'id'>): LedgerEntry;
  /** 全部记录，旧的在前 */
  listLedger(): LedgerEntry[];

  listOrders(): StoreOrder[];
  replaceOrders(orders: StoreOrder[]): void;

  listWorkflows(): WorkflowItem[];
  replaceWorkflows(items: WorkflowItem[]): void;
  updateWorkflow(id: string, patch: Partial<WorkflowItem>): void;

  insertApproval(a: ApprovalItem): void;
  updateApproval(id: string, patch: Partial<ApprovalItem>): void;
  getApproval(id: string): ApprovalItem | undefined;
  /** 新的在前 */
  listApprovals(): ApprovalItem[];

  insertAudit(e: Omit<AuditEntry, 'id'>): AuditEntry;
  /** 新的在前 */
  listAudit(limit: number): AuditEntry[];

  getProfile(): CompanyProfile | null;
  setProfile(p: CompanyProfile | null): void;
  getSettings(): Partial<AppSettings> | null;
  setSettings(s: AppSettings | null): void;

  /** 清空任务、账本、审批、留痕（演示重置用；订单数据保留） */
  resetRuntime(): void;
}

export interface MemorySnapshot {
  v: 1;
  tasks: TaskRecord[];
  outputs: Record<string, TaskOutput[]>;
  events: Record<string, AgentEvent[]>;
  ledger: LedgerEntry[];
  workflows: WorkflowItem[];
  approvals: ApprovalItem[];
  audit: AuditEntry[];
  profile: CompanyProfile | null;
  settings: Partial<AppSettings> | null;
}

/** 内存实现，可导出快照（浏览器存进 localStorage）。订单不进快照，启动时按固定种子重新生成。 */
export class MemoryStore implements Store {
  private tasks: TaskRecord[] = [];
  private outputs = new Map<string, TaskOutput[]>();
  private events = new Map<string, AgentEvent[]>();
  private ledger: LedgerEntry[] = [];
  private orders: StoreOrder[] = [];
  private workflows: WorkflowItem[] = [];
  private approvals: ApprovalItem[] = [];
  private audit: AuditEntry[] = [];
  private profile: CompanyProfile | null = null;
  private settings: Partial<AppSettings> | null = null;
  /** 每次写入后调用（浏览器用它做防抖持久化） */
  onChange?: () => void;

  constructor(snapshot?: MemorySnapshot | null) {
    if (snapshot?.v === 1) {
      this.tasks = snapshot.tasks ?? [];
      this.outputs = new Map(Object.entries(snapshot.outputs ?? {}));
      this.events = new Map(Object.entries(snapshot.events ?? {}));
      this.ledger = snapshot.ledger ?? [];
      this.workflows = snapshot.workflows ?? [];
      this.approvals = snapshot.approvals ?? [];
      this.audit = snapshot.audit ?? [];
      this.profile = snapshot.profile ?? null;
      this.settings = snapshot.settings ?? null;
    }
  }

  private changed() {
    this.onChange?.();
  }

  /** 只保留最近 50 个任务及其产出，账本 500 条、留痕 300 条，避免 localStorage 撑爆 */
  snapshot(): MemorySnapshot {
    const tasks = this.tasks.slice(0, 50);
    const keep = new Set(tasks.map((t) => t.id));
    const pick = <T>(m: Map<string, T[]>) => Object.fromEntries([...m.entries()].filter(([k]) => keep.has(k)));
    return {
      v: 1,
      tasks,
      outputs: pick(this.outputs),
      events: pick(this.events),
      ledger: this.ledger.slice(-500),
      workflows: this.workflows,
      approvals: this.approvals.slice(0, 200),
      audit: this.audit.slice(0, 300),
      profile: this.profile,
      settings: this.settings,
    };
  }

  insertTask(t: TaskRecord) {
    this.tasks.unshift({ ...t });
    this.changed();
  }
  updateTask(id: string, patch: Partial<TaskRecord>) {
    const t = this.tasks.find((x) => x.id === id);
    if (t) Object.assign(t, patch);
    this.changed();
  }
  getTask(id: string) {
    return this.tasks.find((x) => x.id === id);
  }
  listTasks(limit: number) {
    return this.tasks.slice(0, limit);
  }
  insertOutput(taskId: string, o: TaskOutput) {
    this.outputs.set(taskId, [...(this.outputs.get(taskId) ?? []), o]);
    this.changed();
  }
  listOutputs(taskId: string) {
    return this.outputs.get(taskId) ?? [];
  }
  insertEvent(ev: AgentEvent) {
    this.events.set(ev.taskId, [...(this.events.get(ev.taskId) ?? []), ev]);
    this.changed();
  }
  listEvents(taskId: string) {
    return this.events.get(taskId) ?? [];
  }

  insertLedger(e: Omit<LedgerEntry, 'id'>) {
    const entry: LedgerEntry = { ...e, id: (this.ledger[this.ledger.length - 1]?.id ?? 0) + 1 };
    this.ledger.push(entry);
    this.changed();
    return entry;
  }
  listLedger() {
    return this.ledger;
  }

  listOrders() {
    return this.orders;
  }
  replaceOrders(orders: StoreOrder[]) {
    this.orders = orders;
  }

  listWorkflows() {
    return this.workflows;
  }
  replaceWorkflows(items: WorkflowItem[]) {
    this.workflows = items.map((w) => ({ ...w }));
    this.changed();
  }
  updateWorkflow(id: string, patch: Partial<WorkflowItem>) {
    const w = this.workflows.find((x) => x.id === id);
    if (w) Object.assign(w, patch);
    this.changed();
  }

  insertApproval(a: ApprovalItem) {
    this.approvals.unshift({ ...a });
    this.changed();
  }
  updateApproval(id: string, patch: Partial<ApprovalItem>) {
    const a = this.approvals.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
    this.changed();
  }
  getApproval(id: string) {
    return this.approvals.find((x) => x.id === id);
  }
  listApprovals() {
    return this.approvals;
  }

  insertAudit(e: Omit<AuditEntry, 'id'>) {
    const entry: AuditEntry = { ...e, id: (this.audit[0]?.id ?? 0) + 1 };
    this.audit.unshift(entry);
    this.changed();
    return entry;
  }
  listAudit(limit: number) {
    return this.audit.slice(0, limit);
  }

  getProfile() {
    return this.profile;
  }
  setProfile(p: CompanyProfile | null) {
    this.profile = p;
    this.changed();
  }
  getSettings() {
    return this.settings;
  }
  setSettings(s: AppSettings | null) {
    this.settings = s;
    this.changed();
  }

  resetRuntime() {
    this.tasks = [];
    this.outputs.clear();
    this.events.clear();
    this.ledger = [];
    this.approvals = [];
    this.audit = [];
    this.changed();
  }
}
