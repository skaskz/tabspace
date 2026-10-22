import { useEffect, useState, type ReactNode } from 'react';
import { Moon, Search, Sun, User } from 'lucide-react';
import { navigate, useRoute } from '@/app/router';
import { useBackground } from '@/app/ThemeController';
import { useSettings } from '@/hooks/useStore';
import { update } from '@/storage/store';
import { Kbd } from '@/components/ui';
import { cn } from '@/utils/cn';
import { Starfield } from './Starfield';
import { Logo } from './Logo';
import { NAV, NAV_FOOTER, type NavEntry } from './nav';
import { FocusIndicator } from './FocusIndicator';
import { SearchPalette } from './SearchPalette';

export function AppShell({ children }: { children: ReactNode }) {
  const { page } = useRoute();
  const bg = useBackground();
  const [settings] = useSettings();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isDark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const initial = settings.userName.trim().charAt(0).toUpperCase();

  return (
    <div className="relative flex min-h-screen">
      {bg.image ? (
        <div aria-hidden className="fixed inset-0 -z-10 bg-cover bg-center" style={{ backgroundImage: `url(${bg.image})` }} />
      ) : (
        bg.starfield && <Starfield animate={bg.animate} parallax={bg.parallax} />
      )}
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-fg focus:px-3 focus:py-2 focus:text-bg"
      >
        Skip to content
      </a>

      <nav aria-label="Primary" className="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-line bg-bg/70 px-3 py-6 backdrop-blur-md max-lg:w-[72px]">
        <button type="button" onClick={() => navigate('dashboard')} className="mb-8 px-2 text-left" aria-label="Tabspace home">
          <Logo className="max-lg:[&>span]:hidden" />
        </button>
        <ul className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavItem key={item.id} item={item} active={page === item.id} />
          ))}
        </ul>
        <ul className="mt-auto flex flex-col gap-1 border-t border-line pt-4">
          {NAV_FOOTER.map((item) => (
            <NavItem key={item.id} item={item} active={page === item.id} />
          ))}
        </ul>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-4 px-8 pt-5 pb-2 max-md:px-4">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="ts-card ts-press flex h-11 w-full max-w-[720px] items-center gap-3 px-4 text-left text-sm text-faint hover:border-line-strong"
            aria-label="Search tabs, workspaces, notes and bookmarks"
          >
            <Search size={18} />
            <span className="flex-1 truncate">Search tabs, workspaces, notes, bookmarks…</span>
            <Kbd>Ctrl K</Kbd>
          </button>
          <div className="ml-auto flex items-center gap-3">
            <FocusIndicator />
            <button
              type="button"
              aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={isDark ? 'Light theme' : 'Dark theme'}
              onClick={() => void update('ts.settings', (s) => ({ ...s, theme: isDark ? 'light' : 'dark' }))}
              className="ts-press inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-glow hover:text-fg"
            >
              {isDark ? <Sun size={20} /> : <Moon size={20} />}
            </button>
            <button
              type="button"
              onClick={() => navigate('settings')}
              aria-label="Profile and settings"
              className="ts-press flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-surface-3 text-base font-semibold hover:border-fg/40"
            >
              {initial || <User size={18} aria-hidden />}
            </button>
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 px-8 pt-4 pb-10 outline-none max-md:px-4" tabIndex={-1}>
          {children}
        </main>
      </div>
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

function NavItem({ item, active }: { item: NavEntry; active: boolean }) {
  const Icon = item.icon;
  return (
    <li>
      <a
        href={`#/${item.id}`}
        aria-current={active ? 'page' : undefined}
        title={item.label}
        className={cn(
          'ts-nav-item flex h-11 items-center gap-3.5 rounded-[var(--radius-ctl)] border border-transparent px-3 text-[14.5px] max-lg:justify-center',
          active ? 'ts-active text-fg' : 'text-muted hover:bg-glow hover:text-fg',
        )}
      >
        <Icon size={20} strokeWidth={1.75} />
        <span className="max-lg:sr-only">{item.label}</span>
      </a>
    </li>
  );
}
