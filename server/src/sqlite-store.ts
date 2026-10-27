/** Store 接口的 SQLite 实现。数据文件在仓库根目录 data/inflow.sqlite（已在 .gitignore 里）。 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type {
  AgentEvent, AppSettings, ApprovalItem, AuditEntry, CompanyProfile, LedgerEntry, StoreOrder, TaskOutput, WorkflowItem,
} from '@inflow/contracts';
import type { Store, TaskRecord } from '@inflow/core';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, '../../data');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  requester_id TEXT NOT NULL,
  assignee_id TEXT,
  department_id TEXT
);
CREATE TABLE IF NOT EXISTS task_outputs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_events ON task_events (task_id, ts);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  model TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_cny REAL NOT NULL,
  simulated INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS store_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store TEXT NOT NULL,
  platform TEXT NOT NULL,
  order_no TEXT NOT NULL,
  sku TEXT NOT NULL,
  revenue REAL NOT NULL,
  cogs REAL NOT NULL,           -- 采购 + 头程
  platform_fee REAL NOT NULL,   -- 平台佣金 + 支付手续费
  ad_cost REAL NOT NULL,        -- 分摊的投流费
  influencer_fee REAL NOT NULL, -- 达人佣金
  refund REAL NOT NULL,
  order_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
`;

type Row = Record<string, any>;

const toTask = (r: Row): TaskRecord => ({
  id: r.id, title: r.title, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
  requesterId: r.requester_id, assigneeId: r.assignee_id ?? undefined, departmentId: r.department_id ?? undefined,
});

const toLedger = (r: Row): LedgerEntry => ({
  id: r.id, ts: r.ts, model: r.model, agentId: r.agent_id, taskId: r.task_id,
  promptTokens: r.prompt_tokens, completionTokens: r.completion_tokens, costCny: r.cost_cny, simulated: Boolean(r.simulated),
});

export class SqliteStore implements Store {
  readonly db: Database.Database;

  constructor(file = join(DATA_DIR, 'inflow.sqlite')) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  // ---------- 任务 ----------
  insertTask(t: TaskRecord) {
    this.db
      .prepare('INSERT INTO tasks (id, title, status, created_at, updated_at, requester_id, assignee_id, department_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(t.id, t.title, t.status, t.createdAt, t.updatedAt, t.requesterId, t.assigneeId ?? null, t.departmentId ?? null);
  }
  updateTask(id: string, patch: Partial<TaskRecord>) {
    const cols: Record<string, string> = { status: 'status', updatedAt: 'updated_at', assigneeId: 'assignee_id', departmentId: 'department_id', title: 'title' };
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, col] of Object.entries(cols)) {
      const v = patch[k as keyof TaskRecord];
      if (v !== undefined) {
        sets.push(`${col} = ?`);
        vals.push(v);
      }
    }
    if (sets.length) this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  }
  getTask(id: string) {
    const r = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return r ? toTask(r) : undefined;
  }
  listTasks(limit: number) {
    return (this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?').all(limit) as Row[]).map(toTask);
  }
  insertOutput(taskId: string, o: TaskOutput) {
    this.db
      .prepare('INSERT INTO task_outputs (id, task_id, type, title, content, created_at) VALUES (?,?,?,?,?,?)')
      .run(o.id, taskId, o.type, o.title, o.content, o.createdAt);
  }
  listOutputs(taskId: string) {
    return (this.db.prepare('SELECT * FROM task_outputs WHERE task_id = ? ORDER BY created_at, rowid').all(taskId) as Row[]).map(
      (r): TaskOutput => ({ id: r.id, type: r.type, title: r.title, content: r.content, createdAt: r.created_at })
    );
  }
  insertEvent(ev: AgentEvent) {
    this.db.prepare('INSERT INTO task_events (id, task_id, ts, json) VALUES (?,?,?,?)').run(ev.id, ev.taskId, ev.ts, JSON.stringify(ev));
  }
  listEvents(taskId: string) {
    return (this.db.prepare('SELECT json FROM task_events WHERE task_id = ? ORDER BY ts, rowid').all(taskId) as Row[]).map((r) => JSON.parse(r.json) as AgentEvent);
  }

  // ---------- 账本 ----------
  insertLedger(e: Omit<LedgerEntry, 'id'>) {
    const info = this.db
      .prepare('INSERT INTO ledger (ts, model, agent_id, task_id, prompt_tokens, completion_tokens, cost_cny, simulated) VALUES (?,?,?,?,?,?,?,?)')
      .run(e.ts, e.model, e.agentId, e.taskId, e.promptTokens, e.completionTokens, e.costCny, e.simulated ? 1 : 0);
    return { ...e, id: Number(info.lastInsertRowid) };
  }
  listLedger() {
    return (this.db.prepare('SELECT * FROM ledger ORDER BY id').all() as Row[]).map(toLedger);
  }

  // ---------- 订单 ----------
  listOrders() {
    return (this.db.prepare('SELECT * FROM store_orders ORDER BY id').all() as Row[]).map(
      (r): StoreOrder => ({
        store: r.store, platform: r.platform, orderNo: r.order_no, sku: r.sku, revenue: r.revenue, cogs: r.cogs,
        platformFee: r.platform_fee, adCost: r.ad_cost, influencerFee: r.influencer_fee, refund: r.refund, orderDate: r.order_date,
      })
    );
  }
  replaceOrders(orders: StoreOrder[]) {
    const insert = this.db.prepare(
      'INSERT INTO store_orders (store, platform, order_no, sku, revenue, cogs, platform_fee, ad_cost, influencer_fee, refund, order_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    );
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM store_orders').run();
      for (const o of orders) {
        insert.run(o.store, o.platform, o.orderNo, o.sku, o.revenue, o.cogs, o.platformFee, o.adCost, o.influencerFee, o.refund, o.orderDate);
      }
    })();
  }

  // ---------- 工作流 ----------
  listWorkflows() {
    return (this.db.prepare('SELECT json FROM workflows ORDER BY sort').all() as Row[]).map((r) => JSON.parse(r.json) as WorkflowItem);
  }
  replaceWorkflows(items: WorkflowItem[]) {
    const insert = this.db.prepare('INSERT INTO workflows (id, sort, json) VALUES (?,?,?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM workflows').run();
      items.forEach((w, i) => insert.run(w.id, i, JSON.stringify(w)));
    })();
  }
  updateWorkflow(id: string, patch: Partial<WorkflowItem>) {
    const r = this.db.prepare('SELECT json FROM workflows WHERE id = ?').get(id) as Row | undefined;
    if (r) this.db.prepare('UPDATE workflows SET json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(r.json), ...patch }), id);
  }

  // ---------- 审批 ----------
  insertApproval(a: ApprovalItem) {
    this.db.prepare('INSERT INTO approvals (id, task_id, created_at, json) VALUES (?,?,?,?)').run(a.id, a.taskId, a.createdAt, JSON.stringify(a));
  }
  updateApproval(id: string, patch: Partial<ApprovalItem>) {
    const a = this.getApproval(id);
    if (a) this.db.prepare('UPDATE approvals SET json = ? WHERE id = ?').run(JSON.stringify({ ...a, ...patch }), id);
  }
  getApproval(id: string) {
    const r = this.db.prepare('SELECT json FROM approvals WHERE id = ?').get(id) as Row | undefined;
    return r ? (JSON.parse(r.json) as ApprovalItem) : undefined;
  }
  listApprovals() {
    return (this.db.prepare('SELECT json FROM approvals ORDER BY created_at DESC, rowid DESC').all() as Row[]).map((r) => JSON.parse(r.json) as ApprovalItem);
  }

  // ---------- 留痕 ----------
  insertAudit(e: Omit<AuditEntry, 'id'>) {
    const info = this.db.prepare('INSERT INTO audit (ts, actor, action, target, detail) VALUES (?,?,?,?,?)').run(e.ts, e.actor, e.action, e.target, e.detail);
    return { ...e, id: Number(info.lastInsertRowid) };
  }
  listAudit(limit: number) {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit) as AuditEntry[];
  }

  // ---------- 档案与设置 ----------
  private getKv<T>(key: string): T | null {
    const r = this.db.prepare('SELECT json FROM kv WHERE key = ?').get(key) as Row | undefined;
    return r ? (JSON.parse(r.json) as T) : null;
  }
  private setKv(key: string, value: unknown) {
    if (value === null) this.db.prepare('DELETE FROM kv WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO kv (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(key, JSON.stringify(value));
  }
  getProfile() {
    return this.getKv<CompanyProfile>('company_profile');
  }
  setProfile(p: CompanyProfile | null) {
    this.setKv('company_profile', p);
  }
  getSettings() {
    return this.getKv<Partial<AppSettings>>('settings');
  }
  setSettings(s: AppSettings | null) {
    this.setKv('settings', s);
  }

  resetRuntime() {
    this.db.exec('DELETE FROM tasks; DELETE FROM task_outputs; DELETE FROM task_events; DELETE FROM ledger; DELETE FROM approvals; DELETE FROM audit;');
  }
}
