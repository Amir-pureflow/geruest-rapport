-- 0014: Weitere Empfänger je Kunde (z. B. zweite Person der Bauleitung), kommagetrennt.
-- Die Sendefunktion erlaubt: kunde.email, kunde.weitere_emails, jede Adresse mit derselben Domain wie kunde.email,
-- sowie konfiguration.MAIL_TESTEMPFAENGER. Alles andere wird abgelehnt (Schutz vor Tippfehlern und Fehlversand).
alter table kunde add column if not exists weitere_emails text;
comment on column kunde.weitere_emails is 'weitere erlaubte Empfänger für Regierapporte, kommagetrennt';
