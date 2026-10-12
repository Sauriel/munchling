# Munchling

Kalorien- und Nährwerttracker mit **offlinefähiger Android-/iOS-App** und **bearbeitbarer Online-Website**. Nuxt 4 / Vue 3 bilden die Oberfläche, Capacitor 8 die native App; Fachdaten liegen nativ in SQLite und auf dem Server in MariaDB.

> **Sicherheitsgrenze:** Munchling hat derzeit keine Benutzeranmeldung oder Anwendungsauthentifizierung. Website **und API** ausschließlich hinter einem privaten Netzwerk/VPN bzw. einer nachweislich geeigneten Zugangsbeschränkung betreiben. Öffentlich verfügbarer Quellcode bedeutet nicht, dass eine ungeschützte Instanz sicher ins Internet gestellt werden kann. HTTPS/CORS ersetzen keine Zugriffskontrolle.

## Funktionen

- Mehrere Profile mit individuellen Kalorien-/Nährwertzielen und einheitlicher alphabetischer Sortierung.
- Eigene Lebensmittel, EAN-/Open-Food-Facts-Abfrage und lokal gebündelte BLS-Suche.
- Gerichte mit Zutaten/Untergerichten; Mahlzeiten mit individuellen Profilportionen, Gramm oder Bruchteilen einer Portion.
- Aktivitätsvorlagen und datierte Buchungen; Zusatzkalorien gelten nur für das jeweilige Profil und den gebuchten Tag.
- Optionale automatische Profilziele aus ausdrücklich eingegebenem Gewicht, Schlaf, Arbeit, Sport und kcal-/Prozentdefizit; separate manuelle Ziele bleiben erhalten.
- Unveränderliche datierte Gewichts-/Zielhistorie, Warnbestätigung und transparente Modellannahmen. Das MET-Modell ist eine Schätzung, keine medizinische Bewertung und keine verifizierte Reproduktion des TK-Rechners.
- Profilstatistik für bis zu 366 Tage mit Datenlücken, tatsächlichen Messtagen und Web-Druck/PDF. Mahlzeitnährwerte werden aus gespeicherten Portionen und aktuellen Quellnährwerten rekonstruiert, nicht aus unveränderlichen Nährwert-Snapshots.
- Optionaler bidirektionaler Native-Sync mit explizitem Erstabgleich, Konfliktentscheidungen und unveränderlichen Upload-Journalen. Automatik bei Start/Rückkehr separat pro Gerät schaltbar und standardmäßig aus; sie läuft nur in Dashboard-Ansichten, nicht während der Bearbeitung.
- Lokaler JSON-Export/Restore mit vorheriger Sicherheitssicherung; Online-Browser verwenden kein lokales Restore gegen den Server.
- Deutsch/Englisch und responsive Ansichten für Handy, Tablet und Desktop.

## Voraussetzungen und lokaler Start

- Node.js **22 oder neuer**, pnpm **10.33.0** (siehe `packageManager`).
- Python 3 zum Neubauen des BLS-Katalogs.
- Android: JDK **21**, Android SDK/platform-tools; iOS: macOS/Xcode.
- MariaDB **11.4** für Serverbetrieb; Docker und Chromium für die entsprechenden Integrationstests.

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

`pnpm dev` nutzt lokale Browser-SQLite als Entwicklungsmodus. `.env` enthält ausschließlich eigene lokale Werte, ist ignoriert und darf nicht veröffentlicht werden. Für gewöhnliche Webnutzer ist der Server-/Online-Build vorgesehen.

## Online-Website / Dokploy

```sh
pnpm build:server
# Vorher die privaten Runtime-Variablen setzen, siehe Deployment-Anleitung:
node .output/server/index.mjs
```

Alternativ den enthaltenen `Dockerfile` in Dokploy bauen, Containerport 3000 routen und MariaDB mit separatem persistentem Volume im privaten Dienstnetz betreiben. Der Container läuft als nicht privilegierter Benutzer; Readiness: `/api/health/ready`, Liveness: `/api/health/live`.

`NUXT_MARIA_DB_*`, `NUXT_SYNC_PUBLIC_ORIGIN` und ausdrücklich erlaubte native Origins werden **zur Laufzeit** gesetzt. Produktions-Nuxt lädt `.env` nicht automatisch. Passwörter bleiben serverseitig, niemals in `runtimeConfig.public` oder Build-Argumenten.

Vollständige Anleitung: [Betrieb und Dokploy](docs/dokploy.md).

## Native App bauen und Android aktualisieren

Android/iOS-Projekte sind bereits enthalten; `cap:add:*` ist für diesen Checkout nicht erforderlich.

```sh
pnpm generate
pnpm exec cap sync
pnpm cap:open:android
# Auf macOS mit Xcode:
pnpm cap:open:ios
```

Capacitor verwendet `.output/public`. Server- und Mobile-Build überschreiben `.output`; deshalb **Server zuerst, Mobile zuletzt** bauen, bevor Capacitor synchronisiert wird.

Vor Installation den aktuellen Handybestand **extern sichern**. Das Bash-Skript erkennt Standard-SDK-Pfade und JDK/ADB bzw. verwendet `ANDROID_HOME`, `JAVA_HOME`, `ADB_BIN` und `ADB_SERIAL`. Ohne explizite Gerätekennung muss genau ein bereitstehendes Gerät verbunden sein:

```sh
# Nach einer frischen unabhängigen Sicherung; Seriennummer lokal konfigurieren:
ANDROID_BACKUP_CONFIRMED=true pnpm android:update
```

Das Skript baut BLS, Mobile-Assets und Debug-APK und installiert mit `install -r`, ohne Reset/Deinstallation. Die Bestätigung erzeugt selbst **keine** Sicherung; nicht dauerhaft in `.env` speichern. Keine Fernentsperrung. Die App startet nur bei `OPEN_AFTER_INSTALL=true`. `.env` wird vom Skript als **vertrauenswürdiger Shell-Code** geladen.

Standardmäßig vertraut Android nur System-CAs. Für einen ausdrücklich gewählten privaten HTTPS-Host ist eine eng begrenzte lokale Benutzer-CA-Regel möglich, ohne Domain im öffentlichen Repository:

```properties
# android/local-network.properties – ignoriert, nicht veröffentlichen
userCaHost=sync.example.internal
```

Alternativ `MUNCHLING_ANDROID_USER_CA_HOST` als Build-Umgebungsvariable setzen. Ein leerer Wert deaktiviert eine lokale Überschreibung. Nur exakte DNS-Namen, keine URLs/Wildcards/Subdomains-Freigabe; die Regel wird im ignorierten Build-Verzeichnis erzeugt. Die öffentliche CA muss der Geräteinhaber selbst installieren; private Schlüssel werden niemals eingebettet, TLS-Prüfungen bleiben aktiv. Details: [Entwicklung und Native-Build](docs/development.md).

Android-Laufzeit ist geprüft; iOS-Laufzeitabnahme benötigt weiterhin macOS/Xcode und ein passendes Gerät. Debug-APKs sind keine signierten Store-Releases.

## Daten, Synchronisation und Sicherungen

| Vertrag | Stand |
| --- | --- |
| SQLite-Schema | 9 |
| MariaDB-/Sync-Schema | 5 |
| JSON-Backup | 5, ältere Versionen 1–4 lesbar |
| HTTP-Sync-Protokoll | 1 |

UUIDs sind geräteübergreifende Identitäten, numerische IDs lokale Aliase. Bereits bestätigte Historien, ursprüngliche Requests und Receipts dürfen nicht still ersetzt werden. Neue alte-Client-Schreibversuche werden durch die Schema-Prüfung abgewiesen; bereits akzeptierte Originalanfragen bleiben replaybar.

- [Datensicherheit, Backup und Restore](docs/data-integrity-and-backups.md)
- [HTTP-/Sync-API](docs/sync-api.md)

## Prüfungen

```sh
pnpm test                       # lokale Domänen-/SQLite-Prüfungen
pnpm typecheck
pnpm typecheck:server
pnpm test:server                 # isolierte MariaDB/Nitro-Prüfungen, Docker nötig
pnpm generate && pnpm test:browser
pnpm test:responsive             # generierte Mobile-Assets + Chromium nötig
pnpm test:deployment             # Docker-Containerprüfung
```

Für kleine Änderungen gezielte Testdateien verwenden, z. B. `pnpm test tests/domain/profile-statistics.test.ts`. Browser-/Serverprüfungen nutzen temporäre Testdaten, keine Produktionsdatenbank. `CHROMIUM_BIN` kann den Browserpfad überschreiben. Bei Backend-Prüfungen anschließend erneut Mobile-Assets erzeugen, wenn eine APK gebaut wird.

## Lizenz und Datenquellen

Der Projektcode steht unter [MIT](LICENSE). Abhängigkeiten und externe Daten haben eigene Lizenzbedingungen. Die versionierte BLS-4.0-Quelldatei liegt unter `data/`; der abgeleitete Suchkatalog unter `public/databases/`. Vor Weiterveröffentlichung dieser Daten deren Herkunft, Nutzungsbedingungen und erforderliche Attribution gesondert bestätigen — die MIT-Lizenz des Codes erteilt keine zusätzlichen Rechte daran.

Produktabfragen verwenden [Open Food Facts](https://world.openfoodfacts.org/); das Kalorienmodell nennt seine Compendium-Quellen direkt in `shared/domain/calorie-model.ts`. Es ist kein medizinisches Produkt.
