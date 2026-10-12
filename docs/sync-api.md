# HTTP-/Sync-API v1

## Sicherheitsgrenze und Versionen

Implementierte Online-Website und Native-Sync teilen den UUID-basierten Vertrag. Aggregate: `profiles`, `foods`, `recipes`, `meal_logs`, `activities`, `activity_logs`. Kinder: `recipe_ingredients`, `meal_log_profiles`, `profile_calorie_history`. Typen liegen in `shared/domain/{server,protocol,sync,replies}.ts`.

**Keine Authentifizierung:** alle berechtigten Netzteilnehmer können lesen/schreiben. Website/API nur im geschützten privaten Netzwerk/VPN betreiben. HTTPS/Host/Origin-Prüfungen sind keine Benutzeranmeldung.

`NUXT_SYNC_PUBLIC_ORIGIN` ist Pflicht, z.B. `https://sync.example.internal`; fehlend: 503 `API_NOT_CONFIGURED`. `NUXT_SYNC_ALLOWED_ORIGINS` erlaubt ausschließlich ausdrücklich freigegebene exakte Origins, ohne Credentials oder Wildcards. Android verwendet `https://localhost`, iOS üblicherweise `capacitor://localhost`. Tatsächlicher Host muss zum kanonischen Origin passen; `X-Forwarded-Host` ist kein Ersatz.

- Außer Info verlangen Fachendpunkte `X-Munchling-Protocol: 1` und Instanz-/Epoch-Bindung.
- Neue Schreibvorgänge verlangen zusätzlich `X-Munchling-Schema: 5`; alte unbekannte Schreibanfragen werden vor Mutation abgewiesen.
- Bereits bestätigte **unveränderte Originalanfragen** erhalten ihr gespeichertes Receipt nach dessen Lookup auch beim Legacy-Replay. Niemals alte Bodies/Journale umschreiben, um eine Schema-Prüfung zu umgehen.
- JSON: `application/json` (optional charset=utf-8), keine komprimierten Bodies/Form-/Textzugriffe. Preflight erlaubt Content-Type/X-Munchling-Protocol/X-Munchling-Schema.
- Antworten: `no-store`, `Vary: Origin`, `nosniff`. Fehlerlogs nur feste Codes, keine SQL-/Credential-/Body-Daten.

UUIDs sind kanonisch kleingeschrieben; lokale numerische IDs/`view_id` sind keine Wire-Identitäten. Info-Entitätszahlen enthalten nur tatsächlich registrierte Entitäten, nicht alle grundsätzlich unterstützten leeren Tabellen.

## Endpunkte

| Methode/Pfad | Eingabe / Ergebnis |
| --- | --- |
| `GET /api/sync/info` | Instanz/Epoch, Protokoll/Schemastand, beratender Cursor, Zahlen/Fähigkeiten/Limits |
| `POST /api/sync/push` | versionierter `ServerWriteBatch` → atomarer Receipt oder vollständige Ablehnung |
| `POST /api/sync/snapshots` | `{serverInstanceId,serverEpoch,targetBytes?}` → konsistente gespeicherte Seite0 |
| `GET /api/sync/snapshots/:id` | Query Bindung/`page` → dieselbe Snapshot-Seite bis Ablauf/Freigabe |
| `DELETE /api/sync/snapshots/:id` | Query Bindung → idempotente Freigabe |
| `GET /api/sync/changes` | Query Bindung/`cursor`/`limit?`/`targetBytes?` → vollständige Change-Batches |
| `GET /api/sync/deletion-preview` | Query Bindung/`entity`/`id` → aktueller Abhängigkeitsstand, keine reservierte Freigabe |
| `GET /api/sync/view` | Query Bindung → Online-Ansicht mit stabilen UI-Aliasen |

## Atomare Writes und Wiederholung

Batch enthält stabile `batchId`, Instanz/Epoch, optionale Geräte-UUID, Operationen mit stabiler `operationId`, Aggregate-/Entity-UUID, `baseRevision`, `upsert`/`delete` und vollständigem Payload sowie zusätzliche Versionsguards.

`upsert` ist ein vollständiges Aggregat, kein partielles Feldpatch. Neue UUID: Basisrevision0; bekannte UUID: tatsächliche bearbeitete Revision. Kinder können Eigentümer nicht wechseln, fremde/tombstonierte UUIDs dürfen nicht übernommen werden. Referenz-Eltern können im selben Batch stehen; finale Graph-/Löschprüfung und alle Änderungen erfolgen gemeinsam. Technische Zeitpunkte UTC, ursprüngliches `logged_at`-Literal bleibt erhalten.

Profilhistorie ist append-only: akzeptierte Kind-UUIDs, ursprüngliche JSON-Bytes, kanonische Zeitstempel und Werte müssen unverändert bleiben. Nur neue Berechnungen werden gegen autoritativen vorherigen DB-Stand geprüft; alte Modellstände werden nicht nachberechnet.

Transport-Retry verwendet denselben ursprünglichen Inhalt und dieselben IDs. Bestätigtes Receipt ist unveränderlich; Replay erzeugt keinen neuen Cursor. Wiederverwendung von IDs für andere Inhalte wird abgewiesen. Abbruch/Timeout kann **nach** Commit auftreten und beweist keine Ablehnung.

409 erfordert ausdrückliche Neuentscheidung gegen erneut gelesenen aktuellen Stand, keine automatische Versionsanpassung/Rebase. Bei erneutem konkurrierendem Edit erneut Konflikt. Löschvorschauen müssen vor Commit neu geprüft werden; unbekannte neue Abhängigkeiten werden nicht still kaskadiert. `preserveHistory` schützt neue Web-Kaskaden einschließlich indirekter historischer Bezüge. Bereits gespeicherte alte Anfragen erhalten keine hinzugefügten Defaultfelder.

## Snapshot und Empfang

Snapshot-Erstellung nimmt einen konsistenten Repeatable-Read-Cut mit allen Roots und kompletter Registry einschließlich Kind-Tombstones. Manifest/Seiten werden atomar gespeichert; separate Quotenverwaltung, kein Fachwriter-Haushaltslock während Lesen. Seiten enthalten Snapshot-ID, Bindung, konstanten Cut-Cursor, Ablauf, Seitenzahlen, Aggregate und Identitäten.

**Alle Seiten stagen**, nicht unvollständige Referenzen früh anwenden. Erst nach vollständiger Identitäts-/Konfliktprüfung atomar übernehmen, Cut-Cursor speichern und seit diesem Cut pullen. Lokale Pending-Daten bleiben geschützt. Unveränderte akzeptierte Kinder nicht neu anlegen oder hochrevisionieren.

Erste Snapshot-POST-Antwort verloren: eine Wiederholung kann eine zusätzliche Lease erzeugen; nicht eng neu anfordern. Bekanntes Manifest über denselben Token fortsetzen. Nach Übernahme DELETE freigeben, sonst 30-Minuten-TTL. Nicht automatisch beim Lesen der letzten Seite löschen; 410 benötigt neuen Snapshot ohne stilles lokales Ersetzen.

## Pull und Cursor

Cursor sind kanonische Dezimalstrings im sicheren Ganzzahlbereich. Start nur0, an vollständigem Batch-Endcursor oder Snapshot-Cut. Zukunft, Lücke oder mitten im Batch: `cursorInvalid`/Resync, kein stilles Überspringen.

Antwort enthält `fromCursor`, tatsächlichen Fortschrittscursor, `highWaterCursor`, `hasMore` und komplette Batch-Gruppen mit vollen Roots/Tombstones. High-Water ist kein angewendeter Fortschritt. Gruppen werden nie durch Paging zerschnitten; Eltern/Referenzen, Fachdaten und Cursor gemeinsam lokal committen, erst danach fortsetzen. Replay ist versionsgebunden/idempotent und erzeugt keine Empfangsechos.

## Grenzen und Fehler

- Push25MiB UTF-8, 100.000 Roots/Kinder/Guards, 15s Body-Deadline; Größen-/UTF-8-Prüfung auch tatsächlich empfangener Bytes.
- Ganze Change-Gruppe32MiB; zu große Writes inklusive Kaskaden vor Commit ablehnen.
- Weiches Seitenziel64KiB–1MiB, Vorgabe256KiB; große einzelne Roots/Gruppen werden nicht zerlegt.
- Pull normalerweise10, höchstens100 vollständige Batches.
- Snapshot256MiB, 4096 Seiten, 1M Root-/Registry-Einträge, vier Leases, 30min TTL.
- MariaDB `max_allowed_packet >= 64MiB`; Proxy-Größen/Timeouts passend konfigurieren.

Fehler: `{error:{code,resync,retryable,field?,current?}}`, ohne SQL-/Stackdetails. 403 Origin/Host; 422 Validierung; 409 Version/Abhängigkeit/Identität/Idempotenz oder Bindung/Cursor; 410 Snapshot abgelaufen; 426 inkompatibles Protokoll/Schema; 429 Snapshot-Quota; 413 Größen; 503 Konfiguration/DB. Aktueller Fachstand in Konfliktantworten ist gewollt, keine öffentliche Zugriffserlaubnis.

## Wartung und Restore

Normaler Redeploy erhält Instanz/Epoch/Revisionen/Cursor. Nach DB-Restore Writer stoppen und Epoch vor Clientzugriff über interne Administration erneuern; [Backup/Restore](data-integrity-and-backups.md). Kein unauthentifizierter Reset-Endpoint.

Tombstones, Registry, Change-Log und bestätigte Operations/Batches werden unbefristet aufbewahrt. Kein Cleanup anhand ungesicherter Geräte-Cursor. Temporäre Snapshot-Seiten sind eine andere Datenklasse.

`pnpm test:server` prüft echte isolierte MariaDB/Nitro-Instanzen. Gezielt nach Server-Build: `node scripts/test-server-db.mjs tests/server/http.test.ts`. Niemals gegen eine Produktionsdatenbank testen.
