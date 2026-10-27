/**
 * L5 命令行：不开网页也能派活、审批、看账。和网页共用同一个数据库。
 *   pnpm fde status
 *   pnpm fde run "帮我汇总三个店铺本月的真实利润"
 *   pnpm fde approvals
 *   pnpm fde approve <审批编号前几位> [备注]   /   pnpm fde reject <编号> [备注]
 *   pnpm fde ledger
 *   pnpm fde diagnose
 */
import type { AppStatus, ApprovalItem, LedgerSummary, WorkflowItem } from '@inflow/contracts';
import { createApp, yuan, type TaskRecord } from '@inflow/core';
import { loadEnv } from './env.js';
import { loadPlugins } from './plugins.js';
import { SqliteStore } from './sqlite-store.js';

loadEnv();
const inflow = createApp({
  store: new SqliteStore(),
  plugins: loadPlugins,
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || undefined,
  paceMs: 0,
  streamDelayMs: 0,
});
inflow.ensureDemoData();

async function api<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  const r = await inflow.api.handle(method, url, body);
  if (r.status >= 400) throw new Error((r.body as { error?: string }).error ?? `HTTP ${r.status}`);
  return r.body as T;
}

const KIND: Record<ApprovalItem['kind'], string> = { refund: '退款', budget: '预算', settlement: '结算', price: '改价' };
const short = (id: string) => id.slice(0, 8);

function printApprovals(list: ApprovalItem[]) {
  if (!list.length) return console.log('（没有待审批）');
  for (const a of list) {
    console.log(`[${short(a.id)}] ${KIND[a.kind]}｜${a.title}${a.amountCny !== undefined ? `｜${yuan(a.amountCny, 2)}` : ''}｜风险 ${a.risk}`);
    console.log(`           依据：${a.reason}`);
  }
}

async function main() {
  const [cmd = 'help', ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'status': {
      const s = await api<AppStatus>('GET', '/api/status');
      console.log(`模型：${s.activeAdapter === 'deepseek' ? 'DeepSeek' : '离线演示模型'}（模式 ${s.mode}）`);
      console.log(`今日花费：${yuan(s.spentTodayCny, 4)} / 预算 ${yuan(s.dailyBudgetCny)}`);
      console.log(`待审批：${s.pendingApprovals} 条　演示数据：${s.dataRange}`);
      break;
    }
    case 'run': {
      const prompt = args.join(' ').trim();
      if (!prompt) throw new Error('用法：pnpm fde run "任务内容"');
      inflow.bus.on((ev) => {
        if (ev.type === 'session_progress') process.stdout.write(ev.message ?? '');
        else if (ev.type === 'task_assigned' || ev.type === 'session_started') console.log(`› ${ev.message}`);
        else if (ev.type === 'task_failed') console.error(`\n✗ ${ev.message}`);
      });
      const task = await api<TaskRecord>('POST', '/api/tasks', { prompt });
      await inflow.orchestrator.waitFor(task.id);
      console.log('\n');
      const pending = (await api<ApprovalItem[]>('GET', `/api/tasks/${task.id}/approvals`)).filter((a) => a.status === 'pending');
      if (pending.length) {
        console.log('需要你拍板：');
        printApprovals(pending);
        console.log('\n用 pnpm fde approve <编号> 或 pnpm fde reject <编号> 处理。');
      }
      break;
    }
    case 'approvals':
      printApprovals(await api<ApprovalItem[]>('GET', '/api/approvals?status=pending'));
      break;
    case 'approve':
    case 'reject': {
      const [prefix, ...note] = args;
      if (!prefix) throw new Error(`用法：pnpm fde ${cmd} <编号> [备注]`);
      const hits = (await api<ApprovalItem[]>('GET', '/api/approvals?status=pending')).filter((a) => a.id.startsWith(prefix));
      if (hits.length !== 1) throw new Error(hits.length ? '编号不唯一，多写几位' : '没找到这条待审批');
      const a = await api<ApprovalItem>('POST', `/api/approvals/${hits[0].id}/decide`, {
        decision: cmd === 'approve' ? 'approved' : 'rejected',
        note: note.join(' '),
      });
      console.log(`${a.status === 'approved' ? '✓ 已批准' : '✗ 已驳回'}：${a.title}`);
      break;
    }
    case 'ledger': {
      const { summary } = await api<{ summary: LedgerSummary }>('GET', '/api/ledger');
      console.log(`累计 ${yuan(summary.totalCny, 4)}，${summary.totalCalls} 次调用（其中模拟 ${summary.simulatedCalls} 次），今日 ${yuan(summary.spentTodayCny, 4)} / ${yuan(summary.dailyBudgetCny)}`);
      for (const a of summary.byAgent) console.log(`  ${a.name.padEnd(6, '　')} ${a.department.padEnd(4, '　')} ${yuan(a.costCny, 4)}  ${a.calls} 次`);
      break;
    }
    case 'diagnose': {
      const r = await api<{ ok: boolean; error?: string }>('POST', '/api/workflows/analyze');
      if (!r.ok) throw new Error(r.error);
      for (const w of await api<WorkflowItem[]>('GET', '/api/workflows')) {
        console.log(`${String(w.repeatScore ?? '-').padStart(3)}  ${w.name}（${w.owner}）\n     ${w.aiSuggestion ?? ''}`);
      }
      break;
    }
    default:
      console.log('用法：pnpm fde <status | run "任务" | approvals | approve <编号> [备注] | reject <编号> [备注] | ledger | diagnose>');
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
