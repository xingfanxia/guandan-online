// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AdminDashboard } from '@/screens/AdminDashboard';
import type { PlayerReport, LatencyAggregate } from '@/lib/api/admin';
import { RoomApiError } from '@/lib/api/rooms';

const REPORTS: PlayerReport[] = [
  { reporterHandle: '@阿祥', targetHandle: '@老郭', gameId: 'G1', reason: 'cheating', createdAt: 1_700_000_000_000 },
  { reporterHandle: '@饭团', targetHandle: '@泉酱', gameId: 'G2', reason: 'afk', createdAt: 1_700_000_100_000 },
];

const LATENCY: LatencyAggregate = {
  iad1: { p50: 50, p95: 95, p99: 99, count: 100 },
  hkg1: { p50: 20, p95: 40, p99: 40, count: 4 },
};

function deps(overrides: Partial<Parameters<typeof AdminDashboard>[0]> = {}) {
  return {
    token: 'tok',
    fetchReportsFn: vi.fn().mockResolvedValue(REPORTS),
    fetchLatencyFn: vi.fn().mockResolvedValue(LATENCY),
    setBanFn: vi.fn().mockResolvedValue({ handle: '@老郭', banned: true }),
    resetStatsFn: vi.fn().mockResolvedValue({ handle: '@老郭', gamesPlayed: 0 }),
    ...overrides,
  };
}

describe('AdminDashboard — data load', () => {
  it('renders the reports table from the injected fetch fn', async () => {
    render(<AdminDashboard {...deps()} />);
    await waitFor(() => expect(screen.getByText('@老郭')).toBeInTheDocument());
    expect(screen.getByText('@泉酱')).toBeInTheDocument();
    // Reasons are localized.
    expect(screen.getByText('作弊')).toBeInTheDocument();
    expect(screen.getByText('挂机')).toBeInTheDocument();
  });

  it('renders the latency panel with p50/p95/p99 per region', async () => {
    render(<AdminDashboard {...deps()} />);
    await waitFor(() => expect(screen.getByText('iad1')).toBeInTheDocument());
    const panel = screen.getByLabelText('网络延迟');
    expect(panel).toHaveTextContent('iad1');
    expect(panel).toHaveTextContent('50');
    expect(panel).toHaveTextContent('95');
    expect(panel).toHaveTextContent('99');
    expect(panel).toHaveTextContent('hkg1');
  });

  it('passes the token to both fetch fns', async () => {
    const d = deps({ token: 'super-secret' });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(d.fetchReportsFn).toHaveBeenCalled());
    expect(d.fetchReportsFn).toHaveBeenCalledWith('super-secret');
    expect(d.fetchLatencyFn).toHaveBeenCalledWith('super-secret');
  });

  it('shows empty states when there is no data', async () => {
    const d = deps({
      fetchReportsFn: vi.fn().mockResolvedValue([]),
      fetchLatencyFn: vi.fn().mockResolvedValue({}),
    });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('暂无举报')).toBeInTheDocument());
    expect(screen.getByText('暂无延迟数据')).toBeInTheDocument();
  });

  it('surfaces a 401 as a token error', async () => {
    const d = deps({
      fetchReportsFn: vi.fn().mockRejectedValue(new RoomApiError(401, 'unauthorized')),
      fetchLatencyFn: vi.fn().mockRejectedValue(new RoomApiError(401, 'unauthorized')),
    });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('令牌无效或缺失')).toBeInTheDocument());
  });

  it('shows a missing-token error when no token is supplied', async () => {
    const d = deps({ token: '' });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('缺少管理员令牌')).toBeInTheDocument());
    // Never attempts a fetch without a token.
    expect(d.fetchReportsFn).not.toHaveBeenCalled();
  });
});

describe('AdminDashboard — moderation actions', () => {
  it('bans the entered handle and shows confirmation', async () => {
    const d = deps({ setBanFn: vi.fn().mockResolvedValue({ handle: '@cheater', banned: true }) });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('@老郭')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('玩家 handle'), { target: { value: '@cheater' } });
    fireEvent.click(screen.getByRole('button', { name: '封禁' }));
    await waitFor(() => expect(d.setBanFn).toHaveBeenCalledWith('tok', '@cheater', true));
    expect(screen.getByText('@cheater 已封禁')).toBeInTheDocument();
  });

  it('unbans via the 解封 button (banned=false)', async () => {
    const d = deps({ setBanFn: vi.fn().mockResolvedValue({ handle: '@x', banned: false }) });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('@老郭')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('玩家 handle'), { target: { value: '@x' } });
    fireEvent.click(screen.getByRole('button', { name: '解封' }));
    await waitFor(() => expect(d.setBanFn).toHaveBeenCalledWith('tok', '@x', false));
  });

  it('resets stats for the entered handle', async () => {
    const d = deps({ resetStatsFn: vi.fn().mockResolvedValue({ handle: '@grinder', gamesPlayed: 0 }) });
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('@老郭')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('玩家 handle'), { target: { value: '@grinder' } });
    fireEvent.click(screen.getByRole('button', { name: '重置战绩' }));
    await waitFor(() => expect(d.resetStatsFn).toHaveBeenCalledWith('tok', '@grinder'));
    expect(screen.getByText(/@grinder 战绩已重置/)).toBeInTheDocument();
  });

  it('refuses a ban with an empty handle', async () => {
    const d = deps();
    render(<AdminDashboard {...d} />);
    await waitFor(() => expect(screen.getByText('@老郭')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '封禁' }));
    expect(screen.getByText('请输入 @handle')).toBeInTheDocument();
    expect(d.setBanFn).not.toHaveBeenCalled();
  });
});
