import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SidePanel } from '@/extension/sidebar/SidePanel';

describe('SidePanel rail', () => {
  it('arrow keys move from the focused tab (roving focus), Home/End jump', async () => {
    render(<SidePanel preview />);
    const tasks = await screen.findByRole('tab', { name: 'Tasks' });
    // "Focus" is selected by default; focus moves onto "Tasks" without selecting it.
    expect(screen.getByRole('tab', { name: 'Focus' })).toHaveAttribute('aria-selected', 'true');
    tasks.focus();
    fireEvent.keyDown(tasks, { key: 'ArrowDown' });
    const notes = screen.getByRole('tab', { name: 'Notes' });
    expect(document.activeElement).toBe(notes);
    expect(notes).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(notes, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Workspaces' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Focus' }));
  });

  it('hides a tab tooltip after it is clicked, until the pointer leaves', async () => {
    render(<SidePanel preview />);
    const tasks = await screen.findByRole('tab', { name: 'Tasks' });
    const tip = tasks.querySelector('span[aria-hidden="true"]')!;
    expect(tip.className).toContain('group-hover:opacity-100');
    fireEvent.pointerDown(tasks);
    fireEvent.click(tasks);
    expect(tip.className).not.toContain('group-hover:opacity-100');
    fireEvent.pointerLeave(tasks);
    expect(tip.className).toContain('group-hover:opacity-100');
  });

  it('uses the given heading level so an embedding page keeps a single H1', async () => {
    const { container } = render(<SidePanel preview headingLevel={3} />);
    await screen.findByRole('tab', { name: 'Focus' });
    expect(container.querySelector('h1')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: 'Focus' })).toBeInTheDocument();
  });
});
