'use client';
import { useEffect, useState } from 'react';
import type { AdapterInfo, AppSettings, ModelMode } from '@inflow/contracts';
import { REPO_URL, STATIC_DEMO, apiGet, apiPost, fmtCny } from '@/lib/api';
import { useStatus } from '@/lib/useStatus';

type SettingsView = AppSettings & { keyConfigured: boolean; staticDemo: boolean };

const MODES: { id: ModelMode; label: string; note: string }[] = [
  { id: 'auto', label: '自动', note: '配置了 DeepSeek Key 就用 DeepSeek，没有就用离线演示模型' },
  { id: 'demo', label: '离线演示模型', note: '不联网、不花钱：按技能模板出稿，数字照样由代码真算' },
  { id: 'deepseek', label: 'DeepSeek', note: '强制使用 DeepSeek；没配 Key 时任务会提示去配置' },
];

const ADAPTER_STATUS: Record<AdapterInfo['status'], { text: string; cls: string }> = {
  ready: { text: '可用', cls: 'border-brand text-brand-dark' },
  needs_key: { text: '配置后启用', cls: '' },
  coming_soon: { text: '即将推出', cls: 'opacity-60' },
};

export default function SettingsPage() {
  const [s, setS] = useState<SettingsView | null>(null);
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { status, reload } = useStatus();

  const load = () => apiGet<SettingsView>('/api/settings').then(setS).catch(() => setMsg({ ok: false, text: '读不到设置：服务端没启动？' }));
  useEffect(() => {
    load();
    apiGet<AdapterInfo[]>('/api/adapters').then(setAdapters).catch(() => {});
  }, []);

  if (!s) return <div className="p-10 text-sm text-subtle">{msg?.text ?? '加载中…'}</div>;

  const set = (patch: Partial<AppSettings>) => setS({ ...s, ...patch });
  const setPrice = (model: string, key: 'input' | 'output', v: string) =>
    set({ pricing: { ...s.pricing, [model]: { ...s.pricing[model], [key]: Number(v) } } });

  async function save() {
    if (!s) return;
    setSaving(true);
    setMsg(null);
    try {
      const next = await apiPost<AppSettings>('/api/settings', {
        mode: s.mode, model: s.model, dailyBudgetCny: s.dailyBudgetCny, maxTokensPerCall: s.maxTokensPerCall, pricing: s.pricing,
      });
      setS({ ...s, ...next });
      setMsg({ ok: true, text: '已保存，改动写进了操作留痕，下一次调用立即生效。' });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!window.confirm('清空所有任务、审批、账本和留痕，恢复演示初始状态？')) return;
    await apiPost('/api/admin/reset');
    await load();
    reload();
    setMsg({ ok: true, text: '演示数据已重置。' });
  }

  const spent = status?.spentTodayCny ?? 0;
  const used = s.dailyBudgetCny > 0 ? Math.min(100, (spent / s.dailyBudgetCny) * 100) : 100;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="mt-1 text-sm text-subtle">模型接入、成本护栏和计价。所有改动都写进操作留痕。</p>

      {/* 模型接入 */}
      <section className="card mt-6 p-5">
        <h2 className="font-semibold">模型接入</h2>
        <div className="mt-3 grid gap-2">
          {MODES.map((m) => {
            const disabled = s.staticDemo && m.id === 'deepseek';
            return (
              <label
                key={m.id}
                className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${s.mode === m.id ? 'border-brand bg-brand-soft' : 'border-line'} ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
              >
                <input type="radio" name="mode" className="mt-1 accent-brand" checked={s.mode === m.id} disabled={disabled} onChange={() => set({ mode: m.id })} />
                <span>
                  <span className="font-medium">{m.label}</span>
                  <span className="mt-0.5 block text-xs text-subtle">{m.note}</span>
                </span>
              </label>
            );
          })}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-subtle">默认模型</span>
            <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={s.model} onChange={(e) => set({ model: e.target.value })}>
              {Object.keys(s.pricing).map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <div className="text-sm">
            <span className="text-subtle">DeepSeek API Key</span>
            <div className={`mt-1 rounded-xl border px-3 py-2 text-sm ${s.keyConfigured ? 'border-brand text-brand-dark' : 'border-line text-subtle'}`}>
              {s.staticDemo ? '在线演示不接模型' : s.keyConfigured ? '✓ 已在 server/.env 配置' : '未配置'}
            </div>
          </div>
        </div>

        {!s.staticDemo && !s.keyConfigured && (
          <div className="mt-4 rounded-xl bg-panel px-4 py-3 text-xs leading-6 text-subtle">
            Key 只放在服务端，不经过浏览器：
            <pre className="mt-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-[11px] text-ink">{`cp server/.env.example server/.env
# 在 server/.env 里填 DEEPSEEK_API_KEY=…，然后重启 pnpm dev`}</pre>
            Key 在 <a className="text-brand-dark underline" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com</a> 创建。
          </div>
        )}
        {s.staticDemo && (
          <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
            这是部署在 GitHub Pages 上的在线演示，没有服务端，只能用离线演示模型。想接真模型：克隆仓库在本地运行，Key 填在 server/.env。
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {adapters.map((a) => (
            <span key={a.id} className={`chip ${ADAPTER_STATUS[a.status].cls}`}>
              {a.name} · {ADAPTER_STATUS[a.status].text}
            </span>
          ))}
        </div>
      </section>

      {/* 成本护栏 */}
      <section className="card mt-5 p-5">
        <h2 className="font-semibold">成本护栏</h2>
        <p className="mt-1 text-xs text-subtle">今日花费到达预算后，网关拒绝新的模型调用，任务会提示原因并写进操作留痕。</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="text-subtle">每日预算（元）</span>
            <input type="number" min={0} step="0.01" className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={s.dailyBudgetCny}
              onChange={(e) => set({ dailyBudgetCny: Number(e.target.value) })} />
          </label>
          <label className="block text-sm">
            <span className="text-subtle">单次调用最大 token</span>
            <input type="number" min={256} max={8192} step={1} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={s.maxTokensPerCall}
              onChange={(e) => set({ maxTokensPerCall: Number(e.target.value) })} />
          </label>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-xs text-subtle">
            <span>今日已花 {fmtCny(spent)}{status?.activeAdapter === 'demo' ? '（含模拟）' : ''}</span>
            <span>预算 {fmtCny(s.dailyBudgetCny)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-panel">
            <div className={`h-2 rounded-full ${used >= 100 ? 'bg-red-500' : used > 80 ? 'bg-amber-400' : 'bg-brand'}`} style={{ width: `${used}%` }} />
          </div>
        </div>
      </section>

      {/* 计价 */}
      <section className="card mt-5 p-5">
        <h2 className="font-semibold">计价（元 / 百万 token）</h2>
        <p className="mt-1 text-xs text-subtle">以 DeepSeek 官方最新价目为准。离线演示模型的调用按「默认模型」的价目模拟记账。</p>
        <div className="mt-3 space-y-2">
          {Object.entries(s.pricing).map(([model, p]) => (
            <div key={model} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm">
              <span className="truncate">{model}</span>
              <label className="flex items-center gap-1 text-xs text-subtle">
                输入
                <input type="number" min={0} step="0.1" className="w-20 rounded-lg border border-line px-2 py-1 text-sm text-ink" value={p.input} onChange={(e) => setPrice(model, 'input', e.target.value)} />
              </label>
              <label className="flex items-center gap-1 text-xs text-subtle">
                输出
                <input type="number" min={0} step="0.1" className="w-20 rounded-lg border border-line px-2 py-1 text-sm text-ink" value={p.output} onChange={(e) => setPrice(model, 'output', e.target.value)} />
              </label>
            </div>
          ))}
        </div>
      </section>

      <div className="sticky bottom-0 mt-5 flex flex-wrap items-center gap-3 bg-white py-3">
        <button className="btn-brand" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存设置'}</button>
        {msg && <span className={`text-sm ${msg.ok ? 'text-brand-dark' : 'text-red-600'}`}>{msg.text}</span>}
      </div>

      {/* 演示数据 */}
      <section className="card mt-5 p-5">
        <h2 className="font-semibold">演示数据</h2>
        <p className="mt-1 text-xs leading-5 text-subtle">
          三家虚构店铺 {status?.dataRange ?? ''} 的 408 笔订单，按固定种子生成，服务端和在线演示算出来的数一模一样。
          {STATIC_DEMO ? '在线演示的任务、审批和账本存在你自己浏览器的 localStorage 里。' : ''}
        </p>
        <button className="btn-ghost mt-3" onClick={reset}>重置演示数据</button>
      </section>

      <section className="mt-5 px-1 pb-10 text-xs leading-6 text-subtle">
        InFlow FDE · MIT 许可 · <a className="text-brand-dark hover:underline" href={REPO_URL} target="_blank" rel="noreferrer">GitHub 源码</a>
      </section>
    </div>
  );
}
