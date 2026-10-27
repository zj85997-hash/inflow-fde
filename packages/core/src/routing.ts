import { employeesOf } from './org';

/** 关键词路由：离线演示用它，接了真模型时它是模型路由失败后的兜底 */
const RULES: [string, RegExp][] = [
  ['finance', /利润|账|费用|结算|亏|财务|回款|成本|GMV|简报|快报|经营|汇总/i],
  ['growth', /广告|投放|投流|素材|ROAS|归因|预算/i],
  ['service', /客服|退款|回复|差评|投诉|客户/],
  ['ops', /上架|选品|商品|listing|链接|定价|价格|竞品|SKU/i],
];

export const DEPARTMENT_IDS = RULES.map(([id]) => id);

/** 没有对口部门时返回 undefined，由总指挥自己回答 */
export function routeByKeyword(prompt: string): string | undefined {
  return RULES.find(([, re]) => re.test(prompt))?.[0];
}

/** 部门 Agent 选员工：交给本部门的数字员工 */
export function pickEmployee(departmentId: string): string | undefined {
  return employeesOf(departmentId).find((e) => e.employeeType === 'digital')?.id;
}
