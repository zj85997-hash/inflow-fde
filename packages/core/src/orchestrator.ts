/**
 * L1 编排核心（事件协议见 @inflow/contracts）。
 * 三层分发：总指挥 → 部门 Agent → 数字员工；产出里涉及钱的动作进审批收件箱，人拍板后任务才算完成。
 */
import type { AgentEvent, AgentEventType, ApprovalItem, ChatMessage, TaskOutput } from '@inflow/contracts';
import { GatewayError, type ModelGateway } from '@inflow/gateway';
import { HttpError } from './router';
import { AGENTS, getAgent } from './org';
import { DEPARTMENT_IDS, pickEmployee, routeByKeyword } from './routing';
import { SKILLS } from './skills';
import type { Store, TaskRecord } from './store';
import { Emitter, sleep, uid, yuan } from './util';

export interface RunOptions {
  prompt: string;
  /** 指定 Agent 直接派活；缺省走总指挥三层分发 */
  agentId?: string;
}

export interface OrchestratorDeps {
  store: Store;
  gateway: ModelGateway;
  bus: Emitter<AgentEvent>;
  /** 分发每一步之间的停顿（毫秒），让人看得清流程；测试设 0 */
  paceMs: number;
  now: () => number;
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;

export function createOrchestrator(d: OrchestratorDeps) {
  const running = new Map<string, Promise<void>>();

  function emit(type: AgentEventType, taskId: string, extra: Partial<AgentEvent> = {}): AgentEvent {
    const ev: AgentEvent = { id: uid(), type, ts: d.now(), taskId, ...extra };
    // 逐字流和账本事件不落库，其余用来回放历史任务
    if (type !== 'session_progress' && type !== 'ledger_updated') d.store.insertEvent(ev);
    d.bus.emit(ev);
    return ev;
  }

  const pause = () => (d.paceMs > 0 ? sleep(d.paceMs) : Promise.resolve());

  const audit = (actor: string, action: string, target: string, detail: string) =>
    d.store.insertAudit({ ts: d.now(), actor, action, target, detail });

  const setTask = (id: string, patch: Partial<TaskRecord>) => d.store.updateTask(id, { ...patch, updatedAt: d.now() });

  function saveOutput(taskId: string, o: Omit<TaskOutput, 'id' | 'createdAt'>): TaskOutput {
    const output: TaskOutput = { id: uid(), createdAt: d.now(), ...o };
    d.store.insertOutput(taskId, output);
    return output;
  }

  /** 总指挥选部门：先问模型，模型不可用或答非所问时用关键词兜底 */
  async function routeDepartment(prompt: string, taskId: string): Promise<string | undefined> {
    const guess = routeByKeyword(prompt);
    try {
      const res = await d.gateway.chat(
        [
          {
            role: 'system',
            content: '你是公司主 Agent 的路由模块。根据任务内容返回最合适的部门 id，只返回其中之一：ops(运营)、finance(财务)、service(客服)、growth(投放)；都不合适就返回 none。只输出 id，不要其他文字。',
          },
          { role: 'user', content: prompt },
        ],
        { attribution: { agentId: 'main', taskId }, maxTokens: 8, temperature: 0, draft: guess ?? 'none' }
      );
      const id = res.content.trim().toLowerCase();
      if (DEPARTMENT_IDS.includes(id)) return id;
      if (id === 'none') return undefined;
    } catch (e) {
      if (e instanceof GatewayError && e.code === 'budget_exceeded') throw e;
    }
    return guess;
  }

  async function runTask(taskId: string, opts: RunOptions) {
    const direct = opts.agentId && opts.agentId !== 'main' ? getAgent(opts.agentId) : undefined;
    let employeeId: string | undefined;
    let departmentId: string | undefined;

    if (direct?.kind === 'employee') {
      employeeId = direct.id;
      departmentId = direct.departmentId;
      emit('task_assigned', taskId, { agentId: employeeId, message: `直接指派给「${direct.name}」` });
    } else {
      if (direct?.kind === 'department') {
        departmentId = direct.departmentId;
      } else {
        setTask(taskId, { status: 'running', assigneeId: 'main' });
        emit('session_started', taskId, { agentId: 'main', message: '总指挥正在理解任务、选择部门…' });
        await pause();
        departmentId = await routeDepartment(opts.prompt, taskId);
      }
      if (departmentId) {
        const dept = AGENTS.find((a) => a.kind === 'department' && a.departmentId === departmentId)!;
        setTask(taskId, { status: 'assigned', assigneeId: dept.id, departmentId });
        emit('task_assigned', taskId, { agentId: dept.id, message: direct ? `直接交给「${dept.name}」` : `总指挥已分派给「${dept.name}」` });
        await pause();
        employeeId = pickEmployee(departmentId);
        const emp = employeeId ? getAgent(employeeId) : undefined;
        if (emp) emit('task_assigned', taskId, { agentId: emp.id, message: `${dept.name}指派数字员工「${emp.name}」执行` });
        await pause();
      }
    }

    const agentId = employeeId ?? 'main';
    const agent = getAgent(agentId)!;
    const skill = SKILLS[agentId] ?? SKILLS.main;
    const ctx = { prompt: opts.prompt, orders: d.store.listOrders() };

    setTask(taskId, { status: 'running', assigneeId: agentId, departmentId });
    emit('session_started', taskId, { agentId, message: agentId === 'main' ? '没有对口部门，总指挥直接回答' : `${agent.name}开始工作` });

    const messages: ChatMessage[] = [
      { role: 'system', content: `${agent.systemPrompt ?? `你是${agent.name}，${agent.title}。`}\n数字以给到的数据为准，不许编造。用简体中文、Markdown 输出。` },
      { role: 'user', content: `${opts.prompt}\n\n${skill.context(ctx)}` },
    ];
    const result = await d.gateway.chat(messages, {
      attribution: { agentId, taskId },
      draft: skill.draft(ctx),
      onDelta: (text) => emit('session_progress', taskId, { agentId, message: text }),
    });
    const output = saveOutput(taskId, { type: 'markdown', title: `${agent.name} · 工作产出`, content: result.content });
    emit('output_produced', taskId, { agentId, output });
    const memo = saveOutput(taskId, { type: 'memory', title: `diary/${new Date(d.now()).toISOString().slice(0, 10)}.md`, content: '本次任务结论已写入长期记忆。' });
    emit('output_produced', taskId, { agentId, output: memo });

    // 涉及钱的动作：代码算出建议 → 审批收件箱 → 人拍板。模型说什么都不会直接动钱。
    const proposals = skill.propose(ctx);
    for (const p of proposals) {
      const approval: ApprovalItem = { id: uid(), taskId, agentId, status: 'pending', createdAt: d.now(), ...p };
      d.store.insertApproval(approval);
      audit(agentId, 'approval.requested', approval.id, `${approval.title}${approval.amountCny !== undefined ? `（${yuan(approval.amountCny, 2)}）` : ''}`);
      emit('approval_required', taskId, { agentId, approval, message: `「${approval.title}」等待审批` });
    }


    if (proposals.length) {
      setTask(taskId, { status: 'awaiting_approval' });
    } else {
      setTask(taskId, { status: 'completed' });
      emit('task_completed', taskId, { agentId });
    }
  }

  function createTask(opts: RunOptions): TaskRecord {
    const prompt = opts.prompt.trim();
    const now = d.now();
    const task: TaskRecord = { id: uid(), title: prompt.slice(0, 40), status: 'created', createdAt: now, updatedAt: now, requesterId: 'user' };
    d.store.insertTask(task);
    emit('task_created', task.id, { message: prompt });
    const p = runTask(task.id, { ...opts, prompt })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        setTask(task.id, { status: 'failed' });
        if (e instanceof GatewayError && e.code === 'budget_exceeded') audit('system', 'budget.blocked', task.id, msg);
        emit('task_failed', task.id, { message: msg });
      })
      .finally(() => running.delete(task.id));
    running.set(task.id, p);
    return task;
  }

  /** 人拍板：批准或驳回。一个任务的审批全部处理完，任务才算完成。 */
  function decide(approvalId: string, decision: 'approved' | 'rejected', note?: string): ApprovalItem {
    const a = d.store.getApproval(approvalId);
    if (!a) throw new HttpError(404, '审批不存在');
    if (a.status !== 'pending') throw new HttpError(409, '这条审批已经处理过了');
    const cleanNote = note?.trim().slice(0, 200) || undefined;
    const patch = { status: decision, decidedAt: d.now(), note: cleanNote } as const;
    d.store.updateApproval(approvalId, patch);
    const updated: ApprovalItem = { ...a, ...patch };
    audit('user', `approval.${decision}`, approvalId, `${decision === 'approved' ? '批准' : '驳回'}：${a.title}${cleanNote ? `；备注：${cleanNote}` : ''}`);
    emit('approval_decided', a.taskId, {
      agentId: a.agentId,
      approval: updated,
      message: `${decision === 'approved' ? '已批准' : '已驳回'}「${a.title}」`,
    });
    const left = d.store.listApprovals().filter((x) => x.taskId === a.taskId && x.status === 'pending');
    if (left.length === 0 && d.store.getTask(a.taskId)?.status === 'awaiting_approval') {
      setTask(a.taskId, { status: 'completed' });
      emit('task_completed', a.taskId, { agentId: a.agentId, message: '审批已全部处理' });
    }
    return updated;
  }

  return {
    createTask,
    decide,
    /** 等任务跑完（测试和命令行用） */
    waitFor: (taskId: string) => running.get(taskId) ?? Promise.resolve(),
  };
}
