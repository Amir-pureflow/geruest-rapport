/** Export mit Team-Filter: Abwesenheit zählt im Team, in dem die Person AN DEM TAG war (behoben 28.11.2026). */
import { describe, expect, it } from 'vitest';
import { amTagImTeam, type Einteilung, type Mitgliedschaft } from '../../src/lib/abwesenheit';

// Ana: bis 15.11. in Team 1, ab 16.11. in Team 2. Ben: immer Team 1, am 20.11. per Planung in Team 2 eingeteilt.
const mitglieder: Mitgliedschaft[] = [
  { mitarbeiter_id: 'ana', team_id: 't1', von: '2026-01-05', bis: '2026-11-15' },
  { mitarbeiter_id: 'ana', team_id: 't2', von: '2026-11-16', bis: null },
  { mitarbeiter_id: 'ben', team_id: 't1', von: '2026-01-05', bis: null },
];
const einteilungen: Einteilung[] = [{ mitarbeiter_id: 'ben', team_id: 't2', datum: '2026-11-20' }];

describe('amTagImTeam', () => {
  it('Ferien vor dem Wechsel gehören ins alte Team, danach ins neue', () => {
    expect(amTagImTeam('ana', '2026-11-10', 't1', mitglieder, einteilungen)).toBe(true);
    expect(amTagImTeam('ana', '2026-11-10', 't2', mitglieder, einteilungen)).toBe(false); // vorher: heute in t2 → fälschlich dort
    expect(amTagImTeam('ana', '2026-11-15', 't1', mitglieder, einteilungen)).toBe(true); // «bis» zählt mit
    expect(amTagImTeam('ana', '2026-11-16', 't2', mitglieder, einteilungen)).toBe(true);
  });
  it('Einteilung der Planung geht vor der festen Mitgliedschaft', () => {
    expect(amTagImTeam('ben', '2026-11-20', 't2', mitglieder, einteilungen)).toBe(true);
    expect(amTagImTeam('ben', '2026-11-20', 't1', mitglieder, einteilungen)).toBe(false);
    expect(amTagImTeam('ben', '2026-11-19', 't1', mitglieder, einteilungen)).toBe(true);
  });
  it('vor dem Eintritt gehört niemand dazu', () => {
    expect(amTagImTeam('ana', '2026-01-02', 't1', mitglieder, einteilungen)).toBe(false);
  });
});
