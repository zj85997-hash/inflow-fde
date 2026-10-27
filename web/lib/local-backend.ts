'use client';
/**
 * 在线演示的「浏览器里的服务端」：和 server/ 用的是同一个 @inflow/core，
 * 只是把 SQLite 换成内存存储，并存进 localStorage，刷新后数据还在。
 */
import { BUILTIN_PLUGINS, MemoryStore, createApp, type InflowApp, type MemorySnapshot } from '@inflow/core';

const KEY = 'inflow-fde-demo-v1';
let app: InflowApp | undefined;

export function getLocalApp(): InflowApp {
  if (app) return app;
  let snapshot: MemorySnapshot | null = null;
  try {
    snapshot = JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    snapshot = null;
  }
  const store = new MemoryStore(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  store.onChange = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(store.snapshot()));
      } catch {
        /* 存满了就不存，演示照样能用 */
      }
    }, 300);
  };
  app = createApp({ store, plugins: () => BUILTIN_PLUGINS, staticDemo: true });
  app.ensureDemoData();
  return app;
}
