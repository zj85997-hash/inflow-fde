'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { REPO_URL, STATIC_DEMO, apiGet, timeAgo, useEventStream } from '@/lib/api';
import { useStatus } from '@/lib/useStatus';
import Logo from './Logo';

const NAV = [
  { href: '/', icon: '✏️', label: '新任务' },
  { href: '/org', icon: '🏢', label: '组织' },
  { href: '/inbox', icon: '📥', label: '审批收件箱', badge: true },
  { href: '/plugins', icon: '🧩', label: '插件中心' },
  { href: '/schedules', icon: '⏰', label: '定时任务' },
  { href: '/workflows', icon: '🔁', label: '工作流管理' },
  { href: '/knowledge', icon: '☁️', label: '知识库' },
  { href: '/ledger', icon: '🧾', label: '成本账本' },
  { href: '/settings', icon: '⚙️', label: '设置' },
];

interface TaskRow { id: string; title: string; status: string; createdAt: number }

const STATUS_DOT: Record<string, string> = { running: '🟢 ', assigned: '🟢 ', created: '🟢 ', failed: '🔴 ', awaiting_approval: '🟡 ' };

export default function Sidebar() {
  const pathname = usePathname();
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [open, setOpen] = useState(false);
  const { status, offline } = useStatus();

  const load = () => apiGet<TaskRow[]>('/api/tasks').then(setTasks).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEventStream((ev) => {
    if (['task_created', 'task_completed', 'task_failed', 'approval_required'].includes(ev.type)) load();
  });
  useEffect(() => setOpen(false), [pathname]);

  const pending = status?.pendingApprovals ?? 0;
  const demoModel = status?.activeAdapter === 'demo';
  const model = offline
    ? { dot: 'bg-red-400', text: '服务端未连接（pnpm dev:server）' }
    : !status
      ? { dot: 'bg-line', text: '正在连接…' }
      : demoModel
        ? { dot: 'bg-amber-400', text: '离线演示模型 · 数字由代码真算' }
        : { dot: 'bg-brand', text: 'DeepSeek 已连接' };

  return (
    <>
      {/* 手机顶栏 */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center gap-2 border-b border-line bg-white/90 px-4 backdrop-blur md:hidden">
        <button aria-label="打开菜单" className="-ml-1 rounded-lg px-2 py-1 text-lg" onClick={() => setOpen(true)}>☰</button>
        <Logo size={22} />
        <span className="font-bold">InFlow FDE</span>
        {pending > 0 && (
          <Link href="/inbox" className="ml-auto rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">待审批 {pending}</Link>
        )}
      </div>
      {open && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r border-line bg-panel transition-transform md:static md:w-60 md:translate-x-0 md:bg-panel/80 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-5 pb-4 pt-5">
          <Logo />
          <span className="text-lg font-bold tracking-tight">InFlow FDE</span>
        </div>

        <nav className="px-3">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm ${
                pathname === n.href ? 'bg-white font-medium shadow-card' : 'text-subtle hover:bg-white/70'
              }`}
            >
              <span>{n.icon}</span>
              {n.label}
              {n.badge && pending > 0 && (
                <span className="ml-auto rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold leading-4 text-white">{pending}</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="mt-4 flex-1 overflow-y-auto px-3">
          <div className="px-3 pb-1 text-xs font-medium text-subtle">任务</div>
          {tasks.slice(0, 12).map((t) => (
            <Link
              key={t.id}
              href={`/?task=${t.id}`}
              className="group flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-subtle hover:bg-white/70"
            >
              <span className="truncate">
                {STATUS_DOT[t.status] ?? ''}
                {t.title}
              </span>
              <span className="ml-2 shrink-0 text-[10px] text-subtle/70">{timeAgo(t.createdAt)}</span>
            </Link>
          ))}
          {tasks.length === 0 && <div className="px-3 py-2 text-xs text-subtle/60">暂无任务</div>}
        </div>

        <div className="border-t border-line px-3 py-3">
          <Link href="/onboard" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-subtle hover:bg-white/70">
            <span>🚀</span> 企业 Onboard
          </Link>
          <Link href="/settings" className="mt-1 flex items-center gap-2 px-3 py-1 text-[11px] text-subtle hover:text-ink">
            <span className={`h-1.5 w-1.5 rounded-full ${model.dot}`} />
            {model.text}
          </Link>
          <div className="mt-1 flex items-center gap-2 px-3 py-1.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">老</div>
            <span className="text-sm">老板</span>
            <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-medium text-brand-dark">演示账号</span>
          </div>
          {STATIC_DEMO && (
            <div className="mt-1 flex gap-3 px-3 text-[11px] text-subtle">
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">GitHub 源码 ↗</a>
              <a href="https://zj85997-hash.github.io/" target="_blank" rel="noreferrer" className="hover:text-ink">作者主页 ↗</a>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
