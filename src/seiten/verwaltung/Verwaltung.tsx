import { useState } from 'react';
import { Shell } from '../../ui/Shell';
import { Mitarbeiter } from './Mitarbeiter';
import { Teams } from './Teams';
import { Kunden } from './Kunden';
import { Baustellen } from './Baustellen';
import { Demo } from './Demo';

type Tab = 'mitarbeiter' | 'teams' | 'kunden' | 'baustellen' | 'demo';

const TABS: [Tab, string][] = [
  ['mitarbeiter', 'Mitarbeitende'],
  ['teams', 'Teams'],
  ['kunden', 'Kunden'],
  ['baustellen', 'Baustellen'],
  ['demo', 'Demo'],
];

/** Stammdaten — das, was die App braucht, bevor sie mit echten Leuten läuft. */
export function Verwaltung() {
  const [tab, setTab] = useState<Tab>(() => (location.hash.replace('#', '') as Tab) || 'mitarbeiter');

  function wechseln(t: Tab) {
    setTab(t);
    history.replaceState(null, '', '#' + t);
  }

  return (
    <Shell zurueck>
      <div className="space-y-4">
        <h1 className="font-display text-2xl font-bold">Verwaltung</h1>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" onClick={() => wechseln(t)} className={'chip whitespace-nowrap px-3 py-1.5 text-xs ' + (tab === t ? 'chip-on' : '')}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'mitarbeiter' && <Mitarbeiter />}
        {tab === 'teams' && <Teams />}
        {tab === 'kunden' && <Kunden />}
        {tab === 'baustellen' && <Baustellen />}
        {tab === 'demo' && <Demo />}
      </div>
    </Shell>
  );
}
