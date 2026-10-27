/**
 * L2 连接器背后的「算数」：利润、亏损订单、单品经济、投放漏斗。
 * 原则：规矩交给知识库记，算数交给代码算 —— 模型只负责把算好的数写成人话。
 */
import type { StoreOrder } from '@inflow/contracts';
import { AD_BENCHMARK, AD_FUNNEL, DATA_DAYS, SKUS, STORES } from './demo-data';
import { pct, yuan } from './util';

export const netOf = (o: StoreOrder) => o.revenue - o.cogs - o.platformFee - o.adCost - o.influencerFee - o.refund;

export interface StoreSummary {
  store: string;
  platform: string;
  orders: number;
  revenue: number;
  cogs: number;
  platformFee: number;
  adCost: number;
  influencerFee: number;
  refund: number;
  netProfit: number;
  netMargin: number;
  refundOrders: number;
  /** 退款订单上已计提的达人佣金（按合作条款应扣回） */
  refundCommission: number;
  lossOrders: number;
}

const storeRank = (name: string) => {
  const i = STORES.findIndex((s) => s.store === name);
  return i < 0 ? 99 : i;
};

function emptySummary(store: string, platform: string): StoreSummary {
  return {
    store, platform, orders: 0, revenue: 0, cogs: 0, platformFee: 0, adCost: 0, influencerFee: 0, refund: 0,
    netProfit: 0, netMargin: 0, refundOrders: 0, refundCommission: 0, lossOrders: 0,
  };
}

function finish(s: StoreSummary): StoreSummary {
  s.netProfit = s.revenue - s.cogs - s.platformFee - s.adCost - s.influencerFee - s.refund;
  s.netMargin = s.revenue ? s.netProfit / s.revenue : 0;
  return s;
}

export function summarizeStores(orders: StoreOrder[]): StoreSummary[] {
  const map = new Map<string, StoreSummary>();
  for (const o of orders) {
    let s = map.get(o.store);
    if (!s) map.set(o.store, (s = emptySummary(o.store, o.platform)));
    s.orders += 1;
    s.revenue += o.revenue;
    s.cogs += o.cogs;
    s.platformFee += o.platformFee;
    s.adCost += o.adCost;
    s.influencerFee += o.influencerFee;
    s.refund += o.refund;
    if (o.refund > 0) {
      s.refundOrders += 1;
      s.refundCommission += o.influencerFee;
    }
    if (netOf(o) < 0) s.lossOrders += 1;
  }
  return [...map.values()].map(finish).sort((a, b) => storeRank(a.store) - storeRank(b.store));
}

export function totalOf(stores: StoreSummary[]): StoreSummary {
  const t = emptySummary('合计', '');
  for (const s of stores) {
    t.orders += s.orders;
    t.revenue += s.revenue;
    t.cogs += s.cogs;
    t.platformFee += s.platformFee;
    t.adCost += s.adCost;
    t.influencerFee += s.influencerFee;
    t.refund += s.refund;
    t.refundOrders += s.refundOrders;
    t.refundCommission += s.refundCommission;
    t.lossOrders += s.lossOrders;
  }
  return finish(t);
}

/** 净利率最低的店 */
export function worstStore(stores: StoreSummary[]): StoreSummary {
  return [...stores].sort((a, b) => a.netMargin - b.netMargin)[0];
}

export type LosingOrder = StoreOrder & { netProfit: number };

/** 疑似亏损订单（单笔净利为负），最亏的在前 */
export function losingOrders(orders: StoreOrder[], limit = 12): LosingOrder[] {
  return orders
    .map((o) => ({ ...o, netProfit: netOf(o) }))
    .filter((o) => o.netProfit < 0)
    .sort((a, b) => a.netProfit - b.netProfit)
    .slice(0, limit);
}

/** 一笔亏损订单最主要的原因 */
export function lossReason(o: StoreOrder): string {
  if (o.refund > 0) return `退款 ${yuan(o.refund, 2)}`;
  const parts = [
    { label: '达人佣金', v: o.influencerFee },
    { label: '投流费', v: o.adCost },
    { label: '采购头程', v: o.cogs },
  ].sort((a, b) => b.v - a.v);
  return `${parts[0].label}占 ${pct(parts[0].v / o.revenue, 0)}`;
}

/** 费用占收入的比例，用来和其他店对比 */
export function costRatios(s: StoreSummary) {
  const r = (v: number) => (s.revenue ? v / s.revenue : 0);
  return {
    cogs: r(s.cogs),
    platformFee: r(s.platformFee),
    adCost: r(s.adCost),
    influencerFee: r(s.influencerFee),
    refund: r(s.refund),
  };
}

export const COST_LABELS: Record<keyof ReturnType<typeof costRatios>, string> = {
  cogs: '采购头程',
  platformFee: '平台费',
  adCost: '投流费',
  influencerFee: '达人佣金',
  refund: '退款',
};

// ---------------- 单品 ----------------

export function skuInfo(sku: string) {
  for (const [store, list] of Object.entries(SKUS)) {
    const item = list.find((x) => x.sku === sku);
    if (item) return { ...item, store };
  }
  return undefined;
}

export interface SkuStats {
  sku: string;
  name: string;
  store: string;
  price: number;
  orders: number;
  units: number;
  revenue: number;
  netProfit: number;
  netMargin: number;
  lossOrders: number;
  /** 平台费 + 投流 + 达人 + 退款 占收入的比例（随售价同比变化的部分） */
  variableRatio: number;
  influencerRatio: number;
  /** 每件的采购 + 头程 */
  unitCost: number;
}

export function skuStats(orders: StoreOrder[], sku: string): SkuStats | undefined {
  const info = skuInfo(sku);
  const list = orders.filter((o) => o.sku === sku);
  if (!info || list.length === 0) return undefined;
  let revenue = 0, cogs = 0, variable = 0, influencer = 0, units = 0, net = 0, lossOrders = 0;
  for (const o of list) {
    revenue += o.revenue;
    cogs += o.cogs;
    influencer += o.influencerFee;
    variable += o.platformFee + o.adCost + o.influencerFee + o.refund;
    units += Math.round(o.revenue / info.price);
    const n = netOf(o);
    net += n;
    if (n < 0) lossOrders += 1;
  }
  return {
    sku, name: info.name, store: info.store, price: info.price, orders: list.length, units, revenue,
    netProfit: net, netMargin: revenue ? net / revenue : 0, lossOrders,
    variableRatio: revenue ? variable / revenue : 0, influencerRatio: revenue ? influencer / revenue : 0,
    unitCost: units ? cogs / units : 0,
  };
}

export function allSkuStats(orders: StoreOrder[]): SkuStats[] {
  return Object.values(SKUS).flat().map((s) => skuStats(orders, s.sku)).filter((x): x is SkuStats => Boolean(x));
}

/**
 * 让净利率回到 target 的最低售价：P × (1 − 变动费率 − target) = 单件成本。
 * 变动费率太高（≥ 95%）时改价救不回来，返回 undefined。
 */
export function priceForMargin(s: SkuStats, target = 0.1, variableRatio = s.variableRatio): number | undefined {
  const room = 1 - variableRatio - target;
  if (room <= 0.05) return undefined;
  const raw = s.unitCost / room;
  return Math.ceil((raw + 1) / 10) * 10 - 1; // 取尾数 9 的价格
}

// ---------------- 投放漏斗 ----------------

export interface FunnelRow {
  store: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;
  cpc: number;
  cvr: number;
  roas: number;
  dailySpend: number;
  issues: ('素材' | '出价' | '落地页')[];
}

export function adFunnel(orders: StoreOrder[]): FunnelRow[] {
  return summarizeStores(orders).map((s) => {
    const f = AD_FUNNEL[s.store] ?? { ctr: AD_BENCHMARK.ctr, cpc: AD_BENCHMARK.cpc, cvr: AD_BENCHMARK.cvr };
    const clicks = s.adCost / f.cpc;
    const issues: FunnelRow['issues'] = [];
    if (f.ctr < AD_BENCHMARK.minCtr) issues.push('素材');
    if (f.cpc > AD_BENCHMARK.maxCpc) issues.push('出价');
    if (f.cvr < AD_BENCHMARK.minCvr) issues.push('落地页');
    return {
      store: s.store,
      spend: s.adCost,
      impressions: clicks / f.ctr,
      clicks,
      conversions: clicks * f.cvr,
      ctr: f.ctr,
      cpc: f.cpc,
      cvr: f.cvr,
      roas: s.adCost ? s.revenue / s.adCost : 0,
      dailySpend: s.adCost / DATA_DAYS,
      issues,
    };
  });
}

/** 预算挪移：从 ROAS 最低且有问题的店，挪 30% 日预算给 ROAS 最高且健康的店 */
export function budgetShift(rows: FunnelRow[]) {
  const sorted = [...rows].sort((a, b) => a.roas - b.roas);
  const from = sorted.find((r) => r.issues.length > 0);
  const to = [...sorted].reverse().find((r) => r.issues.length === 0);
  if (!from || !to || from.store === to.store) return undefined;
  return { from, to, amount: Math.round(from.dailySpend * 0.3) };
}
