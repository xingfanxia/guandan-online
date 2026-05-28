// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportButton } from '@/components/ReportButton';

describe('ReportButton', () => {
  it('renders the default 举报 trigger', () => {
    render(<ReportButton targetHandle="@老郭" gameId="G1" onSubmit={async () => undefined} />);
    expect(screen.getByRole('button', { name: '举报 @老郭' })).toBeInTheDocument();
  });

  it('opens the reason modal on click', () => {
    render(<ReportButton targetHandle="@老郭" gameId="G1" onSubmit={async () => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @老郭' }));
    expect(screen.getByRole('dialog', { name: '举报 @老郭' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: '举报原因' })).toBeInTheDocument();
  });

  it('fires onSubmit with the default reason (cheating) + target + gameId', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReportButton targetHandle="@老郭" gameId="G7" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @老郭' }));
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({
      targetHandle: '@老郭',
      gameId: 'G7',
      reason: 'cheating',
    });
  });

  it('submits the picked reason when a different radio is chosen', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReportButton targetHandle="@x" gameId="G1" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @x' }));
    fireEvent.click(screen.getByRole('radio', { name: '挂机 / 消极游戏' }));
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]![0].reason).toBe('afk');
  });

  it('surfaces an error when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('网络错误'));
    render(<ReportButton targetHandle="@x" gameId="G1" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @x' }));
    fireEvent.click(screen.getByRole('button', { name: '提交举报' }));
    await waitFor(() => expect(screen.getByText('网络错误')).toBeInTheDocument());
    // Dialog stays open so the user can retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on 取消 without firing onSubmit', () => {
    const onSubmit = vi.fn();
    render(<ReportButton targetHandle="@x" gameId="G1" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @x' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not open when disabled', () => {
    render(<ReportButton targetHandle="@x" gameId="G1" onSubmit={async () => undefined} disabled />);
    fireEvent.click(screen.getByRole('button', { name: '举报 @x' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
