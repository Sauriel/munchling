# HTTP-/Sync-API v1

## Stand und Sicherheitsgrenze

Die Server-API für UUID-basierte Fach-Batches, Snapshots und Änderungen ist implementiert. Sie bearbeitet alle sechs Facharten über vier Aggregate: `profiles`, `foods`, `recipes` (einschließlich `recipe_ingredients`) und `meal_logs` (einschließlich `meal_log_profiles`). Die UI verwendet **noch den lokalen Adapter**; native Sync-Engine, Einrichtungs-/Konfliktdialoge und Web-HTTP-Datenadapter folgen. Keine Hintergrundarbeit bei geschlossener App.

Ein gemeinsamer Haushaltsbestand, **keine Authentifizierung**. Zugriff ausschließlich innerhalb des genehmigten sicheren Netzwerks, möglichst HTTPS. Jeder berechtigte Netzteilnehmer kann lesen/schreiben; Origin-/Host-Prüfungen sind **kein Benutzer-/Geräteauthentifizierungsverfahren**.

Zusätzliche private Runtime-Variablen:

- `NUXT_SYNC_PUBLIC_ORIGIN`: Pflicht für die API, z. B. `https://munchling.intern.example`. Ohne Wert bleiben Fach-Endpunkte mit 503 `API_NOT_CONFIGURED` deaktiviert; Health bleibt verfügbar.
- `NUXT_SYNC_ALLOWED_ORIGINS`: optional, kommaseparierte **exakte** vertrauenswürdige Origins. Für Standard-Capacitor beispielsweise `capacitor://localhost,http://localhost`; keine Wildcards, niemals `null`. Leer erlaubt nur den kanonischen Web-Origin und direkte Requests ohne Origin.

Der tatsächliche `Host` muss zum kanonischen öffentlichen Origin passen. Der Reverse-Proxy muss diesen Host erhalten; `X-Forwarded-Host` wird absichtlich nicht als Ersatz vertraut (DNS-Rebinding). CORS nur für freigegebene Origins, ohne Credentials-Freigabe. JSON-Schreibzugriffe verlangen den Versionsheader und `application/json` (optional `charset=utf-8`); HTML-Form-/Text- und komprimierte Bodies sind nicht erlaubt. Native Origin-/TLS-Verhalten auf echten Android-/iOS-Geräten ist später noch zu prüfen.

Alle Fachantworten: `Cache-Control: no-store`, `Vary: Origin`, `X-Content-Type-Options: nosniff`. Logs enthalten ausschließlich feste Fehlercodes, keine Bodies/SQL/Credentials. Aktuelle Fachstände in Konfliktantworten sind dagegen gewollt für die manuelle Auflösung.

## Vertrag und Endpunkte

Typen: `shared/domain/{server,protocol}.ts`. Außer Serverinfo verlangen alle Endpunkte `X-Munchling-Protocol: 1`. Alle UUIDs sind kanonisch kleingeschrieben. Numerische SQLite-/`view_id`-Werte sind **keine** Wire-Identitäten.

| Methode/Pfad | Eingabe | Ergebnis |
| --- | --- | --- |
| `GET /api/sync/info` | kein Versionsheader nötig | Protokoll-/Schemaversion, Instanz/Epoch, beratender letzter Cursor, Entitätszahlen, Fähigkeiten und Limits |
| `POST /api/sync/push` | `ServerWriteBatch` als JSON | `ServerReceipt`, vollständiger Batch oder keine Änderung |
| `POST /api/sync/snapshots` | `{serverInstanceId, serverEpoch, targetBytes?}` | Seite 0 eines dauerhaft zwischengespeicherten konsistenten Bestands |
| `GET /api/sync/snapshots/:id` | Query: Instanz/Epoch, `page` (ab 0) | dieselbe unveränderliche Snapshot-Seite bis Ablauf/Freigabe |
| `DELETE /api/sync/snapshots/:id` | Query: Instanz/Epoch | `{released:true}`; idempotente Freigabe nach erfolgreicher lokaler Übernahme |
| `GET /api/sync/changes` | Query: Instanz/Epoch, `cursor`, `limit?`, `targetBytes?` | vollständige `ChangeBatch`-Gruppen, Fortschrittscursor und High-Water-Marke |
| `GET /api/sync/deletion-preview` | Query: Instanz/Epoch, `entity`, `id` | konsistente aktuelle Root-/Abhängigkeitsstände für bestätigte Löschguards |

Browser-/Native-Preflight erlaubt nur GET, POST, DELETE und die Header Content-Type/X-Munchling-Protocol. OPTIONS wird vor dem Nitro-Routing behandelt, damit es nicht versehentlich in die SPA-Ausgabe fällt.

## Push und bewusste Konfliktauflösung

Beispielstruktur (Payload-Felder siehe vollständige Fach-Snapshots):

```json
{
  "batchId": "<stabile UUID>",
  "serverInstanceId": "<UUID aus gespeicherter Bindung>",
  "serverEpoch": "<UUID aus gespeicherter Bindung>",
  "deviceId": "<optionale Geräte-UUID>",
  "operations": [{
    "operationId": "<stabile UUID>",
    "entity": "recipes",
    "entityUuid": "<Gericht-UUID>",
    "baseRevision": 3,
    "operation": "upsert",
    "payload": "<vollständiges Objekt mit Zutaten und UUID-Referenzen>"
  }],
  "guards": [{ "entity": "meal_logs", "entityUuid": "<UUID>", "baseRevision": 7 }]
}
```

`payload` ist tatsächlich ein Objekt, kein String. `upsert` ist ein vollständiger Ersatz, keine partielle Feldänderung. Delete-Payload: `{id:<UUID>, deleted_at?:<technischer Zeitpunkt>}`; der Server versieht Tombstones mit seiner UTC-Zeit. Technische Zeitpunkte sind UTC; das historische `logged_at`-Literal bleibt unverändert.

Neue UUIDs erwarten Basisrevision 0. Bestehende (auch gelöschte) Roots erwarten ihre tatsächlich bearbeitete Revision. Kinder-UUIDs dürfen den Aggregatbesitzer nicht wechseln. Neue Referenz-Eltern dürfen im selben Batch stehen; Root-/Kinderanwendung und finale Rezeptgraphprüfung erfolgen gemeinsam.

Transport-Retry: **derselbe** Inhalt mit denselben Batch-/Operations-IDs. Ein bereits bestätigter Batch gibt das ursprüngliche Receipt erneut zurück, ohne weitere Cursor/Versionen. Geänderte bestätigte Inhalte/anders wiederverwendete Operations-IDs werden abgewiesen. HTTP-Abbruch/fehlende Antwort ist keine Ablehnung eines möglicherweise schon committed Batches.

Bei 409 erfolgt keine automatische Versionsanpassung. Die Oberfläche vergleicht Basis/lokal/Server und lässt den Nutzer entscheiden. Danach eine neue Operation mit der bewusst gewählten vollständigen Version und der nun bekannten aktuellen Basisrevision senden. Wenn jemand zwischenzeitlich weiter editiert, erneut Konflikt. Bewusste Wiederanlage nach Löschung ebenfalls explizit und versionsgeprüft.

Löschungen brauchen sämtliche aktuellen abhängigen Roots als eigene Operationen oder `guards`. Eine Vorschau ist keine reservierte Löschfreigabe: neu angelegte/geänderte Abhängigkeiten zwischen Vorschau und Push erzeugen weiterhin `dependencyConflict`. Keine stillen Kaskaden an unbekannten Mahlzeiten/Gerichten. Details: [server-foundation.md](server-foundation.md).

Erfolgreiches Receipt ordnet jede Operation eindeutig ihrer Serverrevision zu und benennt zusätzlich kaskadierend geänderte Roots. Ein abgewiesener Batch hat **keine** erfolgreichen Teiloperationen; nichts quittieren, lokale Outbox unverändert lassen.

## Initialsnapshot: Staging statt laufender Live-Pages

MariaDB-Migration **v2** ergänzt nur Snapshot-Mutex, Manifest und Seiten; v1-Prüfsumme/Fachdaten/Instanz bleiben unverändert. Die Erstellung öffnet eine Repeatable-Read-Sicht durch den ersten State-Read. Alle Roots und die komplette UUID-Registry (auch gelöschte Kinder mit Aggregatzuordnung) gehören genau zu diesem Cursor. Fach-Writer werden dabei **nicht** auf dem Haushalts-Lock blockiert; ein getrennter Mutex schützt lediglich Snapshot-Quoten.

Alle Seiten werden in derselben Transaktion dauerhaft gespeichert. Erst nach Commit wird Seite 0 ausgeliefert. Bei einem Fehler verschwinden Manifest und bereits geschriebene Seiten gemeinsam. Weitere Requests lesen die gespeicherten Fragmente, nicht inzwischen veränderte Fachzeilen. Auch andere Node-Instanzen/neu geöffnete Pools können den Download fortsetzen.

Eine Seite enthält `snapshotId`, Instanz/Epoch, konstanten Cut-`cursor`, `expiresAt`, `page`, `pageCount`, `nextPage`, `aggregates` und `identities`. Roots mit aktiven Kindern und Registry-Zeilen können auf getrennten Seiten stehen. **Alle Seiten zunächst stagen**; nicht erste Roots mit fehlenden Referenz-Eltern sichtbar aktivieren. Erst nach vollständigem Download und konfliktbewusster Bestandszusammenführung atomar lokal übernehmen und den Cut-Cursor speichern. Dann seit diesem Cursor pullen: während Download/Übernahme entstandene Änderungen gehen so nicht verloren.

Snapshot-Erstellung selbst ist derzeit kein idempotenter Push: geht die erste POST-Antwort verloren, kann ein begrenzter Wiederholungsversuch eine weitere Lease erzeugen. Nicht in enger Schleife neu anfordern; die Haushaltsquote und 30-Minuten-TTL gelten auch dafür. Sobald Seite 0 bekannt ist, weitere Seiten über denselben Token wiederholen, nicht einen neuen Live-Snapshot erzeugen.

Nach erfolgreicher Übernahme mit DELETE freigeben; sonst läuft das Snapshot-Lease nach 30 Minuten aus. Niemals beim Lesen der letzten Seite automatisch löschen: deren Antwort könnte verloren gehen. Expiry/unbekannter Token: 410, neuen Snapshot beginnen; lokale Daten/Outbox nicht ungefragt ersetzen.

## Pull, atomare Gruppen und Cursor

Cursor sind kanonische Dezimalstrings im sicheren Ganzzahlbereich. Erlaubte Startpunkte: `"0"`, ein bekannter vollständiger Batch-Endcursor oder ein Snapshot-Cut. Mitten im Batch, Zukunft, Lücken/fehlende Logeinträge: 409 `cursorInvalid` mit Resync-Hinweis, **kein** stilles Springen zur aktuellen Marke.

Antwort: `fromCursor`, tatsächlich gelieferter Fortschritts-`cursor`, `highWaterCursor`, `hasMore`, vollständige `batches`. Jede Gruppe enthält Batch-ID, ersten/letzten Cursor und `{cursor, aggregate}`-Änderungen mit vollen Root-Snapshots bzw. Tombstones. Der High-Water-Cursor ist **keine** Erlaubnis, noch nicht heruntergeladene Änderungen zu überspringen.

Paging schneidet nie eine Gruppe auseinander. Auch Löschkaskaden und deren referenzierende Aggregate bleiben zusammen. Ein Client muss jede Gruppe auf lokale Pending-/Konfliktdaten einschließlich Referenzabhängigkeiten prüfen, Eltern passend materialisieren und Daten+Cursor gemeinsam committen. Erst danach nächsten Request starten. Pull-Replays nach Absturz sind versioniert/idempotent zu behandeln. Die vorhandene `applyRemoteTransaction()` allein ist noch **kein** konfliktbewusster Runner; Native-Anwendung folgt separat.

## Limits und Fehler

- Push: 25 MiB tatsächliche UTF-8-Bytes, 100.000 Roots/Kinder/Guards; 15 Sekunden Body-Empfangsdeadline. Deklarierten **und** tatsächlich empfangenen Body prüfen; ungültiges UTF-8 abweisen.
- Vollständige Change-Gruppe: 32 MiB einschließlich Framing-Reserve. Implizite Kaskaden zählen mit. Zu große Gruppen werden **vor Commit** vollständig abgewiesen; nicht erst später unübertragbar im Log ablegen.
- Ziel-Seitenbudget: 64 KiB–1 MiB, Standard 256 KiB. Größere einzelne Roots/Gruppen werden nicht zerlegt und dürfen dieses weiche Budget überschreiten, bis zum harten 32-MiB-Datengrenzwert (plus Antwort-Metadaten).
- Pull: Standard 10, maximal 100 komplette Batches, zusätzlich weiches Bytebudget.
- Snapshot: maximal 256 MiB gespeicherte Fragmente, 4.096 Seiten, 1.000.000 Root-/Registry-Einträge, vier gleichzeitige Leases pro Haushalt. Root- und Registry-Einträge zählen separat. Größen-/Seitenfehler rollen die Erstellung vollständig zurück. Abgelaufene temporäre Seiten werden beim nächsten Erstellen gelöscht; freigegebene sofort.
- MariaDB `max_allowed_packet >= 64 MiB`; Reverse-Proxy muss die Body-/Antwortgrenzen und geeignete Request-Zeitlimits unterstützen. Keine Garantie beliebig großer/unbegrenzter Haushalte.

Fehlerformat: `{error:{code,resync,retryable,field?,current?}}`. SQL-/Stackdetails werden nicht ausgegeben.

| HTTP | Code/Gruppe | Verhalten |
| --- | --- | --- |
| 400/415/413/408 | invalidRequest, INVALID_JSON, JSON_REQUIRED, BODY_TOO_LARGE, REQUEST_TIMEOUT | Request korrigieren; bei unklarem Commit nur stabilen Push wiederholen |
| 403 | ORIGIN_DENIED | Netzwerk-/Host-/Origin-Konfiguration prüfen |
| 422 | Domain-Validierungsfehler | lokal korrigieren; nichts quittieren |
| 409 | versionConflict/dependencyConflict/identityConflict/idempotencyConflict | bewusst lösen; keine automatische Überschreibung |
| 409 | serverChanged/cursorInvalid (`resync:true`) | gespeicherte Bindung/Bestand abgleichen; nicht blind neue Epoch/Cursor übernehmen |
| 410 | snapshotExpired (`resync:true`) | Snapshot neu starten, lokale Pending-Daten bewahren |
| 426 | protocolMismatch | kompatiblen Client verwenden; kein stilles Downgrade |
| 429 | snapshotBusy | Retry-After 60 s, fertige Leases freigeben |
| 413 | batchTooLarge/snapshotLimit | begrenzen/segmentieren; Abhängigkeiten und manuelle Freigaben erhalten |
| 503 | API_NOT_CONFIGURED/DB_READ_FAILED/DB_WRITE_FAILED/DB_UNAVAILABLE | feste Fehlercodes, keine SQL-/Credentials; begrenztes Backoff, Push-IDs bewahren |

## Restore, Aufbewahrung und Wartung

**MariaDB-Backup-Restore ist ein Historienwechsel**, kein gewöhnlicher Redeploy. Ein Client könnte bereits Operationen bestätigt haben, die im älteren DB-Backup fehlen. Deshalb nach jedem Restore vor erneutem Client-Zugriff die Sync-Epoch wechseln; nicht nur auf einen möglicherweise höheren Clientcursor hoffen.

1. Alle App-/Serverinstanzen und Schreibzugriffe stoppen, aktuelles externes Sicherheitsbackup erstellen.
2. DB-Backup wiederherstellen und Schema/Migrationsmarker prüfen.
3. In einer vertrauenswürdigen administrativen MariaDB-Sitzung im richtigen Schema:

```sql
START TRANSACTION;
SELECT instance_uuid, epoch_uuid, last_cursor FROM server_state WHERE id=1 FOR UPDATE;
UPDATE server_state SET epoch_uuid=UUID() WHERE id=1;
DELETE FROM sync_snapshots;
COMMIT;
```

Danach kontrollieren: genau eine State-Zeile aktualisiert, neue Epoch, Instanz/Revisionen/Cursor nicht zurückgesetzt. Server mit passenden Migrationen starten/Readiness prüfen; Clients müssen kontrolliert neu abgleichen und eigene lokale Änderungen bewahren.

`server/database/epoch.ts` bietet die interne, getestete UUID-basierte Epoch-Rotation ebenfalls; **keinen** unauthentifizierten administrativen HTTP-Endpunkt. Instanzwechsel/alte Epoch werden in Push, Pull und Snapshot-Seiten abgewiesen. Ein normaler Neustart rotiert nichts. Der Native-Reconciliation-Dialog kommt noch.

Fach-Tombstones, `sync_identities`, Change-Log, Operations und bestätigte Batches werden derzeit **unbefristet** aufbewahrt. Kein Cleanup anhand ungesicherter Geräte-Push-Cursor. Späterer Fach-Cleanup braucht ausdrücklich einen Retention-Watermark, Snapshot-/Resync für alte Geräte und Erhaltung globaler UUID-Ownership; nicht mit temporären Snapshot-Seiten verwechseln.

## Verifikation

`pnpm test:server` baut den echten Nitro-Prozess und testet mit einer isolierten MariaDB 11.4. Geprüft: v1→v2 ohne Fachverlust, RR-Cut bei gleichzeitiger Änderung, paginierter Wiederanlauf über neue Pools, Registry-/Kinder-Tombstones, Ablauf/Freigabe/Quoten/partielle Snapshot-Rollbacks, Cursorgrenzen, vollständige Gruppen und übergroße Kaskaden-Rollbacks. HTTP-Tests prüfen zwei unabhängige/veraltete/gleichzeitige Bearbeiter, manuelle Neuentscheidung, idempotenten Push, echte Origin/Host/Preflight- und Byte-/UTF-8-Sicherheitsgrenzen sowie datensparsame Fehler.

Gezielt nach einem Backend-Build: `node scripts/test-server-db.mjs tests/server/http.test.ts`. Der Harness akzeptiert nur explizite `tests/server/*.test.ts`-Filter und weiterhin keine Produktionsdatenbank.
