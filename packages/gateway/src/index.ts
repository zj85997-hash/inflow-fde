/**
 * @inflow/gateway — L0 模型网关。
 * 统一模型出入口：DeepSeek 真接，离线演示模型兜底，其余适配器留位；
 * 每次调用前过预算护栏，调用后回调用量（由上层记入成本账本）。
 */
import type { AdapterInfo, ChatMessage, ChatUsage, ModelMode } from '@inflow/contracts';

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 流式增量回调 */
  onDelta?: (text: string) => void;
  /** 归因信息，用于成本账本 */
  attribution: { agentId: string; taskId: string };
  /** 离线演示模型要输出的稿子（由技能用代码算好的数据生成） */
  draft?: string;
}

export interface ChatResult {
  content: string;
  usage: ChatUsage;
  model: string;
  simulated: boolean;
}

export interface ModelAdapter {
  info(): AdapterInfo;
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult>;
}

export type Pricing = Record<string, { input: number; output: number }>;

/** 每百万 token 的价格（人民币）。以官方最新价目表为准，可在设置页修改。 */
export const DEFAULT_PRICING: Pricing = {
  'deepseek-chat': { input: 2, output: 8 },
  'deepseek-reasoner': { input: 4, output: 16 },
};

export function estimateCostCny(model: string, usage: ChatUsage, pricing: Pricing = DEFAULT_PRICING): number {
  const p = pricing[model] ?? pricing['deepseek-chat'] ?? DEFAULT_PRICING['deepseek-chat'];
  return (usage.promptTokens * p.input + usage.completionTokens * p.output) / 1_000_000;
}

/** 粗估 token：中文约 0.6 token/字，其他约 4 字符/token */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length;
  return Math.ceil(cjk * 0.6 + (text.length - cjk) / 4);
}

export class GatewayError extends Error {
  constructor(public code: 'needs_key' | 'api_error' | 'budget_exceeded', message: string) {
    super(message);
  }
}

// ---------------- 离线演示模型 ----------------

/**
 * 不联网、不花钱。把技能预先算好的稿子按流式吐出来，
 * 用量按字数估算，成本按真实价目模拟，账本里标「模拟」。
 */
export class DemoAdapter implements ModelAdapter {
  constructor(private streamDelayMs = 16, private chunkSize = 8) {}

  info(): AdapterInfo {
    return { id: 'demo', name: '离线演示模型', status: 'ready', models: ['inflow-demo'] };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    const content = opts.draft ?? '（离线演示模型只会复述技能算好的稿子。这个请求没有稿子，接入 DeepSeek 后再试。）';
    if (opts.onDelta) {
      for (let i = 0; i < content.length; i += this.chunkSize) {
        opts.onDelta(content.slice(i, i + this.chunkSize));
        if (this.streamDelayMs > 0) await new Promise((r) => setTimeout(r, this.streamDelayMs));
      }
    }
    const usage: ChatUsage = {
      promptTokens: estimateTokens(messages.map((m) => m.content).join('\n')),
      completionTokens: estimateTokens(content),
    };
    return { content, usage, model: 'inflow-demo', simulated: true };
  }
}

// ---------------- DeepSeek（真实接入） ----------------

export class DeepSeekAdapter implements ModelAdapter {
  constructor(private apiKey: string | undefined, private baseUrl = 'https://api.deepseek.com') {}

  info(): AdapterInfo {
    return {
      id: 'deepseek',
      name: 'DeepSeek',
      status: this.apiKey ? 'ready' : 'needs_key',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      keyUrl: 'https://platform.deepseek.com/api_keys',
    };
  }

  async chat(messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new GatewayError(
        'needs_key',
        '未配置 DeepSeek API Key。请到 https://platform.deepseek.com/api_keys 创建 Key，写入 server/.env 的 DEEPSEEK_API_KEY 后重启服务。'
      );
    }
    const model = opts.model ?? 'deepseek-chat';
    const stream = Boolean(opts.onDelta);
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 2048,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new GatewayError('api_error', `DeepSeek API ${res.status}: ${body.slice(0, 300)}`);
    }

    if (!stream) {
      const json: any = await res.json();
      const usage: ChatUsage = {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
      };
      return { content: json.choices?.[0]?.message?.content ?? '', usage, model, simulated: false };
    }

    // SSE 流式解析
    let content = '';
    let usage: ChatUsage = { promptTokens: 0, completionTokens: 0 };
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json: any = JSON.parse(payload);
          const delta: string = json.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            content += delta;
            opts.onDelta?.(delta);
          }
          if (json.usage) {
            usage = {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          /* 忽略无法解析的行 */
        }
      }
    }
    // 个别情况下流结束但没给 usage，按字数估算兜底
    if (usage.promptTokens === 0 && usage.completionTokens === 0) {
      usage = {
        promptTokens: estimateTokens(messages.map((m) => m.content).join('\n')),
        completionTokens: estimateTokens(content),
      };
    }
    return { content, usage, model, simulated: false };
  }
}

// ---------------- 留位适配器（仅接口与状态，未实现调用） ----------------

class PlaceholderAdapter implements ModelAdapter {
  constructor(private meta: AdapterInfo) {}
  info(): AdapterInfo {
    return this.meta;
  }
  async chat(): Promise<ChatResult> {
    throw new GatewayError('needs_key', `${this.meta.name} 适配器尚未启用：${this.meta.status === 'needs_key' ? '配置后启用' : '即将推出'}`);
  }
}

// ---------------- 网关：路由 + 预算护栏 + 用量回调 ----------------

export interface UsageReport {
  model: string;
  agentId: string;
  taskId: string;
  usage: ChatUsage;
  costCny: number;
  simulated: boolean;
}

export interface GatewayConfig {
  deepseekApiKey?: string;
  /** 每次调用时读取，设置页改完立即生效 */
  getSettings?: () => { mode: ModelMode; model: string; dailyBudgetCny: number; maxTokensPerCall: number; pricing: Pricing };
  /** 今日已花费（元），用于预算护栏 */
  getSpentToday?: () => number;
  /** 强制只用离线演示模型（在线静态演示） */
  demoOnly?: boolean;
  /** 离线演示模型的流式间隔（毫秒），测试时设 0 */
  demoStreamDelayMs?: number;
  onUsage?: (u: UsageReport) => void;
}

export class ModelGateway {
  private adapters: Map<string, ModelAdapter> = new Map();

  constructor(private cfg: GatewayConfig) {
    this.adapters.set('demo', new DemoAdapter(cfg.demoStreamDelayMs));
    this.adapters.set('deepseek', new DeepSeekAdapter(cfg.demoOnly ? undefined : cfg.deepseekApiKey));
    this.adapters.set(
      'codex',
      new PlaceholderAdapter({ id: 'codex', name: 'OpenAI Codex', status: 'needs_key', models: ['codex'], keyUrl: 'https://platform.openai.com' })
    );
    this.adapters.set(
      'claude-code',
      new PlaceholderAdapter({ id: 'claude-code', name: 'Claude Code', status: 'needs_key', models: ['claude'], keyUrl: 'https://claude.ai' })
    );
    this.adapters.set('proxy', new PlaceholderAdapter({ id: 'proxy', name: '海外模型代理', status: 'coming_soon', models: [] }));
  }

  listAdapters(): AdapterInfo[] {
    return [...this.adapters.values()].map((a) => a.info());
  }

  get keyConfigured(): boolean {
    return !this.cfg.demoOnly && Boolean(this.cfg.deepseekApiKey);
  }

  /** 按设置决定这次调用走哪个适配器 */
  activeAdapter(): 'demo' | 'deepseek' {
    if (this.cfg.demoOnly) return 'demo';
    const mode = this.cfg.getSettings?.().mode ?? 'auto';
    if (mode === 'demo') return 'demo';
    if (mode === 'deepseek') return 'deepseek';
    return this.keyConfigured ? 'deepseek' : 'demo';
  }

  async chat(messages: ChatMessage[], opts: ChatOptions & { adapter?: string }): Promise<ChatResult> {
    const settings = this.cfg.getSettings?.();
    if (settings && this.cfg.getSpentToday) {
      const spent = this.cfg.getSpentToday();
      if (spent >= settings.dailyBudgetCny) {
        throw new GatewayError(
          'budget_exceeded',
          `今日预算已用完：已花 ¥${spent.toFixed(4)}，上限 ¥${settings.dailyBudgetCny}。到「设置」里调高预算，或明天再试。`
        );
      }
    }
    const id = opts.adapter ?? this.activeAdapter();
    const adapter = this.adapters.get(id);
    if (!adapter) throw new GatewayError('api_error', `未知适配器: ${id}`);
    const result = await adapter.chat(messages, {
      ...opts,
      model: opts.model ?? settings?.model,
      maxTokens: opts.maxTokens ?? settings?.maxTokensPerCall,
    });
    // 模拟调用按「当前所选真实模型」的价目估算，让账本看得出接真模型后大概花多少
    const priceModel = result.simulated ? (settings?.model ?? 'deepseek-chat') : result.model;
    const costCny = estimateCostCny(priceModel, result.usage, settings?.pricing);
    this.cfg.onUsage?.({
      model: result.model,
      agentId: opts.attribution.agentId,
      taskId: opts.attribution.taskId,
      usage: result.usage,
      costCny,
      simulated: result.simulated,
    });
    return result;
  }
}
