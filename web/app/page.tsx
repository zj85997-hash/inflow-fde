'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentEvent, AgentProfile, ApprovalItem, PluginManifest, TaskOutput } from '@inflow/contracts';
import ApprovalCard from '@/components/ApprovalCard';
import { BASE_PATH, STATIC_DEMO, apiGet, apiPost, fmtCny, useEventStream } from '@/lib/api';
import { useStatus } from '@/lib/useStatus';

interface FeedItem {
  key: string;
  kind: 'status' | 'stream' | 'output' | 'memory' | 'error' | 'user' | 'approval' | 'done';
  agentId?: string;
  title?: string;
  text: string;
  approval?: ApprovalItem;
}

const RUNNING = ['created', 'assigned', 'running'];

function ChatPage() {
  const params = useSearchParams();
  const taskParam = params.get('task');
  const { status } = useStatus();

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [currentAgent, setCurrentAgent] = useState<string>('main');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [input, setInput] = useState('');
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [running, setRunning] = useState(false);
  const [sessionCost, setSessionCost] = useState(0);
  const activeRef = useRef<string | null>(null);
  /** 自己刚发起的任务：事件流已经在显示，不用再拉历史 */
  const liveRef = useRef<string | null>(null);
  /** 最近的事件：任务 id 还没拿到时先到的事件，拿到 id 后补放 */
  const recentRef = useRef<AgentEvent[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<{ agents: AgentProfile[] }>('/api/org').then((d) => setAgents(d.agents)).catch(() => {});
    apiGet<PluginManifest[]>('/api/plugins').then(setPlugins).catch(() => {});
  }, []);

  // 打开历史任务 / 回到新任务
  useEffect(() => {
    if (!taskParam) {
      liveRef.current = null;
      activeRef.current = null;
      setFeed([]);
      setRunning(false);
      setSessionCost(0);
      return;
    }
    if (taskParam === liveRef.current) return;
    liveRef.current = null;
    activeRef.current = taskParam;
    setSessionCost(0);
    Promise.all([
      apiGet<AgentEvent[]>(`/api/tasks/${taskParam}/events`),
      apiGet<TaskOutput[]>(`/api/tasks/${taskParam}/outputs`),
      apiGet<ApprovalItem[]>(`/api/tasks/${taskParam}/approvals`),
      apiGet<{ status: string }>(`/api/tasks/${taskParam}`),
    ])
      .then(([events, outputs, approvals, task]) => {
        const items: FeedItem[] = [];
        for (const ev of events) {
          if (ev.type === 'task_created') items.push({ key: ev.id, kind: 'user', text: ev.message ?? '' });
          if (ev.type === 'task_assigned' || ev.type === 'session_started') items.push({ key: ev.id, kind: 'status', agentId: ev.agentId, text: ev.message ?? '' });
          if (ev.type === 'task_failed') items.push({ key: ev.id, kind: 'error', text: ev.message ?? '任务失败' });
        }
        for (const o of outputs) {
          items.push({ key: o.id, kind: o.type === 'memory' ? 'memory' : 'output', title: o.title, text: o.content });
        }
        for (const a of [...approvals].reverse()) items.push({ key: `ap-${a.id}`, kind: 'approval', agentId: a.agentId, text: '', approval: a });
        setFeed(items);
        setRunning(RUNNING.includes(task.status));
      })
      .catch(() => setFeed([{ key: 'err', kind: 'error', text: '这个任务找不到了（演示数据可能已重置）。' }]));
  }, [taskParam]);

  function apply(ev: AgentEvent) {
    if (ev.taskId !== activeRef.current) return;
    if (ev.type === 'ledger_updated') {
      if (ev.ledger) setSessionCost((c) => c + ev.ledger!.costCny);
      return;
    }
    if (ev.type === 'approval_required' || ev.type === 'task_completed' || ev.type === 'task_failed') setRunning(false);
    setFeed((prev) => {
      if (prev.some((i) => i.key === ev.id)) return prev;
      const next = [...prev];
      switch (ev.type) {
        case 'task_assigned':
        case 'session_started':
          next.push({ key: ev.id, kind: 'status', agentId: ev.agentId, text: ev.message ?? '' });
          break;
        case 'session_progress': {
          const last = next[next.length - 1];
          if (last?.kind === 'stream' && last.agentId === ev.agentId) next[next.length - 1] = { ...last, text: last.text + (ev.message ?? '') };
          else next.push({ key: ev.id, kind: 'stream', agentId: ev.agentId, text: ev.message ?? '' });
          break;
        }
        case 'output_produced': {
          if (!ev.output) break;
          if (ev.output.type === 'memory') {
            next.push({ key: ev.id, kind: 'memory', title: ev.output.title, text: ev.output.content });
            break;
          }
          // 中途打开的任务只收到后半段流，用完整产出替换
          const i = next.findIndex((x) => x.kind === 'stream' && x.agentId === ev.agentId);
          if (i >= 0) next[i] = { ...next[i], text: ev.output.content };
          else next.push({ key: ev.id, kind: 'output', agentId: ev.agentId, title: ev.output.title, text: ev.output.content });
          break;
        }
        case 'approval_required':
          if (ev.approval) next.push({ key: `ap-${ev.approval.id}`, kind: 'approval', agentId: ev.agentId, text: '', approval: ev.approval });
          break;
        case 'approval_decided':
          return next.map((i) => (i.approval && i.approval.id === ev.approval?.id ? { ...i, approval: ev.approval } : i));
        case 'task_completed':
          if (ev.message) next.push({ key: ev.id, kind: 'done', text: ev.message });
          break;
        case 'task_failed':
          next.push({ key: ev.id, kind: 'error', text: ev.message ?? '任务失败' });
          break;
      }
      return next;
    });
  }

  useEventStream((ev) => {
    recentRef.current = [...recentRef.current.slice(-199), ev];
    apply(ev);
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [feed]);

  const agent = agents.find((a) => a.id === currentAgent) ?? agents[0];
  const quickActions = useMemo(() => plugins.flatMap((p) => p.quickActions), [plugins]);
  const demoModel = !status || status.activeAdapter === 'demo';

  async function send(prompt?: string) {
    const text = (prompt ?? input).trim();
    if (!text || running) return;
    setInput('');
    setSessionCost(0);
    setFeed([{ key: `u-${Date.now()}`, kind: 'user', text }]);
    setRunning(true);
    activeRef.current = null;
    try {
      const task = await apiPost<{ id: string }>('/api/tasks', { prompt: text, agentId: currentAgent === 'main' ? undefined : currentAgent });
      activeRef.current = task.id;
      liveRef.current = task.id;
      for (const ev of recentRef.current.filter((e) => e.taskId === task.id && e.type !== 'task_created')) apply(ev);
      window.history.replaceState(null, '', `${BASE_PATH}/?task=${task.id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFeed((f) => [...f, { key: 'err', kind: 'error', text: STATIC_DEMO ? msg : `无法连接服务端：${msg}（先运行 pnpm dev:server）` }]);
      setRunning(false);
    }
  }

  const agentName = (id?: string) => agents.find((a) => a.id === id)?.name ?? id ?? '';
  const agentAvatar = (id?: string) => agents.find((a) => a.id === id)?.avatar ?? '🤖';

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4 pb-6 md:px-6">
      {/* 顶部：当前 Agent + 切换 */}
      <div className="flex items-center justify-between gap-3 pt-6 md:pt-10">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-2xl">{agent?.avatar ?? '🧠'}</div>
          <div className="min-w-0">
            <div className="text-xl font-bold">{agent?.name ?? '总指挥'}</div>
            <div className="truncate text-sm text-subtle">{agent?.title ?? '公司主 Agent'}</div>
          </div>
        </div>
        <div className="relative shrink-0">
          <button className="btn-ghost" onClick={() => setShowSwitcher((v) => !v)}>⇆ 切换智能体</button>
          {showSwitcher && (
            <div className="absolute right-0 z-10 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-card">
              {agents.filter((a) => a.kind !== 'employee' || a.employeeType === 'digital').map((a) => (
                <button
                  key={a.id}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-panel ${a.id === currentAgent ? 'bg-panel font-medium' : ''}`}
                  onClick={() => { setCurrentAgent(a.id); setShowSwitcher(false); }}
                >
                  <span>{a.avatar}</span>
                  <span>{a.name}</span>
                  <span className="ml-auto text-[10px] text-subtle">{a.kind === 'main' ? '主' : a.kind === 'department' ? '部门' : '数字员工'}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 首次进入：一句话讲清楚这是什么 */}
      {feed.length === 0 && (
        <div className="card mt-6 p-5">
          <div className="text-base font-semibold">把企业里重复、机械的活，交给一支 Agent 队伍</div>
          <ul className="mt-3 space-y-1.5 text-sm text-subtle">
            <li>① 你对「总指挥」说一句话 → 它分给部门 → 部门派给数字员工干活，全程实时可见。</li>
            <li>② 报告里的数字由代码从 408 笔演示订单逐笔算出，模型只负责把结论写成人话。</li>
            <li>③ 退款、结算、预算、改价这类动钱的动作，一律进「审批收件箱」，人批准才执行。</li>
            <li>④ 每一次模型调用都进「成本账本」，超过每日预算自动拦截。</li>
          </ul>
          {demoModel && (
            <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
              {STATIC_DEMO
                ? '这是在线演示：没有接大模型，回复由「离线演示模型」按技能模板生成，账本里的金额按 DeepSeek 价目模拟。本地部署填入 DeepSeek Key 后，同一套流程换成真模型。'
                : '还没配置 DeepSeek Key，现在用「离线演示模型」：流程和数字都是真的，回复按技能模板生成。到「设置」查看如何接入。'}
            </p>
          )}
        </div>
      )}

      {/* 会话流 */}
      <div className="mt-6 flex-1 space-y-3">
        {feed.map((item) => {
          if (item.kind === 'user')
            return (
              <div key={item.key} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white">{item.text}</div>
              </div>
            );
          if (item.kind === 'status')
            return (
              <div key={item.key} className="flex items-center gap-2 text-xs text-subtle">
                <span>{agentAvatar(item.agentId)}</span>
                <span>{item.text}</span>
              </div>
            );
          if (item.kind === 'stream' || item.kind === 'output')
            return (
              <div key={item.key} className="card p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-subtle">
                  <span>{agentAvatar(item.agentId)}</span>
                  {item.title ?? `${agentName(item.agentId)} · 工作产出`}
                  {running && item.kind === 'stream' && <span className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />}
                </div>
                <div className="md-body">
                  <Markdown remarkPlugins={[remarkGfm]}>{item.text}</Markdown>
                </div>
              </div>
            );
          if (item.kind === 'approval' && item.approval)
            return (
              <ApprovalCard
                key={item.key}
                approval={item.approval}
                agentName={agentName(item.agentId)}
                onDecided={(a) => setFeed((f) => f.map((i) => (i.approval?.id === a.id ? { ...i, approval: a } : i)))}
              />
            );
          if (item.kind === 'memory')
            return (
              <div key={item.key} className="flex items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
                <span className="text-lg">📝</span>
                <div>
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-subtle">{item.text}</div>
                </div>
                <span className="chip ml-auto">长期记忆</span>
              </div>
            );
          if (item.kind === 'done')
            return (
              <div key={item.key} className="flex items-center gap-2 text-xs text-brand-dark">
                <span>✓</span>
                <span>{item.text}，任务完成</span>
              </div>
            );
          return (
            <div key={item.key} className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              ⚠️ {item.text}
              {/预算/.test(item.text) && <Link href="/settings" className="ml-2 underline">去设置</Link>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* 输入区 */}
      <div className="sticky bottom-0 bg-white pb-2 pt-2">
        <div className="card p-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`向 ${agent?.name ?? '总指挥'} 下达任务…`}
            rows={2}
            className="w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-subtle/60"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 px-1">
            <span className="chip">🛡️ 动钱的动作要审批</span>
            <Link href="/settings" className={`chip ${demoModel ? '' : 'border-brand text-brand-dark'}`}>
              ⬡ {demoModel ? '离线演示模型' : 'DeepSeek 已连接'}
            </Link>
            {sessionCost > 0 && <span className="chip">本次 {fmtCny(sessionCost)}{demoModel ? '（模拟）' : ''}</span>}
            <button className="btn-brand ml-auto !px-3.5 !py-1.5" onClick={() => send()} disabled={running}>
              {running ? '执行中…' : '↑ 发送'}
            </button>
          </div>
        </div>

        {/* 场景快捷入口 */}
        {feed.length === 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {quickActions.map((q) => (
              <button key={q.label} className="btn-ghost !py-1.5 text-xs" onClick={() => send(q.prompt)}>
                {q.label}
              </button>
            ))}
          </div>
        )}
        <p className="mt-3 text-center text-[11px] text-subtle/70">内容由 AI 生成；涉及金额的执行动作均需人工确认。</p>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChatPage />
    </Suspense>
  );
}
