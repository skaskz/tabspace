import {
  BookOpen,
  Briefcase,
  Camera,
  Code2,
  Dumbbell,
  Gamepad2,
  Globe,
  Heart,
  Home,
  LayoutGrid,
  Music,
  Palette,
  Rocket,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  Video,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Curated workspace icon set. `Workspace.icon` stores one of these keys.
 * Keys are lower-case alphanumerics so they match the dashboard's
 * WorkspaceGlyph normaliser (src/pages/dashboard/WorkspaceGlyph.tsx).
 */
export const WORKSPACE_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  layoutgrid: { icon: LayoutGrid, label: 'Grid' },
  code: { icon: Code2, label: 'Code' },
  home: { icon: Home, label: 'Home' },
  video: { icon: Video, label: 'Video' },
  search: { icon: Search, label: 'Research' },
  briefcase: { icon: Briefcase, label: 'Work' },
  book: { icon: BookOpen, label: 'Reading' },
  rocket: { icon: Rocket, label: 'Launch' },
  palette: { icon: Palette, label: 'Creative' },
  sparkles: { icon: Sparkles, label: 'Ideas' },
  gamepad: { icon: Gamepad2, label: 'Games' },
  music: { icon: Music, label: 'Music' },
  camera: { icon: Camera, label: 'Photo' },
  dumbbell: { icon: Dumbbell, label: 'Fitness' },
  heart: { icon: Heart, label: 'Health' },
  globe: { icon: Globe, label: 'Web' },
  shoppingbag: { icon: ShoppingBag, label: 'Shopping' },
  star: { icon: Star, label: 'Favourite' },
};

export const WORKSPACE_ICON_KEYS = Object.keys(WORKSPACE_ICONS);
export const DEFAULT_WORKSPACE_ICON = 'layoutgrid';

export function normalizeIconKey(key: string | undefined): string {
  return (key ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isWorkspaceIcon(key: string): boolean {
  return normalizeIconKey(key) in WORKSPACE_ICONS;
}

/** Renders a workspace's icon; unknown keys fall back to the grid icon. */
export function WorkspaceIcon({ icon, size = 18, className }: { icon: string | undefined; size?: number; className?: string }) {
  const Icon = WORKSPACE_ICONS[normalizeIconKey(icon)]?.icon ?? LayoutGrid;
  return <Icon size={size} strokeWidth={1.75} className={className} aria-hidden />;
}

/** Square icon tile used on workspace cards. */
export function WorkspaceIconTile({ icon, size = 44, className }: { icon: string | undefined; size?: number; className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center rounded-xl border border-line bg-surface-3 text-fg', className)} style={{ width: size, height: size }} aria-hidden>
      <WorkspaceIcon icon={icon} size={Math.round(size * 0.45)} />
    </span>
  );
}
