# MariaDB-/Server-Grundlage

## Stand und Grenzen

Die Server-Grundlage stellt eine MariaDB-Verbindung, versionierte Migrationen, einen gemeinsamen versionsgeprüften Schreibdienst sowie Health-Endpunkte bereit. Die Fach-HTTP-/Sync-API ist jetzt verfügbar ([sync-api.md](sync-api.md)); **noch kein UI-HTTP-Datenadapter und kein nativer Netzwerk-Sync.** Auch die Oberfläche eines Backend-Builds verwendet derzeit noch den lokalen Datenadapter. Nicht als fertigen gemeinsamen Webbetrieb deployen; dieser folgt mit den nächsten Phasen.

Ein Server bedient genau einen gemeinsamen Haushaltsbestand. Keine Authentifizierung: ausschließlich im vereinbarten sicheren Netzwerk betreiben. MariaDB-Zugangsdaten bleiben serverseitig; niemals in `runtimeConfig.public` oder Client-Bundles.

## Build und private Konfiguration

```bash
pnpm build:server
# Private Umgebungsvariablen aus .env.example setzen, dann:
node .output/server/index.mjs
```

`build:server` wählt `MUNCHLING_BUILD_MODE=server` und das Nitro-Preset `node-server`. `pnpm dev` bleibt eine lokale Vorschau. `pnpm generate` erzwingt den mobilen/static Modus und schließt Server-Plugins/-Routen aus. `pnpm cap:sync` generiert diese mobile Ausgabe erneut; ein zuvor erzeugter Backend-Build wird niemals ungeprüft in die App kopiert.

Runtime-Variablen:

| Variable | Bedeutung |
| --- | --- |
| `NUXT_MARIA_DB_HOST` | Privater Datenbankhostname, im Container üblicherweise nicht `127.0.0.1` |
| `NUXT_MARIA_DB_PORT` | Port, Standard 3306 |
| `NUXT_MARIA_DB_USER` | Dedizierter App-/Migrationsbenutzer, nicht `root` |
| `NUXT_MARIA_DB_PASSWORD` | Pflichtwert; privat im Deployment setzen |
| `NUXT_MARIA_DB_DATABASE` | Vorhandene Datenbank, Standard `munchling`; einfacher SQL-Bezeichner |
| `NUXT_MARIA_DB_CONNECTION_LIMIT` | Poolgröße 1–32, Standard 5 |
| `NUXT_SYNC_PUBLIC_ORIGIN` | Kanonischer HTTP(S)-Origin; ohne Konfiguration bleibt die Fach-API deaktiviert |
| `NUXT_SYNC_ALLOWED_ORIGINS` | Optional exakte vertrauenswürdige Browser-/Capacitor-Origins |

Ein direkt gestarteter Produktions-Node-Prozess liest `.env` nicht automatisch; Variablen über Prozess-/Containerumgebung setzen. Die Datenbank muss vorhanden sein. Der Benutzer benötigt für aktuelle Migrationen DDL-/Referenzrechte und für den Betrieb Lese-/Schreibrechte auf diesem Schema. Ein späteres Deployment kann Migrationen und Laufzeitberechtigungen trennen.

Getestet mit **MariaDB 11.4**. InnoDB, UTF-8 (`utf8mb4_bin`), strikter SQL-Modus und UTC-Sessions sind festgelegt. Für große Snapshot-Payloads `max_allowed_packet` mindestens auf **64 MiB** konfigurieren. Pool-, Verbindungs-, Query- und Socket-Zeitlimits vermeiden unbegrenztes Warten; große spätere Schemaänderungen benötigen ein gesondertes Wartungs-/Timeout-Konzept.

## Migration und Wiederanlauf

`server/database/migrations.ts` verwendet einen verbindungsgebundenen `GET_LOCK` für das jeweilige Schema. Parallele Serverstarts können nicht gleichzeitig migrieren. Jede Migration hat Version, Name und SHA-256-Prüfsumme. Neuere unbekannte Versionen und geänderte bereits angewendete Migrationen verhindern den Start.

**MariaDB-DDL ist nicht transaktional rückrollbar.** Vor DDL wird ein dauerhafter Marker `applying` geschrieben; erst nach allen Statements und Initialisierung der Haushaltsmetadaten folgt `applied`. Ein Abbruch lässt den Marker absichtlich bestehen. Weitere Starts verweigern den Betrieb, statt ein unvollständiges Schema zu akzeptieren.

Bei `applying`: externes DB-Backup anfertigen, Marker/Prüfsumme und tatsächlich vorhandene Tabellen/Constraints prüfen, den unvollständigen Schritt fachkundig reparieren. Nicht blind den Marker löschen oder vorhandene Tabellen neu erzeugen. Das konkrete Reparaturverfahren hängt von der betroffenen Migration ab. Vor späteren produktiven Upgrades zusätzlich DB-Backup und Wiederherstellung erproben.

Die initiale Schema-Definition und ihre erzeugten Statements sind nach Freigabe **unveränderlich**. Künftige Änderungen in neuen versionierten Migrationen ergänzen; nicht durch Bearbeiten der v1-Definition eine bereits gespeicherte Prüfsumme verändern.

Serverinstanz-UUID und Sync-Epoch entstehen einmal und bleiben bei gewöhnlichen Neustarts erhalten. Nach einem MariaDB-Backup-Restore muss die Epoch bewusst erneuert werden; administrativer Ablauf und API-Ablehnung alter Bindungen sind in [sync-api.md](sync-api.md) beschrieben. Der Native-Reconciliation-Dialog folgt noch. Ein bloßes Redeploy darf die Epoch nicht wechseln.

## Datenmodell und Zeit-/Zahlenregeln

- Sechs Fachtabellen, UUID-Fremdschlüssel und ein globales `sync_identities`-Register. Eine UUID darf weder Entitätstyp noch Aggregatbesitzer wechseln.
- Profile, Lebensmittel, Gerichte mit Zutaten und Mahlzeiten mit Portionen sind die vier versionierten Aggregate. Interne `view_id`-Werte sind keine Sync-Identitäten.
- Root- und Beziehungslöschungen bleiben als Tombstones erhalten. Eine nie hochgeladene Root-Löschung kann allein im Register bestehen, ohne erfundene Fachwerte.
- Nährwerte, Mengen und Faktoren verwenden `DOUBLE`, entsprechend SQLite `REAL`/JavaScript-Zahlen. Keine zusätzliche Dezimalrundung; exakte gespeicherte Portionsfaktoren und Gewichte werden übernommen, nicht neu normalisiert.
- Revisionen/Cursor werden auf sichere JavaScript-Ganzzahlen begrenzt. Der Cursor wird im Dienst als String ausgegeben; keine Fließkomma-Konvertierung unbeschränkter BIGINT-Werte.
- Technische Erstellungs-/Änderungs-/Löschzeitpunkte sind UTC `DATETIME(3)` (Jahre 1000–9999). Explizite Offsets werden normalisiert.
- **`logged_at` bleibt als validiertes Literal erhalten.** Alte `datetime-local`-/SQLite-Angaben ohne Zeitzone dürfen nicht nachträglich mit `Z` versehen werden: das würde ihre bisherige lokale Anzeige verschieben. ISO-Angaben mit Offset bleiben ebenfalls unverändert. Die Textsortierung entspricht dem bisherigen lokalen Ansatz; Date-/Timezone-Filter müssen im späteren HTTP-Adapter ausdrücklich SQLite-kompatibel umgesetzt werden.
- EANs werden getrimmt, leere Werte werden `NULL`. Bis 255 Unicode-Zeichen; case-sensitive Eindeutigkeit unter aktiven Lebensmitteln über einen generierten Index. Gelöschte Lebensmittel blockieren die EAN nicht. Namen sind nicht eindeutig; keine automatische Dublettenverschmelzung.

## Gemeinsamer Schreibvertrag

`shared/domain/server.ts` definiert UUID-adressierte Batches; `server/services/write.ts` ist der **einzige Fach-Schreibpfad** für Web und Sync, erreichbar über `POST /api/sync/push`. Web-Adapter und Native-Runner müssen denselben Vertrag verwenden.

Ein Batch enthält stabile Batch-/Operations-IDs, erwartete Serverinstanz/Epoch und volle Aggregate mit ihrer bekannten `baseRevision`. Eine neue UUID erwartet `0`. Payloads entsprechen den snake_case-Snapshots der nativen Outbox; Root-ID, Kinder-IDs und alle Referenzen sind UUIDs. Unbekannte Felder, ungültige Identitäten/Flags/Werte/Datumsangaben und nichtfinite Zahlen werden vor Schreiben abgewiesen. Grenze: 25 MiB und 100.000 Roots/Kinder/Guards insgesamt.

Ablauf in **einer** Transaktion:

1. Haushalts-Zeile in `server_state` mit `FOR UPDATE` sperren; Instanz/Epoch prüfen.
2. Bereits bestätigte Batch-ID mit identischem kanonischem Inhalt exakt wiederholen. Geänderte Inhalte oder anderweitig wiederverwendete Operations-IDs ablehnen.
3. Basisrevisionen sämtlicher Ziele und Löschabhängigkeiten prüfen. Bei Abweichung Konflikt mit aktuellem Serverstand, keine Überschreibung.
4. Referenzen prüfen, Eltern zuerst materialisieren, vollständige Kinderlisten ersetzen, Löschungen einschließlich Auswirkungen erfassen.
5. **Finalen Rezeptgraphen** gemeinsam validieren, auch bei mehreren neu erzeugten gegenseitigen Referenzen. Parallele Änderungen an verschiedenen Gerichten können keine unbemerkten Zyklen erzeugen.
6. Jedes betroffene Aggregat einmal versionieren, komplette Snapshots/Tombstones ins Change-Log schreiben, Operations-/Batch-Receipts und Cursor speichern.
7. Gemeinsam committen. Jeder Fehler rollt Fachstand, Versionen, Identitäten, Receipts und Cursor zurück.

Zielgerichtete Inserts/Updates verwenden ausschließlich UUIDs. Kein `ON DUPLICATE KEY UPDATE` für Fachzeilen: sonst könnte eine EAN-/Portions-Kollision ungewollt eine andere Zeile treffen. EAN- und Profilzuordnungstausch innerhalb eines Batches funktionieren unabhängig von der Eingabereihenfolge.

Ein Web-Adapter darf keinen automatischen „GET aktuelle Version, blind PATCH damit“-Retry durchführen. Er muss die tatsächlich vom Benutzer bearbeitete Version mitsenden. IDs und Request-Inhalt einschließlich Erstellungszeitpunkten bleiben bei Transport-Retries unverändert.

## Löschabhängigkeiten und Commit-geordneter Cursor

Das Löschen eines Lebensmittels/Gerichts entfernt betroffene Zutaten und direkte Mahlzeiten; Profil-Löschen entfernt Portionen, ohne alte Gesamtgewichte/Faktoren neu zu berechnen. Solche Auswirkungen ändern andere Root-Versionen und erscheinen ausdrücklich im Change-Log.

**Eine Basisrevision des Elternsatzes allein reicht nicht.** Ein anderes Gerät könnte inzwischen neue Mahlzeiten oder Zutaten angelegt haben, ohne diese Elternversion zu ändern. Alle aktuellen abhängigen Roots müssen daher entweder eigene versionsgeprüfte Operationen im selben Batch haben (native Outbox) oder als `guards` mit bekannter Revision angegeben werden. Fehlende oder veraltete Abhängigkeiten erzeugen `dependencyConflict`, nicht stillen Datenverlust. `previewServerDeletion()` ermöglicht dem späteren Web-Adapter eine konsistente Bestätigungsvorschau.

Der Cursor kommt nicht aus ungeschütztem Auto-Increment. Alle Dienst-Schreibtransaktionen halten dieselbe Haushalts-Zeile bis zum Commit; Cursor-Zuweisung und Change-Log stehen unter dieser Sperre. Ein zweiter Writer kann erst nach dem ersten Commit einen höheren sichtbaren Cursor vergeben. Rollbacks veröffentlichen keine Lücke/Teiloperation. Readonly-Aggregate werden in Repeatable-Read-Transaktionen konsistent gelesen.

Das HTTP-Pull-Paging hält zusammengehörige Batches/Abhängigkeiten vollständig; Initialsnapshots werden unter einer konsistenten RR-Sicht mit festem Cursor dauerhaft in Seiten materialisiert. Migration v2 ergänzt ausschließlich temporäre Snapshot-Tabellen, ohne die v1-Prüfsumme/Fachdaten zu ändern. Event-Zeitpunkte sind informativ, nicht das Ordnungskriterium.

## Betrieb und Prüfungen

- `GET /api/health/live`: Prozess lebt; unabhängig von späteren DB-Problemen.
- `GET /api/health/ready`: Pool, Haushaltsmetadaten und erwartete angewendete Schemaversionen verfügbar; andernfalls 503 mit `DB_NOT_READY`.
- Bootstrap-Fehler verhindern den Start. Shutdown schließt den Pool. Freigegebene SQL-Executor-Leases dürfen nicht wieder verwendet werden.
- Logs/Storage-Fehler enthalten feste Ereignis-/Fehlercodes, keine Credentials, Statements, EANs, Namen oder Snapshot-Inhalte. Konfliktantworten dürfen den aktuellen Fachstand für die bewusste Auflösung liefern; sie sind keine Log-Payloads.

```bash
pnpm test                 # bestehende Domain-/SQLite-/Backup-Tests
pnpm typecheck
pnpm typecheck:server
pnpm test:server          # Server bauen + isolierte MariaDB 11.4 + Tests
pnpm generate
pnpm test:browser         # nach mobilem Generate
```

`test:server` benötigt Docker. Es erzeugt einen eindeutigen kurzlebigen Container, zufällige Test-Credentials, eine reine Loopback-Portfreigabe und die feste Wegwerf-Datenbank `munchling_test`. Tests erhalten keinen frei konfigurierbaren Produktions-DB-Link. Container werden anschließend entfernt; das Image bleibt im Cache. Der Test überschreibt `.output` mit dem Backend-Build; für Capacitor anschließend `cap:sync`/`generate` ausführen.

Abgedeckt sind Migration/Konkurrenz/Prüfsummen/DDL-Abbruch, CRUD-Aggregate, UUID-Referenzen, EANs und Portionstausch, Einzel-/Mehrfach-/Parallelzyklen, Versionskonflikte, Löschguards/Kaskaden/Tombstones, historische Uhrzeiten, Idempotenz, spätes Rollback, Commit-Reihenfolge und die tatsächliche SQLite-Outbox→MariaDB→Receipt-Kette. Der gebaute Nitro-Prozess wird separat mit realen Runtime-Credentials gestartet und über HTTP auf Health/503 und Credential-Abschirmung geprüft.

Verifiziert: 134 bestehende Tests und 75 MariaDB-/Nitro-Tests; beide Typprüfungen, Backend-Build, mobile Generierung, Chromium-Smoke, Capacitor-Sync und Android `assembleDebug` erfolgreich. Keine privaten MariaDB-Bezeichner im mobilen Client-Bundle, keine verbliebenen Testcontainer. Die bekannte Nuxt-Module-Preload-Sourcemap-Warnung bleibt nichtblockierend. iOS wurde synchronisiert, aber mangels macOS/Xcode nicht kompiliert.

Native Laufzeit/Sync-Engine, UI-HTTP-Datenadapter, Konfliktdialoge und Dokploy-Produktionsdeployment folgen noch. Hintergrundbetrieb bei geschlossener App bleibt nicht Teil des Ziels.
