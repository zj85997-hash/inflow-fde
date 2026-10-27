'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AppSettings, PluginManifest } from '@inflow/contracts';
import { apiGet, apiPost } from '@/lib/api';

export default function SchedulesPage() {
  const router = useRouter();
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    apiGet<PluginManifest[]>('/api/plugins').then(setPlugins).catch(() => {});
    apiGet<AppSettings>('/api/settings').then((s) => setEnabled(s.enabledSchedules)).catch(() => {});
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<string, PluginManifest['scheduleTemplates']>();
    for (const p of plugins)
      for (const t of p.scheduleTemplates) {
        map.set(t.category, [...(map.get(t.category) ?? []), t]);
      }
    return [...map.entries()];
  }, [plugins]);

  async function toggle(name: string) {
    const r = await apiPost<{ enabled: boolean }>('/api/schedules/toggle', { name });
    setEnabled((list) => (r.enabled ? [...list, name] : list.filter((x) => x !== name)));
  }

  async function runNow(name: string) {
    setBusy(name);
    try {
      const task = await apiPost<{ id: string }>('/api/schedules/run', { name });
      router.push(`/?task=${task.id}`);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-bold">定时任务</h1>
      <p className="mt-1 text-sm text-subtle">
        行业插件包带来的定时任务模板。现在可以启用（记在设置里）和手动运行一次；按时间自动触发的调度器在路线图里。
      </p>

      {byCategory.map(([category, templates]) => (
        <div key={category} className="mt-7">
          <div className="mb-3 text-base font-semibold">{category}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {templates.map((t) => {
              const on = enabled.includes(t.name);
              return (
                <div key={t.name} className={`card flex items-start gap-3 p-4 ${on ? 'ring-2 ring-brand-soft' : ''}`}>
                  <span className="text-xl">{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{t.name}</div>
                    <div className="mt-0.5 text-xs leading-5 text-subtle">{t.description}</div>
                    <div className="mt-2 flex gap-2">
                      <button className={`!px-2.5 !py-1 text-xs ${on ? 'btn-brand' : 'btn-ghost'}`} onClick={() => toggle(t.name)}>
                        {on ? '✓ 已启用' : '启用'}
                      </button>
                      <button className="btn-ghost !px-2.5 !py-1 text-xs" disabled={busy === t.name} onClick={() => runNow(t.name)}>
                        {busy === t.name ? '派发中…' : '▶ 立即运行一次'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {byCategory.length === 0 && <div className="mt-10 text-sm text-subtle">暂无模板（等待插件加载）</div>}
    </div>
  );
}
