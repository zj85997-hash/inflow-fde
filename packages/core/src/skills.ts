/**
 * L3 方法论技能：每个数字员工一个。
 * - context()：给真模型的数据上下文（代码算好的事实）
 * - draft()：离线演示模型的稿子（同样的事实写成报告）
 * - propose()：涉及钱的建议动作，一律进审批收件箱，由人拍板
 */
import type { ApprovalKind, StoreOrder } from '@inflow/contracts';
import {
  COST_LABELS, adFunnel, allSkuStats, budgetShift, costRatios, losingOrders, lossReason, priceForMargin,
  skuStats, summarizeStores, totalOf, worstStore, type FunnelRow, type SkuStats, type StoreSummary,
} from './analytics';
import { AD_BENCHMARK, DATA_RANGE, STORES } from './demo-data';
import { INFLUENCER_TERMS, LISTING_CHECKLIST, REFUND_POLICY } from './knowledge';
import { mdTable, pct, round2, yuan } from './util';

export interface SkillContext {
  prompt: string;
  orders: StoreOrder[];
}

export interface ProposedAction {
  kind: ApprovalKind;
  title: string;
  reason: string;
  amountCny?: number;
  risk: 'low' | 'medium' | 'high';
}

export interface Skill {
  context(c: SkillContext): string;
  draft(c: SkillContext): string;
  propose(c: SkillContext): ProposedAction[];
}

const HUMAN_GATE = '> 需要人拍板的动作已进入「审批收件箱」，批准前不会执行。';

// ---------------- 利润分析师 ----------------

type ProfitIntent = 'summary' | 'losses' | 'settlement';

export function profitIntent(prompt: string): ProfitIntent {
  if (/结算|达人|佣金/.test(prompt)) return 'settlement';
  if (/亏损订单|亏损的订单|亏损单|哪些订单/.test(prompt)) return 'losses';
  return 'summary';
}

function overviewTable(stores: StoreSummary[]): string {
  const total = totalOf(stores);
  const row = (s: StoreSummary, bold = false) => {
    const b = (x: string) => (bold ? `**${x}**` : x);
    return [
      b(s.platform ? `${s.store}（${s.platform}）` : s.store), s.orders, yuan(s.revenue), yuan(s.cogs), yuan(s.platformFee),
      yuan(s.adCost), yuan(s.influencerFee), yuan(s.refund), b(yuan(s.netProfit)), b(pct(s.netMargin)),
    ];
  };
  return mdTable(
    ['店铺', '订单', '收入', '采购头程', '平台费', '投流', '达人佣金', '退款', '净利', '净利率'],
    [...stores.map((s) => row(s)), row(total, true)]
  );
}

/** 最差店铺的费用率，和另外几家的平均比，多出来的就是漏钱的地方 */
function leaks(stores: StoreSummary[], worst: StoreSummary) {
  const others = stores.filter((s) => s.store !== worst.store);
  const mine = costRatios(worst);
  return (Object.keys(mine) as (keyof typeof mine)[])
    .filter((k) => k !== 'cogs' && k !== 'platformFee')
    .map((k) => {
      const avg = others.reduce((n, s) => n + costRatios(s)[k], 0) / Math.max(1, others.length);
      return { key: k, label: COST_LABELS[k], mine: mine[k], avg, diff: mine[k] - avg };
    })
    .filter((x) => x.diff > 0.005)
    .sort((a, b) => b.diff - a.diff);
}

function clawbackAction(s: StoreSummary): ProposedAction {
  return {
    kind: 'settlement',
    title: `下期结算扣回${s.store} ${s.refundOrders} 笔退款订单的达人佣金`,
    amountCny: round2(s.refundCommission),
    reason: `${s.store}本期有 ${s.refundOrders} 笔订单发生退款，这些订单已计提达人佣金 ${yuan(s.refundCommission, 2)}。按《达人合作条款 2026》第 3 条，应在下期结算中扣回。`,
    risk: s.refundCommission >= 500 ? 'high' : s.refundCommission >= 100 ? 'medium' : 'low',
  };
}

const profit: Skill = {
  context({ orders }) {
    const stores = summarizeStores(orders);
    const losers = losingOrders(orders, 8);
    return [
      `以下是「店铺经营数据」连接器的汇总（单位：元，区间 ${DATA_RANGE}）：`,
      '',
      overviewTable(stores),
      '',
      '退款订单上已计提的达人佣金：',
      mdTable(['店铺', '退款订单', '已计提佣金'], stores.map((s) => [s.store, s.refundOrders, yuan(s.refundCommission, 2)])),
      '',
      '疑似亏损订单（净利为负，最多 8 笔）：',
      mdTable(['店铺', '订单号', 'SKU', '收入', '净利', '主要原因'], losers.map((o) => [o.store, o.orderNo, o.sku, yuan(o.revenue, 2), yuan(o.netProfit, 2), lossReason(o)])),
      '',
      `知识库《达人合作条款 2026》：\n${INFLUENCER_TERMS}`,
    ].join('\n');
  },

  draft({ prompt, orders }) {
    const stores = summarizeStores(orders);
    const total = totalOf(stores);
    const worst = worstStore(stores);
    const intent = profitIntent(prompt);
    const head = `数据区间 ${DATA_RANGE}，共 ${total.orders} 笔订单。所有数字由「店铺经营数据」连接器逐笔算出，模型只负责写结论。`;

    if (intent === 'settlement') {
      const refundRows = orders
        .filter((o) => o.refund > 0)
        .sort((a, b) => b.influencerFee - a.influencerFee)
        .slice(0, 10)
        .map((o) => [o.store, o.orderNo, yuan(o.revenue, 2), yuan(o.refund, 2), yuan(o.influencerFee, 2)]);
      const overRed = stores.filter((s) => costRatios(s).influencerFee > 0.2);
      return [
        '## 达人结算核对',
        '',
        head,
        '依据《达人合作条款 2026》第 3 条：发生退款的订单，已计提的佣金在下期结算中扣回。',
        '',
        mdTable(
          ['店铺', '达人佣金合计', '佣金率', '退款订单', '退款订单上的佣金（应扣回）'],
          [
            ...stores.map((s) => [s.store, yuan(s.influencerFee, 2), pct(costRatios(s).influencerFee), s.refundOrders, yuan(s.refundCommission, 2)]),
            ['**合计**', `**${yuan(total.influencerFee, 2)}**`, pct(costRatios(total).influencerFee), total.refundOrders, `**${yuan(total.refundCommission, 2)}**`],
          ]
        ),
        '',
        '### 需要重点看的',
        ...overRed.map((s) => `- **${s.store}** 佣金率 ${pct(costRatios(s).influencerFee)}，超过第 4 条的 20% 红线，需要财务和运营主管共同确认。`),
        `- 退款订单上的佣金三家合计 ${yuan(total.refundCommission, 2)}，已按店铺拆成 ${stores.filter((s) => s.refundCommission > 0).length} 条审批，批准后从下期结算单中扣除。`,
        '',
        '### 退款订单佣金明细（佣金最高的 10 笔）',
        mdTable(['店铺', '订单号', '收入', '退款', '已计提佣金'], refundRows),
        '',
        HUMAN_GATE,
      ].join('\n');
    }

    if (intent === 'losses') {
      const all = losingOrders(orders, orders.length);
      const byStore = stores
        .map((s) => {
          const list = all.filter((o) => o.store === s.store);
          const refundLed = list.filter((o) => o.refund > 0).length;
          return { s, list, refundLed, loss: list.reduce((n, o) => n + o.netProfit, 0) };
        })
        .filter((x) => x.list.length > 0);
      const feeLed = byStore.filter((x) => x.list.length - x.refundLed > 0);
      const refundOnly = byStore.filter((x) => x.list.length === x.refundLed);
      return [
        '## 疑似亏损订单拆解',
        '',
        head,
        `净利为负的订单共 **${all.length} 笔**，合计亏 ${yuan(-all.reduce((n, o) => n + o.netProfit, 0), 2)}。`,
        '',
        mdTable(
          ['店铺', '亏损订单', '占该店订单', '亏损合计', '其中因退款'],
          byStore.map((x) => [x.s.store, x.list.length, pct(x.list.length / x.s.orders), yuan(x.loss, 2), `${x.refundLed} 笔`])
        ),
        '',
        '### 最亏的 10 笔',
        mdTable(['店铺', '订单号', '日期', 'SKU', '收入', '净利', '主要原因'], all.slice(0, 10).map((o) => [o.store, o.orderNo, o.orderDate, o.sku, yuan(o.revenue, 2), yuan(o.netProfit, 2), lossReason(o)])),
        '',
        '### 结论',
        ...(refundOnly.length ? [`- ${refundOnly.map((x) => x.s.store).join('、')}的亏损单全部来自退款：单子本身赚钱，退款把利润吃掉了。`] : []),
        ...feeLed.map((x) => `- ${x.s.store}有 ${x.list.length - x.refundLed} 笔亏损单没有退款，问题出在费用结构：达人佣金和投流费合计占收入的 ${pct(costRatios(x.s).influencerFee + costRatios(x.s).adCost)}。`),
        `- 退款订单上已计提的达人佣金，按《达人合作条款》第 3 条应扣回；${worst.store}的 ${yuan(worst.refundCommission, 2)} 已提交审批。`,
        '',
        HUMAN_GATE,
      ].join('\n');
    }

    const lk = leaks(stores, worst);
    const losers = losingOrders(orders, 5);
    const lossCount = losingOrders(orders, orders.length).length;
    return [
      '## 三店铺利润汇总',
      '',
      head,
      '',
      '### 1. 总览',
      overviewTable(stores),
      '',
      `### 2. 净利率最低：${worst.store}（${pct(worst.netMargin)}）`,
      `采购头程只占收入的 ${pct(costRatios(worst).cogs)}，毛利是三家里最高的；钱漏在后面几项（和另外两家的平均水平比）：`,
      '',
      mdTable(['费用', worst.store, '另两家平均', '多出'], lk.map((x) => [x.label, pct(x.mine), pct(x.avg), `+${(x.diff * 100).toFixed(1)} 个点`])),
      '',
      '### 3. 疑似亏损订单',
      `净利为负的订单共 ${lossCount} 笔（${stores.map((s) => `${s.store} ${s.lossOrders} 笔`).join('、')}）。最亏的 5 笔：`,
      '',
      mdTable(['店铺', '订单号', 'SKU', '收入', '净利', '主要原因'], losers.map((o) => [o.store, o.orderNo, o.sku, yuan(o.revenue, 2), yuan(o.netProfit, 2), lossReason(o)])),
      '',
      '### 4. 建议',
      `1. **达人佣金**：${worst.store}佣金率 ${pct(costRatios(worst).influencerFee)}，超过《达人合作条款》第 4 条的 20% 红线。逐个复核合作，改成阶梯佣金。`,
      `2. **退款扣佣**：本期 ${worst.refundOrders} 笔退款订单已计提佣金 ${yuan(worst.refundCommission, 2)}，按条款第 3 条应在下期结算中扣回（已提交审批）。`,
      `3. **投流**：${worst.store}投流费占收入 ${pct(costRatios(worst).adCost)}，已转给投放部「广告归因师」查是素材还是出价的问题。`,
      '',
      HUMAN_GATE,
    ].join('\n');
  },

  propose({ prompt, orders }) {
    const stores = summarizeStores(orders);
    if (profitIntent(prompt) === 'settlement') return stores.filter((s) => s.refundCommission > 0).map(clawbackAction);
    const worst = worstStore(stores);
    return worst.refundCommission > 0 ? [clawbackAction(worst)] : [];
  },
};

// ---------------- 广告归因师 ----------------

function issueText(r: FunnelRow): string {
  if (r.issues.length === 0) return `三项都在警戒线以内，ROAS ${r.roas.toFixed(1)}，是最值得加预算的店。`;
  const parts: string[] = [];
  if (r.issues.includes('素材')) parts.push(`CTR ${pct(r.ctr)}，低于警戒线 ${pct(AD_BENCHMARK.minCtr)} → 素材问题，前 3 秒没抓住人`);
  if (r.issues.includes('出价')) parts.push(`CPC ¥${r.cpc.toFixed(2)}，高于警戒线 ¥${AD_BENCHMARK.maxCpc.toFixed(2)} → 出价偏高或人群太窄`);
  if (r.issues.includes('落地页')) parts.push(`CTR 正常但 CVR ${pct(r.cvr)}，低于警戒线 ${pct(AD_BENCHMARK.minCvr)} → 点进来不买，问题在详情页/落地页`);
  return parts.join('；') + '。';
}

function funnelTable(rows: FunnelRow[]): string {
  const warn = (bad: boolean, v: string) => (bad ? `**${v}**` : v);
  return mdTable(
    ['店铺', '花费', '展示', '点击', 'CTR', 'CPC', '转化', 'CVR', 'ROAS', '诊断'],
    rows.map((r) => [
      r.store, yuan(r.spend), `${(r.impressions / 10000).toFixed(1)} 万`, Math.round(r.clicks).toLocaleString('zh-CN'),
      warn(r.issues.includes('素材'), pct(r.ctr)), warn(r.issues.includes('出价'), `¥${r.cpc.toFixed(2)}`), Math.round(r.conversions),
      warn(r.issues.includes('落地页'), pct(r.cvr)), r.roas.toFixed(1), r.issues.length ? r.issues.join(' + ') : '健康',
    ])
  );
}

const benchmarkLine = `基准（知识库《广告投放基准》）：CTR ${pct(AD_BENCHMARK.ctr)}、CPC ¥${AD_BENCHMARK.cpc.toFixed(2)}、CVR ${pct(AD_BENCHMARK.cvr)}；警戒线 CTR < ${pct(AD_BENCHMARK.minCtr)}、CPC > ¥${AD_BENCHMARK.maxCpc.toFixed(2)}、CVR < ${pct(AD_BENCHMARK.minCvr)}。`;

const ads: Skill = {
  context({ orders }) {
    return [`以下是投放漏斗数据（区间 ${DATA_RANGE}，ROAS = 店铺收入 ÷ 投流花费）：`, '', funnelTable(adFunnel(orders)), '', benchmarkLine].join('\n');
  },

  draft({ orders }) {
    const rows = adFunnel(orders);
    const shift = budgetShift(rows);
    const skus = allSkuStats(orders);
    const weakSku = (store: string) => skus.filter((s) => s.store === store).sort((a, b) => a.netMargin - b.netMargin)[0];
    const tips = rows
      .filter((r) => r.issues.length)
      .map((r) => {
        const t: string[] = [];
        if (r.issues.includes('素材')) t.push('停掉 CTR 最低的素材组，重做前 3 秒');
        if (r.issues.includes('出价')) t.push('出价先降 15%，观察 3 天');
        if (r.issues.includes('落地页')) t.push(`优先查 ${weakSku(r.store)?.sku ?? '主推款'} 的详情页（价格锚点、评价数、配送时效）`);
        return `**${r.store}**：${t.join('；')}。`;
      });
    return [
      `## 投放归因（${DATA_RANGE}）`,
      '',
      funnelTable(rows),
      '',
      benchmarkLine,
      '',
      '### 逐店诊断',
      ...rows.map((r) => `- **${r.store}**：${issueText(r)}`),
      '',
      '### 建议',
      ...tips.map((t, i) => `${i + 1}. ${t}`),
      ...(shift
        ? [`${tips.length + 1}. **预算**：每天从${shift.from.store}挪 ¥${shift.amount} 到${shift.to.store}（已提交审批，批准前不改投放后台）。`]
        : []),
      '',
      HUMAN_GATE,
    ].join('\n');
  },

  propose({ orders }) {
    const shift = budgetShift(adFunnel(orders));
    if (!shift) return [];
    return [
      {
        kind: 'budget',
        title: `每日投流预算：${shift.from.store} −¥${shift.amount}，${shift.to.store} +¥${shift.amount}`,
        amountCny: shift.amount,
        reason: `${shift.from.store} ROAS ${shift.from.roas.toFixed(1)}，问题在${shift.from.issues.join('和')}；${shift.to.store} ROAS ${shift.to.roas.toFixed(1)}，各项健康。挪 ${shift.from.store}日均花费（${yuan(shift.from.dailySpend)}）的 30%。`,
        risk: 'medium',
      },
    ];
  },
};

// ---------------- 客服应答员 ----------------

const wantsRefund = (p: string) => /退款|退钱|退货|赔/.test(p);
const aboutLogistics = (p: string) => /物流|快递|没到|没收到|太慢|发货/.test(p);
const aboutSize = (p: string) => /尺码|尺寸|大小|戒圈/.test(p);

/** 客户给了订单号就用它；没给就取「拾光饰品」最近一笔没退款的订单（演示） */
export function pickOrder(prompt: string, orders: StoreOrder[]) {
  const no = prompt.match(/SO\d{10}/)?.[0];
  const hit = no ? orders.find((o) => o.orderNo === no) : undefined;
  if (hit) return { order: hit, guessed: false };
  const sample = orders
    .filter((o) => o.store === STORES[2].store && o.refund === 0)
    .sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.orderNo.localeCompare(a.orderNo))[0];
  return { order: sample, guessed: true };
}

function parseAmount(prompt: string): number | undefined {
  const m = prompt.match(/(?:¥|￥)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块)/);
  const v = m ? Number(m[1] ?? m[2]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

const cs: Skill = {
  context({ prompt, orders }) {
    const { order } = pickOrder(prompt, orders);
    return [
      `知识库《公司退款政策 v3》：\n${REFUND_POLICY}`,
      '',
      `关联订单：${order.orderNo}（${order.store}，${order.sku}，实付 ${yuan(order.revenue, 2)}，下单 ${order.orderDate}）`,
    ].join('\n');
  },

  draft({ prompt, orders }) {
    const { order, guessed } = pickOrder(prompt, orders);
    const amount = parseAmount(prompt) ?? order.revenue;
    const sku = skuStats(orders, order.sku);
    const orderLine = `**关联订单**：${order.orderNo} · ${order.store} · ${sku?.name ?? order.sku} · 实付 ${yuan(order.revenue, 2)} · 下单 ${order.orderDate}` +
      (guessed ? '\n（客户没给订单号，演示里取该店最近一笔未退款的订单。）' : '');

    if (wantsRefund(prompt) || aboutLogistics(prompt)) {
      const refund = wantsRefund(prompt);
      return [
        '## 客服回复草稿',
        '',
        orderLine,
        '',
        '**给客户的回复**（确认物流情况后可直接复制）：',
        '',
        '> 亲，非常抱歉让您久等了 🙏 我们已经联系物流加急核查您的包裹。',
        '> 按照我们的售后政策，如果从发货算起超过 15 天还没签收，您可以选：',
        `> ① 申请全额退款 ${yuan(amount, 2)}；`,
        '> ② 领取一张 15% 无门槛券，继续等包裹。',
        '> 您选哪一种，回复我就行，我马上帮您登记。',
        '',
        '**内部备注**',
        '- 先在物流后台确认是否已超过 15 天未签收；超过才适用《公司退款政策 v3》第 2 条。',
        refund
          ? `- 退款 ${yuan(amount, 2)} 已提交审批。**需人工确认**：主管批准前，不要对客户说「已退款」（政策第 4 条）。`
          : '- 客户还没提退款，先安抚并给出两个选项，不主动推退款。',
      ].join('\n');
    }

    if (aboutSize(prompt)) {
      return [
        '## 客服回复草稿',
        '',
        '**给客户的回复**：',
        '',
        '> 亲，戒圈可以这样量：用一条细纸条绕手指一圈，量出长度，对照详情页的尺码表选就好。',
        '> 两个尺码之间犹豫的话，建议选大一号，戴着更舒服 😊',
        '',
        '**内部备注**',
        '- 知识库里还没有尺码对照表，已记为待补资料；上架专员检查商品卡时会一起标出来。',
      ].join('\n');
    }

    return [
      '## 客服回复草稿',
      '',
      '**给客户的回复**：',
      '',
      '> 亲，收到您的问题了，我这边先帮您查一下，稍后给您准确答复，感谢您的耐心 🙏',
      '',
      '**内部备注**',
      '- 知识库里没有命中这个问题，建议转人工处理，并把答案补进知识库。',
    ].join('\n');
  },

  propose({ prompt, orders }) {
    if (!wantsRefund(prompt)) return [];
    const { order } = pickOrder(prompt, orders);
    const amount = round2(parseAmount(prompt) ?? order.revenue);
    return [
      {
        kind: 'refund',
        title: `退款给客户：订单 ${order.orderNo}`,
        amountCny: amount,
        reason: `客户诉求：「${prompt.slice(0, 40)}」。依据《公司退款政策 v3》第 2 条，物流超 15 天未签收可全额退款；第 4 条要求退款由主管确认。批准前请先核实物流时效。`,
        risk: amount >= 500 ? 'high' : amount >= 200 ? 'medium' : 'low',
      },
    ];
  },
};

// ---------------- 上架专员 ----------------

export function pickSku(prompt: string, orders: StoreOrder[]): SkuStats {
  const all = allSkuStats(orders);
  const named = prompt.toUpperCase().match(/[A-Z]{2,5}-[A-Z]{2,6}-\d{2}/)?.[0];
  return all.find((s) => s.sku === named) ?? [...all].sort((a, b) => a.netMargin - b.netMargin)[0];
}

const BANNED = /最|第一|100%|顶级/;
const TARGET_MARGIN = 0.1;
const COMMISSION_CAP = 0.2;

function pricePlan(s: SkuStats) {
  const need = priceForMargin(s, TARGET_MARGIN);
  const feasible = need !== undefined && need > s.price && need <= s.price * 1.3;
  const capped = s.variableRatio - Math.max(0, s.influencerRatio - COMMISSION_CAP);
  const needCapped = priceForMargin(s, TARGET_MARGIN, capped);
  return { need, feasible, needCapped, ok: s.netMargin >= TARGET_MARGIN };
}

const listing: Skill = {
  context({ prompt, orders }) {
    const s = pickSku(prompt, orders);
    return [
      `商品：${s.sku} ${s.name}（${s.store}），售价 ¥${s.price}`,
      `近 ${DATA_RANGE}：${s.orders} 单 / ${s.units} 件，收入 ${yuan(s.revenue, 2)}，净利 ${yuan(s.netProfit, 2)}（${pct(s.netMargin)}），亏损单 ${s.lossOrders} 笔。`,
      `单件采购头程 ${yuan(s.unitCost, 2)}；平台费 + 投流 + 达人 + 退款合计占收入 ${pct(s.variableRatio)}（其中达人佣金 ${pct(s.influencerRatio)}）。`,
      '',
      `知识库《上架检查清单》：\n${LISTING_CHECKLIST.map((c, i) => `${i + 1}. ${c.item}`).join('\n')}`,
    ].join('\n');
  },

  draft({ prompt, orders }) {
    const s = pickSku(prompt, orders);
    const plan = pricePlan(s);
    const rows = [
      ['标题 ≤ 80 字符，核心词前置', s.name.length <= 80 ? '✅' : '❌', `标题「${s.name}」${s.name.length} 个字`],
      ['不含禁用词（最、第一、100%、顶级）', BANNED.test(s.name) ? '❌' : '✅', BANNED.test(s.name) ? '命中禁用词' : '未命中'],
      ['五点描述齐全', '⚠️', '待补：SKU 台账里还没有五点描述'],
      ['主图白底、无水印、无边框', '👀', '需人工看图：图片合规不让 AI 拍板'],
      ['类目与活动申报一致', '⚠️', '待补：没有活动申报记录'],
      ['单品净利率 ≥ 10%', plan.ok ? '✅' : '❌', `近 21 天 ${s.orders} 单，净利率 ${pct(s.netMargin)}，亏损 ${s.lossOrders} 单`],
    ];
    const pricing: string[] = [
      '### 单品利润核算',
      `售价 ¥${s.price}，单件采购头程 ${yuan(s.unitCost, 2)}；平台费、投流、达人佣金、退款合计占收入 ${pct(s.variableRatio)}（达人佣金 ${pct(s.influencerRatio)}）。`,
      '',
    ];
    if (plan.ok) {
      pricing.push(`- 当前售价有利润空间，不需要改价。`);
    } else if (plan.feasible) {
      pricing.push(`- 想让净利率回到 10%，售价至少 ¥${plan.need}（+${pct(plan.need! / s.price - 1, 0)}）。改价影响所有在售链接，已提交审批。`);
    } else {
      pricing.push(
        plan.need
          ? `- 想让净利率回到 10%，售价要到 ¥${plan.need}（+${pct(plan.need / s.price - 1, 0)}），单靠改价不现实。`
          : '- 费用率太高，改价救不回来。',
        plan.needCapped && s.influencerRatio > COMMISSION_CAP
          ? plan.needCapped <= s.price
            ? `- 如果先把达人佣金率从 ${pct(s.influencerRatio)} 谈到 20% 以内，不用改价，净利率就能回到 10% 以上。`
            : `- 如果先把达人佣金率从 ${pct(s.influencerRatio)} 谈到 20% 以内，售价调到 ¥${plan.needCapped} 就能回到 10%。`
          : '- 需要先压投流和退款。',
        '- 建议：先由运营主管和达人重谈佣金，再决定是否改价。'
      );
    }
    return [
      `## 商品卡上架检查：${s.sku} ${s.name}（${s.store}）`,
      '',
      mdTable(['检查项', '结果', '说明'], rows),
      '',
      ...pricing,
      ...(plan.feasible ? ['', HUMAN_GATE] : []),
    ].join('\n');
  },

  propose({ prompt, orders }) {
    const s = pickSku(prompt, orders);
    const plan = pricePlan(s);
    if (!plan.feasible || !plan.need) return [];
    return [
      {
        kind: 'price',
        title: `${s.sku} ${s.name} 售价 ¥${s.price} → ¥${plan.need}`,
        reason: `近 21 天净利率 ${pct(s.netMargin)}，${s.lossOrders} 单亏损。按当前费用结构（变动费率 ${pct(s.variableRatio)}、单件成本 ${yuan(s.unitCost, 2)}），售价 ¥${plan.need} 时净利率回到 10%。`,
        risk: 'medium',
      },
    ];
  },
};

// ---------------- 总指挥（没有对口部门时自己答） ----------------

const main: Skill = {
  context() {
    return '公司有四个部门：运营部（上架专员）、财务部（利润分析师）、客服部（客服应答员）、投放部（广告归因师）。';
  },
  draft() {
    return [
      '我是总指挥，负责把任务分给四个部门。现在能直接交给数字员工的有：',
      '',
      '- **财务部 · 利润分析师**：多店铺利润汇总、找亏损订单、达人结算核对',
      '- **投放部 · 广告归因师**：判断是素材、出价还是落地页的问题，给出预算建议',
      '- **客服部 · 客服应答员**：按知识库草拟回复，退款金额走审批',
      '- **运营部 · 上架专员**：商品卡上架检查、单品定价核算',
      '',
      '试试：「帮我汇总三个店铺本月的真实利润」。',
    ].join('\n');
  },
  propose() {
    return [];
  },
};

export const SKILLS: Record<string, Skill> = {
  main,
  'emp-profit': profit,
  'emp-ads': ads,
  'emp-cs': cs,
  'emp-listing': listing,
};
