# Munchling

Lokaler Kalorien- und Nährwerttracker als mobile Hybrid-App mit Nuxt 4, Vue 3 und Capacitor.

## Setup

```bash
pnpm install
pnpm dev
```

## Mobile / Capacitor

```bash
pnpm generate
pnpm cap:add:android
pnpm cap:add:ios
pnpm cap:sync
```

Die Capacitor-Ausgabe nutzt `.output/public` als Web-Verzeichnis.

## Tests und Typprüfung

```bash
pnpm test
pnpm test:watch
pnpm typecheck
pnpm typecheck:server
pnpm test:server
pnpm generate
pnpm test:browser
```

`test:browser` benötigt Node >= 22 und Chromium (`CHROMIUM_BIN` überschreibt `/usr/bin/chromium`). Der Test nutzt ein frisches temporäres Browserprofil und prüft Export, Profilpersistenz, bestätigte Wiederherstellung und die gespeicherte Sicherheitssicherung.

`test:server` baut den Nitro-Backend-Modus und prüft ihn samt Schreibdienst gegen eine isolierte MariaDB 11.4 in Docker. Zufällige Test-Credentials und Loopback-Port, keine Produktionsdatenbank. Anschließend für Browser/Capacitor erneut `generate`/`cap:sync` ausführen.

Die Repository-Integrationstests verwenden eine echte SQLite-Engine über `sql.js` mit dem App-Schema. Sie prüfen unter anderem atomare Gerichte/Zutaten und Mahlzeiten/Portionen, Rollbacks, parallele Datenbankzugriffe und Nährwertberechnungen. Native Geräte- und Browser-Smoke-Tests werden dadurch nicht ersetzt.

## Datenschicht und geplanter Webbetrieb

- `shared/domain/`: persistenzunabhängige Datentypen, Datenservice-Vertrag, Nährwertberechnung, gemeinsame Validierung und Backup-Format.
- `app/composables/useMunchlingData.ts`: zentraler Zugriff der Oberflächen auf den Datenservice.
- `app/utils/data/local.ts`: lokaler Adapter mit injizierbarer SQLite-Verbindung.
- `app/utils/database/executor.ts`: serialisierte Zugriffe und explizite Transaktionen. Innerhalb eines Transaktionscallbacks ausschließlich den übergebenen SQL-Executor verwenden, nicht die globale Verbindung.

`pnpm build:server` nutzt den Online-HTTP-Adapter mit MariaDB, stabilen UI-IDs und ausdrücklich versionierten Formularschreibvorgängen; Browser-SQLite wird dabei nicht initialisiert. `pnpm dev` und der Mobile-Build bleiben lokal. SQLite-Schema v2 ergänzt stabile UUIDs, Löschmarker und eine atomare Änderungswarteschlange; v3 ergänzt dauerhafte Empfangsmetadaten. Netzwerk-Sync bleibt ausgeschaltet. Details: [docs/local-sync-foundation.md](docs/local-sync-foundation.md).

Die MariaDB-Grundlage ist vorhanden: private Pool-Anbindung, geschützte versionierte Migrationen, transaktionaler Schreibdienst mit Versions-/Löschprüfungen, idempotente Receipts, Commit-geordnetes Change-Log und Health-Endpunkte. `pnpm build:server` erzeugt dafür einen Nitro-Node-Server. Die Fach-HTTP-/Sync-API bietet Serverinfo, konsistente mehrseitige Snapshots, Push, batch-erhaltenden Pull und Löschvorschauen. Instanz/Epoch-/Versionsprüfung und exakte Origin-/Host-Freigaben schützen vor stillen Historienwechseln und Browser-Fremdzugriffen; keine Authentifizierung. Vertrag: [docs/sync-api.md](docs/sync-api.md). Der **Web-HTTP-Datenadapter ist angeschlossen** ([Online-Vertrag und Grenzen](docs/web-data-adapter.md)); Native-Sync-Runner steht noch aus. Dockerfile und getesteter Runtime-Container sind für Dokploy vorbereitet; [Deployment-Anleitung](docs/dokploy.md). Konfiguration und Grenzen: [docs/server-foundation.md](docs/server-foundation.md).

Unter **Einstellungen → Server-Synchronisierung vorbereiten** können native Geräte ausdrücklich Verbindung/Bestandszahlen prüfen und einen Server-Snapshot getrennt zwischenspeichern oder fortsetzen. Der Download selbst verändert keine Fachdaten. Gesondert bestätigte Erstabgleich-/Konfliktentscheidungen prüfen den Serverstand erneut und speichern zuerst eine unabhängige Sicherheitssicherung; lokale Gewinner werden neu versionsgebunden vorgemerkt. Kein Upload und keine automatische Aktivierung. Geführte Zuordnung unregistrierter lokaler EAN-Imports und lokales Trennen mit neuem Erstabgleich sind vorhanden ([Details](docs/client-sync-food-alias.md)); Runner und allgemeines serverseitiges Zusammenlegen bleiben offen. Details: [docs/client-sync-decisions.md](docs/client-sync-decisions.md). Details: [docs/client-sync-receive.md](docs/client-sync-receive.md) und [docs/client-sync-transport.md](docs/client-sync-transport.md).

Für Dokploy: Dockerfile im Projektroot bauen, MariaDB separat mit persistentem Volume/privatem Netzwerk betreiben und Runtime-Variablen setzen. Keine frei zugängliche Veröffentlichung ohne Zugangsbeschränkung; die App hat keine Authentifizierung. `pnpm test:deployment` prüft den gebauten Container mit wegwerfbarer MariaDB und Chromium. Ein tatsächliches Deployment auf deinem Dokploy-Host ist noch nicht erfolgt.

`dev`, `build` und `generate` bereiten die WASM-Assets automatisch vor. Die BLS-Suche nutzt `public/sql-wasm.wasm`; Browser-SQLite verwendet separat `public/assets/sql-wasm.wasm`. `jeep-sqlite` 2.8.0 bündelt einen älteren sql.js-Runtime-Code und benötigt die dazu passende, über `sql.js-jeep` bereitgestellte WASM-Version. Bei Updates müssen Runtime und WASM zusammen überprüft werden.

## Lokale Datensicherung

Unter **Einstellungen → Lokale Datensicherung** lassen sich alle Fachdaten als JSON exportieren und nach Bestätigung wiederherstellen. Eine Wiederherstellung ersetzt den lokalen Bestand, statt ihn zusammenzuführen, und speichert vorher automatisch eine separate Sicherheitssicherung. Diese kann ebenfalls exportiert werden.

Sicherungen sind unverschlüsselt. Eine externe Kopie schützt auch vor App-Deinstallation oder gelöschten Browserdaten. V2 bewahrt UUIDs und Löschmarker; alte v1-Dateien werden mit neuen UUIDs importiert. Wiederherstellen trennt die Sync-Bindung und setzt einen neuen lokalen Abgleich auf. Importgrenzen: 25 MiB und insgesamt 100.000 Fachzeilen/Löschmarker. Geräteinstellungen und der BLS-Katalog sind nicht enthalten.

Vor dem Upgrade eines gefüllten v1-Bestands wird separat `backups/before-schema-v2.json` gespeichert; ohne erfolgreiche Speicherung findet keine Migration statt. Diese Sicherung ist nach dem Upgrade ebenfalls in den Einstellungen exportierbar. Vor App-Updates zusätzlich extern sichern.

Details zu Format, Validierung, Datenschutz und Schema-Migration: [docs/data-integrity-and-backups.md](docs/data-integrity-and-backups.md).

Der ausführliche Umsetzungsplan und Teilstand stehen in [docs/web-sync-plan.md](docs/web-sync-plan.md).
