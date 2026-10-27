/** 极简路由：服务端（Fastify）和浏览器演示共用同一套接口实现 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ApiResult {
  status: number;
  body: unknown;
}

export interface RouteContext {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}

type Handler = (c: RouteContext) => unknown | Promise<unknown>;

export function createRouter() {
  const routes: { method: string; re: RegExp; keys: string[]; handler: Handler }[] = [];

  function add(method: 'GET' | 'POST', pattern: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' + pattern.replace(/:(\w+)/g, (_, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) + '/?$'
    );
    routes.push({ method, re, keys, handler });
  }

  async function handle(method: string, url: string, body?: unknown): Promise<ApiResult> {
    const u = new URL(url, 'http://inflow.local');
    for (const r of routes) {
      if (r.method !== method.toUpperCase()) continue;
      const m = u.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const safeBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      try {
        return { status: 200, body: await r.handler({ params, query: u.searchParams, body: safeBody }) };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
        console.error(e);
        return { status: 500, body: { error: e instanceof Error ? e.message : String(e) } };
      }
    }
    return { status: 404, body: { error: `没有这个接口：${method} ${u.pathname}` } };
  }

  return { add, handle };
}
