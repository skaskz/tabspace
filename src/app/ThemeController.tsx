import { useEffect } from 'react';
import { useSettings } from '@/hooks/useStore';

/** Mirrors appearance settings onto <html> data attributes consumed by global.css. */
export function ThemeController() {
  const [settings] = useSettings();
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = settings.theme === 'dark' || (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    root.dataset.density = settings.density;
    root.dataset.text = settings.textScale;
    root.dataset.motion = settings.reducedMotion || !settings.animations ? 'reduced' : 'full';
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings.theme, settings.density, settings.textScale, settings.reducedMotion, settings.animations]);
  return null;
}

/**
 * Background layer: user image (if any) or starfield.
 * `parallax` is already gated on motion (animations on, reduced motion off); Starfield additionally
 * honours the OS `prefers-reduced-motion` setting. Usage: `<Starfield animate={bg.animate} parallax={bg.parallax} />`.
 */
export function useBackground() {
  const [settings] = useSettings();
  const animate = settings.animations && !settings.reducedMotion;
  return {
    image: settings.backgroundImage,
    starfield: settings.starfield && !settings.backgroundImage,
    animate,
    parallax: animate && settings.parallax !== false,
  };
}
