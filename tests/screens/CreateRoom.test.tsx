// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateRoom } from '@/screens/CreateRoom';
import { RoomApiError } from '@/lib/api/rooms';

beforeEach(() => {
  window.localStorage.clear();
});

describe('CreateRoom', () => {
  it('renders 3 mode buttons + 4P default', () => {
    render(<CreateRoom initialHandle="@阿祥" />);
    expect(screen.getByRole('radio', { name: '4 人模式', checked: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '6 人模式', checked: false })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '8 人模式', checked: false })).toBeInTheDocument();
  });

  it('switches mode and updates AI fill row count', () => {
    render(<CreateRoom initialHandle="@阿祥" />);
    // 4P default → 3 AI rows
    expect(screen.getAllByText(/座位 \d/)).toHaveLength(3);
    fireEvent.click(screen.getByRole('radio', { name: '8 人模式' }));
    expect(screen.getAllByText(/座位 \d/)).toHaveLength(7);
  });

  it('toggles rule axes via aria-pressed', () => {
    render(<CreateRoom initialHandle="@阿祥" />);
    const aLevel = screen.getByRole('button', { name: 'A 级严格' });
    expect(aLevel).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(aLevel);
    expect(aLevel).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects A 级 toggle in spec preview', () => {
    render(<CreateRoom initialHandle="@阿祥" />);
    expect(screen.getByText('严格')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'A 级严格' }));
    expect(screen.getByText('宽松')).toBeInTheDocument();
  });

  it('submits and navigates to /wait on success', async () => {
    const createFn = vi.fn().mockResolvedValue({
      code: 'K7M2P9',
      hostId: 'p0',
      hostToken: 'ht',
      hostJoinToken: 'jt',
    });
    const navigateFn = vi.fn();
    render(
      <CreateRoom
        initialHandle="@阿祥"
        createFn={createFn}
        navigateFn={navigateFn}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /建立房间/ }));
    await waitFor(() =>
      expect(createFn).toHaveBeenCalledWith({ mode: '4', handle: '@阿祥' })
    );
    await waitFor(() =>
      expect(navigateFn).toHaveBeenCalledWith({ kind: 'wait', code: 'K7M2P9' })
    );
    // Credentials persisted
    const tokens = JSON.parse(window.localStorage.getItem('guandan.tokens') ?? '[]');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].code).toBe('K7M2P9');
    expect(tokens[0].hostToken).toBe('ht');
  });

  it('shows error when server rejects', async () => {
    const createFn = vi
      .fn()
      .mockRejectedValue(new RoomApiError(503, 'code_generation_exhausted'));
    render(<CreateRoom initialHandle="@阿祥" createFn={createFn} />);
    fireEvent.click(screen.getByRole('button', { name: /建立房间/ }));
    await waitFor(() =>
      expect(screen.getByText(/暂时繁忙/)).toBeInTheDocument()
    );
  });

  it('disables submit when no handle', () => {
    render(<CreateRoom initialHandle={null} />);
    expect(screen.getByRole('button', { name: /建立房间/ })).toBeDisabled();
  });

  it('returns to landing on back', () => {
    const navigateFn = vi.fn();
    render(<CreateRoom initialHandle="@阿祥" navigateFn={navigateFn} />);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(navigateFn).toHaveBeenCalledWith({ kind: 'landing' });
  });

  it('AI tier chip toggles aria-pressed', () => {
    render(<CreateRoom initialHandle="@阿祥" />);
    // Seat 2 row, find 'AI 进阶' chip
    const chips = screen.getAllByRole('button', { name: /AI 进阶/i });
    expect(chips.length).toBeGreaterThan(0);
    const first = chips[0]!;
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
  });
});
