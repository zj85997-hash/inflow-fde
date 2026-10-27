'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ComparisonPlan } from '@inflow/contracts';
import { apiGet } from '@/lib/api';

export default function ComparePage() {
  const [plan, setPlan] = useState<ComparisonPlan | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<ComparisonPlan>('/api/compare')
      .then(setPlan)
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" />
          <p className="mt-3 text-sm text-subtle">AI 正在生成对比方案…</p>
        </div>
      </div>
    );
  if (!plan) return <div className="p-10 text-sm text-subtle">方案生成失败，请检查服务端。</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-10">
      <h1 className="text-center text-2xl font-bold">AI 企业转型 · 对比方案</h1>
      <p className="mt-2 text-center text-sm text-subtle">{plan.efficiencyGain}</p>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* 左：现状 */}
        <div className="card border-2 border-line p-6">
          <div className="text-lg font-bold text-subtle">{plan.current.title}</div>
          <ul className="mt-4 space-y-2 text-sm">
            {plan.current.points.map((p, i) => (
              <li key={i} className="flex gap-2"><span className="text-subtle">•</span>{p}</li>
            ))}
          </ul>
          <div className="mt-5 space-y-1.5">
            {plan.current.pros.map((p, i) => (
              <div key={i} className="text-xs text-brand-dark">✓ {p}</div>
            ))}
            {plan.current.cons.map((c, i) => (
              <div key={i} className="text-xs text-red-500">✗ {c}</div>
            ))}
          </div>
        </div>

        {/* 右：优化后 */}
        <div className="card border-2 border-brand p-6 ring-4 ring-brand-soft">
          <div className="flex items-center justify-between">
            <div className="text-lg font-bold text-brand-dark">{plan.optimized.title}</div>
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-white">推荐</span>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {plan.optimized.points.map((p, i) => (
              <li key={i} className="flex gap-2"><span className="text-brand-dark">•</span>{p}</li>
            ))}
          </ul>
          <div className="mt-5 space-y-1.5">
            {plan.optimized.pros.map((p, i) => (
              <div key={i} className="text-xs text-brand-dark">✓ {p}</div>
            ))}
            {plan.optimized.cons.map((c, i) => (
              <div key={i} className="text-xs text-amber-600">! {c}</div>
            ))}
          </div>
        </div>
      </div>

      {/* 报价 + CTA */}
      <div className="card mx-auto mt-8 flex max-w-xl flex-wrap items-center gap-6 p-6">
        <div>
          <div className="text-xs text-subtle">AI 转型交付一口价（含 3 个月陪跑）</div>
          <div className="mt-1 text-3xl font-extrabold">
            ¥{plan.priceCny.toLocaleString('zh-CN')}
          </div>
          <div className="mt-1 text-[11px] text-subtle">演示定价，不构成报价 · 正式报价按诊断结果出具</div>
        </div>
        <Link href="/" className="btn-brand ml-auto !px-6 !py-3 text-base">进入中台 →</Link>
      </div>
    </div>
  );
}
