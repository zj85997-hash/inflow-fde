'use client';
import { useEffect, useMemo, useState } from 'react';
import type { PluginManifest, ConnectorDef } from '@inflow/contracts';
import { apiGet } from '@/lib/api';

const TABS = ['插件', '技能', '应用授权'] as const;

const STATUS_LABEL: Record<ConnectorDef['status'], { text: string; cls: string }> = {
  connected: { text: '已连接', cls: 'border-brand text-brand-dark' },
  not_connected: { text: '未连接', cls: '' },
  coming_soon: { text: '即将推出', cls: 'opacity-60' },
  auth_pending: { text: '授权未完成', cls: 'border-amber-400 text-amber-600' },
};

export default function PluginsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('插件');
  const [showDiy, setShowDiy] = useState(false);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);

  useEffect(() => {
    apiGet<PluginManifest[]>('/api/plugins').then(setPlugins).catch(() => {});
  }, []);

  const skillsByCategory = useMemo(() => {
    const map = new Map<string, { pluginName: string; skill: PluginManifest['skills'][number] }[]>();
    for (const p of plugins)
      for (const s of p.skills) {
        const list = map.get(s.category) ?? [];
        list.push({ pluginName: p.name, skill: s });
        map.set(s.category, list);
      }
    return [...map.entries()];
  }, [plugins]);

  const connectors = useMemo(
    () => plugins.flatMap((p) => p.connectors.map((c) => ({ ...c, plugin: p.name }))),
    [plugins]
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center gap-6 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-sm ${tab === t ? 'font-semibold text-ink' : 'text-subtle hover:text-ink'}`}
          >
            {t}
          </button>
        ))}
        <button className="btn-primary ml-auto !py-1.5 text-xs" onClick={() => setShowDiy((v) => !v)}>⬆ 上传（DIY）</button>
      </div>
      {showDiy && (
        <p className="mt-4 rounded-xl bg-panel px-4 py-3 text-xs leading-5 text-subtle">
          DIY 插件 = 一个文件夹 + 一份 manifest.json（技能、连接器、快捷入口、定时任务模板）。放进仓库的 <code>plugins/</code> 目录，重启服务端就会出现在这里。格式见 <code>plugins/cross-border-ecommerce/manifest.json</code>。
        </p>
      )}

      {tab === '插件' && (
        <div className="mt-6">
          <div className="mb-3 text-sm font-semibold">行业插件包</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {plugins.map((p) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{p.icon}</span>
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className="text-[11px] text-subtle">{p.vendor}</div>
                  </div>
                  <button className="btn-ghost ml-auto !px-2.5 !py-1 text-xs">
                    {p.id === 'cross-border-ecommerce' ? '✓ 已装' : '＋'}
                  </button>
                </div>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-subtle">{p.description}</p>
                <div className="mt-2 flex gap-1.5 text-[10px] text-subtle">
                  <span className="chip !py-0">{p.skills.length} 技能</span>
                  <span className="chip !py-0">{p.connectors.length} 连接器</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === '技能' && (
        <div className="mt-6 space-y-7">
          {skillsByCategory.map(([category, items]) => (
            <div key={category}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {category}
                <span className="text-xs font-normal text-subtle">{items.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {items.map(({ skill, pluginName }) => (
                  <div key={skill.id} className="card p-3.5">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>📘</span> {skill.name}
                      <button className="ml-auto text-subtle hover:text-ink">＋</button>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-subtle">{skill.description}</p>
                    <div className="mt-2 text-[10px] text-subtle/70">{pluginName}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-subtle">技能 = 提示词 + 流程 + 验收标准。点右上「上传」可 DIY 自定义技能。</p>
        </div>
      )}

      {tab === '应用授权' && (
        <div className="mt-6">
          <div className="mb-3 text-sm text-subtle">
            两类初始化：<span className="font-medium text-ink">已有接口 → 「Agent 协助接入」</span>；
            <span className="font-medium text-ink">非现成 → DIY 配置</span>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {connectors.map((c) => {
              const st = STATUS_LABEL[c.status];
              return (
                <div key={`${c.plugin}-${c.id}`} className={`card p-4 ${c.status === 'coming_soon' ? 'opacity-70' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{c.icon}</span>
                    <div className="text-sm font-semibold">{c.name}</div>
                    <span className={`chip ml-auto !py-0 ${st.cls}`}>{st.text}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-subtle">{c.description}</p>
                  <div className="mt-3">
                    {c.status === 'connected' && <span className="text-xs text-brand-dark">✓ 数据已同步</span>}
                    {c.status === 'not_connected' && (
                      <button className="btn-ghost !py-1 text-xs">
                        {c.onboarding === 'already_available' ? '🤝 Agent 协助接入' : '🛠️ DIY 配置'}
                      </button>
                    )}
                    {c.status === 'coming_soon' && <span className="text-xs text-subtle">敬请期待</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
