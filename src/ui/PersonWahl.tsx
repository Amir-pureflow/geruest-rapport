import type { ReactNode } from 'react';
import { Avatar } from './Dialog';
import { Auswahl, SymbolRund, type AuswahlOption } from './Auswahl';
import { anzeigeName } from '../lib/namen';

/**
 * Person wählen (12.10.2026, Amir: «mach das cleaner»): die `Auswahl` mit Avatar, immer mit Suche; «(Bsp.)» im Namen
 * erscheint als leise Marke «Beispiel», `zusatz` (z. B. «temp») als Marke. `oben` = ein besonderer Eintrag über den
 * Personen (z. B. «Alle Mitarbeitenden»).
 */
export interface PersonOption { id: string; name: string; zusatz?: string }
export interface ObenOption { id: string; text: string; hinweis?: string; icon?: ReactNode }

export function PersonWahl({
  id, leute, wert, aendern, platzhalter = 'Person wählen …', oben, leer = 'Niemand gefunden.',
}: {
  id?: string;
  leute: PersonOption[];
  wert: string;
  aendern: (id: string) => void;
  platzhalter?: string;
  oben?: ObenOption;
  leer?: string;
}) {
  const optionen: AuswahlOption[] = [
    ...(oben ? [{ wert: oben.id, text: oben.text, unter: oben.hinweis, vorne: <SymbolRund>{oben.icon}</SymbolRund>, trenner: true }] : []),
    ...leute.map((p) => {
      const a = anzeigeName(p.name);
      return {
        wert: p.id,
        text: a.name,
        vorne: <Avatar name={a.name} />,
        marken: [...(p.zusatz ? [{ text: p.zusatz }] : []), ...(a.beispiel ? [{ text: 'Beispiel', leise: true }] : [])],
      };
    }),
  ];
  return <Auswahl id={id} optionen={optionen} wert={wert} aendern={aendern} platzhalter={platzhalter} leer={leer} suche />;
}
