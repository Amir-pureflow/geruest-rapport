"""
Phase 3 — Rundgang im Browser (lokal, ohne echte Datenbank).

Voraussetzungen (siehe tests/README.md): lokale Supabase + Testdaten, Functions, App mit lokaler Adresse auf Port 3000.
Start:  python tests/browser/rundgang.py
Ergebnis: Bildschirmfotos + bericht.json in C:\\Users\\El Dragon\\Render-Cache\\Rapporto Pruefung\\rundgang

Sperre: Jede Anfrage an einen Rechner ausser 127.0.0.1/localhost wird abgebrochen und protokolliert. Geht eine
Anfrage an *.supabase.co oder die Live-App, bricht der Rundgang sofort ab.
"""
import json
import os
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

APP = 'http://127.0.0.1:3000'
PASSWORT = 'Lokal-Test-1234'
AUS = r'C:\Users\El Dragon\Render-Cache\Rapporto Pruefung\rundgang'
BREITEN = [(360, 740), (390, 844), (1366, 860)]
RAPPORT_A = 'aaaaaaaa-0000-4000-8000-000000000091'
TOKEN_A = 'aaaaaaaa-0000-4000-8000-00000000aaaa'
SPUREN_B = re.compile(r'Testbau B|Baustelle B|Kunde B AG|Chef B Test|Monteur B Test|Geheimer Text B')

ROLLEN = {
    'bauf': ('buero@testbau-a.test', 'bauf'),
    'sekretariat': ('buero@testbau-a.test', 'sekretariat'),
    'chef': ('chef@testbau-a.test', None),
    'monteur': ('monteur@testbau-a.test', None),
}
SEITEN = ['/', '/posteingang', '/heute', '/cockpit', '/planung', '/karte', '/zusatzauftrag', '/regie', f'/regie/{RAPPORT_A}',
          '/auswertung', '/export', '/verwaltung', '/erfassung']

os.makedirs(AUS, exist_ok=True)
befunde = []
gesperrt = set()


def sperre(route):
    host = urlparse(route.request.url).hostname or ''
    if host in ('127.0.0.1', 'localhost'):
        return route.continue_()
    if host.endswith('supabase.co') or 'vercel.app' in host:
        print(f'GESPERRT (Abbruch): {route.request.url}', file=sys.stderr)
        os._exit(2)
    gesperrt.add(host)
    return route.abort()


def pruefen(page, rolle, breite, pfad):
    page.wait_for_timeout(1800)
    name = f"{rolle}_{breite}_{pfad.strip('/').replace('/', '-') or 'start'}"[:90]
    page.screenshot(path=os.path.join(AUS, name + '.png'), full_page=True)
    m = page.evaluate("""() => {
      const de = document.documentElement;
      const breit = [...document.querySelectorAll('body *')].filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 2 && getComputedStyle(e).position !== 'fixed';
      }).slice(0, 3).map(e => (e.tagName + '.' + (e.className?.toString?.() || '')).slice(0, 80));
      return { quer: de.scrollWidth > window.innerWidth + 1, scrollWidth: de.scrollWidth, text: document.body.innerText, breit };
    }""")
    if m['quer']:
        befunde.append({'art': 'seitlich scrollen', 'rolle': rolle, 'breite': breite, 'seite': pfad, 'detail': f"scrollWidth {m['scrollWidth']}", 'elemente': m['breit']})
    if SPUREN_B.search(m['text']):
        befunde.append({'art': 'FREMDE FIRMA SICHTBAR', 'rolle': rolle, 'breite': breite, 'seite': pfad})
    return m['text']


def anmelden(page, mail):
    page.goto(APP + '/')
    page.fill('input[type=email]', mail)
    page.fill('input[type=password]', PASSWORT)
    page.click('button[type=submit]')
    page.wait_for_timeout(2500)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for rolle, (mail, ansicht) in ROLLEN.items():
            for (w, h) in BREITEN:
                ctx = browser.new_context(viewport={'width': w, 'height': h}, service_workers='block')
                ctx.route('**/*', sperre)
                page = ctx.new_page()
                fehler = []
                page.on('console', lambda msg, f=fehler: f.append(msg.text) if msg.type == 'error' else None)
                page.on('pageerror', lambda e, f=fehler: f.append('pageerror: ' + str(e)))
                anmelden(page, mail)
                if ansicht:
                    page.evaluate(f"localStorage.setItem('ansicht', '{ansicht}')")
                for pfad in SEITEN:
                    vorher = len(fehler)
                    page.goto(APP + pfad)
                    text = pruefen(page, rolle, w, pfad)
                    neu = [f for f in fehler[vorher:] if 'ERR_FAILED' not in f and 'net::' not in f]
                    if neu:
                        befunde.append({'art': 'Konsolenfehler', 'rolle': rolle, 'breite': w, 'seite': pfad, 'detail': neu[:5]})
                    if re.search(r'undefined|NaN|\[object Object\]', text):
                        befunde.append({'art': 'Platzhalter im Text (undefined/NaN)', 'rolle': rolle, 'breite': w, 'seite': pfad,
                                        'detail': re.findall(r'.{0,40}(?:undefined|NaN|\[object Object\]).{0,40}', text)[:3]})
                ctx.close()
        # Kunden-Link ohne Anmeldung
        for (w, h) in BREITEN:
            ctx = browser.new_context(viewport={'width': w, 'height': h}, service_workers='block')
            ctx.route('**/*', sperre)
            page = ctx.new_page()
            page.goto(f'{APP}/b/{TOKEN_A}')
            pruefen(page, 'kunde', w, '/b/token')
            ctx.close()
        browser.close()
    with open(os.path.join(AUS, 'bericht.json'), 'w', encoding='utf-8') as f:
        json.dump({'befunde': befunde, 'gesperrte_hosts': sorted(gesperrt)}, f, ensure_ascii=False, indent=1)
    print(json.dumps({'befunde': len(befunde), 'gesperrte_hosts': sorted(gesperrt)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
