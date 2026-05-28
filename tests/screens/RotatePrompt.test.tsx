// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RotatePrompt } from '@/screens/RotatePrompt';
import * as orientation from '@/lib/orientation';

describe('RotatePrompt', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the rotate overlay with both CN + EN copy', () => {
    render(<RotatePrompt />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('请横屏游戏')).toBeInTheDocument();
    expect(
      screen.getByText(/rotate your device to landscape/i)
    ).toBeInTheDocument();
  });

  it('calls onLockAttempt when lockLandscape resolves true', async () => {
    vi.spyOn(orientation, 'lockLandscape').mockResolvedValue(true);
    const onLockAttempt = vi.fn();
    render(<RotatePrompt onLockAttempt={onLockAttempt} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(onLockAttempt).toHaveBeenCalledTimes(1));
  });

  it('does not call onLockAttempt when lockLandscape resolves false', async () => {
    vi.spyOn(orientation, 'lockLandscape').mockResolvedValue(false);
    const onLockAttempt = vi.fn();
    render(<RotatePrompt onLockAttempt={onLockAttempt} />);
    fireEvent.click(screen.getByRole('button'));
    // Give the resolved promise a tick; onLockAttempt must stay uncalled.
    await Promise.resolve();
    expect(onLockAttempt).not.toHaveBeenCalled();
  });
});
