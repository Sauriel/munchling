# Dauerhafter Empfang: Vorbereitung, noch kein laufender Sync

SQLite-Schema **v3** ergänzt nur technische Tabellen/`server_epoch`; veröffentlichte Migrationen v1/v2 bleiben unverändert. Numerische IDs, UUIDs, Outbox und Fachwerte bleiben erhalten. Backupformat v2 bleibt kompatibel: Empfangsseiten, Serverbindung, Cursor und Konflikte sind nicht exportierte Fachdaten. Ein lokaler Restore löscht Empfangsmetadaten, trennt die Bindung und erneuert die lokale Epoch.

## Snapshot-Staging

`createSnapshotStaging()` in `app/utils/sync/staging.ts`:

- `begin(localEpoch, url, firstPage)` speichert einen getrennten Download, keine Fachzeilen. Kein implizites Ersetzen eines aktiven Downloads oder einer vorhandenen Serverbindung.
- `save(page)` schreibt nur die nächste Seite; identische Wiederholungen sind wirkungslos, veränderte Wiederholungen werden abgelehnt. Seiten und Fortschritt committen gemeinsam.
- `audit()` prüft vor Wiederaufnahme sämtliche bereits gespeicherten Seiten: lückenlose Indizes, unveränderliche Snapshot-Metadaten, globale UUID-Duplikate und Grenzen. `complete()` prüft den gesamten Bestand einschließlich Registry/Owner, aktiver Referenzen, EANs und Rezeptgraph. Erst vollständige Bestände sind übernehmbar.
- Jede Mutation prüft lokale Epoch und Bindung. Eine spät eintreffende Antwort nach Restore darf keinen neuen Bestand verändern.
- Abgelaufene/gelöschte Server-Leases verhindern weitere Downloads; bereits vollständig gespeicherte Seiten bleiben lokal prüfbar. Nach einer epochbedingten Ablehnung nicht automatisch neu binden.
- `discard()` löscht nur den lokalen Zwischenspeicher; unvollständige Server-Leases laufen eigenständig ab. Nach erfolgreichem Download versucht die UI die Freigabe, ohne lokale Seiten bei Netzfehlern zu verlieren.

## Atomarer Remote-Empfänger

`createRemoteReceiver()` in `app/utils/sync/apply.ts` ist eine **explizit aufgerufene, getestete Bibliothek**, kein Startup-/Hintergrunddienst:

- `previewSnapshot()` prüft die vollständige Staging-Aufnahme. `adoptSnapshot(localEpoch)` ist nur bei noch nicht initialisiertem Cursor möglich. Es ersetzt **nicht** den lokalen Bestand und aktiviert Sync nicht. Lokale UUIDs werden nicht nach Namen/EAN zusammengelegt.
- `applyPage(context, page)` verlangt die tatsächliche Request-Epoch, URL, Instanz/Epoch und den angefragten Cursor. Der gesamte validierte Page-Commit umfasst vollständige Gruppen, Fachänderungen bzw. Konflikte und Fortschritt. Es wird niemals auf die advisory High-Water-Marke vorgerückt.
- UUID→numerische-ID-Auflösung, Eltern vor Kindern, vollständige Zutaten-/Portionsersetzung, Unique-Key-Freigabe für EAN-/Portionswechsel und Tombstones. Wiederanlage bewahrt vorhandene lokale IDs. Identifikatoren im SQL stammen nur aus statischen Tabellen-/Feldlisten; Wire-Werte werden gebunden.
- Pending/In-flight-Inhalte und tatsächliche Basisrevisionen werden nicht verändert. Bereits bestätigte eigene Vorgänger/ältere Feed-Versionen dürfen neuere lokale Entwürfe nicht zurücksetzen.
- Lokale Änderungen, UUID-Besitzer, EAN-Kollisionen, fehlende Referenzen, neue kombinierte Rezeptzyklen sowie aktuelle **und vorgemerkte** Löschabhängigkeiten blockieren die vollständige Gruppe, ohne Fachzeilen zu überschreiben. Unabhängige spätere Gruppen dürfen weiterlaufen; abhängige Folgegruppen bleiben ebenfalls zurückgehalten.
- `sync_inbox` bewahrt vollständige Gruppen, Bindung, Cursorintervall und Status (`applied`/`blocked`). `sync_conflicts` bewahrt Basis-/lokalen Wire-Inhalt und vollständigen Remote-Root mit Revision. Ein blockierter Cursor bedeutet **dauerhaft empfangen**, nicht fachlich angewendet: zukünftige Auflösung muss gespeicherte Gruppen/Abhängigkeiten verwenden. Keine Bereinigung dieser Daten vor vollständiger Auflösung.
- SQL-Fehler rollen Fachzeilen, Registry, Konflikte, Inbox, Tracking-Schalter und Cursor gemeinsam zurück. Remote-Commits erzeugen keine Echo-Outbox. Browser-Persistierung erfolgt weiterhin erst nach SQL-Commit und ist kein nachträglicher Rollback.

## Einstellungen: Vorbereitung und gesonderte Entscheidungen

`SyncPreparation.client.vue` erscheint auf **nativen Capacitor-Geräten**. Erst nach Bestätigung des abgesicherten Netzes und Buttondruck werden Serverinfo oder Snapshotseiten angefragt. Es zeigt lokale/Server-Zählungen, lädt in Staging und setzt Downloads nach Neustart explizit fort. Der Download selbst nimmt keine Fachdaten über. `SyncDecisions.client.vue` ergänzt gesondert bestätigte Erstabgleich-/Konfliktentscheidungen mit frischem Serverbeleg und unabhängiger Sicherheitssicherung. Kein Upload, keine Aktivierung und keine automatischen Requests bei Start/Resume/Reconnect. Dev-Seed-Bestände bleiben gesperrt. Die bestehende Browser-Vorschau bleibt unverändert.

Erstabgleich (lokal/Server/beide), manuelle Basis/Lokal/Server-Entscheidungen und Gruppenfreigabe: [client-sync-decisions.md](client-sync-decisions.md). Lokale EAN-Import-Zuordnung und kontrolliertes Trennen: [client-sync-food-alias.md](client-sync-food-alias.md). **Noch offen:** allgemeines serverseitiges Zusammenlegen und Single-Flight-Runner. Diese Abläufe müssen vor Aktivierung integriert werden. Der rohe Queue-Claim ist kein konfliktbewusster Upload-Runner.

## Prüfungen

203 lokale Tests und 80 MariaDB/Nitro-Tests: v2→v3-Migration/DDL-Rollback, persistierte Downloads/Wiederaufnahme/History-Audit, Restore-Epoch-Schutz, vollständige UUID-Graphen, historische Uhrzeiten, stabile IDs/Wiederanlage, EAN-Swaps, abhängige Löschungen, gemeinsame Rezeptzyklen, In-flight-Konflikte, eigene bestätigte Vorgänger und spätes SQL-Rollback. Zwei echte SQLite-Clients empfangen produktive HTTP-Antworten von Nitro/MariaDB; Offline-Entwurf/Konflikte bleiben nach Wiederöffnung erhalten.

Beide Typprüfungen, Backend- und Mobile-Build sowie Chromium-Backup-Smoke sind erfolgreich. Die native Vorbereitungsoberfläche und tatsächliches Gerät-Netzwerkverhalten sind noch **nicht auf Android/iOS zur Laufzeit geprüft**.
