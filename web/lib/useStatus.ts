'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AppStatus } from '@inflow/contracts';
import { apiGet, useEventStream } from './api';

/** 全局状态：模型、预算、待审批数。有审批或账本事件时立即刷新。 */
export function useStatus() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [offline, setOffline] = useState(false);
  const load = useCallback(() => {
    apiGet<AppStatus>('/api/status')
      .then((s) => {
        setStatus(s);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  useEventStream((ev) => {
    if (['approval_required', 'approval_decided', 'ledger_updated', 'task_failed'].includes(ev.type)) load();
  });
  return { status, offline, reload: load };
}
