import { Cloud, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Snowflake, Sun, Wind, type LucideIcon } from 'lucide-react';
import { temperaturText, warnungen, wetterArt, wetterText, type WarnArt, type Warnung, type WetterArt, type WetterTag } from '../lib/wetter';

/** Eigene Zeichen (lucide) — die Grafiken von MeteoSchweiz dürfen nicht verwendet werden, nur Nummer und Bedeutung */
const ART: Record<WetterArt, LucideIcon> = {
  sonnig: Sun, teils: CloudSun, bewoelkt: Cloud, nebel: CloudFog, regen: CloudRain, schneeregen: CloudSnow, schnee: CloudSnow, gewitter: CloudLightning,
};
const WARN: Record<WarnArt, LucideIcon> = {
  sturm: Wind, wind: Wind, gewitter: CloudLightning, schnee: CloudSnow, starkregen: CloudRain, regen: CloudRain, frost: Snowflake,
};

export const warnFarbe = (w: Warnung) => (w.stark ? 'text-accent-deep' : 'text-amber-deep');

/** Kopf der Planung: Zeichen und Höchstwert im Gebiet der Firma; mit Warnung farbig */
export function WetterKopf({ w }: { w: WetterTag }) {
  const warn = warnungen(w);
  const Icon = warn[0] ? WARN[warn[0].art] : ART[wetterArt(w)];
  const titel = `Wetter im Gebiet der Firma: ${wetterText(w)}${warn.length ? '\n' + warn.map((x) => x.text).join(' · ') : ''}\nQuelle: MeteoSchweiz`;
  return (
    <span className={'inline-flex items-center gap-0.5 text-[10.5px] font-medium tabular-nums ' + (warn[0] ? warnFarbe(warn[0]) : 'text-ink3')} title={titel}>
      <Icon size={12} strokeWidth={2.2} aria-hidden="true" />
      {w.tmax !== null && `${Math.round(w.tmax)}°`}
      <span className="sr-only">{titel}</span>
    </span>
  );
}

/** Kleines Warnzeichen (Tageszeile eines Teams): das Wichtigste zeigen, alle im Tooltip */
export function WetterWarnung({ liste, ort }: { liste: Warnung[]; ort: string }) {
  if (liste.length === 0) return null;
  const Icon = WARN[liste[0].art];
  const titel = `Wetter ${ort}: ${liste.map((x) => x.text).join(' · ')} (MeteoSchweiz)`;
  return (
    <span className={'inline-flex shrink-0 ' + warnFarbe(liste[0])} title={titel}>
      <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
      <span className="sr-only">{titel}</span>
    </span>
  );
}

/** Eine Zeile im Tag: Zeichen, «Regen · 4–9 °C · 12 mm …», Warnungen hervorgehoben */
export function WetterZeile({ w, gebiet }: { w: WetterTag; gebiet: boolean }) {
  const warn = warnungen(w);
  const Icon = warn[0] ? WARN[warn[0].art] : ART[wetterArt(w)];
  return (
    <span className={'mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-[10px] px-2.5 py-1.5 text-[12px] ' + (warn[0]?.stark ? 'bg-accent-soft/70 text-accent-deep' : warn[0] ? 'bg-amber-soft text-amber-deep' : 'bg-surface-2 text-ink2')}>
      <Icon size={13} className="shrink-0" aria-hidden="true" />
      {/* Mit Warnung: die Warnungen fett, dahinter nur noch die Temperatur — Regen und Böen stehen schon vorne */}
      {warn.length > 0 && <b className="font-semibold">{warn.map((x) => x.text).join(' · ')}</b>}
      <span className={warn.length ? 'opacity-80' : ''}>{warn.length ? (temperaturText(w) ? `· ${temperaturText(w)}` : '') : wetterText(w)}{gebiet ? ' (Gebiet der Firma)' : ''}</span>
    </span>
  );
}
