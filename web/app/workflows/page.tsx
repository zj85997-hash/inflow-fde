'use client';
import { useEffect, useState } from 'react';
import type { WorkflowItem } from '@inflow/contracts';
import { apiGet, apiPost } from '@/lib/api';

const STATUS_TEXT: Record<string, string> = {
  manual: '人工执行中',
  analyzed: '已分析',
  agent_ready: '✅ Agent 已接管',
  agent_running: 'Agent 执行中',
};

export default function WorkflowsPage() {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => apiGet<WorkflowItem[]>('/api/workflows').then(setItems).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function analyze() {
    setAnalyzing(true);
    setNote(null);
    try {
      const res = await apiPost<{ ok: boolean; error?: string; adapter?: string }>('/api/workflows/analyze');
      if (!res.ok) setNote({ ok: false, text: res.error ?? 'AI 分析失败' });
      else setNote({ ok: true, text: res.adapter === 'demo' ? '离线演示模型按规则打分：每天/每月重复、导出合并、逐单核对的得分高；讨论和决策类的得分低，建议留给人。' : '已由模型逐条打分。' });
      await load();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setAnalyzing(false);
    }
  }

  async function adopt(id: string) {
    await apiPost(`/api/workflows/${id}/adopt`);
    await load();
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">工作流管理</h1>
          <p className="mt-1 text-sm text-subtle">梳理现有工作流 → AI 标注可重复环节 → 人确认后交给 Agent 执行</p>
        </div>
        <button className="btn-brand" onClick={analyze} disabled={analyzing}>
          {analyzing ? '分析中…' : '✨ AI 标注可重复环节'}
        </button>
      </div>

      {note && (
        <div className={`mt-4 rounded-xl border px-4 py-2.5 text-sm ${note.ok ? 'border-brand/30 bg-brand-soft text-brand-dark' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
          {note.text}
        </div>
      )}

      <div className="mt-6 space-y-3">
        {items.map((w) => {
          const keepHuman = typeof w.repeatScore === 'number' && w.repeatScore < 40;
          return (
            <div key={w.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    {w.name}
                    <span className="chip !py-0">{w.owner}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-subtle">{w.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {typeof w.repeatScore === 'number' && (
                    <div className="text-right">
                      <div className={`text-lg font-bold ${w.repeatScore >= 70 ? 'text-brand-dark' : keepHuman ? 'text-subtle' : 'text-ink'}`}>{w.repeatScore}</div>
                      <div className="text-[10px] text-subtle">机械程度</div>
                    </div>
                  )}
                  <span className="chip">{keepHuman && w.status === 'analyzed' ? '建议留给人' : STATUS_TEXT[w.status] ?? w.status}</span>
                  {w.status === 'analyzed' && !keepHuman && (
                    <button className="btn-primary !py-1.5 text-xs" onClick={() => adopt(w.id)}>确认交给 Agent</button>
                  )}
                </div>
              </div>
              {w.aiSuggestion && (
                <div className={`mt-3 rounded-xl px-3 py-2 text-xs leading-5 ${keepHuman ? 'bg-panel text-subtle' : 'bg-brand-soft text-brand-dark'}`}>
                  🤖 {w.aiSuggestion}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
