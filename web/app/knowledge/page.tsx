'use client';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentProfile } from '@inflow/contracts';
import { apiGet } from '@/lib/api';

interface KnowledgeDoc {
  id: string;
  name: string;
  type: string;
  usedBy: string[];
  content: string;
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [open, setOpen] = useState<KnowledgeDoc | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    apiGet<KnowledgeDoc[]>('/api/knowledge').then(setDocs).catch(() => {});
    apiGet<{ agents: AgentProfile[] }>('/api/org').then((d) => setAgents(d.agents)).catch(() => {});
  }, []);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">知识库</h1>
          <p className="mt-1 text-sm text-subtle">规矩写在这里，数字员工按条引用：改一句就生效，不用改代码。</p>
        </div>
        <button className="btn-primary" onClick={() => setShowUpload((v) => !v)}>⬆ 上传文件</button>
      </div>
      {showUpload && (
        <p className="mt-4 rounded-xl bg-panel px-4 py-3 text-xs leading-5 text-subtle">
          演示版还不支持上传和向量检索。这几份文件写在 <code>packages/core/src/knowledge.ts</code>，改完重启即可生效；正式版会接上传、切片和检索。
        </p>
      )}

      <div className="mt-6 space-y-2">
        {docs.map((d) => (
          <button key={d.id} onClick={() => setOpen(d)} className="card flex w-full flex-wrap items-center gap-3 p-4 text-left hover:bg-panel/40">
            <span className="text-xl">{d.type === 'XLSX' ? '📊' : '📄'}</span>
            <div className="min-w-0">
              <div className="text-sm font-medium">{d.name}</div>
              <div className="text-xs text-subtle">Document · {d.type} · 点击查看内容</div>
            </div>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {d.usedBy.map((id) => (
                <span key={id} className="chip border-brand text-brand-dark">{agentName(id)}引用中</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(null)}>
          <div className="card max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className="chip">{open.type}</span>
              <span className="text-xs text-subtle">引用：{open.usedBy.map(agentName).join('、')}</span>
              <button className="btn-ghost ml-auto !py-1 text-xs" onClick={() => setOpen(null)}>关闭</button>
            </div>
            <div className="md-body mt-3">
              <Markdown remarkPlugins={[remarkGfm]}>{open.content}</Markdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
