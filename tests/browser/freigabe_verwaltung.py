"""
Phase 3 — Wochenübersicht freigeben und Verwaltung «Neue Person» (lokal).
Start:  node tests/lokal/testdaten.mjs && python tests/browser/freigabe_verwaltung.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from ablaeufe import AUS, APP, anmelden, kontext, notiere, sql  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

MELDUNG_A = 'aaaaaaaa-0000-4000-8000-0000000000d1'


def freigabe(b):
    ctx = kontext(b, 1366, 900)
    page = ctx.new_page()
    anmelden(page, 'buero@testbau-a.test', 'bauf')
    page.goto(APP + '/cockpit')
    page.wait_for_timeout(3500)
    page.screenshot(path=os.path.join(AUS, 'cockpit_vorher.png'), full_page=True)
    knopf = page.get_by_role('button', name=re.compile('freigeben', re.I))
    n = knopf.count()
    if n == 0:
        notiere('Wochenübersicht: Freigeben-Knopf vorhanden', False, 'kein Knopf «… freigeben» gefunden')
        return ctx.close()
    knopf.first.click()
    page.wait_for_timeout(3000)
    page.screenshot(path=os.path.join(AUS, 'cockpit_nachher.png'), full_page=True)
    offen = sql(f"select count(*) from zeiteintrag where tagesmeldung_id='{MELDUNG_A}' and status='offen';")
    log = sql(f"select count(*) from freigabe_log where zeiteintrag_id in (select id from zeiteintrag where tagesmeldung_id='{MELDUNG_A}');")
    notiere('Wochenübersicht: Freigeben schreibt Status und Protokoll', offen == '0' and log not in ('', '0'), f'offen danach {offen}, Protokollzeilen {log}')
    ctx.close()


def neue_person(b, w, h):
    ctx = kontext(b, w, h)
    page = ctx.new_page()
    anmelden(page, 'buero@testbau-a.test', 'bauf')
    page.goto(APP + '/verwaltung')
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(AUS, f'verwaltung_{w}.png'), full_page=True)
    page.wait_for_timeout(1500)
    knopf = page.get_by_role('button', name=re.compile(r'^\s*Person\s*$|Neue Person'))
    if knopf.count() == 0:
        notiere(f'Verwaltung: Neue Person ({w}px)', False, 'kein Knopf gefunden: ' + ' | '.join(t.strip() for t in page.locator('button').all_inner_texts()[:15]))
        return ctx.close()
    knopf.first.click()
    page.wait_for_timeout(800)
    page.fill('input[placeholder="Vorname Name"]', f'Neu Test {w}')
    page.screenshot(path=os.path.join(AUS, f'verwaltung_dialog_{w}.png'), full_page=True)
    page.get_by_role('button', name=re.compile('Speichern|Anlegen', re.I)).first.click()
    page.wait_for_timeout(2500)
    n = sql(f"select count(*)||'/'||coalesce(max(firma_id::text),'') from mitarbeiter where name='Neu Test {w}';")
    notiere(f'Verwaltung: Neue Person angelegt, in Firma A ({w}px)', n == '1/aaaaaaaa-0000-4000-8000-000000000001', n)
    ctx.close()


if __name__ == '__main__':
    with sync_playwright() as p:
        b = p.chromium.launch()
        freigabe(b)
        for w, h in [(360, 740), (1366, 860)]:
            neue_person(b, w, h)
        b.close()
