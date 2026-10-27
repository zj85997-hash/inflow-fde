'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentProfile, LedgerEntry, LedgerSummary } from '@inflow/contracts';
import { apiGet, fmtCny, useEventStream } from '@/lib/api';

interface LedgerData {
  entries: LedgerEntry[];
  summary: LedgerSummary;
}

export default function LedgerPage() {
  const [data, setData] = useState<LedgerData | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const load = () => apiGet<LedgerData>('/api/ledger').then(setData).catch(() => {});
  useEffect(() => {
    load();
    apiGet<{ agents: AgentProfile[] }>('/api/org').then((d) => setAgents(d.agents)).catch(() => {});
  }, []);
  useEventStream((ev) => {
    if (ev.type === 'ledger_updated') load();
  });

  if (!data) return <div className="p-10 text-sm text-subtle">加载中…</div>;
  const s = data.summary;
  const used = s.dailyBudgetCny > 0 ? Math.min(100, (s.spentTodayCny / s.dailyBudgetCny) * 100) : 100;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-bold">成本账本</h1>
      <p className="mt-1 text-sm text-subtle">每一次模型调用逐笔记账，按 Agent 与部门归因 —— AI 花的每一分钱都可解释。</p>
      {s.simulatedCalls > 0 && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
          标「模拟」的是离线演示模型的调用：token 按字数估算，金额按设置里的 DeepSeek 价目模拟，让你看到接真模型后大概花多少。
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-subtle">累计成本</div>
          <div className="mt-1 text-2xl font-bold">{fmtCny(s.totalCny)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-subtle">调用次数</div>
          <div className="mt-1 text-2xl font-bold">{s.totalCalls}</div>
          {s.simulatedCalls > 0 && <div className="text-[11px] text-subtle">其中模拟 {s.simulatedCalls} 次</div>}
        </div>
        <div className="card p-4">
          <div className="text-xs text-subtle">单次均价</div>
          <div className="mt-1 text-2xl font-bold">{s.totalCalls ? fmtCny(s.totalCny / s.totalCalls) : '—'}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-subtle">今日 / 每日预算</div>
          <div className="mt-1 text-lg font-bold">
            {fmtCny(s.spentTodayCny)} <span className="text-sm font-normal text-subtle">/ {fmtCny(s.dailyBudgetCny)}</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-panel">
            <div className={`h-1.5 rounded-full ${used >= 100 ? 'bg-red-500' : used > 80 ? 'bg-amber-400' : 'bg-brand'}`} style={{ width: `${used}%` }} />
          </div>
          <Link href="/settings" className="mt-1 inline-block text-[11px] text-subtle hover:text-ink">调整预算 →</Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">按 Agent 归因</div>
          {s.byAgent.map((a) => (
            <div key={a.agentId} className="flex items-center border-b border-line py-2 text-sm last:border-0">
              <span>{a.name}</span>
              <span className="ml-2 text-xs text-subtle">{a.department}</span>
              <span className="ml-auto font-medium">{fmtCny(a.costCny)}</span>
              <span className="ml-2 w-12 text-right text-xs text-subtle">{a.calls} 次</span>
            </div>
          ))}
          {s.byAgent.length === 0 && <div className="text-xs text-subtle">暂无调用记录</div>}
          {s.byModel.length > 0 && (
            <>
              <div className="mb-2 mt-5 text-sm font-semibold">按模型</div>
              {s.byModel.map((m) => (
                <div key={m.model} className="flex items-center py-1.5 text-xs">
                  <span>{m.model === 'inflow-demo' ? '离线演示模型（模拟）' : m.model}</span>
                  <span className="ml-auto font-medium">{fmtCny(m.costCny)}</span>
                  <span className="ml-2 w-12 text-right text-subtle">{m.calls} 次</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold">最近调用明细</div>
          <div className="max-h-96 overflow-y-auto">
            {data.entries.slice(0, 50).map((e) => (
              <div key={e.id} className="flex items-center gap-2 border-b border-line py-2 text-xs last:border-0">
                <span className="text-subtle">{new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                <span className="truncate">{agents.find((a) => a.id === e.agentId)?.name ?? e.agentId}</span>
                <span className="text-subtle">{e.promptTokens}+{e.completionTokens} tok</span>
                {e.simulated && <span className="chip !px-1.5 !py-0 text-[10px]">模拟</span>}
                <span className="ml-auto font-medium">{fmtCny(e.costCny)}</span>
              </div>
            ))}
            {data.entries.length === 0 && (
              <div className="text-xs text-subtle">
                暂无记录 —— <Link href="/" className="text-brand-dark hover:underline">发起一个任务试试</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
