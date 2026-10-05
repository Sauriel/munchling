# Lokale UUID-/Sync-Grundlage (Schema v2)

Noch kein Netzwerk-Sync: MariaDB, HTTP-Adapter, Erstabgleich, Konfliktauflösung und Sync-Einstellungen folgen separat. Der lokale Betrieb bleibt offline-fähig und `enabled=0` ist der Standard.

## Identitäten und Zustände

Alle sechs Fachtabellen bekommen zusätzlich `uuid`, ohne numerische IDs oder Referenzen umzuschreiben. SQL erzeugt UUID-v4-Kennungen beim Backfill und bei späteren Inserts; Unique-Indizes, das globale Register und Unveränderlichkeits-Trigger schützen sie. UI/Repositories verwenden weiterhin lokale IDs.

- `sync_records`: UUID-zu-lokaler-ID-Auflösung, Aggregatzuordnung, monotone lokale Revision, bestätigte Serverrevision und Löschzeitpunkt. Gelöschte Zutaten/Portionen bleiben ebenfalls erfasst; keine automatische Tombstone-Bereinigung.
- `sync_state`: Geräte-ID, lokale Epoch, Serveradresse/-instanz, Cursor, Aktivierung und scoped Tracking-Modus. Eine lokale Epoch unterscheidet Datenbestände vor/nach einem Restore; Geräte-ID bleibt unverändert.
- `sync_baselines`: exakt bestätigter Operationsinhalt, nicht der möglicherweise inzwischen lokal weiter bearbeitete Datensatz.
- `sync_conflicts`: vorbereiteter Speicher für Basis-/Lokal-/Remote-Daten und Serverrevision. Noch kein Konfliktprozessor oder Dialog.
- `development_seeded`: automatisches Dev-Seeding schaltet Sync aus und markiert den Bestand. Eine DB-Constraint verhindert die Aktivierung solcher Installationen. Ein bewusst bestätigter Backup-Restore setzt einen neuen, ungebundenen Bestand auf; bei erneutem Dev-Seeding wird dieser wieder gesperrt.

## Atomarer Schreibpfad

Trigger aktualisieren das Register und markieren betroffene **Aggregate**, auch bei FK-Kaskaden. Das Register speichert den Aggregatbezug der Kinder, damit er selbst nach physischer Entfernung des Elternsatzes verfügbar bleibt.

`flushOutbox()` läuft im SQL-Executor **nach** allen Fachschritten und **vor** dem Commit. Pro verändertem Aggregat entsteht genau eine vollständige Operation mit der zu diesem Zeitpunkt bekannten Basisrevision (ungebundene neue Bestände zunächst `0`). Alle Operationen derselben Fachtransaktion haben dieselbe Batch-ID. Auch alleinstehende `run`-/`execute`-Aufrufe erhalten mit diesem Commit-Hook eine äußere Transaktion.

Die Outbox enthält Profile, Lebensmittel, Gerichte mit vollständigen Zutaten sowie Mahlzeiten mit vollständigen Profilportionen. Payloads verwenden derzeit die gespeicherten snake_case-Felder, aber `id` und sämtliche Fremdschlüssel sind UUIDs, keine lokalen IDs. Das ist ein interner Snapshot, noch kein endgültiger öffentlicher HTTP-Vertrag. Gelöschte Aggregate enthalten UUID und Löschzeitpunkt; entfernte Kinder werden durch vollständigen Aggregatersatz auf dem späteren Server erkannt.

Ein Fehler beim Snapshot/Outbox-Schreiben rollt Fachänderungen ebenfalls zurück. Die Browser-Persistierung erfolgt nach dem SQL-Commit; ein anschließender Speicherfehler kann nicht zurückgerollt werden. Fachstand und Queue bleiben innerhalb der SQLite-Datenbank zusammen.

## Dauerhafte Queue und Wiederanlauf

Lokale Änderungen werden auch bei ausgeschaltetem Sync protokolliert. Es gibt noch keine automatische Verdichtung oder Größenbereinigung; mehrere Transaktionen bleiben als getrennte, geordnete Batches erhalten.

`createSyncQueue()` stellt einen lokalen Queue-Vertrag bereit:

1. `list()` liest alle vorgemerkten Operationen.
2. `claimNextBatch()` reserviert nur den ältesten Batch und speichert `inflight` atomar. Bereits erfasste Basisrevisionen bleiben unverändert: eine inzwischen beobachtete Remote-Version darf einen lokalen Konflikt nicht durch stilles Rebasing verdecken.
3. Solange dieser Batch unbestätigt ist, liefert jeder erneute Claim dieselben IDs, Basisrevisionen und Payloads, auch nach einem Neustart. Spätere lokale Bearbeitungen erzeugen neue Operationen, statt einen eventuell bereits versendeten Request zu verändern.
4. `acknowledgeBatch()` verlangt vollständige, eindeutige Receipts für alle Operationen und jeweils eine höhere sichere Serverrevision. Erst dann werden Basisstände/Serverrevisionen übernommen und die bestätigten Queue-Zeilen entfernt, gemeinsam in einer Transaktion. Ältere Receipts dürfen bekannte Serverrevisionen nicht zurücksetzen.
5. Nur die Bestätigung eines eigenen lokalen Vorgängers aktualisiert Basisrevisionen der späteren Pending-Operationen derselben UUID; neue Remote-Versionen tun das nicht. Eine wiederholte Bestätigung eines bereits entfernten Batches ist wirkungslos.

Der zukünftige Transport muss atomare Batches unterstützen und Idempotenz gegen diese stabilen Batch-/Operations-IDs garantieren. Bei Timeout wird der unveränderte In-flight-Batch wiederholt, niemals blind als bestätigt behandelt. Erstabgleich, Konfliktbehandlung und Server-Epoch-Wechsel müssen vor realen Uploads implementiert werden.

## Eingehende Änderungen und Restore

`applyRemoteTransaction()` unterdrückt Echo-Operationen, ohne Identitätsregister/Löschmarker zu verlieren. Scheitert die Transaktion, wird auch der Tracking-Schalter zurückgerollt. Die Funktion ist nur ein **Low-Level-Werkzeug**: ein späterer Pull-Prozessor muss vorher UUIDs/Referenzen auflösen, lokale Pending-Änderungen prüfen und Konflikte sichern. Sie ist keine Erlaubnis, lokale Bearbeitungen ungeprüft zu überschreiben.

Ein Backup-Restore ersetzt ausschließlich den lokalen Bestand. Er entfernt alte Operations-IDs, Basisstände und Konflikte, trennt die Serverbindung und erneuert die lokale Epoch. Globale UUIDs/Tombstones bleiben bei v2 erhalten; v1 bekommt neue UUIDs. Der neue vollständige Snapshot bleibt lokal vorgemerkt, bis ein expliziter Erstabgleich erlaubt ist. Alte Serverantworten können keine entfernten Batches quittieren. Ein zukünftiger Sync-Runner muss vor jedem Request/Receipt außerdem Aktivierung, Serverinstanz und lokale Epoch überprüfen.

Details: [data-integrity-and-backups.md](data-integrity-and-backups.md).

## Nachweise und Grenzen

- Gefüllte v1-Datenbank mit allen sechs Tabellen: Fachwerte/IDs erhalten, globale UUIDs, Initialbatch und unveränderter Wiederanlauf.
- Fehlgeschlagene Sicherheitsdatei, DDL-/Migrationsmarker-/Outbox-Fehler: Rollback und erfolgreicher erneuter Versuch; Neustart aus gespeicherten SQLite-Bytes.
- CRUD, vollständige Aggregate, Food-/Profile-Löschkaskaden, Queue-Schreibfehler und Remote-Echo-Unterdrückung.
- In-flight-Wiederanlauf, ungültige Receipts, bestätigte Basisstände trotz weiterer lokaler Bearbeitung.
- v1-/v2-Restore, UUID-/Tombstone-Prüfungen, Bindungs-/Queue-Reset und gemeinsamer Metadaten-Rollback.
- Chromium-Smoke-Test mit tatsächlichem `jeep-sqlite`: v2-UUIDs und v1-Import einschließlich Reload.

Native Laufzeittests auf Android/iOS bleiben erforderlich; Android-Kompilation ersetzt sie nicht. Der finale Sync-/HTTP-Vertrag und echte MariaDB-Integration werden in den folgenden Phasen getestet.
