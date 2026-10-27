/** 重新灌入演示数据：三店铺 408 笔订单 + 6 条工作流（全部虚构）。运行：pnpm seed */
import { DEMO_WORKFLOWS, generateOrders } from '@inflow/core';
import { SqliteStore } from './sqlite-store.js';

const store = new SqliteStore();
const orders = generateOrders();
store.replaceOrders(orders);
store.replaceWorkflows(DEMO_WORKFLOWS);
if (process.argv.includes('--reset')) store.resetRuntime();
console.log(`✅ 演示数据灌入完成：${orders.length} 笔订单（3 店铺）+ ${DEMO_WORKFLOWS.length} 条工作流${process.argv.includes('--reset') ? '，任务/账本/审批已清空' : ''}`);
