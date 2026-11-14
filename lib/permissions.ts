/**
 * Access profiles (Teo, 13/11/2026): one shared credential per profile, at most two profiles.
 * - "amministrazione": everything (also the only profile when no email list is configured);
 * - "laboratorio": the operations of the production/warehouse floor (list below: proposal to confirm).
 * Enforced by the server (app/api/**); the interface only hides what is not allowed.
 */
import type { Action } from './domain.ts';

export type Role = 'amministrazione' | 'laboratorio';
export const roleNames: Record<Role, string> = { amministrazione: 'Amministrazione', laboratorio: 'Laboratorio' };

/** Operations the laboratorio profile may record. Everything else is amministrazione only. */
export const LAB_ACTIONS: ReadonlySet<Action['type']> = new Set<Action['type']>([
  'lot.receive', 'lot.return', 'lot.transfer',
  'production.start', 'production.count', 'production.close',
  'order.prepare', 'order.dispatch',
]);
/** Back-office areas outside the operational log. */
export type Capability = 'devices' | 'backup';

export function canRecord(role: Role, type: string): boolean {
  if (type === 'production.deviceClose') return false; // only the authenticated bridge
  return role === 'amministrazione' || LAB_ACTIONS.has(type as Action['type']);
}
const ADMIN_ONLY: readonly Capability[] = ['devices', 'backup'];
export function canUse(role: Role, capability: Capability): boolean { return role === 'amministrazione' || !ADMIN_ONLY.includes(capability); }
