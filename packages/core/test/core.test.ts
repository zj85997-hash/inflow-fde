import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, ApprovalItem, AuditEntry, LedgerSummary, TaskOutput } from '@inflow/contracts';
import { DemoAdapter, GatewayError, ModelGateway, estimateCostCny } from '@inflow/gateway';
import {
  BUILTIN_PLUGINS, MemoryStore, createApp, generateOrders, losingOrders, netOf, pickSku, profitIntent, routeByKeyword,
  scoreWorkflow, summarizeStores, totalOf, worstStore, type TaskRecord,
} from '../src/index';

function makeApp(opts: { staticDemo?: boolean } = {}) {
  const app = createApp({ store: new MemoryStore(), plugins: () => BUILTIN_PLUGINS, paceMs: 0, streamDelayMs: 0, ...opts });
  app.ensureDemoData();
  return app;
}

async function call<T>(app: ReturnType<typeof makeApp>, method: 'GET' | 'POST', url: string, body?: unknown) {
  const r = await app.api.handle(method, url, body);
  return r as { status: number; body: T };
}

async function runTask(app: ReturnType<typeof makeApp>, prompt: string, agentId?: string) {
  const events: AgentEvent[] = [];
  const off = app.bus.on((e) => events.push(e));
  const r = await call<TaskRecord>(app, 'POST', '/api/tasks', { prompt, agentId });
  assert.equal(r.status, 200);
  await app.orchestrator.waitFor(r.body.id);
  off();
  return { task: app.store.getTask(r.body.id)!, events, outputs: app.store.listOutputs(r.body.id) };
}

// ---------------- 演示数据与算数 ----------------

test('演示数据固定：408 笔订单，两次生成完全一样', () => {
  const a = generateOrders();
  assert.equal(a.length, 408);
  assert.deepEqual(a, generateOrders());
});

test('利润按订单逐笔加总，拾光饰品毛利最高却在亏钱', () => {
  const orders = generateOrders();
  const stores = summarizeStores(orders);
  assert.deepEqual(stores.map((s) => s.store), ['星尘家居', '曜石数码', '拾光饰品']);
  const total = totalOf(stores);
  const byHand = orders.reduce((n, o) => n + netOf(o), 0);
  assert.ok(Math.abs(total.netProfit - byHand) < 1e-6);
  const worst = worstStore(stores);
  assert.equal(worst.store, '拾光饰品');
  assert.ok(worst.netProfit < 0, '拾光饰品净利应为负');
  assert.ok(worst.cogs / worst.revenue < Math.min(...stores.filter((s) => s !== worst).map((s) => s.cogs / s.revenue)));
  assert.equal(losingOrders(orders, 3).length, 3);
  assert.ok(losingOrders(orders, 1)[0].netProfit < 0);
});

test('关键词路由与意图识别', () => {
  assert.equal(routeByKeyword('帮我汇总三个店铺本月的真实利润'), 'finance');
  assert.equal(routeByKeyword('分析本周广告数据，判断是素材问题还是出价问题'), 'growth');
  assert.equal(routeByKeyword('客户说物流太慢要求退款，帮我草拟一条回复'), 'service');
  assert.equal(routeByKeyword('检查 ACC-RING-01 的商品卡能不能上架'), 'ops');
  assert.equal(routeByKeyword('你好'), undefined);
  assert.equal(profitIntent('核对达人结算单'), 'settlement');
  assert.equal(profitIntent('找出本月疑似亏损的订单'), 'losses');
  assert.equal(profitIntent('汇总利润，指出哪个店在亏钱'), 'summary');
  assert.equal(pickSku('看看 acc-ring-01', generateOrders()).sku, 'ACC-RING-01');
});

test('工作流打分：机械重复的高分，讨论决策的低分', () => {
  assert.ok(scoreWorkflow({ name: '每日三店销售数据汇总', description: '每天导出订单，手工合并到 Excel' }).score >= 70);
  const meeting = scoreWorkflow({ name: '新品选品会', description: '每月一次，讨论下季度新品方向' });
  assert.ok(meeting.score < 40);
  assert.match(meeting.suggestion, /保留给人/);
});

// ---------------- 网关 ----------------

test('离线演示模型：按块流式吐出稿子，标记为模拟', async () => {
  const chunks: string[] = [];
  const r = await new DemoAdapter(0, 5).chat([{ role: 'user', content: '你好' }], {
    attribution: { agentId: 'a', taskId: 't' }, draft: '一二三四五六七八九十', onDelta: (t) => chunks.push(t),
  });
  assert.deepEqual(chunks, ['一二三四五', '六七八九十']);
  assert.equal(r.content, '一二三四五六七八九十');
  assert.equal(r.simulated, true);
  assert.ok(r.usage.completionTokens > 0);
  assert.equal(estimateCostCny('deepseek-chat', { promptTokens: 1_000_000, completionTokens: 1_000_000 }), 10);
});

test('预算护栏：今日花费到上限后拒绝调用', async () => {
  const gw = new ModelGateway({
    getSettings: () => ({ mode: 'demo', model: 'deepseek-chat', dailyBudgetCny: 1, maxTokensPerCall: 1000, pricing: { 'deepseek-chat': { input: 2, output: 8 } } }),
    getSpentToday: () => 1,
  });
  await assert.rejects(
    gw.chat([{ role: 'user', content: 'x' }], { attribution: { agentId: 'a', taskId: 't' }, draft: 'y' }),
    (e: unknown) => e instanceof GatewayError && e.code === 'budget_exceeded'
  );
});

test('没配 Key 时 auto 模式走离线演示模型，deepseek 模式提示配置', async () => {
  const gw = new ModelGateway({ getSettings: () => ({ mode: 'deepseek', model: 'deepseek-chat', dailyBudgetCny: 5, maxTokensPerCall: 1000, pricing: {} }) });
  assert.equal(gw.activeAdapter(), 'deepseek');
  await assert.rejects(gw.chat([{ role: 'user', content: 'x' }], { attribution: { agentId: 'a', taskId: 't' } }), /DEEPSEEK_API_KEY/);
  assert.equal(new ModelGateway({}).activeAdapter(), 'demo');
  assert.equal(new ModelGateway({ deepseekApiKey: 'k', demoOnly: true }).activeAdapter(), 'demo');
});

// ---------------- 完整任务流 ----------------

test('利润任务：三层分发 → 报告 → 结算审批 → 人批准后完成', async () => {
  const app = makeApp();
  const { task, events, outputs } = await runTask(app, '帮我汇总三个店铺本月的真实利润，指出哪个店在亏钱、亏在哪里');
  const flow = events.filter((e) => e.type !== 'session_progress' && e.type !== 'ledger_updated').map((e) => `${e.type}:${e.agentId ?? ''}`);
  assert.deepEqual(flow, [
    'task_created:',
    'session_started:main',
    'task_assigned:dept-finance',
    'task_assigned:emp-profit',
    'session_started:emp-profit',
    'output_produced:emp-profit',
    'output_produced:emp-profit',
    'approval_required:emp-profit',
  ]);
  assert.ok(events.some((e) => e.type === 'session_progress'), '应该有流式输出');
  assert.equal(task.status, 'awaiting_approval');
  const report = outputs.find((o: TaskOutput) => o.type === 'markdown')!.content;
  assert.match(report, /净利率最低：拾光饰品（-1\.8%）/);
  assert.match(report, /\| \*\*合计\*\* \| 408 \|/);

  const ledger = (await call<{ summary: LedgerSummary }>(app, 'GET', '/api/ledger')).body.summary;
  assert.equal(ledger.totalCalls, 2, '路由 1 次 + 干活 1 次');
  assert.equal(ledger.simulatedCalls, 2);
  assert.ok(ledger.totalCny > 0);
  assert.deepEqual(ledger.byAgent.map((a) => a.agentId).sort(), ['emp-profit', 'main']);

  const pending = (await call<ApprovalItem[]>(app, 'GET', '/api/approvals?status=pending')).body;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].kind, 'settlement');
  assert.equal(pending[0].amountCny, 743.05);

  const done: AgentEvent[] = [];
  app.bus.on((e) => done.push(e));
  const r = await call<ApprovalItem>(app, 'POST', `/api/approvals/${pending[0].id}/decide`, { decision: 'approved', note: '核对过了' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'approved');
  assert.deepEqual(done.map((e) => e.type), ['approval_decided', 'task_completed']);
  assert.equal(app.store.getTask(task.id)!.status, 'completed');

  const again = await call<{ error: string }>(app, 'POST', `/api/approvals/${pending[0].id}/decide`, { decision: 'rejected' });
  assert.equal(again.status, 409);
  const audit = (await call<AuditEntry[]>(app, 'GET', '/api/audit')).body;
  assert.deepEqual(audit.map((a) => a.action), ['approval.approved', 'approval.requested']);
  assert.match(audit[0].detail, /备注：核对过了/);
});

test('达人结算核对：每家有退款佣金的店各出一条审批', async () => {
  const app = makeApp();
  const { task } = await runTask(app, '达人结算核对：结算单到账自动匹配订单并标记差异');
  const list = (await call<ApprovalItem[]>(app, 'GET', `/api/tasks/${task.id}/approvals`)).body;
  assert.equal(list.length, 3);
  assert.ok(list.every((a) => a.kind === 'settlement' && (a.amountCny ?? 0) > 0));
});

test('客服退款：金额从诉求里取，没写就用订单实付；没提退款就不出审批', async () => {
  const app = makeApp();
  const a = await runTask(app, '客户说物流太慢要求退款 ¥89，帮我草拟一条回复');
  const refund = app.store.listApprovals().find((x) => x.taskId === a.task.id)!;
  assert.equal(refund.kind, 'refund');
  assert.equal(refund.amountCny, 89);
  assert.match(a.outputs[0].content, /需人工确认/);

  const b = await runTask(app, '客户问戒圈尺码怎么选，帮我回复');
  assert.equal(app.store.listApprovals().filter((x) => x.taskId === b.task.id).length, 0);
  assert.equal(b.task.status, 'completed');
});

test('广告归因：诊断素材/出价/落地页问题，预算挪移进审批', async () => {
  const app = makeApp();
  const { outputs, task } = await runTask(app, '分析本周广告数据，判断是素材问题还是出价问题');
  assert.match(outputs[0].content, /拾光饰品.*素材 \+ 出价/);
  assert.match(outputs[0].content, /曜石数码.*落地页/);
  const [budget] = app.store.listApprovals().filter((x) => x.taskId === task.id);
  assert.equal(budget.kind, 'budget');
  assert.match(budget.title, /拾光饰品 −¥\d+，星尘家居 \+¥\d+/);
});

test('直接指派数字员工、没有对口部门时总指挥自己答', async () => {
  const app = makeApp();
  const direct = await runTask(app, '看看 ACC-RING-01', 'emp-listing');
  assert.equal(direct.events.find((e) => e.type === 'task_assigned')?.agentId, 'emp-listing');
  assert.match(direct.outputs[0].content, /商品卡上架检查：ACC-RING-01/);
  const hello = await runTask(app, '你好');
  assert.equal(hello.task.assigneeId, 'main');
  assert.match(hello.outputs[0].content, /我是总指挥/);
});

test('预算用完：任务失败并留痕', async () => {
  const app = makeApp();
  assert.equal((await call(app, 'POST', '/api/settings', { dailyBudgetCny: 0 })).status, 200);
  const { task, events } = await runTask(app, '帮我汇总利润');
  assert.equal(task.status, 'failed');
  assert.match(events.find((e) => e.type === 'task_failed')!.message!, /今日预算已用完/);
  const audit = (await call<AuditEntry[]>(app, 'GET', '/api/audit')).body;
  assert.deepEqual(audit.map((a) => a.action), ['budget.blocked', 'settings.updated']);
});

test('设置校验：非法值返回 400，合法修改写进留痕', async () => {
  const app = makeApp();
  assert.equal((await call(app, 'POST', '/api/settings', { mode: 'gpt' })).status, 400);
  assert.equal((await call(app, 'POST', '/api/settings', { dailyBudgetCny: -1 })).status, 400);
  assert.equal((await call(app, 'POST', '/api/settings', { pricing: { 'deepseek-chat': { input: 'x', output: 1 } } })).status, 400);
  const ok = await call<{ dailyBudgetCny: number }>(app, 'POST', '/api/settings', { dailyBudgetCny: 20, model: 'deepseek-reasoner' });
  assert.equal(ok.body.dailyBudgetCny, 20);
  const [entry] = (await call<AuditEntry[]>(app, 'GET', '/api/audit')).body;
  assert.match(entry.detail, /每日预算 ¥5 → ¥20/);
  const demo = makeApp({ staticDemo: true });
  assert.equal((await call(demo, 'POST', '/api/settings', { mode: 'deepseek' })).status, 400);
});

test('工作流：离线规则标注，人确认后交给 Agent', async () => {
  const app = makeApp();
  const r = await call<{ ok: boolean; adapter: string }>(app, 'POST', '/api/workflows/analyze');
  assert.deepEqual(r.body, { ok: true, adapter: 'demo' });
  const list = (await call<{ id: string; status: string; repeatScore: number }[]>(app, 'GET', '/api/workflows')).body;
  assert.ok(list.every((w) => w.status === 'analyzed' && typeof w.repeatScore === 'number'));
  assert.ok(list.find((w) => w.id === 'wf-6')!.repeatScore < 40);
  await call(app, 'POST', '/api/workflows/wf-1/adopt');
  await call(app, 'POST', '/api/workflows/analyze');
  assert.equal(app.store.listWorkflows().find((w) => w.id === 'wf-1')!.status, 'agent_ready', '再次分析不会覆盖已接管的工作流');
});

test('定时任务：启用、手动运行一次；演示重置清空运行数据', async () => {
  const app = makeApp();
  assert.deepEqual((await call(app, 'POST', '/api/schedules/toggle', { name: '晨间经营简报' })).body, { enabled: true });
  const t = await call<TaskRecord>(app, 'POST', '/api/schedules/run', { name: '晨间经营简报' });
  await app.orchestrator.waitFor(t.body.id);
  assert.equal(app.store.getTask(t.body.id)!.departmentId, 'finance');
  await call(app, 'POST', '/api/admin/reset');
  assert.equal(app.store.listTasks(10).length, 0);
  assert.equal(app.store.listLedger().length, 0);
  assert.deepEqual(app.settings().enabledSchedules, []);
  assert.deepEqual(app.store.listAudit(10).map((a) => a.action), ['demo.reset']);
});

test('接口兜底：未知路由 404，空任务 400，组织指标由数据算出', async () => {
  const app = makeApp();
  assert.equal((await call(app, 'GET', '/api/nope')).status, 404);
  assert.equal((await call(app, 'POST', '/api/tasks', { prompt: '  ' })).status, 400);
  const org = (await call<{ departments: { id: string; metrics: { label: string; value: string }[] }[] }>(app, 'GET', '/api/org')).body;
  const finance = org.departments.find((d) => d.id === 'finance')!;
  assert.equal(finance.metrics[0].value, '¥76,512');
});

test('内存存储快照可以还原（浏览器演示刷新后数据还在）', async () => {
  const app = makeApp();
  await runTask(app, '帮我汇总利润');
  const snap = (app.store as MemoryStore).snapshot();
  const restored = new MemoryStore(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.listTasks(10).length, 1);
  assert.equal(restored.listLedger().length, 2);
  assert.equal(restored.listApprovals().length, 1);
  assert.equal(restored.listOrders().length, 0, '订单不进快照，启动时重新生成');
});
