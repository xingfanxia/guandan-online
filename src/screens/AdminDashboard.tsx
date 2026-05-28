// AdminDashboard — token-gated moderation + telemetry console. (SEC-3 + DEPLOY-2)
//
// Reached at #/admin?token=<ADMIN_TOKEN> (the parent wires the route; this
// screen parses the token from a prop or, failing that, `window.location.hash`'s
// query). The token is sent as the bearer on every admin call.
//
// Three panels:
//   (a) 举报记录   — recent player reports table (SEC-3)
//   (b) 玩家管理   — ban / unban + reset-stats controls keyed by @handle (SEC-3)
//   (c) 网络延迟   — p50/p95/p99 per region (DEPLOY-2)
//
// All network access is via dependency-injected fns (like Waiting's getRoomFn)
// so tests assert behavior without hitting the API.

import { useCallback, useEffect, useState } from 'react';
import {
  fetchReports as apiFetchReports,
  setBan as apiSetBan,
  resetStats as apiResetStats,
  fetchLatency as apiFetchLatency,
  type PlayerReport,
  type ReportReason,
  type LatencyAggregate,
} from '@/lib/api/admin';
import { RoomApiError } from '@/lib/api/rooms';

export interface AdminDashboardProps {
  /** Admin token. When omitted, parsed from the URL hash query (`?token=`). */
  token?: string;
  fetchReportsFn?: typeof apiFetchReports;
  setBanFn?: typeof apiSetBan;
  resetStatsFn?: typeof apiResetStats;
  fetchLatencyFn?: typeof apiFetchLatency;
}

const REASON_LABEL: Record<ReportReason, string> = {
  cheating: '作弊',
  abuse: '辱骂',
  afk: '挂机',
  other: '其他',
};

/** Read `?token=` out of the location hash (e.g. `#/admin?token=abc`). */
function tokenFromHash(): string {
  if (typeof window === 'undefined') return '';
  const hash = window.location.hash;
  const q = hash.indexOf('?');
  if (q < 0) return '';
  return new URLSearchParams(hash.slice(q + 1)).get('token') ?? '';
}

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof RoomApiError) {
    if (err.status === 401) return '令牌无效或缺失';
    if (err.status === 503) return '服务未配置管理员令牌';
    return err.details ?? err.code;
  }
  return fallback;
}

export function AdminDashboard({
  token,
  fetchReportsFn = apiFetchReports,
  setBanFn = apiSetBan,
  resetStatsFn = apiResetStats,
  fetchLatencyFn = apiFetchLatency,
}: AdminDashboardProps): React.JSX.Element {
  const authToken = token !== undefined ? token : tokenFromHash();

  const [reports, setReports] = useState<readonly PlayerReport[]>([]);
  const [latency, setLatency] = useState<LatencyAggregate>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [banHandle, setBanHandle] = useState('');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!authToken) {
      setLoadError('缺少管理员令牌');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [r, l] = await Promise.all([
        fetchReportsFn(authToken),
        fetchLatencyFn(authToken),
      ]);
      setReports(r);
      setLatency(l);
      setLoadError(null);
    } catch (err) {
      setLoadError(errMessage(err, '加载失败 — 检查网络'));
    } finally {
      setLoading(false);
    }
  }, [authToken, fetchReportsFn, fetchLatencyFn]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBan(banned: boolean): Promise<void> {
    const handle = banHandle.trim();
    if (!handle) {
      setActionErr('请输入 @handle');
      return;
    }
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await setBanFn(authToken, handle, banned);
      setActionMsg(`${res.handle} ${res.banned ? '已封禁' : '已解封'}`);
    } catch (err) {
      setActionErr(errMessage(err, '操作失败'));
    } finally {
      setBusy(false);
    }
  }

  async function runReset(): Promise<void> {
    const handle = banHandle.trim();
    if (!handle) {
      setActionErr('请输入 @handle');
      return;
    }
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await resetStatsFn(authToken, handle);
      setActionMsg(`${res.handle} 战绩已重置（对局数 ${res.gamesPlayed}）`);
    } catch (err) {
      setActionErr(errMessage(err, '操作失败'));
    } finally {
      setBusy(false);
    }
  }

  const regions = Object.entries(latency);

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard__top">
        <span className="admin-dashboard__title">管理控制台</span>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </header>

      {loadError ? <div className="admin-dashboard__error">{loadError}</div> : null}

      <section className="admin-dashboard__panel" aria-label="举报记录">
        <h2 className="admin-dashboard__panel-title">举报记录</h2>
        {reports.length === 0 ? (
          <p className="admin-dashboard__empty">暂无举报</p>
        ) : (
          <table className="admin-dashboard__table">
            <thead>
              <tr>
                <th>举报人</th>
                <th>被举报</th>
                <th>原因</th>
                <th>对局</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r, i) => (
                <tr key={`${r.reporterHandle}-${r.targetHandle}-${r.gameId}-${i}`}>
                  <td>{r.reporterHandle}</td>
                  <td>{r.targetHandle}</td>
                  <td>{REASON_LABEL[r.reason]}</td>
                  <td className="mono">{r.gameId}</td>
                  <td className="mono">{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="admin-dashboard__panel" aria-label="玩家管理">
        <h2 className="admin-dashboard__panel-title">玩家管理</h2>
        <div className="admin-dashboard__controls">
          <input
            type="text"
            className="admin-dashboard__input"
            placeholder="@handle"
            aria-label="玩家 handle"
            value={banHandle}
            onChange={(e) => setBanHandle(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--danger btn--sm"
            onClick={() => void runBan(true)}
            disabled={busy}
          >
            封禁
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void runBan(false)}
            disabled={busy}
          >
            解封
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void runReset()}
            disabled={busy}
          >
            重置战绩
          </button>
        </div>
        {actionMsg ? <p className="admin-dashboard__ok">{actionMsg}</p> : null}
        {actionErr ? <p className="admin-dashboard__action-error">{actionErr}</p> : null}
      </section>

      <section className="admin-dashboard__panel" aria-label="网络延迟">
        <h2 className="admin-dashboard__panel-title">网络延迟 (ms)</h2>
        {regions.length === 0 ? (
          <p className="admin-dashboard__empty">暂无延迟数据</p>
        ) : (
          <table className="admin-dashboard__table admin-dashboard__latency">
            <thead>
              <tr>
                <th>区域</th>
                <th className="num">p50</th>
                <th className="num">p95</th>
                <th className="num">p99</th>
                <th className="num">样本</th>
              </tr>
            </thead>
            <tbody>
              {regions.map(([region, s]) => (
                <tr key={region}>
                  <td>{region}</td>
                  <td className="num tabular">{s.p50}</td>
                  <td className="num tabular">{s.p95}</td>
                  <td className="num tabular">{s.p99}</td>
                  <td className="num tabular">{s.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
