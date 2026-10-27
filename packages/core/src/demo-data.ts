/**
 * 演示数据：一家三店铺的跨境电商（店铺、商品、订单全部虚构）。
 * 订单用固定种子的伪随机生成，服务端和浏览器算出来的 408 笔订单一模一样。
 */
import type { StoreOrder, WorkflowItem } from '@inflow/contracts';

export const STORES = [
  { store: '星尘家居', platform: 'TikTok Shop' },
  { store: '曜石数码', platform: '亚马逊' },
  { store: '拾光饰品', platform: 'TikTok Shop' },
] as const;

export const SKUS: Record<string, { sku: string; name: string; price: number; cogs: number }[]> = {
  星尘家居: [
    { sku: 'HOME-LAMP-01', name: '奶油风床头氛围灯', price: 189, cogs: 62 },
    { sku: 'HOME-RUG-02', name: '短绒防滑地毯 120×160', price: 259, cogs: 98 },
    { sku: 'HOME-SHELF-03', name: '原木三层置物架', price: 329, cogs: 145 },
  ],
  曜石数码: [
    { sku: 'TECH-HUB-01', name: '七合一扩展坞', price: 219, cogs: 88 },
    { sku: 'TECH-STAND-02', name: '铝合金笔记本支架', price: 129, cogs: 41 },
    { sku: 'TECH-CABLE-03', name: '240W 编织快充线', price: 59, cogs: 14 },
  ],
  拾光饰品: [
    { sku: 'ACC-RING-01', name: '极简素圈戒指', price: 79, cogs: 12 },
    { sku: 'ACC-NECK-02', name: '珍珠锁骨链', price: 129, cogs: 28 },
    { sku: 'ACC-EAR-03', name: '法式耳夹', price: 99, cogs: 18 },
  ],
};

/** 费用结构：「拾光饰品」达人佣金高、退款多，是演示里「看着赚钱其实在亏」的店 */
const PROFILE: Record<string, { adRate: number; infRate: number; refundProb: number; feeRate: number }> = {
  星尘家居: { adRate: 0.1, infRate: 0.05, refundProb: 0.05, feeRate: 0.08 },
  曜石数码: { adRate: 0.14, infRate: 0.02, refundProb: 0.07, feeRate: 0.08 },
  拾光饰品: { adRate: 0.2, infRate: 0.33, refundProb: 0.16, feeRate: 0.08 },
};

export const DATA_FROM = '2026-08-01';
export const DATA_TO = '2026-08-21';
export const DATA_DAYS = 21;
export const DATA_RANGE = `${DATA_FROM} 至 ${DATA_TO}`;

export function generateOrders(): StoreOrder[] {
  // 可复现的伪随机（线性同余）
  let seed = 20260822;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const orders: StoreOrder[] = [];
  for (const s of STORES) {
    const p = PROFILE[s.store];
    const count = 110 + Math.floor(rand() * 40);
    for (let i = 0; i < count; i++) {
      const item = SKUS[s.store][Math.floor(rand() * SKUS[s.store].length)];
      const qty = rand() < 0.85 ? 1 : 2;
      const revenue = item.price * qty;
      const cogs = item.cogs * qty + 8 + rand() * 12; // 采购 + 头程
      const platformFee = revenue * p.feeRate;
      const adCost = revenue * p.adRate * (0.5 + rand());
      const influencerFee = revenue * p.infRate * (0.6 + rand() * 0.8);
      const refund = rand() < p.refundProb ? revenue * (0.5 + rand() * 0.5) : 0;
      const day = String(1 + Math.floor(rand() * DATA_DAYS)).padStart(2, '0');
      orders.push({
        store: s.store,
        platform: s.platform,
        orderNo: `SO2608${day}${1000 + i}`,
        sku: item.sku,
        revenue: r2(revenue),
        cogs: r2(cogs),
        platformFee: r2(platformFee),
        adCost: r2(adCost),
        influencerFee: r2(influencerFee),
        refund: r2(refund),
        orderDate: `2026-08-${day}`,
      });
    }
  }
  return orders;
}

/** 投放漏斗参数（演示）：拾光饰品素材差、出价高；曜石数码点进来不买 */
export const AD_FUNNEL: Record<string, { ctr: number; cpc: number; cvr: number }> = {
  星尘家居: { ctr: 0.019, cpc: 1.15, cvr: 0.031 },
  曜石数码: { ctr: 0.021, cpc: 1.3, cvr: 0.012 },
  拾光饰品: { ctr: 0.007, cpc: 2.1, cvr: 0.026 },
};

/** 类目基准线（知识库《广告投放基准》） */
export const AD_BENCHMARK = { ctr: 0.015, cpc: 1.4, cvr: 0.025, minCtr: 0.012, maxCpc: 1.8, minCvr: 0.018 };

export const DEMO_WORKFLOWS: WorkflowItem[] = [
  { id: 'wf-1', name: '每日三店销售数据汇总', description: '每天早上从三个店铺后台导出昨日订单，手工合并到 Excel，计算 GMV 和毛利', owner: '财务专员', status: 'manual' },
  { id: 'wf-2', name: '达人结算单核对', description: '每月收到达人机构结算单后，逐单核对订单号与佣金金额，标记差异', owner: '财务专员', status: 'manual' },
  { id: 'wf-3', name: '客服常见问题回复', description: '物流查询、退款政策、尺码咨询等重复问题，每天人工回复约 150 条', owner: '客服主管', status: 'manual' },
  { id: 'wf-4', name: '商品上架检查', description: '新品上架前人工检查标题、五点描述、主图合规、类目与活动申报', owner: '运营主管', status: 'manual' },
  { id: 'wf-5', name: '广告日报整理', description: '每天从广告后台截图数据，粘贴到周报模板，标注异常波动', owner: '投放专员', status: 'manual' },
  { id: 'wf-6', name: '新品选品会', description: '每月一次，运营和老板根据趋势、供应链报价和竞品情况讨论下季度新品方向', owner: '运营主管', status: 'manual' },
];
