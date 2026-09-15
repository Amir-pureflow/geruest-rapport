-- 0013: Der Bauführer kann eine gemeldete Zusatzarbeit als «keine Regie» abschliessen (mit Pflichtgrund).
-- Die Stunden bleiben unverändert (Lohn) — nur die Verrechnung an den Kunden entfällt.
-- Angewendet am 15.09.2026 via MCP (Name «tagesmeldung_keine_regie»).
alter table tagesmeldung
  add column if not exists regie_entscheid text check (regie_entscheid in ('keine_regie')),
  add column if not exists regie_grund text check (regie_grund in ('pauschale', 'kulanz', 'irrtum', 'doppelt')),
  add column if not exists regie_entschieden_am timestamptz,
  add column if not exists regie_entschieden_von text;
comment on column tagesmeldung.regie_entscheid is 'keine_regie = Bauführer hat entschieden, dass die gemeldete Zusatzarbeit nicht verrechnet wird';
comment on column tagesmeldung.regie_grund is 'pauschale = in Offerte/Pauschale enthalten, kulanz, irrtum = Team hat sich vertan, doppelt = schon in einem anderen Rapport';
