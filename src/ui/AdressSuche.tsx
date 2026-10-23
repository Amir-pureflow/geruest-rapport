import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { MapPin, Search } from 'lucide-react';
import { adresseSuchen, hausnummerFehlt, trefferSortieren, type Treffer } from '../lib/adresse';

/**
 * Adresssuche des Bundes (geo.admin.ch) mit Trefferliste — für Baustellen und den Werkhof (24.10.2026).
 * Sucht beim Öffnen sofort mit `start`; das Büro kann den Text ändern und tippt den richtigen Treffer an. Nichts wird
 * ungefragt übernommen. Fehlt die gesuchte Hausnummer im Verzeichnis, steht das dabei.
 */
export function AdressSuche({ start, plz, naehe, onWaehlen, fuss }: {
  start: string;
  plz?: string | null;
  /** Gebiet der Firma — Treffer dort zuerst */
  naehe: { lat: number; lon: number } | null;
  onWaehlen: (t: Treffer) => void;
  /** z. B. «Adresse entfernen» */
  fuss?: ReactNode;
}) {
  const [text, setText] = useState(start);
  const [treffer, setTreffer] = useState<Treffer[] | null>(null);
  const [gesucht, setGesucht] = useState('');
  const [sucht, setSucht] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const suchen = useCallback(async (q: string) => {
    setSucht(true);
    setFehler(null);
    try {
      setTreffer(trefferSortieren(await adresseSuchen(q, naehe), { plz, naehe }).slice(0, 6));
      setGesucht(q);
    } catch (e) {
      setTreffer(null);
      setFehler('Adresssuche gerade nicht erreichbar — später nochmals. (' + (e instanceof Error ? e.message : String(e)) + ')');
    }
    setSucht(false);
  }, [plz, naehe]);
  useEffect(() => { if (start.trim().length >= 3) void suchen(start); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const nrFehlt = treffer ? hausnummerFehlt(gesucht, treffer) : null;

  return (
    <div className="space-y-2 rounded-[12px] border border-line-strong bg-white p-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void suchen(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Strasse Nr. und Ort, z. B. Waldstrasse 6 Zollikofen" aria-label="Adresse suchen" className="field" />
        <button type="submit" disabled={sucht} className="btn-ghost whitespace-nowrap disabled:opacity-50"><Search size={14} aria-hidden="true" /> Suchen</button>
      </form>
      {sucht && <p className="text-xs text-ink3">Sucht …</p>}
      {fehler && <p className="text-xs font-semibold text-accent-deep">{fehler}</p>}
      {nrFehlt && !sucht && (
        <p className="rounded-[8px] bg-amber-soft px-2.5 py-1.5 text-xs text-amber-deep">
          Hausnummer {nrFehlt} kennt das Verzeichnis nicht — die Treffer sind andere Nummern. Genau prüfen oder die richtige Nummer suchen.
        </p>
      )}
      {treffer && treffer.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-[10px] border border-line">
          {treffer.map((t) => (
            <li key={`${t.lat},${t.lon}`}>
              <button type="button" onClick={() => onWaehlen(t)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ground">
                <MapPin size={14} className="shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate"><b className="font-semibold text-ink">{t.strasse}</b><span className="text-ink2">, {t.plz} {t.ort}</span></span>
                <span className="shrink-0 text-xs font-semibold text-steel">übernehmen</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {treffer && treffer.length === 0 && !sucht && (
        <p className="text-xs text-ink3">Nichts gefunden. Suchtext ändern — am besten «Strasse Nr. Ort» (Projektnamen wie «Wohnüberbauung …» kennt die Suche nicht).</p>
      )}
      <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink3">
        <span>Adressen: © swisstopo (Amtliches Gebäudeadressverzeichnis)</span>
        {fuss}
      </p>
    </div>
  );
}
