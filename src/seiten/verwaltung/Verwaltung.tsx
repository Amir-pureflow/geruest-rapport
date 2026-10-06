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
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-semibold">Verwaltung</h1>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {tabs.map(([t, label]) => (
            <button key={t} type="button" onClick={() => wechseln(t)} className={'chip whitespace-nowrap px-3 py-1.5 text-xs ' + (tab === t ? 'chip-on' : '')}>
              {label}
            </button>
          ))}
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
