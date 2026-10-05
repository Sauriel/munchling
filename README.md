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
pnpm generate
pnpm test:browser
```

`test:browser` benötigt Node >= 22 und Chromium (`CHROMIUM_BIN` überschreibt `/usr/bin/chromium`). Der Test nutzt ein frisches temporäres Browserprofil und prüft Export, Profilpersistenz, bestätigte Wiederherstellung und die gespeicherte Sicherheitssicherung.

Die Repository-Integrationstests verwenden eine echte SQLite-Engine über `sql.js` mit dem App-Schema. Sie prüfen unter anderem atomare Gerichte/Zutaten und Mahlzeiten/Portionen, Rollbacks, parallele Datenbankzugriffe und Nährwertberechnungen. Native Geräte- und Browser-Smoke-Tests werden dadurch nicht ersetzt.

## Datenschicht und geplanter Webbetrieb

- `shared/domain/`: persistenzunabhängige Datentypen, Datenservice-Vertrag, Nährwertberechnung, gemeinsame Validierung und Backup-Format.
- `app/composables/useMunchlingData.ts`: zentraler Zugriff der Oberflächen auf den Datenservice.
- `app/utils/data/local.ts`: lokaler Adapter mit injizierbarer SQLite-Verbindung.
- `app/utils/database/executor.ts`: serialisierte Zugriffe und explizite Transaktionen. Innerhalb eines Transaktionscallbacks ausschließlich den übergebenen SQL-Executor verwenden, nicht die globale Verbindung.

Aktuell ist weiterhin nur der lokale Betriebsmodus implementiert; auch `pnpm dev` nutzt lokale Browser-SQLite. Es gibt noch keine MariaDB-API und keinen Sync. Das bestehende Datenbankschema wurde noch nicht verändert.

`dev`, `build` und `generate` bereiten die WASM-Assets automatisch vor. Die BLS-Suche nutzt `public/sql-wasm.wasm`; Browser-SQLite verwendet separat `public/assets/sql-wasm.wasm`. `jeep-sqlite` 2.8.0 bündelt einen älteren sql.js-Runtime-Code und benötigt die dazu passende, über `sql.js-jeep` bereitgestellte WASM-Version. Bei Updates müssen Runtime und WASM zusammen überprüft werden.

## Lokale Datensicherung

Unter **Einstellungen → Lokale Datensicherung** lassen sich alle Fachdaten als JSON exportieren und nach Bestätigung wiederherstellen. Eine Wiederherstellung ersetzt den lokalen Bestand, statt ihn zusammenzuführen, und speichert vorher automatisch eine separate Sicherheitssicherung. Diese kann ebenfalls exportiert werden.

Sicherungen sind unverschlüsselt. Eine externe Kopie schützt auch vor App-Deinstallation oder gelöschten Browserdaten. Importgrenzen: 25 MiB und insgesamt 100.000 Datensätze. Geräteinstellungen und der BLS-Katalog sind nicht enthalten.

Details zu Format, Validierung, Datenschutz und der nächsten Schema-Migration: [docs/data-integrity-and-backups.md](docs/data-integrity-and-backups.md).

Der ausführliche Umsetzungsplan und Teilstand stehen in [docs/web-sync-plan.md](docs/web-sync-plan.md).
