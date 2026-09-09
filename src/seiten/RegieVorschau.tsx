/**
 * Vorschau eines Regierapports — nichts wird gespeichert, bis der Bauführer «Als Entwurf speichern» drückt.
 * Aufruf: /regie/neu?meldung=<tagesmeldung_id> (aus der Wochenübersicht, gelbe Karte).
 * Gibt es zur Meldung schon einen Rapport, geht es direkt dorthin.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../ui/Shell';
import { FotoGalerie } from '../ui/FotoGalerie';
import { supabase } from '../lib/supabase';
import { formatChf } from '../lib/tarif';
import { positionenAusEintraegen, regierapportAnlegen, summe, vorhandenerRapport, type RegiePosition } from '../lib/regie';

interface Meldung {
  id: string;
  datum: string;
  abweichung_typ: string | null;
  wer_hats_gewollt: string | null;
  transkript: string | null;
  audio_sekunden: number | null;
  team: { id: string; bezeichnung: string; chefmonteur: { name: string } | null } | null;
  baustelle: { id: string; konto_nr: string; bezeichnung: string | null } | null;
  zeiteintrag: { normal_min: number; ueber_min: number; mitarbeiter: { name: string; funktion: string } | null }[];
  foto: { id: string; pfad: string }[];
}

const ABWEICHUNG_TEXT: Record<string, string> = { zusaetzlich: 'zusätzliche Arbeit', warten: 'Wartezeit', kaputt: 'etwas kaputt' };
const WER_TEXT: Record<string, string> = { kunde: 'der Kunde wollte es', chef: 'der Chef wollte es', niemand: 'niemand hat es verlangt' };

function tagKurz(isoDatum: string): string {
  const d = new Date(isoDatum + 'T12:00:00');
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

export function RegieVorschau() {
  const navigiere = useNavigate();
  const meldungId = new URLSearchParams(window.location.search).get('meldung');
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [auftragId, setAuftragId] = useState<string | null>(null);
  const [positionen, setPositionen] = useState<RegiePosition[]>([]);
  const [zustand, setZustand] = useState<'laedt' | 'bereit' | 'speichert' | 'fehler'>('laedt');
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    if (!supabase || !meldungId) { setZustand('fehler'); setFehler('Keine Meldung angegeben.'); return; }
    const c = supabase;
    void (async () => {
      // Schon ein Rapport da? Dann keine Vorschau, sondern der echte.
      const schon = await vorhandenerRapport(c, meldungId);
      if (schon) { navigiere(`/regie/${schon}`, { replace: true }); return; }
      const { data, error } = await c
        .from('tagesmeldung')
        .select('id,datum,abweichung_typ,wer_hats_gewollt,transkript,audio_sekunden,team:team_id(id,bezeichnung,chefmonteur:chefmonteur_id(name)),baustelle:baustelle_id(id,konto_nr,bezeichnung),zeiteintrag(normal_min,ueber_min,mitarbeiter:mitarbeiter_id(name,funktion)),foto(id,pfad)')
        .eq('id', meldungId)
        .single();
      if (error || !data) { setZustand('fehler'); setFehler('Meldung nicht gefunden.'); return; }
      const m = data as unknown as Meldung;
      setMeldung(m);
      setPositionen(positionenAusEintraegen(m.zeiteintrag.map((z) => ({ normal_min: z.normal_min, ueber_min: z.ueber_min, mitarbeiter: z.mitarbeiter ?? { name: '?', funktion: 'monteur' } }))));
      if (m.baustelle) {
        const { data: a } = await c.from('zusatzauftrag_stand').select('id').eq('baustelle_id', m.baustelle.id).in('stand', ['bestellt', 'gemeldet']).order('bestellt_am').limit(1);
        setAuftragId(a && a.length > 0 ? a[0].id : null);
      }
      setZustand('bereit');
    })();
  }, [meldungId, navigiere]);

  async function speichern() {
    if (!supabase || !meldung?.baustelle) return;
    setZustand('speichert');
    const erg = await regierapportAnlegen(supabase, { meldungId: meldung.id, baustelleId: meldung.baustelle.id, zusatzauftragId: auftragId, positionen });
    if ('fehler' in erg) { setZustand('bereit'); setFehler(erg.fehler); return; }
    navigiere(`/regie/${erg.id}`, { replace: true });
  }

  const zurueck = meldung?.team ? `/cockpit?woche=${meldung.datum}&tag=${meldung.datum}&team=${meldung.team.id}&meldung=${meldung.id}` : '/cockpit';

  return (
    <Shell zurueck schmal>
      <div className="space-y-5">
        <header>
          <p className="lbl mb-1">Regierapport · Vorschau</p>
          <h1 className="font-display text-2xl font-bold">{meldung?.baustelle?.bezeichnung ?? (zustand === 'laedt' ? 'Lädt …' : '—')}</h1>
          {meldung?.baustelle && <p className="mt-1 text-sm text-ink3"><span className="knr">{meldung.baustelle.konto_nr}</span> · noch nicht gespeichert</p>}
        </header>

        {zustand === 'fehler' && <div className="card border-accent/40 bg-accent-soft text-sm">{fehler}</div>}

        {meldung && (
          <>
            <section className="card space-y-1.5 text-sm">
              <p className="lbl mb-0">Grundlage</p>
              <p>
                <strong>Tagesmeldung {tagKurz(meldung.datum)}</strong>
                {meldung.team && <> · {meldung.team.bezeichnung}{meldung.team.chefmonteur ? ` (${meldung.team.chefmonteur.name})` : ''}</>}
              </p>
              <p className="text-ink2">
                Team meldet: <strong>{ABWEICHUNG_TEXT[meldung.abweichung_typ ?? ''] ?? '—'}</strong>
                {meldung.wer_hats_gewollt && <> · {WER_TEXT[meldung.wer_hats_gewollt] ?? meldung.wer_hats_gewollt}</>}
              </p>
              {meldung.transkript && <p className="rounded-[10px] bg-ground px-3 py-2 italic text-ink2">«{meldung.transkript}»</p>}
              {meldung.foto.length > 0 && <FotoGalerie pfade={meldung.foto.map((f) => f.pfad)} klein />}
            </section>

            <section className="card">
              <p className="lbl">So würde der Rapport aussehen · SGUV 2026/27</p>
              <div className="divide-y divide-line">
                {positionen.map((p, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span>{p.bezeichnung}</span>
                    <span className="font-mono tabular-nums">{formatChf(p.betrag_rappen)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
                <span className="font-display font-bold">Total</span>
                <span className="font-mono text-lg font-bold tabular-nums text-accent-deep">{formatChf(summe(positionen))}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink3">
                Lieferwagen, Etappenzuschlag und Materialmiete kommen im Entwurf dazu, Stunden lassen sich dort anpassen.
              </p>
            </section>

            <button type="button" className="cta" disabled={zustand !== 'bereit'} onClick={() => void speichern()}>
              {zustand === 'speichert' ? 'Speichert …' : 'Als Entwurf speichern'}
            </button>
            <Link to={zurueck} className="btn-ghost block w-full text-center">Nur anschauen — zurück zur Woche</Link>
            <p className="text-center text-[11px] text-ink3">Solange du nicht speicherst, entsteht kein Rapport.</p>
          </>
        )}
      </div>
    </Shell>
  );
}
