/** 浏览器和 Node 都能跑的小工具，不依赖任何 Node 模块 */

export function uid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** ¥12,345 / -¥1,234.56 */
export function yuan(n: number, digits = 0): string {
  const sign = n < 0 ? '-' : '';
  const body = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${sign}¥${body}`;
}

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export function mdTable(head: string[], rows: (string | number)[][]): string {
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 极简事件总线：on 返回取消订阅函数 */
export class Emitter<T> {
  private fns = new Set<(value: T) => void>();

  on(fn: (value: T) => void): () => void {
    this.fns.add(fn);
    return () => {
      this.fns.delete(fn);
    };
  }

  emit(value: T) {
    for (const fn of [...this.fns]) {
      try {
        fn(value);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
