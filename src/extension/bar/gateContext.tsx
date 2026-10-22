import { createContext, useContext, useEffect, type RefObject } from 'react';
import type { VisibilityGate } from './visibility';

/** The website bar's clickjacking gate (null on the New Tab, which is Tabspace's own page). */
export const VisibilityGateContext = createContext<VisibilityGate | null>(null);

/** Register a panel (menu / popover) so clicks inside it are checked against its own visibility. */
export function useGateTarget(ref: RefObject<Element | null>, active = true) {
  const gate = useContext(VisibilityGateContext);
  useEffect(() => {
    if (!gate || !active || !ref.current) return;
    return gate.observe(ref.current);
  }, [gate, active, ref]);
}
