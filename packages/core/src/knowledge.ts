/** 知识库：规矩写在这里，数字员工按条引用。改一句就生效，不用改代码。 */
import { AD_BENCHMARK, SKUS } from './demo-data';
import { mdTable, pct } from './util';

export interface KnowledgeDoc {
  id: string;
  name: string;
  type: 'MD' | 'XLSX';
  /** 引用这份文件的数字员工 */
  usedBy: string[];
  content: string;
}

export const REFUND_POLICY = `1. 签收后 7 天内可无理由退货；饰品类拆封后不支持无理由退货。
2. 物流超过 15 天未签收：客户可选择全额退款，或领取 15% 无门槛券继续等待。
3. 质量问题：免费换新或全额退款，来回运费由公司承担。
4. 所有退款金额由客服草拟、主管确认后才执行；客服不能向客户承诺「已退款」。`;

export const INFLUENCER_TERMS = `1. 达人佣金按成交金额计提，比例以单个合作约定为准。
2. 佣金在订单签收 15 天后结算，结算单每月 5 日前发出。
3. 发生退款的订单，已计提的佣金在下期结算中扣回。
4. 单个达人佣金率超过 20% 的合作，需要财务和运营主管共同确认。`;

export const LISTING_CHECKLIST = [
  { item: '标题 ≤ 80 字符，核心词前置', auto: true },
  { item: '不含禁用词（最、第一、100%、顶级）', auto: true },
  { item: '五点描述齐全，每点 ≤ 200 字符', auto: true },
  { item: '主图白底、无水印、无边框', auto: false },
  { item: '类目与活动申报一致', auto: true },
  { item: '单品净利率 ≥ 10%', auto: true },
];

export const KNOWLEDGE_DOCS: KnowledgeDoc[] = [
  { id: 'refund-policy', name: '公司退款政策 v3.md', type: 'MD', usedBy: ['emp-cs'], content: `# 公司退款政策 v3\n\n${REFUND_POLICY}` },
  { id: 'influencer-terms', name: '达人合作条款 2026.md', type: 'MD', usedBy: ['emp-profit'], content: `# 达人合作条款 2026\n\n${INFLUENCER_TERMS}` },
  {
    id: 'ad-benchmark',
    name: '广告投放基准.md',
    type: 'MD',
    usedBy: ['emp-ads'],
    content: `# 广告投放基准（类目均值）\n\n${mdTable(['指标', '基准', '警戒线', '低于/高于警戒线说明'], [
      ['点击率 CTR', pct(AD_BENCHMARK.ctr), `< ${pct(AD_BENCHMARK.minCtr)}`, '素材问题：前 3 秒没抓住人'],
      ['单次点击成本 CPC', `¥${AD_BENCHMARK.cpc.toFixed(2)}`, `> ¥${AD_BENCHMARK.maxCpc.toFixed(2)}`, '出价问题：出价过高或人群太窄'],
      ['转化率 CVR', pct(AD_BENCHMARK.cvr), `< ${pct(AD_BENCHMARK.minCvr)}`, '落地页问题：点进来不买'],
    ])}`,
  },
  {
    id: 'listing-checklist',
    name: '上架检查清单.md',
    type: 'MD',
    usedBy: ['emp-listing'],
    content: `# 上架检查清单\n\n${LISTING_CHECKLIST.map((c, i) => `${i + 1}. ${c.item}${c.auto ? '' : '（需人工看图）'}`).join('\n')}`,
  },
  {
    id: 'sku-ledger',
    name: '三店铺 SKU 台账.xlsx',
    type: 'XLSX',
    usedBy: ['emp-profit', 'emp-listing'],
    content: `# 三店铺 SKU 台账\n\n${mdTable(
      ['店铺', 'SKU', '商品', '售价', '采购价'],
      Object.entries(SKUS).flatMap(([store, list]) => list.map((s) => [store, s.sku, s.name, `¥${s.price}`, `¥${s.cogs}`]))
    )}`,
  },
];
