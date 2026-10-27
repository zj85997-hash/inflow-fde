'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';

const STORAGE_OPTIONS = [
  { id: 'local', label: '本地电脑 / Excel' },
  { id: 'cloud', label: '云端 SaaS 后台' },
  { id: 'private', label: '私有化部署系统' },
  { id: 'saas', label: '飞书/钉钉等协同表格' },
];

export default function OnboardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '星拾曜贸易（演示）',
    industry: 'cross-border-ecommerce',
    revenueRange: '5000万以下',
    headcount: 12,
    opsModel: '三店铺跨境电商：TikTok Shop × 2 + 亚马逊 × 1，自营选品+达人带货+付费投流',
    workflows: ['每日三店销售数据人工汇总', '达人结算单人工核对', '客服重复问题人工回复', '广告日报截图整理'],
    people: ['运营主管 1 人', '财务专员 1 人', '客服团队 5 人', '投放专员 2 人'],
    dataStorage: ['local', 'cloud'] as string[],
    existingSystems: ['店铺后台', 'Excel 台账', '微信群'],
  });
  const [wfText, setWfText] = useState(form.workflows.join('\n'));
  const [peopleText, setPeopleText] = useState(form.people.join('\n'));

  async function submit() {
    setSaving(true);
    const profile = {
      ...form,
      workflows: wfText.split('\n').filter(Boolean),
      people: peopleText.split('\n').filter(Boolean),
    };
    try {
      await apiPost('/api/onboard', profile);
      router.push('/compare');
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-10">
      <div className="mb-2 text-xs font-medium text-brand-dark">企业 Onboard · 第 {step} / 3 步</div>
      <div className="mb-6 h-1.5 w-full rounded-full bg-panel">
        <div className="h-1.5 rounded-full bg-brand transition-all" style={{ width: `${(step / 3) * 100}%` }} />
      </div>

      {step === 1 && (
        <div className="card p-6">
          <h1 className="text-xl font-bold">公司基本盘</h1>
          <p className="mt-1 text-sm text-subtle">告诉我们公司的行业、规模和运营模式</p>
          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="text-subtle">公司名称</span>
              <input className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="text-subtle">行业</span>
                <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}>
                  <option value="cross-border-ecommerce">跨境电商</option>
                  <option value="finance">金融</option>
                  <option value="indie-site">海外独立站</option>
                  <option value="manufacturing">传统制造</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-subtle">年营收区间</span>
                <select className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" value={form.revenueRange}
                  onChange={(e) => setForm({ ...form, revenueRange: e.target.value })}>
                  <option>5000万以下</option>
                  <option>5000万–1亿</option>
                  <option>1亿–3亿</option>
                  <option>3亿以上</option>
                </select>
              </label>
            </div>
            <label className="block text-sm">
              <span className="text-subtle">运营模式（一两句话）</span>
              <textarea rows={3} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={form.opsModel}
                onChange={(e) => setForm({ ...form, opsModel: e.target.value })} />
            </label>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card p-6">
          <h1 className="text-xl font-bold">工作流与人员</h1>
          <p className="mt-1 text-sm text-subtle">列出目前每天/每周在重复做的事情，和涉及的岗位（每行一条）</p>
          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="text-subtle">现有工作流</span>
              <textarea rows={5} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={wfText}
                onChange={(e) => setWfText(e.target.value)} />
            </label>
            <label className="block text-sm">
              <span className="text-subtle">涉及人员 / 岗位</span>
              <textarea rows={4} className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={peopleText}
                onChange={(e) => setPeopleText(e.target.value)} />
            </label>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card p-6">
          <h1 className="text-xl font-bold">数据资产</h1>
          <p className="mt-1 text-sm text-subtle">经营数据现在存在哪里？（多选）</p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {STORAGE_OPTIONS.map((o) => (
              <label key={o.id} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm ${form.dataStorage.includes(o.id) ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                <input
                  type="checkbox"
                  className="accent-brand"
                  checked={form.dataStorage.includes(o.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dataStorage: e.target.checked
                        ? [...form.dataStorage, o.id]
                        : form.dataStorage.filter((x) => x !== o.id),
                    })
                  }
                />
                {o.label}
              </label>
            ))}
          </div>
          <label className="mt-4 block text-sm">
            <span className="text-subtle">已有系统（逗号分隔）</span>
            <input className="mt-1 w-full rounded-xl border border-line px-3 py-2 text-sm" value={form.existingSystems.join('，')}
              onChange={(e) => setForm({ ...form, existingSystems: e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean) })} />
          </label>
        </div>
      )}

      <div className="mt-6 flex justify-between">
        <button className="btn-ghost" disabled={step === 1} onClick={() => setStep(step - 1)}>← 上一步</button>
        {step < 3 ? (
          <button className="btn-primary" onClick={() => setStep(step + 1)}>下一步 →</button>
        ) : (
          <button className="btn-brand" onClick={submit} disabled={saving}>
            {saving ? '生成方案中…' : '✨ 生成 AI 转型对比方案'}
          </button>
        )}
      </div>
    </div>
  );
}
