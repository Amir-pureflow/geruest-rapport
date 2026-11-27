#!/usr/bin/env bash
# Lokale Supabase für die Prüfung vorbereiten: Migrationen und Edge Functions aus dem Repo herkopieren.
# Läuft komplett lokal (Docker). Diese Arbeitskopie ist mit KEINEM Cloud-Projekt verbunden (kein «supabase link»).
set -euo pipefail
cd "$(dirname "$0")"
if [ -f supabase/.temp/project-ref ]; then echo "GESPERRT: diese Arbeitskopie ist mit einem Cloud-Projekt verbunden"; exit 1; fi
rm -rf supabase/migrations supabase/functions
mkdir -p supabase/migrations
# Nummern 0001..0055 → Zeitstempel-Form, die die CLI erwartet (Reihenfolge bleibt)
for f in ../../supabase/migrations/*.sql; do
  n=$(basename "$f"); nr=${n%%_*}; rest=${n#*_}
  cp "$f" "supabase/migrations/2026000000${nr}_${rest}"
done
cp -r ../../supabase/functions supabase/functions
echo "Migrationen: $(ls supabase/migrations | wc -l), Functions kopiert."
