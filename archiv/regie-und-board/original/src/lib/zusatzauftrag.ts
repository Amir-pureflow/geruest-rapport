/** Tätigkeiten eines Zusatzauftrags: Code in der Datenbank → Wort in der App. Eine Quelle für alle Seiten. */
export const TAETIGKEITEN = [
  ['versetzen', 'versetzen'],
  ['ergaenzen', 'ergänzen'],
  ['reparieren', 'reparieren'],
  ['teilabbau', 'Teilabbau'],
  ['reinigen', 'reinigen'],
  ['anderes', 'anderes'],
] as const;

export const TAETIGKEIT_LABEL: Record<string, string> = Object.fromEntries(TAETIGKEITEN);

/** Code → Wort; unbekannte Codes kommen so zurück, wie sie sind. */
export function taetigkeitText(code: string | null | undefined): string {
  return code ? TAETIGKEIT_LABEL[code] ?? code : '—';
}
