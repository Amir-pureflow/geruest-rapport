import { describe, it, expect } from 'vitest';
import { aufteilenNachBisher, bisherNormal, restNormal, teileNachBisher } from './tagesrest';

const TAG = 504; // 8.4 h, Gerüst GmbH

describe('Normal/Überstunden über alle Meldungen eines Tages', () => {
  it('erste Meldung: wie bisher, 8.4 h normal, der Rest Überstunden', () => {
    expect(aufteilenNachBisher(600, TAG, 0)).toEqual({ normal_min: 504, ueber_min: 96 });
  });

  it('zweite Meldung am selben Tag («Zusätzlich»): nur noch Überstunden, wenn der Tag schon voll ist', () => {
    expect(aufteilenNachBisher(120, TAG, 504)).toEqual({ normal_min: 0, ueber_min: 120 });
  });

  it('Gast, den zwei Teams melden: der Rest des normalen Tags, dann Überstunden', () => {
    // Team 1 meldet 5 h am Morgen, Team 2 am Nachmittag 5 h
    expect(aufteilenNachBisher(300, TAG, 300)).toEqual({ normal_min: 204, ueber_min: 96 });
  });

  it('mehr als ein normaler Tag schon gemeldet: nie negativ', () => {
    expect(restNormal(TAG, 700)).toBe(0);
    expect(aufteilenNachBisher(60, TAG, 700)).toEqual({ normal_min: 0, ueber_min: 60 });
  });

  it('nichts geht verloren: Summe bleibt gleich', () => {
    const t = aufteilenNachBisher(437, TAG, 222);
    expect(t.normal_min + t.ueber_min).toBe(437);
  });

  it('zwei Baustellen in einem Durchgang nach einer früheren Meldung', () => {
    expect(teileNachBisher([180, 240], TAG, 300)).toEqual([{ normal_min: 180, ueber_min: 0 }, { normal_min: 24, ueber_min: 216 }]);
  });

  it('bisherNormal: je Person summiert, ersetzte Meldungen zählen nicht', () => {
    const m = bisherNormal([
      { mitarbeiter_id: 'p1', normal_min: 300, meldung: 'a' },
      { mitarbeiter_id: 'p1', normal_min: 100, meldung: 'b' },
      { mitarbeiter_id: 'p2', normal_min: 504, meldung: 'a' },
    ], new Set(['a']));
    expect(m.get('p1')).toBe(100);
    expect(m.get('p2')).toBeUndefined();
  });
});
