'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentProfile, ApprovalItem, AuditEntry } from '@inflow/contracts';
import ApprovalCard from '@/components/ApprovalCard';
import { apiGet, fmtCny, fmtTime, useEventStream } from '@/lib/api';

const TABS = [
  { id: 'pending', label: '待审批' },
  { id: 'decided', label: '已处理' },
  { id: 'audit', label: '操作留痕' },
] as const;

const ACTION_LABEL: Record<string, string> = {
  'approval.requested': '提交审批',
  'approval.approved': '批准',
  'approval.rejected': '驳回',
  'settings.updated': '修改设置',
  'workflow.analyzed': '工作流诊断',
  'workflow.adopted': '工作流交给 Agent',
  'onboard.saved': '录入企业档案',
  'schedule.enabled': '启用定时任务',
  'schedule.disabled': '停用定时任务',
  'schedule.run': '手动运行定时任务',
  'budget.blocked': '预算拦截',
  'demo.reset': '重置演示数据',
};

export default function InboxPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('pending');
  const [pending, setPending] = useState<ApprovalItem[]>([]);
  const [decided, setDecided] = useState<ApprovalItem[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);

  const load = () => {
    apiGet<ApprovalItem[]>('/api/approvals?status=pending').then(setPending).catch(() => {});
    apiGet<ApprovalItem[]>('/api/approvals?status=decided').then(setDecided).catch(() => {});
    apiGet<AuditEntry[]>('/api/audit?limit=200').then(setAudit).catch(() => {});
  };
  useEffect(() => {
    load();
    apiGet<{ agents: AgentProfile[] }>('/api/org').then((d) => setAgents(d.agents)).catch(() => {});
  }, []);
  useEventStream((ev) => {
    if (ev.type === 'approval_required' || ev.type === 'approval_decided') load();
  });

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const actorName = (id: string) => (id === 'user' ? '老板' : id === 'system' ? '系统' : agentName(id));
  const pendingAmount = pending.reduce((n, a) => n + (a.amountCny ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-bold">审批收件箱</h1>
      <p className="mt-1 text-sm text-subtle">
        AI 只出建议：退款、结算、预算、改价这类动钱的动作，在这里由人批准后才执行。每一次批准和驳回都写进操作留痕。
      </p>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <div className="card p-4">
          <div className="text-xs text-subtle">待审批</div>
          <div className="mt-1 text-2xl font-bold">{pending.length} 笔</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-subtle">待审批涉及金额</div>
          <div className="mt-1 text-2xl font-bold">{fmtCny(pendingAmount)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-subtle">已处理</div>
          <div className="mt-1 text-2xl font-bold">{decided.length} 笔</div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-6 border-b border-line pb-3">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`text-sm ${tab === t.id ? 'font-semibold text-ink' : 'text-subtle hover:text-ink'}`}>
            {t.label}
            {t.id === 'pending' && pending.length > 0 && <span className="ml-1 text-amber-600">{pending.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        <div className="mt-5 space-y-3">
          {pending.map((a) => (
            <ApprovalCard key={a.id} approval={a} agentName={agentName(a.agentId)} showTaskLink onDecided={load} />
          ))}
          {pending.length === 0 && (
            <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-subtle">
              没有待审批的事项。
              <Link href="/" className="ml-1 text-brand-dark hover:underline">去让利润分析师汇总一次利润 →</Link>
            </div>
          )}
        </div>
      )}

      {tab === 'decided' && (
        <div className="mt-5 space-y-3">
          {decided.map((a) => (
            <ApprovalCard key={a.id} approval={a} agentName={agentName(a.agentId)} showTaskLink />
          ))}
          {decided.length === 0 && <div className="py-10 text-center text-sm text-subtle">还没有处理过的审批。</div>}
        </div>
      )}

      {tab === 'audit' && (
        <div className="card mt-5 overflow-x-auto p-2">
          <table className="w-full text-left text-xs">
            <thead className="text-subtle">
              <tr>
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">谁</th>
                <th className="px-3 py-2 font-medium">动作</th>
                <th className="px-3 py-2 font-medium">内容</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-subtle">{fmtTime(e.ts)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{actorName(e.actor)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="px-3 py-2 leading-5 text-subtle">{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <div className="py-8 text-center text-sm text-subtle">还没有操作记录。</div>}
        </div>
      )}
    </div>
  );
}
