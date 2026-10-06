# Client-Transport: geprüfte Antworten, noch keine lokale Übernahme

`app/utils/sync/http.ts` stellt `createSyncHttpClient()` bereit. Er ist weder beim App-Start noch in Pages eingebunden: Konstruktion führt keine Requests aus. SQLite, Outbox, Cursor und Einstellungen werden nicht geändert, Sync bleibt optional und ausgeschaltet. Web-HTTP-Datenadapter und Native-Runner folgen weiterhin.

## Transport

- Nur explizite HTTP(S)-Origins; keine Zugangsdaten, Pfadpräfixe, Query- oder Fragmentbestandteile in der Serveradresse. HTTPS empfohlen, HTTP nur im genehmigten sicheren Netzwerk.
- Serverinfo, Push, Pull, Snapshot-Erstellung/Seiten und ausdrückliche Freigabe. Protokollheader v1, keine Cookies/Credentials, Redirects verboten, keine Referrer-/Response-Caches.
- Deadline über Request **und** Body-Empfang; externe Abbruchsignale werden berücksichtigt. Standard 30 Sekunden, konfigurierbar bis 120 Sekunden. Keine automatischen Retries, Rebase oder Epoch-Übernahme.
- Request-Bytes begrenzt, Responses inkrementell gelesen; deklarierte und tatsächliche Bytes begrenzt auf 32 MiB plus 64 KiB Framing. Auch Konflikte dürfen vollständige Aggregate liefern. Striktes UTF-8/JSON; HTML/Login-/Proxyseiten werden nicht als Fachstand akzeptiert.
- Sanitierte `SyncClientError`-Codes ohne Roh-URLs, Netzwerk-/SQL-/Stackdetails. Gültige Konflikte enthalten ihren aktuellen Root-Stand zur späteren manuellen Entscheidung.

## Gemeinsame Decoder

`shared/domain/server-validation.ts` enthält nun die bisher serverseitigen vollständigen Payload-Regeln ohne Datenbank-/Node-Abhängigkeiten. `wire-columns.ts` definiert lediglich v1-Feldnamen. Der Server reexportiert denselben Validator; eine MariaDB-Testprüfung gleicht die Wire-Feldlisten mit dem unveränderten SQL-Manifest ab. Migrationen/Prüfsummen wurden nicht geändert.

`shared/domain/replies.ts` prüft insbesondere:

- Bekannte Protokoll-/Schemaversion und Fähigkeiten/Limits, Instanz/Epoch und kanonische Cursor.
- Vollständige Fachpayloads, UUIDs, Zahlen, Flags, Kinderbesitzer/-duplikate, Datumsangaben und Tombstones. Historische `logged_at`-Literale bleiben unverändert.
- Snapshot-ID, Cut-Cursor, Seitenanzahl, Ablaufzeit und lückenlose Seitenfolge; unveränderliche Metadaten über sämtliche Requests.
- Pull-Gruppen mit eindeutigen Batch-IDs, lückenlosen einzelnen Cursorn, eindeutigen Roots innerhalb einer Gruppe und steigenden Revisionen. Kein Fortschritt anhand einer bloßen High-Water-Marke.
- Receipts gehören exakt zum angefragten Batch und jeder Operation/Root-Art/-UUID. Revisionen müssen über deren tatsächlicher Basis liegen; `changes` muss die bestätigten Root-Versionen einschließen. Ein unvollständiges Receipt darf nie zur Outbox-Quittierung gelangen.

## Snapshot-Staging ist noch kein Sync

`snapshotPages()` liefert einen Async-Iterator geprüfter Seiten, prüft zusätzliche Duplicate-/Gesamtgrößen-/Zahlengrenzen und gibt das Lease **nicht** automatisch frei. Seiten sind nur Staging-Eingabe; vollständige Referenzgraphen dürfen nicht durch einzelne früh sichtbare Seiten ersetzt werden.

Ein optionaler Resume-Frame ermöglicht das Weiterladen nach bereits erhaltenen Seiten. Der zukünftige persistente Staging-Dienst muss dabei auch die vor dem Resume gespeicherten Seiten sowie globale Registry-/Referenzkonsistenz validieren. Der Transport allein behauptet diese Datenbank-Abnahme nicht.

**Noch offen:** persistentes Staging mit lokaler Epoch-Bindung, UUID→numerische-ID-Abbildung, globale Referenz-/EAN-Prüfung, konfliktbewusste Bestandszusammenführung, lokale atomare Daten+Cursor-Anwendung, UI-Konflikte und Single-Flight-Trigger. `applyRemoteTransaction()` weiterhin nicht ungeprüft verwenden. Lokale Änderungen niemals gegen den aktuellen Serverstand automatisch rebasen.

Nur Instanz/Epoch erscheinen in Bindungs-Querystrings; ein Snapshot-Objekt darf dort keine Payloads/Profilnamen serialisieren. Push friert seine normalisierte Anfrage vor dem Fetch ein; Caller-Retry nutzt persistierte identische IDs/Inhalte. Nach Netzwerkverlust ist ein Commit möglicherweise schon erfolgt.

## Prüfungen

153 lokale Domain-/SQLite-/Client-Tests und 77 MariaDB-/Nitro-Tests bestanden, darunter der **produktive Client gegen tatsächliche Nitro-Antworten** (Info, Push/Replays, Snapshot, Pull und Freigabe). Beide Typprüfungen, Backend-/Mobile-Build und Chromium-Smoke-Test erfolgreich. Kein neuer Native-Gerätelaufzeittest; Sync wird noch nicht in Android/iOS ausgelöst.

Vertrag und serverseitige Sicherheitsgrenzen: [sync-api.md](sync-api.md). Native-/lokale Grundlagen: [local-sync-foundation.md](local-sync-foundation.md).
