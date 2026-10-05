# Munchling: Web, MariaDB und optionaler bidirektionaler Sync

Status: Implementierung begonnen; erstes Fundament umgesetzt und automatisiert geprüft. MariaDB, HTTP-Adapter, Deployment und Sync sind noch nicht implementiert.

### Aktueller Teilstand

- Gemeinsame Fachdaten-Typen und CRUD-Service-Vertrag in `shared/domain/`.
- Persistenzunabhängige Nährwertberechnung; dynamische historische Nährwerte bleiben erhalten.
- Lokaler Datenadapter mit injizierbarer Verbindung; sämtliche Pages und Composables greifen für Fachdaten über den Datenservice zu.
- Serialisierte SQL-Zugriffe und atomare Gerichte/Zutaten sowie Mahlzeiten/Portionen mit Rollback; Browser-Persistenz erst nach Commit.
- Gemeinsame Eingabe-/Referenzvalidierung inklusive transaktionaler EAN-Eindeutigkeit und Verhinderung von Rezeptzyklen; lokalisierte Formularfehler.
- JSON-Backup/Restore aller sechs Fachtabellen in den Einstellungen, mit expliziter Ersetzungsbestätigung und separat gespeicherter Sicherheitssicherung vor jedem Restore.
- Format v1 bewahrt IDs, Zeitstempel und exakte Portionsfaktoren; Details in `docs/data-integrity-and-backups.md`.
- Vitest-Testaufbau mit echter SQLite-Engine (`sql.js`): 102 Tests bestanden.
- Echter Chromium-Smoke-Test (`pnpm test:browser`) prüft Export, Profilpersistenz, Restore und persistente Sicherheitssicherung; alle Prüfungen erfolgreich.
- Browserstartfehler behoben: jeep-sqlite bekommt eine separate, zur eingebetteten Runtime passende WASM-Datei; beide WASM-Assets werden vor dev/build/generate vorbereitet.
- `pnpm typecheck`, `pnpm generate`, Capacitor-Sync für Android/iOS und Android `assembleDebug` erfolgreich. Der Generate-Build meldet weiterhin eine Sourcemap-Warnung des Nuxt-Preload-Plugins.
- Keine Schemaänderung, keine Bestandsdatenmigration und keine Sync-Netzwerkzugriffe. Native Geräte-Laufzeittests und iOS-Kompilierung stehen aus.
- Nächste Arbeiten: Backup-Format für UUIDs erweitern und sichere UUID-/Outbox-Migration umsetzen; danach Server-/Web-Anbindung.

## 1. Bestätigte Anforderungen

- Eine Serverinstanz verwaltet einen gemeinsamen Haushalts-Datenbestand.
- Alle verbundenen Geräte und Browser können alle Profile und Fachdaten dieses Bestands nutzen.
- Die Webseite speichert ihre Fachdaten in MariaDB und bietet schreibenden Zugriff, insbesondere für Lebensmittel, Gerichte und Mahlzeiten.
- Die native App bleibt vollständig lokal und offline nutzbar. Sync ist optional und standardmäßig ausgeschaltet.
- Sync funktioniert in beide Richtungen, einschließlich Änderungen und Löschungen.
- Bei aktivierter Synchronisierung: automatisch bei Start, Rückkehr in die App, lokalen Änderungen und wieder verfügbarer Verbindung; zusätzlich manuell auslösbar.
- Synchronisierung bei geschlossener App ist nicht Bestandteil der ersten Version.
- Gleichzeitige widersprüchliche Änderungen werden nicht still überschrieben, sondern manuell aufgelöst.
- Die Webseite benötigt eine Serververbindung. PWA-/Browser-Offline-Betrieb ist nicht erforderlich.
- Deployment über Dokploy; Dockerfile als empfohlener erster Weg, Nixpacks als Alternative.
- Zunächst keine Authentifizierung: ausschließlich Betrieb in einem sicheren Netzwerk. Eine Geräte-ID ist keine Authentifizierung.

## 2. Befund der bestehenden Codebasis

### Stack und Build

- Nuxt 4, Vue 3, Tailwind, Deutsch/Englisch, Capacitor für Android und iOS.
- `nuxt.config.ts`: `ssr: false`, Nitro-Preset `static`.
- `capacitor.config.ts`: native App lädt die generierten Dateien aus `.output/public`.
- `scripts/update-android.sh`: erzeugt BLS-Suchdatenbank, generiert Nuxt, synchronisiert Capacitor und baut/installiert Android.
- Noch kein `server/`-Verzeichnis, keine MariaDB-Anbindung, keine Docker-/Nixpacks-Konfiguration.
- In `package.json` sind noch keine Testskripte vorhanden; in `app/` und `scripts/` wurden keine Testdateien gefunden.

### Datenhaltung

- `app/utils/database/schema.ts`: eine bestehende SQLite-Migration mit sechs fachlichen Tabellen.
- `app/utils/database/client.ts`: SQLite-Verbindung, Migrationen, Entwicklungs-Seeding und Browser-Persistenz.
- `app/plugins/database.client.ts`: initialisiert SQLite auch im Browser über `jeep-sqlite`.
- `app/utils/database/sql.ts`: alle SQL-Helfer sind direkt an Capacitor SQLite gekoppelt.
- `app/utils/database/repositories/{profiles,foods,recipes,mealLogs}.ts`: bestehende CRUD- und Berechnungslogik.
- `app/composables/use*.ts`: greifen direkt auf lokale Repositories zu.
- IDs sind lokale Auto-Increment-Zahlen, keine global eindeutigen Identitäten.
- Es gibt keine Outbox, Versionsprüfung, Change-Log oder Löschmarker.
- Zusammengesetzte Schreibvorgänge sind teilweise mehrere separate SQL-Aufrufe: etwa Gericht mit Zutaten, Austausch der Zutaten und Änderung einer Mahlzeit samt Portionen. Eine gemeinsame Transaktionsgrenze fehlt dort.
- Fremdschlüssel nutzen `ON DELETE CASCADE`; für Sync müssen daraus explizite und nachvollziehbare Löschänderungen werden.
- Das aktive Profil wird separat in `localStorage` gespeichert (`useCurrentProfile.ts`).
- Die BLS-Datenbank ist ein separat gebündelter, unveränderlicher Suchkatalog (`useBundledFoodSearch.ts`), nicht die Benutzerdatenbank.

### Vorhandene Oberflächen

`app/pages/`: Startseite, Dashboard, Profile, Lebensmittel, Gerichte, Mahlzeitenerfassung und Einstellungen. Diese Oberflächen sollen wiederverwendet werden, nicht parallel neu entstehen.

## 3. Empfohlene Zielarchitektur

```text
Native App (Android/iOS)
  gemeinsame Vue-Oberflächen und Fachlogik
  lokale SQLite + transaktionale Outbox
  optionaler Sync-Client
            |
            | HTTP(S), versionierter Sync
            v
Nuxt/Nitro-Server ---------------- MariaDB
  CRUD-API für die Webseite          Fachdaten
  Sync-API für Apps                  Versionen und Tombstones
  gemeinsame Validierung            Change-Log / Konflikte / Idempotenz
            ^
            | Same-Origin CRUD-API
            |
Webseite im Browser
  gemeinsame Vue-Oberflächen und Fachlogik
  HTTP-Datenadapter, keine lokale Fachdaten-SQLite
```

- SPA kann bleiben; Server-API benötigt kein serverseitiges Rendering.
- Web-Build mit laufendem Nitro-Node-Server statt statischem Nitro-Preset.
- Mobile-Build bleibt statisch, inklusive aller Offline-Assets.
- Die Datenquellenwahl erfolgt explizit über Build-/Betriebsmodus; `Capacitor.getPlatform() === 'web'` allein unterscheidet nicht zuverlässig Webbetrieb und mobile Vorschau.
- MariaDB-Zugangsdaten ausschließlich serverseitig; niemals im Client-Bundle oder in der App.
- Ein gemeinsamer Server-Schreibdienst für Web-CRUD und Sync verhindert unterschiedliche Validierung oder fehlende Change-Log-Einträge.

## 4. Umfang von „alle Daten synchronisieren“

| Daten | Verhalten |
| --- | --- |
| Profile und sämtliche Nährwertziele | Vollständig synchronisieren |
| Gespeicherte Lebensmittel inkl. EAN, Marke, Namen, Nährwerte, Custom-Flag | Vollständig synchronisieren |
| Gerichte inkl. Beschreibung und Untergericht-Flag | Vollständig synchronisieren |
| Zutaten inkl. Lebensmittel-/Untergericht-Bezug und Mengen | Mit dem zugehörigen Gericht synchronisieren |
| Mahlzeiten inkl. Verzehrzeitpunkt, Quelle und Gesamtgewicht | Vollständig synchronisieren |
| Profilzuordnungen und Portionen einer Mahlzeit | Mit der zugehörigen Mahlzeit synchronisieren |
| Löschungen aller obigen Daten | Als versionierte Löschungen synchronisieren |
| Aktuell ausgewähltes Profil | Gerätebezogene UI-Auswahl; lokal behalten |
| Serveradresse, Sync-Schalter, Geräte-ID, Cursor, Retry-Status | Gerätebezogene Technik; nicht zwischen Geräten verteilen |
| BLS-Suchkatalog | Als versioniertes gemeinsames Asset bereitstellen, nicht bei jedem Sync kopieren |
| Suchergebnisse, Ladezustände, offene Formulare | Kein synchronisierter Fachbestand |

Weitere künftig persistierte fachliche Daten müssen ausdrücklich in den Sync-Vertrag aufgenommen werden. Aus dem BLS-/Open-Food-Facts-Katalog übernommene und in `foods` gespeicherte Lebensmittel gehören zum synchronisierten Bestand.

## 5. Sync-Grundsätze

1. Lokale fachliche Änderungen und Outbox-Eintrag entstehen in derselben SQLite-Transaktion.
2. Lokale numerische IDs dürfen zunächst erhalten bleiben. Jede Entität erhält zusätzlich eine stabile globale UUID; API und Sync verwenden UUIDs und UUID-Referenzen.
3. Gerichte samt Zutaten sowie Mahlzeiten samt Profilportionen sind atomare Aggregate. Kein Sync von halbfertigen Zutatenlisten oder Portionen.
4. Jede Änderung trägt eine eindeutige Operations-ID und eine bekannte Basisversion.
5. Der Server prüft Basisversionen und vergibt neue Versionen. Gerätezeitstempel entscheiden keine Konflikte.
6. Serveränderungen erhalten einen geordneten, dauerhaften Change-Cursor. Cursorfortschritt muss der Commit-Reihenfolge folgen; ein einfaches Auto-Increment ohne entsprechendes Transaktionskonzept reicht nicht.
7. Wiederholte Requests sind idempotent; ein Timeout darf keine doppelten Gerichte oder Mahlzeiten erzeugen.
8. Gelöschte Datensätze bleiben zunächst als Tombstones erhalten. Keine automatische Bereinigung, solange die Rückkehr lange offline gewesener Geräte nicht sicher abgedeckt ist.
9. Eingehende Daten überschreiben niemals unbestätigte lokale Änderungen. Konflikte werden gesondert gespeichert.
10. Auf eingehende Sync-Daten wird keine neue lokale Outbox-Änderung erzeugt; keine Echo-Schleifen.
11. Deaktivierter Sync bedeutet: keine Sync-Netzwerkzugriffe, lokale Änderungen werden trotzdem für spätere Verbindung nachvollziehbar gehalten.
12. Der Server ist der gemeinsame Austauschpunkt. Ohne Netz sind Geräte nicht sofort identisch; nach erfolgreichem Sync und aufgelösten Konflikten müssen sie konvergieren.

## 6. Umsetzungsphasen und detaillierte TODOs

### Phase 0 — Verträge, Grenzen und Sicherung

- [x] Entscheidungen aus diesem Dokument als Architekturvertrag übernehmen.
- [ ] Dockerfile als primären Deploymentweg bestätigen; Nixpacks nur bei Bedarf zusätzlich umsetzen.
- [ ] Daten- und API-Typen für die sechs Tabellen bzw. vier Aggregate definieren: Profile, Lebensmittel, Gerichte mit Zutaten, Mahlzeiten mit Portionen.
- [x] Regeln für fachliche Validierung dokumentieren: positive Mengen, nichtnegative Ziele/Nährwerte, EAN-Eindeutigkeit, genau eine Quelle, gültige Referenzen, keine Rezeptzyklen.
- [x] Bestehendes Verhalten historischer Mahlzeiten ausdrücklich erhalten: Nährwerte werden aktuell dynamisch aus Lebensmitteln/Gerichten berechnet. Historische Nährwert-Snapshots wären eine separate Funktionsänderung.
- [x] Bestandsdaten-Backup/Export vor der ersten SQLite-Migration ermöglichen und eine Rücksicherung testen.
- [ ] Minimalen Testaufbau mit getrennten lokalen Datenbanken und echter MariaDB-Testinstanz festlegen.

Abnahme: fachlicher Sync-Umfang und verlustfreie Migrationsstrategie sind dokumentiert.

### Phase 1 — Gemeinsame Fachlogik und Datenadapter

- [x] Persistenzunabhängige DTOs und Nährwertberechnung aus SQLite-Implementierungen lösen.
- [x] Gemeinsame Eingabevalidierung aus SQLite-Constraints und UI-Prüfungen lösen.
- [x] Gemeinsame Repository-/Service-Verträge für die bestehenden CRUD-Funktionen schaffen.
- [ ] Lokalen SQLite-Adapter und HTTP-Adapter vorsehen; Pages sollen nicht wissen, wo Daten gespeichert werden.
- [x] Composables auf den injizierten Datenservice umstellen, bestehende Rückgabewerte und Ladezustände möglichst erhalten.
- [ ] Auswahl zwischen lokalem und HTTP-Datenadapter über den Betriebsmodus ergänzen.
- [ ] SQLite-Initialisierung und `jeep-sqlite` nur im lokalen Modus starten.
- [ ] Native Plugins im Browser korrekt abgrenzen; Barcode-Kamera mit unterstütztem Browser und manueller EAN-Eingabe als Fallback testen.
- [x] Mehrteilige lokale Änderungen in echte gemeinsame Transaktionen verlagern, ohne jeden Teil separat zu persistieren.
- [ ] Berechnungen und Validierung sowohl lokal als auch serverseitig verwenden.

Abnahme: die App funktioniert unverändert lokal; die Fachlogik hängt nicht mehr zwingend von Capacitor SQLite ab.

### Phase 2 — SQLite-Sync-Migration

- [x] Neue Migration hinzufügen; bestehende Initialmigration nicht nachträglich umschreiben.
- [x] Globale UUIDs für vorhandene Datensätze erzeugen und dauerhaft speichern, ohne ihre lokalen IDs oder Beziehungen zu verlieren.
- [x] UUID-Indizes und UUID-zu-lokaler-ID-Auflösung für alle Referenzen ergänzen.
- [x] Versions-/Sync-Metadaten und Löschmarker einführen, auch für bisher nur mit `created_at` ausgestattete Beziehungen.
- [x] Transaktionale Outbox, lokale Basis-/Serverstände für Konfliktvergleich und Konfliktspeicher erstellen.
- [x] Geräte-ID, Serverbindung, Serverinstanz-/Epoch-ID und Pull-Cursor lokal speichern.
- [x] Aggregate vollständig und atomar in die Outbox schreiben; mehrere lokale Änderungen kontrolliert bündeln oder sequenziell mit korrekter Version abarbeiten.
- [x] Lokale Create-/Update-/Delete-Vorgänge vollständig erfassen, unabhängig davon, ob Sync gerade aktiviert ist.
- [x] Wiederanlauf nach Abbruch der Migration sowie nach App-Neustart prüfen.
- [x] Entwicklungs-Seeding von produktiven Beständen und echtem Sync trennen; keine versehentliche Verteilung von Testdaten.
- [x] Backup v2 mit UUIDs/Löschmarkern, v1-Import und kontrolliertem lokalen Sync-Neustart ergänzen; Sicherheitssicherung vor produktiver Migration erzwingen.

Implementiert und lokal/mit Chromium geprüft: [local-sync-foundation.md](local-sync-foundation.md). Die Queue wird sequenziell in unveränderlichen Batches quittiert; Basisrevisionen werden bei Fachänderungen festgehalten und nur nach bestätigten eigenen Vorgängern fortgeschrieben, niemals still auf neue Remote-Versionen umgestellt. Noch kein Netzwerktransport oder Konfliktprozessor. Native Gerätelaufzeit und echte MariaDB-Integration folgen in den späteren Abnahmen.

Abnahme: vorhandene Daten bleiben erhalten; jede neue Fachänderung ist dauerhaft synchronisierbar.

### Phase 3 — MariaDB und Server-Grundlage

- [ ] `server/`-Struktur mit serverseitiger MariaDB-Anbindung, Pooling und sauberem Shutdown erstellen.
- [ ] Versionierte MariaDB-Migrationen für Fachdaten, Referenzen, Versionen, Tombstones, Change-Log, Geräte-/Sync-Metadaten und Idempotenz erstellen.
- [ ] Geeignete Typen für UUIDs, Texte, UTC-Zeitpunkte, Zahlen und Flags wählen; SQLite-Syntax nicht unverändert übernehmen.
- [ ] Kollation, EAN-Normalisierung/-Eindeutigkeit und Genauigkeit von Mengen/Nährwerten festlegen; Verhalten mit SQLite abgleichen.
- [ ] Fachliche Konsistenz serverseitig prüfen und zusätzlich soweit sinnvoll durch DB-Constraints absichern.
- [ ] Rezeptzyklen und ungültige Referenzen auch bei mehreren Änderungen in einer Transaktion verhindern.
- [ ] Gemeinsamen transaktionalen Schreibdienst bauen: Fachdaten + Version + Change-Log + Operationsbestätigung in einem Commit.
- [ ] Versionsprüfung auch für gewöhnliche Web-CRUD-Schreibzugriffe nutzen, damit zwei Browser-Tabs keine stillen Überschreibungen verursachen.
- [ ] Sicheres Migrationsverfahren beim Deployment festlegen; keine konkurrierenden Migrationen mehrerer Instanzen.
- [ ] Liveness-/Readiness-Endpunkte und strukturierte, datensparsame Fehlerlogs ergänzen.

Abnahme: MariaDB-Schema und Schreibdienst sind reproduzierbar aufsetzbar, validiert und transaktional konsistent.

### Phase 4 — Bidirektionales Sync-Protokoll

Vorgesehene API-Aufgaben; endgültige Pfade im API-Vertrag festlegen:

- Serverinfo: Protokoll-/Schemaversion, Serverinstanz-ID und Fähigkeiten.
- Initialer Snapshot: konsistenter Bestand mit zugehörigem Change-Cursor.
- Push: begrenzte Änderungsbatches mit Operations-ID und Basisversion.
- Pull: paginierte Änderungen seit einem Cursor, inklusive Tombstones.
- Konfliktauflösung: neue versionierte Schreiboperation, keine unbedingte Überschreibung.

TODOs:

- [ ] API-Vertrag einschließlich Fehler-, Konflikt-, Lösch- und Versionsantworten definieren.
- [ ] Größenlimits, Paging, Zeitlimits und erlaubte Entitätstypen festlegen.
- [ ] Konsistenten initialen Snapshot sicherstellen: Änderungen während eines mehrseitigen Downloads dürfen weder verloren gehen noch unbemerkt doppelt gelten.
- [ ] Dauerhaftes Change-Log mit Commit-geordnetem Cursor implementieren.
- [ ] Push-Idempotenz prüfen und Bestätigungen wiederholbarer Operations-IDs speichern.
- [ ] Konflikte über Basisversionen erkennen, einschließlich Änderung-vs.-Löschung.
- [ ] Eltern/Referenzen vor abhängigen Datensätzen anwenden bzw. referenzabhängige Änderungen zusammen transaktional übertragen.
- [ ] Löschkaskaden als explizite, versionierte Änderungen behandeln; auch Änderungen an referenzierenden Aggregaten berücksichtigen.
- [ ] Erfolgreiche und fehlgeschlagene Batch-Operationen eindeutig zuordnen; keine unklaren Teilzustände.
- [ ] Unbekannte Cursor, inkompatible Versionen und geänderte Serverinstanzen mit kontrolliertem Resync statt stiller Übernahme behandeln.
- [ ] Verhalten nach MariaDB-Backup-Restore festlegen: Sync-Epoch wechseln, damit bereits bestätigte, im Backup fehlende Änderungen nicht unbemerkt verloren bleiben.
- [ ] Tombstone-/Change-Log-Aufbewahrung dokumentieren; späterer Cleanup benötigt Snapshot-/Resync-Konzept für alte Geräte.

Abnahme: zwei unabhängig gestartete Clients können erzeugen, ändern und löschen, ohne ID-Kollisionen oder doppelte Operationen.

### Phase 5 — Ersteinrichtung, Bestandszusammenführung und Konflikte

- [ ] Einrichtungsdialog mit Serveradresse, Verbindungstest und Hinweis „gemeinsamer Bestand, keine Authentifizierung“ erstellen.
- [ ] Lokalen und serverseitigen Bestand vor Erstverbindung zählen und Zusammenführung verständlich ankündigen.
- [ ] Standard: lokale Daten hinzufügen und Serverdaten herunterladen; keine Seite ungefragt ersetzen oder löschen.
- [ ] Bestehende Datensätze nicht allein anhand gleicher Namen als identisch ansehen.
- [ ] EAN-Kollisionen und mutmaßliche Dubletten gesondert anzeigen; Zusammenführung mit korrekter Neuzuordnung aller Referenzen ermöglichen.
- [ ] Abgelehnte Lebensmittel-Imports samt abhängigen Gerichten/Mahlzeiten konsistent zurückhalten; keine dangling references erzeugen.
- [ ] Basis-, lokale und aktuelle Serverversion für Konflikte anzeigen; Zutaten/Portionen verständlich zusammenfassen.
- [ ] Optionen „lokale Version übernehmen“ und „Serverversion übernehmen“ anbieten; Wiederherstellung bei Änderung-vs.-Löschung explizit bestätigen lassen.
- [ ] Konfliktauflösung erneut gegen die aktuelle Serverversion prüfen: zwischen Anzeige und Entscheidung kann sich der Server verändert haben.
- [ ] Andere nicht betroffene Daten trotz einzelner Konflikte weiter synchronisieren; referenzabhängige Änderungen gezielt zurückhalten.
- [ ] Serverwechsel/Neuverbinden als eigenen Ablauf behandeln, nicht bloß URL überschreiben und alten Cursor weiterverwenden.
- [ ] Abschalten/Trennen des Sync erhält die lokale Datenbank; kein automatisches Löschen auf App oder Server.

Abnahme: volle Bestandsdatenbanken lassen sich ohne ungefragten Datenverlust verbinden; Konflikte bleiben bis zur bewussten Entscheidung erhalten.

### Phase 6 — Sync-Engine in der App

- [ ] Einen Single-Flight-Sync-Runner implementieren; kein paralleler automatischer und manueller Sync.
- [ ] Änderungen pushen, Serveränderungen pullen und unbestätigte lokale Daten konfliktbewusst erhalten.
- [ ] Pull-Änderungen samt lokalem Cursor atomar anwenden; Outbox erst nach eindeutiger Serverbestätigung quittieren.
- [ ] Downloads als Remote-Änderungen kennzeichnen, damit keine erneute Outbox entsteht.
- [ ] Debounce für lokale Änderungen und Backoff mit Jitter für Netzwerk-/Serverfehler ergänzen.
- [ ] Trigger für Start, Resume und Verbindungsrückkehr ergänzen; Netzstatus allein nicht als Server-Erreichbarkeit interpretieren.
- [ ] Änderungen der Webseite während geöffneter App durch ein begrenztes Pull-Intervall erkennen; zunächst kein WebSocket notwendig.
- [ ] Aktive App-/UI-Daten nach Pull aktualisieren; ausgewählte gelöschte Profile oder offene veränderte Formulare sauber behandeln.
- [ ] Sync-Einstellungen mit Aktivierung, URL, Verbindungstest und „Jetzt synchronisieren“ ergänzen.
- [ ] Status anzeigen: ausgeschaltet, offline, läuft, letzter erfolgreicher Sync, wartende Änderungen, Konflikte, Fehler.
- [ ] Timeouts, unterbrochene Requests, Serverneustart und App-Neustart zuverlässig wiederaufnehmen.
- [ ] Bei ausgeschaltetem Sync keinerlei Sync-Requests ausführen; lokale CRUD-Funktionen bleiben uneingeschränkt.
- [ ] Android-/iOS-Netzwerkregeln und Capacitor-Origin-Verhalten mit echter Serveradresse prüfen.

Abnahme: Offline-Arbeit bleibt erhalten und konvergiert nach Wiederverbindung; deaktivierter Sync ist wirklich optional.

### Phase 7 — Webseite mit vollständigen Schreibfunktionen

- [ ] HTTP-Datenadapter an CRUD-API anschließen; produktive Webdaten nicht mehr in Browser-SQLite speichern.
- [ ] Vorhandene Pages für Profile, Lebensmittel, Gerichte, Mahlzeiten und Dashboard wiederverwenden.
- [ ] Gerichte erstellen/bearbeiten/löschen, Untergerichte wählen und Nährwertberechnung im Web prüfen.
- [ ] Lebensmittel inklusive manueller EAN und Nährwerten erfassen/bearbeiten/löschen.
- [ ] Mahlzeiten und Portionen mehrerer Profile eintragen/bearbeiten/löschen.
- [ ] Profilziele verwalten und Tagesübersichten servergestützt laden.
- [ ] BLS-Suche und Open-Food-Facts-Übernahme im Browser und in der App prüfen.
- [ ] API-Fehler und nicht erreichbaren Server sichtbar behandeln; erfolgreiche Speicherung nicht vortäuschen.
- [ ] Konfliktbehandlung auch für veraltete Browserformulare und mehrere Tabs nutzen.
- [ ] Bei konkurrierender Löschung verständliche Rückmeldung statt stiller Wiederanlage geben.
- [ ] Änderungen anderer Clients durch Refresh bzw. begrenztes Polling anzeigen; Formularentwürfe nicht ungefragt überschreiben.
- [ ] Desktoplayout und Tastaturbedienung verbessern, mobile Bedienbarkeit erhalten.
- [ ] Neue Texte, Sync-Status und Konfliktdialoge vollständig DE/EN übersetzen.

Abnahme: eine im Browser erstellte Mahlzeit/ein Gericht erscheint nach Sync in der App und umgekehrt.

### Phase 8 — Build-Trennung und Dokploy-Deployment

- [ ] Explizite Skripte für mobilen statischen Build und Web-Server-Build ergänzen.
- [ ] Nitro-Preset pro Build-Modus wählen; Capacitor muss weiterhin `.output/public` erhalten.
- [ ] Bestehende `cap:sync`-/Android-Skripte auf den Mobile-Build ausrichten.
- [ ] Mobile- und Web-Build-Ausgaben nicht gleichzeitig im gleichen `.output`-Verzeichnis erzeugen; separate CI-Jobs/Workspaces verwenden.
- [ ] BLS-/WASM-Assetbereitstellung reproducierbar machen: Generator mit Python-Abhängigkeiten im Build oder kontrolliertes versioniertes Vorbuild-Artefakt.
- [ ] Docker-Multi-Stage-Build mit unterstütztem festgelegtem Node, pnpm-Lockfile, Build- und schlanker Runtime-Stufe erstellen.
- [ ] Produktionsstart über Nitro-Node-Einstiegspunkt (typischerweise `.output/server/index.mjs`), Bind auf `0.0.0.0`, konfigurierbarer Port.
- [ ] `.dockerignore` ergänzen; `.env`, lokale DBs, native Build-Artefakte und sonstige Geheimnisse ausschließen.
- [ ] Container nicht als root ausführen, Shutdown und Healthchecks prüfen.
- [ ] MariaDB als separaten Dokploy-Dienst mit persistentem Volume und internem Netzwerk betreiben; DB-Port nicht unnötig veröffentlichen.
- [ ] DB-Host, Port, Datenbank, Nutzer, Passwort und erlaubte Origins als serverseitige Runtime-Konfiguration dokumentieren.
- [ ] DB-Nutzer mit begrenzten Rechten und dokumentierter Migrationsstrategie einsetzen.
- [ ] Dokploy-Anleitung für Build, Port, Routing, TLS, Umgebungsvariablen, Migration, Healthcheck und Rollback schreiben.
- [ ] Bei gewünschtem Nixpacks-Weg Node/pnpm und gegebenenfalls Python explizit konfigurieren, Web-Build und Nitro-Start festlegen und separat testen.
- [ ] Backup-/Restore-Verfahren für MariaDB und Sync-Epoch dokumentieren und praktisch prüfen.

Abnahme: frisches Dokploy-Deployment startet inklusive MariaDB-Anbindung; Redeploy erhält Daten; Mobile-Build bleibt unabhängig lauffähig.

### Phase 9 — Netzwerkgrenzen ohne Authentifizierung

- [ ] Betrieb ausdrücklich auf LAN/VPN bzw. anderweitig eingeschränkte Erreichbarkeit begrenzen, nicht offen ins Internet stellen.
- [ ] Hinweis dokumentieren: jeder erreichende Client kann in dieser Version sämtliche Daten lesen, verändern und löschen.
- [ ] HTTPS trotz privatem Netz empfehlen; Kamera-/Browserfunktionen können einen sicheren Kontext benötigen.
- [ ] Keine pauschalen Cleartext-Ausnahmen für Android/iOS hinzufügen; falls internes HTTP notwendig ist, eng begrenzt und dokumentiert konfigurieren.
- [ ] CORS auf erforderliche Browser-/Capacitor-Origins begrenzen; CORS ist keine Authentifizierung oder vollständige Zugriffssicherung.
- [ ] Schreib-Requests gegen unerwünschte Cross-Origin-Browseraufrufe härten: Origin-Prüfung, erwarteter Content-Type, keine schreibenden GET-Routen.
- [ ] Parameterisierte SQL-Abfragen, Payloadlimits, Typ-/Referenzvalidierung und zurückhaltende Fehlermeldungen ergänzen.
- [ ] Diagnose- und Serverinfo-Endpunkte ohne Geheimnisse gestalten.
- [ ] API-Struktur so abgrenzen, dass spätere Authentifizierung ergänzt werden kann, ohne jetzt Benutzerverwaltung einzuführen.

Abnahme: Deployment verletzt nicht die Annahme eines sicheren Netzwerks; keine DB-Geheimnisse im Client.

### Phase 10 — Automatisierte Tests und Gesamtabnahme

- [ ] Unit-Tests: UUID-Zuordnung, Serialisierung, Validierung, Rezeptzyklen, Nährwertberechnung, Versionsvergleich und Outbox-Verhalten.
- [ ] SQLite-Migration mit bereits gefüllter Datenbank und vollständigen Beziehungen testen.
- [x] Repository-Integrationstests für atomare Gerichte und Mahlzeiten durchführen.
- [ ] MariaDB-Integrationstests mit echten Migrationen, Constraints und Transaktionen aufsetzen.
- [ ] Sync-Tests mit mindestens zwei getrennten App-Datenbanken und einem Server erstellen.
- [ ] E2E-Test: Web-Gericht erstellen → App pullt → App ändert → Web zeigt Änderung.
- [ ] E2E-Test: Mehrprofil-Mahlzeit inklusive Portionen in beide Richtungen synchronisieren.
- [ ] Gleiche lokale numerische IDs auf unterschiedlichen Geräten erzeugen; keine Kollision erwarten.
- [ ] Gleiche Entität gleichzeitig ändern; manuelle Konfliktauflösung prüfen, keine automatische Überschreibung.
- [ ] Unterschiedliche Entitäten gleichzeitig ändern; beide Änderungen müssen durchgehen.
- [ ] Änderung-vs.-Löschung, Rezept-/Lebensmittel-Löschkaskaden und alte Offline-Geräte testen.
- [ ] Konfliktauflösung bei erneut veränderter Serverversion testen.
- [ ] Erstsynchronisierung mit zwei vollen Beständen und identischen EANs testen.
- [ ] Verbindungsabbruch vor/nach Server-Commit und vor lokaler Quittierung simulieren; Retry darf keine Duplikate erzeugen.
- [ ] App-Abbruch mitten im Pull/Push und Wiederanlauf testen; Cursor darf keine Änderungen überspringen.
- [ ] Snapshot unter parallelen Web-Schreibvorgängen und Pull-Paging unter parallelen Servertransaktionen testen.
- [ ] Serverwechsel, veralteten Cursor, Protokollkonflikt und DB-Restore mit Epoch-Wechsel testen.
- [ ] Mehrere lokale Änderungen am gleichen noch unbestätigten Aggregat testen.
- [ ] Deaktivierten Sync testen: keine Sync-Requests, unveränderte Offline-Funktionen.
- [ ] Serverausfall im Web testen: sichtbarer Fehler, kein falscher Speicherungserfolg.
- [ ] Typecheck, Web-Build, Mobile-Generate und Android-Smoke-Test in CI aufnehmen; iOS-Smoke-Test auf geeigneter Umgebung einplanen.
- [ ] Dockerstart, Migration, DB-Ausfall/Readiness, Redeploy und Backup-Restore prüfen.

Abnahme: alle unten genannten End-to-End-Kriterien sind nachgewiesen.

## 7. Empfohlene Reihenfolge und Lieferpakete

1. **Fundament:** Phase 0–2 — Fachverträge, Adapter, Transaktionen, sichere lokale Migration.
2. **Nutzbare Webseite:** Phase 3 + 7 + Web-Build aus Phase 8 — MariaDB und vorhandene Oberflächen servergestützt nutzbar machen.
3. **Sync-Kern:** Phase 4–6 — Protokoll, Erstverbindung, Konflikte und App-Sync integrieren.
4. **Betriebsreife:** Phase 8–10 abschließen — Dokploy, Netzwerkgrenzen, Backups und Gesamttests.

Tests und Netzwerkvalidierung begleiten jedes Lieferpaket; sie werden nicht erst zum Schluss begonnen. Jede Zwischenversion bleibt klar als Teilstand gekennzeichnet, bis bidirektionaler Sync vollständig funktioniert.

## 8. Endgültige Erfolgskriterien

- [ ] Munchling lässt sich über Dokploy als Webseite mit MariaDB betreiben.
- [ ] Im Browser lassen sich Profile, Lebensmittel, Gerichte mit Untergerichten sowie Mahlzeiten mit Profilportionen verwalten.
- [ ] Die App arbeitet ohne Serverkonfiguration und ohne Netz weiter wie bisher.
- [ ] Sync ist standardmäßig aus und in den Einstellungen bewusst aktivierbar.
- [ ] Änderungen von App zu Web und Web zu App sind nach erfolgreichem Sync sichtbar.
- [ ] Löschungen bleiben Löschungen, auch wenn ein altes Gerät später wieder online kommt.
- [ ] Gleichzeitige Bearbeitungen führen zu nachvollziehbaren, manuell auflösbaren Konflikten statt Datenverlust.
- [ ] Netzwerkfehler, Wiederholungen und App-Neustarts erzeugen keine Duplikate oder halbfertigen Aggregate.
- [ ] Bestehende lokale Daten werden verlustfrei migriert; Erstverbindung ersetzt keinen Bestand ungefragt.
- [ ] Deployment-, Backup-/Restore- und Netzwerkvoraussetzungen sind dokumentiert und getestet.

## 9. Nicht Teil der ersten Version

- Authentifizierung, Benutzerkonten und Berechtigungen.
- Mehrere isolierte Haushalte auf derselben Serverinstanz.
- Öffentlich erreichbarer Betrieb ohne zusätzliche Absicherung.
- Offlinefähige Webseite/PWA.
- Garantierter Sync bei geschlossener nativer App.
- WebSockets oder komplexes Feld-für-Feld-/CRDT-Merging.
- Automatisches Zusammenführen bloß gleichnamiger Lebensmittel oder Gerichte.
- Änderung der bisherigen dynamischen Berechnung historischer Nährwerte.
