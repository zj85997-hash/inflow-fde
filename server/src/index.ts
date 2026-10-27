import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { AgentEvent } from '@inflow/contracts';
import { createApp } from '@inflow/core';
import { loadEnv } from './env.js';
import { loadPlugins } from './plugins.js';
import { SqliteStore } from './sqlite-store.js';

loadEnv();

const inflow = createApp({ store: new SqliteStore(), plugins: loadPlugins, deepseekApiKey: process.env.DEEPSEEK_API_KEY || undefined });
inflow.ensureDemoData();

const app = Fastify({ logger: false });
await app.register(cors, { origin: true });
await app.register(websocket);

// ---------- WebSocket：事件流 ----------
const sockets = new Set<{ send: (data: string) => void; on: (ev: 'close', fn: () => void) => void }>();
app.get('/ws', { websocket: true }, (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
inflow.bus.on((ev: AgentEvent) => {
  const payload = JSON.stringify(ev);
  for (const s of sockets) {
    try {
      s.send(payload);
    } catch {
      /* 忽略断开的连接 */
    }
  }
});

// ---------- 接口：全部转给 @inflow/core（浏览器演示用的是同一套实现） ----------
app.all('/api/*', async (req, reply) => {
  const r = await inflow.api.handle(req.method, req.url, req.body);
  return reply.code(r.status).send(r.body);
});

const port = Number(process.env.PORT ?? 8790);
await app.listen({ port, host: '127.0.0.1' });
const adapter = inflow.gateway.activeAdapter() === 'deepseek' ? 'DeepSeek' : '离线演示模型（没有配置 DEEPSEEK_API_KEY）';
console.log(`🚀 InFlow FDE server: http://127.0.0.1:${port}  (ws: /ws) · 模型：${adapter}`);
