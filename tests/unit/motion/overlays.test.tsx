import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Button, ConfirmProvider, Menu, Modal, ToastProvider, useConfirm, useToast } from '@/components/ui';
import { mockExitAnimations } from './helpers';

function ModalHarness({ initialOpen = false, onClose }: { initialOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        External close
      </button>
      <Modal
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Rename workspace"
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <input aria-label="Name" />
      </Modal>
    </>
  );
}

const backdrop = () => document.querySelector<HTMLElement>('[data-state]');

describe('Modal enter/exit lifecycle', () => {
  let anims: ReturnType<typeof mockExitAnimations> | null = null;
  afterEach(() => {
    anims?.restore();
    anims = null;
    delete document.documentElement.dataset.motion;
  });

  it('opens with enter classes on backdrop and panel', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('Open dialog'));
    const dialog = screen.getByRole('dialog', { name: 'Rename workspace' });
    expect(dialog).toHaveClass('ts-dialog-in');
    expect(backdrop()).toHaveClass('ts-backdrop-in');
    expect(backdrop()).toHaveAttribute('data-state', 'open');
  });

  it('stays mounted (inert, hidden from AT) during the exit animation, then unmounts', async () => {
    anims = mockExitAnimations();
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('Open dialog'));
    fireEvent.click(screen.getByText('External close'));
    // Closing: still in the DOM with exit classes, but not exposed as a dialog any more.
    const node = backdrop();
    expect(node).not.toBeNull();
    expect(node).toHaveAttribute('data-state', 'closing');
    expect(node).toHaveClass('ts-backdrop-out');
    expect(node).toHaveAttribute('aria-hidden', 'true');
    expect(node).toHaveAttribute('inert');
    expect(node?.querySelector('[role="dialog"]')).toHaveClass('ts-dialog-out');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Content is kept while it animates out.
    expect(node).toHaveTextContent('Rename workspace');
    await act(async () => anims!.finishAll());
    expect(backdrop()).toBeNull();
  });

  it('unmounts on the safety timeout if an exit animation never reports finished', () => {
    vi.useFakeTimers();
    try {
      anims = mockExitAnimations();
      render(<ModalHarness />);
      fireEvent.click(screen.getByText('Open dialog'));
      fireEvent.click(screen.getByText('External close'));
      expect(backdrop()).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(backdrop()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmounts immediately under in-app reduced motion', () => {
    anims = mockExitAnimations();
    document.documentElement.dataset.motion = 'reduced';
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('Open dialog'));
    fireEvent.click(screen.getByText('External close'));
    expect(backdrop()).toBeNull();
  });

  it('unmounts immediately when the Web Animations API is unavailable (jsdom fallback)', () => {
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('Open dialog'));
    fireEvent.click(screen.getByText('External close'));
    expect(backdrop()).toBeNull();
  });

  it('restores focus to the trigger as soon as it closes, without waiting for the animation', () => {
    anims = mockExitAnimations();
    render(<ModalHarness />);
    const trigger = screen.getByText('Open dialog');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(backdrop()).toHaveAttribute('data-state', 'closing');
    expect(trigger).toHaveFocus();
  });

  it('Escape closes once; further Escapes during the exit are not captured', () => {
    anims = mockExitAnimations();
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);
    fireEvent.click(screen.getByText('Open dialog'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // Backdrop clicks while closing are ignored too.
    fireEvent.mouseDown(backdrop()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reopening mid-exit returns to the open state on the same node', async () => {
    anims = mockExitAnimations();
    render(<ModalHarness />);
    fireEvent.click(screen.getByText('Open dialog'));
    fireEvent.click(screen.getByText('External close'));
    expect(backdrop()).toHaveAttribute('data-state', 'closing');
    fireEvent.click(screen.getByText('Open dialog'));
    expect(backdrop()).toHaveAttribute('data-state', 'open');
    expect(screen.getByRole('dialog')).toHaveClass('ts-dialog-in');
    // A stale exit completion must not unmount the reopened dialog.
    await act(async () => anims!.finishAll());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('ConfirmProvider animates via Modal', () => {
  let anims: ReturnType<typeof mockExitAnimations> | null = null;
  afterEach(() => anims?.restore());

  it('resolves immediately and keeps its message visible while animating out', async () => {
    anims = mockExitAnimations();
    let result: boolean | undefined;
    function Asker() {
      const confirm = useConfirm();
      return (
        <button type="button" onClick={() => void confirm({ title: 'Delete note?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }).then((v) => (result = v))}>
          Ask
        </button>
      );
    }
    render(
      <ConfirmProvider>
        <Asker />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText('Ask'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })));
    expect(result).toBe(true);
    expect(backdrop()).toHaveTextContent('This cannot be undone.');
    expect(backdrop()).toHaveTextContent('Delete note?');
    await act(async () => anims!.finishAll());
    expect(backdrop()).toBeNull();
  });
});

describe('Menu dropdown animation', () => {
  let anims: ReturnType<typeof mockExitAnimations> | null = null;
  afterEach(() => anims?.restore());

  const items = (onSelect = vi.fn()) => [
    { label: 'Rename', onSelect },
    { label: 'Delete', onSelect, danger: true },
  ];

  it('opens with ts-menu-in and closes with ts-menu-out, then unmounts', async () => {
    anims = mockExitAnimations();
    const onSelect = vi.fn();
    render(<Menu label="More actions" trigger="…" items={items(onSelect)} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu).toHaveClass('ts-menu-in');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const closing = document.querySelector('[data-state="closing"]');
    expect(closing).toHaveClass('ts-menu-out');
    expect(closing).toHaveAttribute('aria-hidden', 'true');
    expect(closing).toHaveAttribute('inert');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await act(async () => anims!.finishAll());
    expect(document.querySelector('[data-state]')).toBeNull();
  });

  it('Escape closes and returns focus to the trigger; without animations it unmounts at once', () => {
    render(<Menu label="More actions" trigger="…" items={items()} />);
    const trigger = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('Toasts slide in and out', () => {
  let anims: ReturnType<typeof mockExitAnimations> | null = null;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    anims?.restore();
  });

  function Pusher() {
    const toast = useToast();
    return (
      <button type="button" onClick={() => toast('Workspace saved')}>
        Push
      </button>
    );
  }

  it('enters with ts-toast-in, leaves with ts-toast-out and is removed after the exit', async () => {
    anims = mockExitAnimations();
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Push'));
    expect(screen.getByRole('status')).toHaveClass('ts-toast-in');
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    const leaving = screen.getByText('Workspace saved');
    expect(leaving).toHaveClass('ts-toast-out');
    await act(async () => anims!.finishAll());
    expect(screen.queryByText('Workspace saved')).toBeNull();
  });

  it('is removed right at 3.5s when exit animations are unavailable (jsdom / reduced motion)', () => {
    render(
      <ToastProvider>
        <Pusher />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('Push'));
    act(() => {
      vi.advanceTimersByTime(3500);
    });
    expect(screen.queryByText('Workspace saved')).toBeNull();
  });
});
