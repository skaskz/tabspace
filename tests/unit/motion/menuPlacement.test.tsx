import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, placeMenu } from '@/components/ui';

const rect = (top: number, left: number, w = 28, h = 28) => ({ top, left, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
const vp = { width: 1280, height: 800 };

describe('menu placement', () => {
  it('opens below the trigger, right-aligned, when there is room', () => {
    const p = placeMenu(rect(100, 600), { width: 180, height: 200 }, vp, 'right');
    expect(p.top).toBe(132);
    expect(p.left).toBe(628 - 180);
  });

  it('flips above the trigger near the bottom of the screen', () => {
    const p = placeMenu(rect(700, 600), { width: 180, height: 300 }, vp, 'right');
    expect(p.top + 300).toBeLessThanOrEqual(700);
  });

  it('never leaves the viewport horizontally', () => {
    expect(placeMenu(rect(100, 2), { width: 180, height: 100 }, vp, 'right').left).toBe(8);
    expect(placeMenu(rect(100, 1270), { width: 180, height: 100 }, vp, 'left').left).toBe(1280 - 180 - 8);
  });

  it('caps height to the available space so long menus scroll', () => {
    const p = placeMenu(rect(380, 600), { width: 180, height: 2000 }, vp, 'right');
    expect(p.maxHeight).toBeLessThan(800);
  });
});

describe('Menu portal', () => {
  it('renders the list outside its card so neighbouring cards cannot cover it', async () => {
    render(
      <div data-testid="card" style={{ backdropFilter: 'blur(4px)' }}>
        <Menu label="Spotify options" trigger={<span>…</span>} items={[{ label: 'Play Liked Songs', onSelect: () => undefined }]} />
      </div>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Spotify options' }));
    const menu = screen.getByRole('menu');
    expect(screen.getByTestId('card').contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });
});
