import type { AppSettings, ModelMode } from '@inflow/contracts';
import { DEFAULT_PRICING } from '@inflow/gateway';

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'auto',
  model: 'deepseek-chat',
  dailyBudgetCny: 5,
  maxTokensPerCall: 2500,
  pricing: DEFAULT_PRICING,
  enabledSchedules: [],
};

export function mergeSettings(saved: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(saved ?? {}),
    pricing: { ...DEFAULT_SETTINGS.pricing, ...(saved?.pricing ?? {}) },
    enabledSchedules: saved?.enabledSchedules ?? [],
  };
}

export class SettingsError extends Error {}

const MODES: ModelMode[] = ['auto', 'demo', 'deepseek'];

function num(v: unknown, label: string, min: number, max: number): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
    throw new SettingsError(`${label}要在 ${min}–${max} 之间`);
  }
  return n;
}

/** 校验并合并一次修改，返回新设置和人能看懂的变更说明（写进操作留痕） */
export function applySettingsPatch(current: AppSettings, patch: Record<string, unknown>): { next: AppSettings; changes: string[] } {
  const next: AppSettings = { ...current, pricing: { ...current.pricing }, enabledSchedules: [...current.enabledSchedules] };
  const changes: string[] = [];
  if (patch.mode !== undefined) {
    if (!MODES.includes(patch.mode as ModelMode)) throw new SettingsError('模型模式只能是 auto / demo / deepseek');
    next.mode = patch.mode as ModelMode;
  }
  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string' || !(patch.model in next.pricing)) throw new SettingsError('模型不在计价表里');
    next.model = patch.model;
  }
  if (patch.dailyBudgetCny !== undefined) next.dailyBudgetCny = num(patch.dailyBudgetCny, '每日预算', 0, 100000);
  if (patch.maxTokensPerCall !== undefined) next.maxTokensPerCall = Math.round(num(patch.maxTokensPerCall, '单次最大 token', 256, 8192));
  if (patch.pricing !== undefined) {
    if (typeof patch.pricing !== 'object' || patch.pricing === null) throw new SettingsError('计价格式不对');
    for (const [model, p] of Object.entries(patch.pricing as Record<string, { input?: unknown; output?: unknown }>)) {
      if (!(model in next.pricing)) throw new SettingsError(`不认识的模型：${model}`);
      next.pricing[model] = {
        input: num(p?.input, `${model} 输入价`, 0, 1000),
        output: num(p?.output, `${model} 输出价`, 0, 1000),
      };
    }
  }
  if (patch.enabledSchedules !== undefined) {
    if (!Array.isArray(patch.enabledSchedules) || !patch.enabledSchedules.every((x) => typeof x === 'string')) {
      throw new SettingsError('定时任务列表格式不对');
    }
    next.enabledSchedules = patch.enabledSchedules as string[];
  }

  if (next.mode !== current.mode) changes.push(`模型模式 ${current.mode} → ${next.mode}`);
  if (next.model !== current.model) changes.push(`模型 ${current.model} → ${next.model}`);
  if (next.dailyBudgetCny !== current.dailyBudgetCny) changes.push(`每日预算 ¥${current.dailyBudgetCny} → ¥${next.dailyBudgetCny}`);
  if (next.maxTokensPerCall !== current.maxTokensPerCall) changes.push(`单次最大 token ${current.maxTokensPerCall} → ${next.maxTokensPerCall}`);
  for (const m of Object.keys(next.pricing)) {
    const a = current.pricing[m], b = next.pricing[m];
    if (!a || a.input !== b.input || a.output !== b.output) changes.push(`${m} 计价 → 输入 ¥${b.input} / 输出 ¥${b.output}（每百万 token）`);
  }
  return { next, changes };
}
