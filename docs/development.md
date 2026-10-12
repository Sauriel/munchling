# Entwicklung und Native-Build

## Architektur

- `app/pages`, `app/components`: gemeinsame responsive Oberfläche; `useMunchlingData()` ist der UI-Datenvertrag.
- `shared/domain`: Typen, Validierung, Nährwerte, Portionen, Aktivitäten, datierte Kalorienhistorie, Sortierung/Statistik, Backup- und Sync-Verträge.
- `app/utils/database`: SQLite, angehängte Migrationen, Repositories, transaktionale Outbox und Backup.
- `app/utils/data`: lokaler Adapter und Online-HTTP-/Webview-Adapter mit stabilen numerischen UI-Aliasen für UUIDs.
- `app/utils/sync`: Vorbereitung, atomarer Empfang, Journale/Receipts, ausdrückliche Entscheidungen und optionaler automatischer Koordinator.
- `server`: Nitro-API, MariaDB-Migrationen, Registry, versionierte Schreibdienste, Snapshot/Changefeed und Online-Ansicht.

`pnpm dev` und `pnpm generate` sind lokal/offlinefähig; `pnpm build:server` ist online mit MariaDB, ohne Browser-SQLite/Restore. Native-Sync ist optional. Start/Rückkehr benötigen getrennte ausdrückliche Gerätefreigaben; Editorwechsel brechen automatische Läufe ab und warten auf deren Abschluss. Die Vertrauenscheckbox ist kein TLS-Zertifikat und aktiviert keine automatische Synchronisation.

## Datenintegrität bei Änderungen

SQL-Zugriffe sind serialisiert. In einem Transaktionscallback ausschließlich den übergebenen Executor verwenden, keine rekursive globale Datenbankverbindung. Fachänderung, Kinder, UUID-Register und Outbox müssen atomar sein.

Veröffentlichte Migrationen/Prüfsummen nicht verändern; neue Migrationen anhängen. Der Capacitor-SQLite-Verbindungsparameter bleibt Version **1**; eigene Migrationen verwalten das Fachschema. Native Trigger sind vollständige SQL-Statements: Semikolons innerhalb `BEGIN … END` dürfen nicht durch einen naiven Statement-Splitter getrennt werden.

Neue Sync-Daten gemeinsam in Domain/Wire, UUID-Ownership, Outbox, Server, Registry/Snapshot/Changefeed, Receive, Backup/Restore und Konfliktprüfungen ergänzen. Kinder des Profilaggregats sind append-only, einschließlich ursprünglicher JSON-Bytes/IDs/Revisionen. Keine Neubasierung oder Umschreibung ungewisser Requests.

Mahlzeitnährwerte werden weiterhin dynamisch aus aktuellen Quellnährwerten rekonstruiert. Statistik darf keine immutable historischen Nährwert-Snapshots behaupten, unbekannte Aufnahme nicht als 0 behandeln und vor dem ersten bekannten Ziel keine früheren Ziele erfinden. Gewicht sind tatsächliche datierte Beobachtungen, keine interpolierten Tageswerte.

## Builds und Prüfungen

Node >=22, pnpm 10.33.0; `pnpm install --frozen-lockfile`. Tests möglichst auf betroffene Dateien beschränken. `pnpm typecheck`/`pnpm typecheck:server` sind maßgebliche CLI-Prüfungen. Servertests brauchen Docker/MariaDB, Browsersmokes Chromium. Reale Android-/iOS-Laufzeitprüfungen bleiben zusätzlich nötig.

Server-/Mobile-Build teilen `.output`. Reihenfolge bei beiden Lieferwegen: **Server bauen/prüfen, dann Mobile generieren, dann Capacitor synchronisieren**. Für Android JDK21/Android SDK, für iOS macOS/Xcode. Bereits vorhandene Plattformprojekte nicht erneut mit `cap add` überschreiben.

`dev`, `build` und `generate` erzeugen WASM-Dateien: BLS nutzt `public/sql-wasm.wasm`, Browser-SQLite `public/assets/sql-wasm.wasm`. `jeep-sqlite` und die gepinnte `sql.js-jeep`-WASM gehören zusammen; Runtime-/WASM-Versionen nicht blind mischen.

`pnpm food-db:build` erzeugt aus `data/BLS_4_0_Daten_2025_DE.xlsx` den SQLite-Suchkatalog und benötigt Python3. Es sind Katalogdaten, keine Haushaltsdaten. Herkunft/Lizenz der externen Daten separat berücksichtigen.

## Android-Updates

`scripts/update-android.sh` lädt ausschließlich eine vertrauenswürdige lokale Shell-Konfiguration aus `.env` bzw. `ENV_FILE`. SDK/JDK/ADB und Seriennummer sind über Umgebungsvariablen konfigurierbar; Standard-SDK-Orte bzw. PATH werden berücksichtigt. Bei mehreren Geräten ist `ADB_SERIAL` Pflicht. Nach dem Build wird dasselbe Ziel erneut geprüft.

Vor jedem Update einen aktuellen unabhängigen externen Export erstellen. Erst danach einmalig:

```sh
ANDROID_BACKUP_CONFIRMED=true pnpm android:update
```

Der Schalter ist nur eine Bestätigung, **keine Backup-Funktion**; nicht dauerhaft in `.env` setzen. Das Skript baut und verwendet ausschließlich `install -r`, keinen Reset/Uninstall. `OPEN_AFTER_INSTALL` ist standardmäßig `false`, damit der erste Start und gegebenenfalls vom Besitzer aktivierter automatischer Sync bewusst erfolgen.

## Private HTTPS-Hosts ohne eingebettete Vorgaben

Standard: Android-System-CAs, kein Klartext, keine globale Benutzer-CA-Freigabe. Optional `MUNCHLING_ANDROID_USER_CA_HOST` als Buildvariable oder `userCaHost` in ignoriertem `android/local-network.properties` setzen. Umgebungsvariable hat Vorrang; ein leerer Wert erzwingt System-CAs auch bei vorhandenem lokalem Property.

Gradle ruft `scripts/android-network-config.mjs` auf und erzeugt die Ressource im ignorierten Build-Verzeichnis. Nur exakte DNS-Namen sind erlaubt; keine URL, Wildcard, IP oder XML-Eingabe. Benutzer-CAs gelten ausschließlich für diesen einen Host, ohne Subdomains. Die System-Basisregel bleibt unverändert. Generierte APKs enthalten die ausdrücklich konfigurierte Hostregel; sie sind nicht durch einen anschließenden Wechsel der Datei rückwirkend geändert.

Für private CAs muss der Eigentümer nur das **öffentliche** CA-Zertifikat nach Fingerprintprüfung am Gerät installieren. Private CA-Schlüssel nie kopieren/einbetten. Nicht fremdgesteuert entsperren; keine `SslErrorHandler.proceed()`-/Trust-all-/`curl -k`-Umgehung. Android-System-DNS muss den Host im vorgesehenen WLAN/VPN auflösen können. Browser-Ausnahmen/DoH beweisen keine WebView-DNS-/TLS-Vertrauensstellung.

Native Android-Origin ist `https://localhost`; sie muss bei beabsichtigtem Sync exakt in `NUXT_SYNC_ALLOWED_ORIGINS` stehen. DNS, TLS und CORS getrennt prüfen, ohne Serverbindung oder Haushaltsuploads zu verändern. iOS-CA-Vertrauen und Runtime-Abnahme sind separat.

## Veröffentlichung

Private `.env`, lokale Netzwerkdateien, Schlüssel/Keystores, Haushaltsdatenbanken und Sicherungen nicht committen. `.gitignore` ist eine Schutzschicht, kein Secret-Scanner und keine Entfernung aus alten Commits. Auch Git-Historie, Commit-Autoren, Remote-Refs und Binärartefakte vor Veröffentlichung prüfen. Gefundene echte Credentials zuerst widerrufen/rotieren; Historienumschreibung nur bewusst und koordiniert.

Quellcode unter MIT, externe Datensätze/Abhängigkeiten mit eigenen Bedingungen. Das Repository öffentlich zu machen ist unabhängig vom Betrieb einer unauthentifizierten privaten Website; deren API darf nicht ungeschützt ins Internet.
