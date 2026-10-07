-- 0027 (08.10.2026): Zusatzaufträge gibt es jetzt auch ohne Regie (Gerüst GmbH). Dort entsteht der Regierapport
-- in SORBA — der übliche Abschluss heisst «in SORBA rapportiert» (erledigt_grund = 'sorba').
alter table zusatzauftrag drop constraint if exists zusatzauftrag_erledigt_grund_check;
alter table zusatzauftrag
  add constraint zusatzauftrag_erledigt_grund_check
  check (erledigt_grund in ('abgesagt','pauschale','kulanz','doppelt','sorba'));
