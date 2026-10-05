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
```

Die Repository-Integrationstests verwenden eine echte SQLite-Engine über `sql.js` mit dem App-Schema. Sie prüfen unter anderem atomare Gerichte/Zutaten und Mahlzeiten/Portionen, Rollbacks, parallele Datenbankzugriffe und Nährwertberechnungen. Native Geräte- und Browser-Smoke-Tests werden dadurch nicht ersetzt.

## Datenschicht und geplanter Webbetrieb

- `shared/domain/`: persistenzunabhängige Datentypen, Datenservice-Vertrag und Nährwertberechnung.
- `app/composables/useMunchlingData.ts`: zentraler Zugriff der Oberflächen auf den Datenservice.
- `app/utils/data/local.ts`: lokaler Adapter mit injizierbarer SQLite-Verbindung.
- `app/utils/database/executor.ts`: serialisierte Zugriffe und explizite Transaktionen. Innerhalb eines Transaktionscallbacks ausschließlich den übergebenen SQL-Executor verwenden, nicht die globale Verbindung.

Aktuell ist weiterhin nur der lokale Betriebsmodus implementiert; auch `pnpm dev` nutzt lokale Browser-SQLite. Es gibt noch keine MariaDB-API und keinen Sync. Für diesen ersten Schritt wurde das bestehende Datenbankschema nicht verändert.

Der ausführliche Umsetzungsplan und Teilstand stehen in [docs/web-sync-plan.md](docs/web-sync-plan.md).
