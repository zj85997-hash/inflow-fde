'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AgentEvent, AgentProfile, Department } from '@inflow/contracts';
import { apiGet, useEventStream } from '@/lib/api';

type AgentLive = { status: 'idle' | 'working'; note?: string };

export default function OrgPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [live, setLive] = useState<Record<string, AgentLive>>({});
  const [showTeamModal, setShowTeamModal] = useState(false);

  useEffect(() => {
    apiGet<{ departments: Department[]; agents: AgentProfile[] }>('/api/org').then((d) => {
      setDepartments(d.departments);
      setAgents(d.agents);
    });
  }, []);

  useEventStream((ev: AgentEvent) => {
    if (!ev.agentId) return;
    if (ev.type === 'session_started' || ev.type === 'session_progress') {
      setLive((l) => ({ ...l, [ev.agentId!]: { status: 'working', note: ev.type === 'session_started' ? ev.message : '输出中…' } }));
    }
    if (ev.type === 'task_completed' || ev.type === 'task_failed') {
      setLive((l) => ({ ...l, [ev.agentId!]: { status: 'idle' } }));
    }
  });

  const main = agents.find((a) => a.kind === 'main');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">组织</h1>
          <p className="mt-1 text-sm text-subtle">主 Agent → 部门 Agent → 员工（真人 / 数字员工），session 状态实时更新</p>
        </div>
        <button className="btn-primary" onClick={() => setShowTeamModal(true)}>＋ 创建团队</button>
      </div>

      {/* 主 Agent */}
      {main && (
        <div className="card mt-6 flex items-center gap-4 p-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-3xl">{main.avatar}</div>
          <div>
            <div className="flex items-center gap-2 text-lg font-bold">
              {main.name}
              <span className="chip">主 Agent</span>
              {live[main.id]?.status === 'working' && <span className="chip border-brand text-brand-dark">● 工作中</span>}
            </div>
            <div className="text-sm text-subtle">{main.title}</div>
          </div>
          <Link href="/" className="btn-ghost ml-auto shrink-0">💬 下达任务</Link>
        </div>
      )}

      {/* 部门 */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {departments.map((dept) => {
          const deptAgent = agents.find((a) => a.kind === 'department' && a.departmentId === dept.id);
          const employees = agents.filter((a) => a.kind === 'employee' && a.departmentId === dept.id);
          return (
            <div key={dept.id} className="card p-5">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{dept.icon}</span>
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {dept.name}
                    {deptAgent && live[deptAgent.id]?.status === 'working' && (
                      <span className="chip border-brand text-brand-dark">● 统筹中</span>
                    )}
                  </div>
                  <div className="text-xs text-subtle">{deptAgent?.name} · 任务与指标统筹</div>
                </div>
              </div>

              {/* 指标卡 */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                {dept.metrics.map((m) => (
                  <div key={m.label} className="rounded-xl bg-panel px-3 py-2">
                    <div className="text-[11px] text-subtle">{m.label}</div>
                    <div className="text-sm font-semibold">
                      {m.value}
                      {m.trend === 'up' && <span className="ml-1 text-xs text-brand-dark">↑</span>}
                      {m.trend === 'down' && <span className="ml-1 text-xs text-red-500">↓</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* 员工 */}
              <div className="mt-4 space-y-2">
                {employees.map((e) => {
                  const st = live[e.id];
                  return (
                    <div key={e.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
                      <span className="text-xl">{e.avatar}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {e.name}
                          <span className="chip !py-0">{e.employeeType === 'digital' ? '🤖 数字员工' : '🧑 真人'}</span>
                        </div>
                        <div className="truncate text-xs text-subtle">
                          {st?.status === 'working' ? (st.note ?? '工作中…') : e.title}
                        </div>
                      </div>
                      <span
                        className={`ml-auto h-2 w-2 shrink-0 rounded-full ${st?.status === 'working' ? 'animate-pulse bg-brand' : 'bg-line'}`}
                        title={st?.status === 'working' ? 'session 进行中' : '空闲'}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* 创建团队弹窗（对齐 Accio：群聊模式 / 调度模式） */}
      {showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-6" onClick={() => setShowTeamModal(false)}>
          <div className="card w-full max-w-xl p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">创建团队</h2>
            <p className="mt-1 text-sm text-subtle">选择成员并设置协作模式，成员之间会相互协作完成任务。</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button className="rounded-2xl border-2 border-brand bg-brand-soft p-4 text-left">
                <div className="font-medium">调度模式</div>
                <div className="mt-1 text-xs text-subtle">TL 拆解任务、分派成员并验收（部门 Agent 默认模式）</div>
              </button>
              <button className="rounded-2xl border border-line p-4 text-left hover:bg-panel">
                <div className="font-medium">群聊模式</div>
                <div className="mt-1 text-xs text-subtle">通过 @ 与任意成员直接沟通</div>
              </button>
            </div>
            <div className="mt-4 max-h-48 space-y-1.5 overflow-y-auto">
              {agents.filter((a) => a.kind === 'employee').map((a) => (
                <label key={a.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                  <input type="checkbox" defaultChecked={a.employeeType === 'digital'} className="accent-brand" />
                  <span>{a.avatar}</span> {a.name}
                  <span className="ml-auto text-xs text-subtle">{a.title}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setShowTeamModal(false)}>取消</button>
              <button className="btn-brand" onClick={() => setShowTeamModal(false)}>创建团队</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
