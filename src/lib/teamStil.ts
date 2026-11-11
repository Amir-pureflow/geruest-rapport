/** Team-Avatar wie in der Wochenübersicht: feste Pastellfarbe je Team, Initialen des Chefmonteurs. */
const TEAM_FARBEN = [
  'bg-[#fde3d3] text-[#8a3510]',
  'bg-[#dde7f0] text-[#2f4a63]',
  'bg-[#e2efd9] text-[#355a22]',
  'bg-[#efe3f3] text-[#5d3470]',
  'bg-[#f6ecc9] text-[#6b5313]',
  'bg-[#d9eeec] text-[#225a55]',
];
/** Feste Pastellfarbe je Team (aus der ID) */
export function teamFarbe(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TEAM_FARBEN[h % TEAM_FARBEN.length];
}
/** «Nikola Vaiti» → «NV» */
export function initialen(name: string | undefined | null): string | null {
  const teile = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!teile.length) return null;
  return ((teile[0][0] ?? '') + (teile.length > 1 ? teile[teile.length - 1][0] : '')).toUpperCase();
}
/** «Team 3» → «3», «Montage Nord» → «MN» */
export function teamKuerzel(bezeichnung: string): string {
  const zahl = bezeichnung.match(/\d+/);
  if (zahl) return zahl[0];
  return bezeichnung.split(/\s+/).filter(Boolean).map((w) => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || 'T';
}
