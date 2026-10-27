'use client';
import Link from 'next/link';
import { useState } from 'react';
import type { ApprovalItem } from '@inflow/contracts';
import { apiPost, fmtCny, fmtTime } from '@/lib/api';

export const KIND_META: Record<ApprovalItem['kind'], { icon: string; label: string }> = {
  refund: { icon: '💸', label: '退款' },
  budget: { icon: '📊', label: '预算调整' },
  settlement: { icon: '🧾', label: '结算' },
  price: { icon: '🏷️', label: '改价' },
};

const RISK: Record<ApprovalItem['risk'], { text: string; cls: string }> = {
  low: { text: '低风险', cls: '' },
  medium: { text: '中风险', cls: 'border-amber-300 text-amber-700' },
  high: { text: '高风险', cls: 'border-red-300 text-red-600' },
};

export default function ApprovalCard({
  approval,
  agentName,
  onDecided,
  showTaskLink = false,
}: {
  approval: ApprovalItem;
  agentName?: string;
  onDecided?: (a: ApprovalItem) => void;
  showTaskLink?: boolean;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const a = approval;
  const kind = KIND_META[a.kind];
  const pending = a.status === 'pending';

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    setError('');
    try {
      const updated = await apiPost<ApprovalItem>(`/api/approvals/${a.id}/decide`, { decision, note });
      onDecided?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-4 ${pending ? 'border-amber-300 bg-amber-50/60' : 'border-line bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg">{kind.icon}</span>
        <span className="chip !py-0">{kind.label}</span>
        <span className={`chip !py-0 ${RISK[a.risk].cls}`}>{RISK[a.risk].text}</span>
        {agentName && <span className="text-xs text-subtle">{agentName} 提出</span>}
        <span className="ml-auto text-[11px] text-subtle">{fmtTime(a.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-sm font-semibold">{a.title}</div>
        {a.amountCny !== undefined && <div className="text-lg font-bold">{fmtCny(a.amountCny)}</div>}
      </div>
      <p className="mt-1.5 text-xs leading-5 text-subtle">依据：{a.reason}</p>
      {showTaskLink && (
        <Link href={`/?task=${a.taskId}`} className="mt-1 inline-block text-xs text-brand-dark hover:underline">查看来源任务 →</Link>
      )}

      {pending ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="备注（可选，会写进操作留痕）"
            className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-1.5 text-xs outline-none focus:border-brand"
          />
          <button className="btn-ghost !py-1.5 text-xs" disabled={busy} onClick={() => decide('rejected')}>驳回</button>
          <button className="btn-brand !py-1.5 text-xs" disabled={busy} onClick={() => decide('approved')}>✓ 批准执行</button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className={`chip ${a.status === 'approved' ? 'border-brand text-brand-dark' : 'border-red-300 text-red-600'}`}>
            {a.status === 'approved' ? '✓ 已批准' : '✗ 已驳回'}
          </span>
          {a.decidedAt && <span className="text-subtle">{fmtTime(a.decidedAt)}</span>}
          {a.note && <span className="text-subtle">备注：{a.note}</span>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
