/** 工作流诊断与转型对比方案：离线演示时用规则算，接了真模型时作为兜底 */
import type { CompanyProfile, ComparisonPlan, WorkflowItem } from '@inflow/contracts';

export function scoreWorkflow(w: Pick<WorkflowItem, 'name' | 'description'>): { score: number; suggestion: string } {
  const t = `${w.name} ${w.description}`;
  let score = 35;
  if (/每天|每日|每周|每月/.test(t)) score += 20;
  if (/导出|合并|截图|粘贴|复制|整理/.test(t)) score += 20;
  if (/核对|对账|匹配|检查/.test(t)) score += 15;
  if (/逐单|逐条|逐项/.test(t)) score += 10;
  if (/重复|常见|约 ?\d+ ?条/.test(t)) score += 10;
  if (/手工|人工/.test(t)) score += 5;
  if (/讨论|决策|判断|谈判|创意|方向/.test(t)) score -= 30;
  score = Math.max(5, Math.min(96, score));

  let suggestion = '可以先让数字员工做数据准备，人负责判断和拍板。';
  if (score < 40) suggestion = '以讨论和判断为主，建议保留给人；AI 可以提前备好趋势、报价和竞品材料。';
  else if (/结算|佣金/.test(t)) suggestion = '交给「利润分析师」的达人结算核对技能：自动匹配订单号，退款订单的佣金扣回进审批收件箱。';
  else if (/汇总|GMV|毛利/.test(t)) suggestion = '交给「利润分析师」：店铺数据连接器每天自动同步，日报自动生成，人只看异常。';
  else if (/客服|回复/.test(t)) suggestion = '交给「客服应答员」：按知识库草拟回复，涉及退款金额的进审批，由主管确认。';
  else if (/上架|商品/.test(t)) suggestion = '交给「上架专员」：能对着数据核的项自动检查，主图合规这类要看图的项留给人。';
  else if (/广告|投放/.test(t)) suggestion = '交给「广告归因师」：自动拉数、对照基准线标异常，预算调整进审批。';
  return { score, suggestion };
}

const DEFAULT_WORKFLOWS = ['三店铺数据每天人工导出合并', '客服重复问题人工逐条回复', '达人结算单人工核对', '广告数据截图贴周报'];

export function buildComparePlan(p: CompanyProfile | null): ComparisonPlan {
  const workflows = p?.workflows?.length ? p.workflows.slice(0, 6) : DEFAULT_WORKFLOWS;
  const hours = Math.min(12, Math.max(2, Math.round(workflows.length * 1.5)));
  const storage = p?.dataStorage ?? ['local', 'cloud'];
  const points = [
    '店铺数据连接器自动同步，利润日清日结',
    '数字员工接管重复回复和数据整理，涉及钱的动作进审批收件箱',
    '部门 Agent 统筹任务，产出与成本全程留痕',
  ];
  if (storage.includes('local')) points.push('散落在本地 Excel 的台账，用 DIY 连接器接进来');
  if (storage.includes('private')) points.push('私有化系统走 DIY 连接器，数据不出内网');
  if (storage.includes('saas')) points.push('飞书 / 钉钉表格作为人机协作的入口');
  return {
    current: {
      title: '现状运行方案',
      points: workflows,
      pros: ['流程熟悉，没有迁移成本', '完全由人把控'],
      cons: [`每天约 ${hours} 小时耗在机械操作`, '利润要月底才算得清，亏损单发现滞后', '各岗位各自用 AI，环节没有串起来', '关键知识只在员工个人手里'],
    },
    optimized: {
      title: '基于 InFlow FDE 的优化方案',
      points: points.slice(0, 5),
      pros: ['机械环节交给 Agent，团队聚焦决策', '亏损订单当天发现', '规则由老板自己调，系统随业务演化', '每一分 AI 成本可解释（内置账本 + 预算护栏）'],
      cons: ['需要 1–2 周适配期和员工培训', '深度定制项按需另议'],
    },
    efficiencyGain: `预计每天释放约 ${hours} 人时的机械劳动，利润核算周期从月度缩短到当日`,
    priceCny: 68888,
  };
}
