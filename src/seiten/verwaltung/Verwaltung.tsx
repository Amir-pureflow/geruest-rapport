import { useState } from 'react';
import { Shell } from '../../ui/Shell';
import { Mitarbeiter } from './Mitarbeiter';
import { Teams } from './Teams';
import { Kunden } from './Kunden';
import { Baustellen } from './Baustellen';
import { Demo } from './Demo';
import { Einstellungen } from './Einstellungen';
import { istDemoFirma } from '../../lib/demo';

type Tab = 'mitarbeiter' | 'teams' | 'kunden' | 'baustellen' | 'einstellungen' | 'demo';

const TABS: [Tab, string][] = [
  ['mitarbeiter', 'Mitarbeitende'],
  ['teams', 'Teams'],
  ['kunden', 'Kunden'],
  ['baustellen', 'Baustellen'],
  ['einstellungen', 'Einstellungen'],
  ['demo', 'Demo'],
];

/** Der Demo-Tab ersetzt alle Bewegungsdaten — nur in Demo-Firmen (We-Plan), nie bei einem echten Betrieb. */
const tabsFuerFirma = (): [Tab, string][] => (istDemoFirma() ? TABS : TABS.filter(([t]) => t !== 'demo'));

/** Stammdaten — das, was die App braucht, bevor sie mit echten Leuten läuft. */
export function Verwaltung() {
  const tabs = tabsFuerFirma();
  const [tab, setTab] = useState<Tab>(() => {
    const t = location.hash.replace('#', '') as Tab;
    return tabs.some(([x]) => x === t) ? t : 'mitarbeiter';
  });

  function wechseln(t: Tab) {
    setTab(t);
    history.replaceState(null, '', '#' + t);
  }

  return (
    <Shell zurueck>
      <div className="space-y-5">
        <header>
          <p className="lbl mb-0.5">Planung &amp; Daten</p>
          <h1 className="font-display text-2xl font-semibold">Verwaltung</h1>
          <p className="mt-1 text-sm text-ink3">Mitarbeitende, Teams, Kunden und Baustellen — das, was die App braucht, bevor sie mit echten Leuten läuft.</p>
        </header>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="inline-flex rounded-full border border-ink/10 bg-white p-1 shadow-[0_1px_2px_rgb(17_17_19/0.06)]" role="tablist">
          {tabs.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => wechseln(t)} className={'whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-semibold transition ' + (tab === t ? 'bg-ink text-white shadow-sm' : 'text-ink2 hover:text-ink')}>
              {label}
            </button>
          ))}
          </div>
        </div>
        {tab === 'mitarbeiter' && <Mitarbeiter />}
        {tab === 'teams' && <Teams />}
        {tab === 'kunden' && <Kunden />}
        {tab === 'baustellen' && <Baustellen />}
        {tab === 'einstellungen' && <Einstellungen />}
        {tab === 'demo' && istDemoFirma() && <Demo />}
      </div>
    </Shell>
  );
}
