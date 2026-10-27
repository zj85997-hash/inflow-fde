'use client';
import { useEffect, useRef, useState } from 'react';
import type { AgentEvent } from '@inflow/contracts';

/** 在线静态演示：没有服务端，接口由浏览器里的 @inflow/core 实现（同一套代码） */
export const STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === '1';
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
export const API = process.env.NEXT_PUBLIC_API ?? 'http://127.0.0.1:8790';
export const REPO_URL = 'https://github.com/zj85997-hash/inflow-fde';

const local = () => import('./local-backend').then((m) => m.getLocalApp());

async function unwrap<T>(r: { status: number; body: unknown }, path: string): Promise<T> {
  if (r.status >= 400) throw new Error((r.body as { error?: string })?.error ?? `${path} → ${r.status}`);
  return r.body as T;
}

/** 在线演示也走一遍序列化，和真实 HTTP 一样拿到的是副本，界面不会和浏览器里的存储共用对象 */
const copy = (r: { status: number; body: unknown }) => ({ status: r.status, body: r.body === undefined ? undefined : JSON.parse(JSON.stringify(r.body)) });

export async function apiGet<T>(path: string): Promise<T> {
  if (STATIC_DEMO) return unwrap<T>(copy(await (await local()).api.handle('GET', path)), path);
  const res = await fetch(`${API}${path}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  return unwrap<T>({ status: res.status, body }, path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  if (STATIC_DEMO) return unwrap<T>(copy(await (await local()).api.handle('POST', path, body ?? {})), path);
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  return unwrap<T>({ status: res.status, body: json }, path);
}

/** 订阅全局事件流：服务端走 WebSocket（断线自动重连），在线演示直接订阅浏览器里的事件总线 */
export function useEventStream(onEvent: (ev: AgentEvent) => void) {
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (STATIC_DEMO) {
      let off: (() => void) | undefined;
      let cancelled = false;
      local().then((app) => {
        if (cancelled) return;
        off = app.bus.on((ev) => cbRef.current(ev));
        setConnected(true);
      });
      return () => {
        cancelled = true;
        off?.();
      };
    }

    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
      ws.onopen = () => setConnected(true);
      ws.onmessage = (m) => {
        try {
          cbRef.current(JSON.parse(m.data));
        } catch {
          /* 忽略坏消息 */
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return connected;
}

export function fmtCny(n: number): string {
  if (n > 0 && n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
