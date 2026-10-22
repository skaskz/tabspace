/**
 * jsdom has no Web Animations API, so overlays unmount instantly there (that is the intended fallback).
 * To exercise the exit-animation path we fake `Element.prototype.getAnimations`: every element in the
 * subtree carrying a `ts-…-out` class reports one running CSS animation whose `finished` promise we control.
 */
export function mockExitAnimations() {
  const proto = Element.prototype as unknown as { getAnimations?: (opts?: { subtree?: boolean }) => Animation[] };
  const original = proto.getAnimations;
  const pending: (() => void)[] = [];
  let calls = 0;
  proto.getAnimations = function (this: Element) {
    calls++;
    const els = [this, ...Array.from(this.querySelectorAll('*'))];
    const anims: Animation[] = [];
    for (const el of els) {
      const name = (el.getAttribute('class') ?? '').match(/\bts-[a-z]+-out\b/)?.[0];
      if (!name) continue;
      const finished = new Promise<Animation>((resolve) => pending.push(() => resolve(undefined as unknown as Animation)));
      anims.push({ animationName: name, finished } as unknown as Animation);
    }
    return anims;
  };
  return {
    /** Resolve every exit animation reported so far. */
    finishAll: () => pending.splice(0).forEach((resolve) => resolve()),
    get calls() {
      return calls;
    },
    restore: () => {
      if (original) proto.getAnimations = original;
      else delete proto.getAnimations;
    },
  };
}
