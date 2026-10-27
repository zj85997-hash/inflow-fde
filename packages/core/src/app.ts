/**
 * 把网关、编排、存储和接口装配在一起。
 * 服务端：createApp({ store: new SqliteStore(), ... })，Fastify 只做转发；
 * 浏览器演示：createApp({ store: new MemoryStore(), staticDemo: true })，同一套接口在浏览器里跑。
 */
import type {
  AgentEvent, AppStatus, ApprovalItem, ComparisonPlan, CompanyProfile, Department, LedgerSummary, PluginManifest,
} from '@inflow/contracts';
import { GatewayError, ModelGateway } from '@inflow/gateway';
import { adFunnel, summarizeStores, totalOf } from './analytics';
import { buildComparePlan, scoreWorkflow } from './advisor';
import { DATA_RANGE, DEMO_WORKFLOWS, SKUS, generateOrders } from './demo-data';
import { KNOWLEDGE_DOCS } from './knowledge';
import { AGENTS, DEPARTMENTS } from './org';
import { createOrchestrator } from './orchestrator';
import { HttpError, createRouter } from './router';
import { SettingsError, applySettingsPatch, mergeSettings } from './settings';
import type { Store } from './store';
import { Emitter, startOfDay, uid, yuan } from './util';

export interface AppDeps {
  store: Store;
  plugins: () => PluginManifest[];
  deepseekApiKey?: string;
  /** 在线静态演示：只用离线演示模型 */
  staticDemo?: boolean;
  /** 分发每一步之间的停顿，默认 450ms；测试设 0 */
  paceMs?: number;
  /** 离线演示模型的流式间隔，默认 16ms；测试设 0 */
  streamDelayMs?: number;
  now?: () => number;
}

export type InflowApp = ReturnType<typeof createApp>;

const stripFence = (s: string) => s.replace(/```json|```/g, '').trim();

export function createApp(deps: AppDeps) {
  const { store } = deps;
  const now = deps.now ?? (() => Date.now());
  const bus = new Emitter<AgentEvent>();
  const settings = () => mergeSettings(store.getSettings());
  const spentToday = () => {
    const from = startOfDay(now());
    return store.listLedger().reduce((n, e) => (e.ts >= from ? n + e.costCny : n), 0);
  };

  const gateway = new ModelGateway({
    deepseekApiKey: deps.deepseekApiKey,
    demoOnly: deps.staticDemo,
    demoStreamDelayMs: deps.streamDelayMs ?? 16,
    getSettings: settings,
    getSpentToday: spentToday,
    onUsage: (u) => {
      const ledger = store.insertLedger({
        ts: now(), model: u.model, agentId: u.agentId, taskId: u.taskId,
        promptTokens: u.usage.promptTokens, completionTokens: u.usage.completionTokens, costCny: u.costCny, simulated: u.simulated,
      });
      bus.emit({ id: uid(), type: 'ledger_updated', ts: now(), taskId: u.taskId, ledger });
    },
  });

  const orchestrator = createOrchestrator({ store, gateway, bus, paceMs: deps.paceMs ?? 450, now });
  const audit = (actor: string, action: string, target: string, detail: string) => store.insertAudit({ ts: now(), actor, action, target, detail });
  const pendingApprovals = () => store.listApprovals().filter((a) => a.status === 'pending');

  function ensureDemoData() {
    if (store.listOrders().length === 0) store.replaceOrders(generateOrders());
    if (store.listWorkflows().length === 0) store.replaceWorkflows(DEMO_WORKFLOWS);
  }

  function departments(): Department[] {
    const stores = summarizeStores(store.listOrders());
    const t = totalOf(stores);
    const funnel = adFunnel(store.listOrders());
    const pending = pendingApprovals();
    const count = (kind: ApprovalItem['kind']) => pending.filter((a) => a.kind === kind).length;
    return DEPARTMENTS.map((d) => {
      if (d.id === 'finance') {
        return { ...d, metrics: [
          { label: '本期 GMV', value: yuan(t.revenue), trend: 'up' as const },
          { label: '预估净利', value: yuan(t.netProfit) },
          { label: '待审批结算', value: `${count('settlement')} 笔` },
        ] };
      }
      if (d.id === 'growth') {
        return { ...d, metrics: [
          { label: '本期投流', value: yuan(t.adCost) },
          { label: '综合 ROAS', value: t.adCost ? (t.revenue / t.adCost).toFixed(1) : '—', trend: 'flat' as const },
          { label: '待优化店铺', value: `${funnel.filter((r) => r.issues.length).length} 家` },
        ] };
      }
      if (d.id === 'ops') {
        return { ...d, metrics: [
          { label: '在售 SKU', value: String(Object.values(SKUS).flat().length) },
          { label: '待审批改价', value: `${count('price')} 个` },
          { label: '链接健康度', value: '92%' },
        ] };
      }
      return { ...d, metrics: d.metrics.map((m) => (m.label === '待处理退款' ? { ...m, label: '待审批退款', value: `${count('refund')} 笔` } : m)) };
    });
  }

  function ledger(): { entries: ReturnType<Store['listLedger']>; summary: LedgerSummary } {
    const all = store.listLedger();
    const byAgent = new Map<string, { costCny: number; calls: number }>();
    const byModel = new Map<string, { costCny: number; calls: number }>();
    let total = 0, simulated = 0;
    for (const e of all) {
      total += e.costCny;
      if (e.simulated) simulated += 1;
      const a = byAgent.get(e.agentId) ?? { costCny: 0, calls: 0 };
      a.costCny += e.costCny; a.calls += 1; byAgent.set(e.agentId, a);
      const m = byModel.get(e.model) ?? { costCny: 0, calls: 0 };
      m.costCny += e.costCny; m.calls += 1; byModel.set(e.model, m);
    }
    return {
      entries: all.slice(-200).reverse(),
      summary: {
        totalCny: total,
        totalCalls: all.length,
        simulatedCalls: simulated,
        spentTodayCny: spentToday(),
        dailyBudgetCny: settings().dailyBudgetCny,
        byAgent: [...byAgent.entries()]
          .map(([agentId, v]) => {
            const agent = AGENTS.find((x) => x.id === agentId);
            const dept = DEPARTMENTS.find((x) => x.id === agent?.departmentId);
            return { agentId, name: agent?.name ?? agentId, department: dept?.name ?? (agentId === 'main' ? '主 Agent' : '—'), ...v };
          })
          .sort((a, b) => b.costCny - a.costCny),
        byModel: [...byModel.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.costCny - a.costCny),
      },
    };
  }

  let compareCache: { key: string; plan: ComparisonPlan } | null = null;

  const r = createRouter();

  // ---------- 状态与组织 ----------
  r.add('GET', '/api/status', (): AppStatus => {
    const s = settings();
    return {
      mode: s.mode,
      activeAdapter: gateway.activeAdapter(),
      keyConfigured: gateway.keyConfigured,
      staticDemo: Boolean(deps.staticDemo),
      pendingApprovals: pendingApprovals().length,
      spentTodayCny: spentToday(),
      dailyBudgetCny: s.dailyBudgetCny,
      dataRange: DATA_RANGE,
    };
  });
  r.add('GET', '/api/org', () => ({ departments: departments(), agents: AGENTS }));
  r.add('GET', '/api/plugins', () => deps.plugins());
  r.add('GET', '/api/adapters', () => gateway.listAdapters());
  r.add('GET', '/api/knowledge', () => KNOWLEDGE_DOCS);

  // ---------- 任务 ----------
  r.add('POST', '/api/tasks', ({ body }) => {
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) throw new HttpError(400, '任务内容不能为空');
    if (prompt.length > 2000) throw new HttpError(400, '任务内容太长了（最多 2000 字）');
    const agentId = typeof body.agentId === 'string' ? body.agentId : undefined;
    if (agentId && !AGENTS.some((a) => a.id === agentId)) throw new HttpError(400, `没有这个 Agent：${agentId}`);
    return orchestrator.createTask({ prompt, agentId });
  });
  r.add('GET', '/api/tasks', () => store.listTasks(50));
  r.add('GET', '/api/tasks/:id', ({ params }) => {
    const t = store.getTask(params.id);
    if (!t) throw new HttpError(404, '任务不存在');
    return t;
  });
  r.add('GET', '/api/tasks/:id/events', ({ params }) => store.listEvents(params.id));
  r.add('GET', '/api/tasks/:id/outputs', ({ params }) => store.listOutputs(params.id));
  r.add('GET', '/api/tasks/:id/approvals', ({ params }) => store.listApprovals().filter((a) => a.taskId === params.id));

  // ---------- 审批收件箱与留痕 ----------
  r.add('GET', '/api/approvals', ({ query }) => {
    const status = query.get('status') ?? 'all';
    const list = store.listApprovals();
    if (status === 'pending') return list.filter((a) => a.status === 'pending');
    if (status === 'decided') return list.filter((a) => a.status !== 'pending').sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
    return list;
  });
  r.add('POST', '/api/approvals/:id/decide', ({ params, body }) => {
    const decision = body.decision;
    if (decision !== 'approved' && decision !== 'rejected') throw new HttpError(400, 'decision 只能是 approved 或 rejected');
    return orchestrator.decide(params.id, decision, typeof body.note === 'string' ? body.note : undefined);
  });
  r.add('GET', '/api/audit', ({ query }) => store.listAudit(Math.min(500, Number(query.get('limit')) || 100)));

  // ---------- 成本账本 ----------
  r.add('GET', '/api/ledger', () => ledger());

  // ---------- 工作流管理 ----------
  r.add('GET', '/api/workflows', () => store.listWorkflows());
  r.add('POST', '/api/workflows/analyze', async () => {
    const rows = store.listWorkflows();
    const draft = JSON.stringify(rows.map((w, i) => ({ id: i + 1, ...scoreWorkflow(w) })));
    try {
      const res = await gateway.chat(
        [
          {
            role: 'system',
            content: '你是 FDE（AI 企业转型）顾问。对每条工作流：给出 0-100 的「可重复/机械程度」评分，和一句话的 Agent 接管建议；以讨论和判断为主的工作给低分并建议保留给人。严格输出 JSON 数组：[{"id":序号,"score":数字,"suggestion":"..."}]，不要输出其他文字。',
          },
          { role: 'user', content: rows.map((w, i) => `${i + 1}. 【${w.name}】${w.description}（负责人：${w.owner}）`).join('\n') },
        ],
        { attribution: { agentId: 'main', taskId: 'workflow-analyze' }, maxTokens: 800, temperature: 0.2, draft }
      );
      let parsed: { id: number; score: number; suggestion: string }[];
      try {
        parsed = JSON.parse(stripFence(res.content));
        if (!Array.isArray(parsed)) throw new Error('not array');
      } catch {
        parsed = JSON.parse(draft);
      }
      for (const p of parsed) {
        const row = rows[Number(p.id) - 1];
        if (!row || row.status === 'agent_ready') continue;
        store.updateWorkflow(row.id, {
          repeatScore: Math.max(0, Math.min(100, Math.round(Number(p.score) || 0))),
          aiSuggestion: String(p.suggestion ?? '').slice(0, 200),
          status: 'analyzed',
        });
      }
      const how = gateway.activeAdapter() === 'demo' ? '离线规则打分' : '模型打分';
      audit('main', 'workflow.analyzed', 'workflows', `${parsed.length} 条工作流已标注（${how}）`);
      return { ok: true, adapter: gateway.activeAdapter() };
    } catch (e) {
      if (e instanceof GatewayError) return { ok: false, error: e.message };
      throw e;
    }
  });
  r.add('POST', '/api/workflows/:id/adopt', ({ params }) => {
    const w = store.listWorkflows().find((x) => x.id === params.id);
    if (!w) throw new HttpError(404, '工作流不存在');
    store.updateWorkflow(w.id, { status: 'agent_ready' });
    audit('user', 'workflow.adopted', w.id, `确认把「${w.name}」交给 Agent`);
    return { ok: true };
  });

  // ---------- Onboard 与方案对比 ----------
  r.add('POST', '/api/onboard', ({ body }) => {
    const p = body as unknown as CompanyProfile;
    if (!p || typeof p.name !== 'string' || !p.name.trim()) throw new HttpError(400, '公司名称不能为空');
    store.setProfile(p);
    compareCache = null;
    audit('user', 'onboard.saved', 'company', `录入企业档案：${p.name}`);
    return { ok: true };
  });
  r.add('GET', '/api/onboard', () => store.getProfile());
  r.add('GET', '/api/compare', async () => {
    const profile = store.getProfile();
    const key = JSON.stringify(profile);
    if (compareCache?.key === key) return compareCache.plan;
    const fallback = buildComparePlan(profile);
    let plan = fallback;
    try {
      const res = await gateway.chat(
        [
          {
            role: 'system',
            content: '你是 FDE 顾问。根据企业档案生成一份"现状 vs AI 中台优化后"的对比方案。严格输出 JSON（不要代码块）：{"current":{"title":"现状运行方案","points":[],"pros":[],"cons":[]},"optimized":{"title":"基于 InFlow FDE 的优化方案","points":[],"pros":[],"cons":[]},"efficiencyGain":"一句话提效估值"}。每个数组 3-4 条，中文。',
          },
          { role: 'user', content: JSON.stringify(profile ?? { note: '没有录入企业档案，按三店铺跨境电商演示公司出方案' }) },
        ],
        { attribution: { agentId: 'main', taskId: 'compare' }, maxTokens: 1200, temperature: 0.3, draft: JSON.stringify(fallback) }
      );
      const p = JSON.parse(stripFence(res.content)) as ComparisonPlan;
      if (p?.current?.points && p?.optimized?.points) plan = { ...p, priceCny: fallback.priceCny };
    } catch {
      /* 用规则方案 */
    }
    compareCache = { key, plan };
    return plan;
  });

  // ---------- 店铺数据 ----------
  r.add('GET', '/api/store-summary', () => {
    const orders = store.listOrders();
    return { hasData: orders.length > 0, dataRange: DATA_RANGE, stores: summarizeStores(orders) };
  });

  // ---------- 设置 ----------
  r.add('GET', '/api/settings', () => ({ ...settings(), keyConfigured: gateway.keyConfigured, staticDemo: Boolean(deps.staticDemo) }));
  r.add('POST', '/api/settings', ({ body }) => {
    try {
      const { next, changes } = applySettingsPatch(settings(), body);
      if (deps.staticDemo && next.mode !== 'demo' && next.mode !== 'auto') throw new SettingsError('在线演示只能用离线演示模型');
      store.setSettings(next);
      if (changes.length) audit('user', 'settings.updated', 'settings', changes.join('；'));
      return next;
    } catch (e) {
      if (e instanceof SettingsError) throw new HttpError(400, e.message);
      throw e;
    }
  });

  // ---------- 定时任务 ----------
  const templates = () => deps.plugins().flatMap((p) => p.scheduleTemplates);
  r.add('POST', '/api/schedules/toggle', ({ body }) => {
    const t = templates().find((x) => x.name === body.name);
    if (!t) throw new HttpError(404, '没有这个定时任务模板');
    const s = settings();
    const on = !s.enabledSchedules.includes(t.name);
    store.setSettings({ ...s, enabledSchedules: on ? [...s.enabledSchedules, t.name] : s.enabledSchedules.filter((x) => x !== t.name) });
    audit('user', on ? 'schedule.enabled' : 'schedule.disabled', t.name, `${on ? '启用' : '停用'}定时任务「${t.name}」`);
    return { enabled: on };
  });
  r.add('POST', '/api/schedules/run', ({ body }) => {
    const t = templates().find((x) => x.name === body.name);
    if (!t) throw new HttpError(404, '没有这个定时任务模板');
    audit('user', 'schedule.run', t.name, `手动运行一次「${t.name}」`);
    return orchestrator.createTask({ prompt: `${t.name}：${t.description}` });
  });

  // ---------- 演示重置 ----------
  r.add('POST', '/api/admin/reset', () => {
    store.resetRuntime();
    store.replaceWorkflows(DEMO_WORKFLOWS);
    store.setProfile(null);
    store.setSettings(null);
    compareCache = null;
    audit('user', 'demo.reset', 'all', '演示数据已重置');
    return { ok: true };
  });

  return { api: { handle: r.handle }, bus, orchestrator, gateway, store, settings, ensureDemoData };
}

