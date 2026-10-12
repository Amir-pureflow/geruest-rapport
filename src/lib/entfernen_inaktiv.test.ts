import { describe, expect, it } from 'vitest';
import { teamInaktivEntscheid, teamInaktivFrage } from './entfernen';

// Haken «aktiv» beim Team (13.10.2026): derselbe Schutz wie beim Entfernen, aber nie löschen
describe('Team inaktiv setzen', () => {
  it('mit offenen Stunden erst nach der Freigabe, sonst aus den Listen — gelöscht wird nie', () => {
    expect(teamInaktivEntscheid({ hatOffeneStunden: true })).toBe('erst_freigeben');
    expect(teamInaktivEntscheid({ hatOffeneStunden: false })).toBe('deaktivieren');
  });

  it('sagt in der Rückfrage, was passiert', () => {
    const ok = teamInaktivFrage('Team 4', 'deaktivieren', 3, 2);
    expect(ok.text).toBe('«Team 4» inaktiv setzen? Das Team verschwindet aus Teamgerät und Planung, die Stunden bleiben im Lohn-Export. Die Leute sind danach ohne Team. Die Planung ab morgen fällt weg.');
    expect(ok.knopf).toBe('Inaktiv setzen');
    expect(teamInaktivFrage('Team 4', 'deaktivieren', 0, 0).text).toBe('«Team 4» inaktiv setzen? Das Team verschwindet aus Teamgerät und Planung, die Stunden bleiben im Lohn-Export.');
    const warten = teamInaktivFrage('Team 4', 'erst_freigeben', 3, 2);
    expect(warten.knopf).toBeNull();
    expect(warten.text).toContain('Zuerst in der Wochenübersicht freigeben');
  });
});
