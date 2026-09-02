import { Shell } from '../ui/Shell';

/** Phase-0-Platzhalter. Echte Daten + Prüfquellen folgen in Phase 3. */
export function Cockpit() {
  return (
    <Shell zurueck>
      <div className="space-y-5">
        <h1 className="font-display text-2xl font-bold">Wochenübersicht</h1>
        <p className="text-sm text-ink2">
          Hier entsteht die Prüf- und Freigabeansicht des Bauführers: eine Zeile
          pro Teamtag, Ampelstatus, Sammelfreigabe, ein Klick vom Regieverdacht
          zum vorgerechneten Fall. (Phase 3)
        </p>
        <div className="card text-sm text-ink3">
          Noch keine Daten — die Erfassung (Phase 2) liefert sie.
        </div>
      </div>
    </Shell>
  );
}
