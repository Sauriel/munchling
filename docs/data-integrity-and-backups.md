# Datensicherheit, Synchronisation und Sicherungen

## Daten und Identitäten

Nativ/offline liegen Fachdaten in SQLite, Online-Fachdaten in MariaDB. Stand: SQLite9, MariaDB5, Backup5, HTTP1. Server/Client müssen denselben unterstützten Sync-Schemastand verwenden; die HTTP-Protokollversion allein reicht nicht.

UUIDs identifizieren Daten geräteübergreifend; numerische IDs sind lokale Aliase. Änderungen an Root/Kinder/Registry/Outbox sind atomar. Empfang erzeugt keine Echo-Outbox. Globale Ownership, Löschmarker und ursprüngliche Historienwerte dürfen nicht durch Merge/Restore still ersetzt werden.

Gemeinsame Validierung in `shared/domain/validation.ts`: endliche gültige Zahlen, existierende Referenzen, eindeutige EANs/Profilportionen und azyklische Gerichte. Neue Profil-/manuelle Ziele sind positiv; ältere Nullplatzhalter bleiben lesbar. Portionsgrammwerte sind positiv. Datierte Kalorienereignisse sind unveränderliche Profilkinder mit ursprünglichem JSON, Sequenz, Gültigkeitstag und UTC-Erfassungszeit; neue Gewicht-/Zielstände verändern keine früheren Ziele. Das manuelle Ziel bleibt vom Automatikmodus unabhängig.

Aktivitätsbuchungen speichern ihre damaligen Vorlagenwerte. Mahlzeitportionen bleiben gespeichert, Nährwertberechnung verwendet dagegen weiterhin aktuelle Lebensmittel-/Gerichtwerte; das sind keine unveränderlichen Nährwert-Snapshots.

## Lokaler Fachbackup v5

**Einstellungen → Lokale Datensicherung** exportiert validiertes JSON (`format: munchling-backup`, Version5, SQLite-Schema9). Enthalten sind Profile, Lebensmittel, Gerichte/Zutaten, Mahlzeiten/Profilportionen, Aktivitäten/Tagesbuchungen und Profil-Kalorienhistorie sowie UUID-Identitäten und Löschmarker. Vorhandene IDs, ursprüngliche Historien-JSON-Daten und exakte gespeicherte Portionsfaktoren bleiben erhalten.

Versionen1–4 bleiben importierbar. Alte v1-Daten bekommen neue UUIDs; bestehende UUIDs späterer Versionen bleiben erhalten. Legacy-Daten ohne Ziel-/Gewichtshistorie erhalten keine erfundenen historischen Fakten. Import ist keine Rückmigration der App.

Nicht enthalten: BLS-Katalog, Suchindex, Formularentwürfe, lokale Geräte-/Automatik-/UI-Einstellungen, Serverbindung, Geräte-ID, Cursor und Upload-/Receipt-Journale. Ein Fachbackup ist daher **kein vollständiges SQLite-/Sync-Recovery-Abbild**.

Importgrenzen: 25MiB, insgesamt 100.000 Fachzeilen/Löschmarker. Format/Versionen, Pflichtarrays, UUIDs, Referenzen, EANs, Zahlen/Datum und Rezeptgraph werden vor Schreiben geprüft. JSON führt kein SQL aus. Fehlende Pflichtarrays sind nicht leer; eine ausdrücklich bestätigte leere Sicherung leert dagegen den lokalen Fachbestand.

## Restore und Sicherheitskopien

1. Datei validieren und Vorschau zeigen.
2. Ausdrücklich bestätigen: lokalen Bestand ersetzen, **nicht zusammenführen**.
3. Vor jeder destruktiven Änderung einen konsistenten bisherigen Fachbestand separat als Sicherheitssicherung speichern; Speicherfehler verhindern Restore.
4. Daten/Metadaten in einer referenzsicheren Transaktion ersetzen; SQL-Fehler rollen zurück.
5. Lokale Epoch erneuern und Serverbindung/Einwilligung/Automatik nicht still übernehmen. Ein neuer Erstabgleich ist erforderlich; der lokale Restore ersetzt niemals den Server.

Ungewisse Uploads und verlorene Receipts müssen zuerst geklärt werden. Originalrequests nicht löschen, umschreiben oder unter neuer Bindung erneut verwenden. Im Zweifel vollständige private Datenbankdateien samt Journaldaten extern sichern und den unklaren Zustand erhalten.

Automatische Restore-Sicherheitsdatei: `backups/before-restore.json` im privaten App-Dateisystem; letzte Kopie ist in Einstellungen exportierbar. Vor dem ursprünglichen gefüllten v1→v2-Upgrade entsteht zusätzlich `backups/before-schema-v2.json`. Beide sind **lokal** und überstehen eine Deinstallation nicht zuverlässig.

Exporte sind unverschlüsselt und enthalten persönliche Ernährungs-/Gewichtsdaten. Externe Kopien geschützt aufbewahren. Vor App-Update/Migration eine frische unabhängige Kopie erstellen, nicht ausschließlich auf dieselbe App oder eine alte Sicherung verlassen. Wiederherstellung auf einem isolierten Bestand prüfen.

## Sync, Konflikte und Löschungen

Native Sync erfordert zunächst eine bewusst gewählte sichere Adresse/Vertrauensfreigabe und einen ausdrücklichen Erstabgleich. Download/Staging alleine ist keine lokale Übernahme und kein Upload. Daten erst nach vollständigem Snapshot, Identitäts-/Konfliktprüfung und Safety-Kopie übernehmen.

Versionierte Outbox/Journale und unveränderliche Requestbytes erlauben Receipt-Replay nach unklarer Antwort. Kein automatischer Merge, Überschreiben oder Rebase. Entscheidungen prüfen den aktuellen Serverstand erneut und schützen akzeptierte Profilhistorie. Verworfenes Offline-Material kann als unabhängige Sicherung erhalten werden.

Automatik bei Start/Rückkehr ist getrennt pro Gerät, standardmäßig aus, an Adresse/Einwilligung/Bindung/Epochen gebunden und kein Teil von Fachbackup/Sync. Sie arbeitet nur auf Dashboard-Routen; Navigation zu Editoren bricht ab und wartet, ohne Formularentwürfe still zu löschen.

Web-Schreibvorgänge verwenden versionierte Journale/Receipts und Web Locks. Konflikte zeigen Basis, Entwurf und Serverstand; unbekannte Basis wird nicht erfunden. Neue geschützte Löschkaskaden prüfen auch indirekte historische Bezüge. Registrierter Lebensmittel-Merge ist ausdrücklich, nur bei gleichen Nährwerten, ohne historische Portions-/UUID-Ersetzung oder automatische Namens-/EAN-Zusammenführung.

## MariaDB-Backup und Restore

Vollständige SQL-Backups müssen neben Fachdaten Registry, Receipts/Operations, Change-Log, State und Migrationsmarker enthalten. Ein API-Snapshot ist nur ein konsistenter Fach-/Identitätscheckpoint, **kein vollständiges SQL-/Receipt-Backup**. Keine Produktionsdaten ins Repository/Image übernehmen.

Ein DB-Restore verändert die bestätigte Historie: Writer stoppen, externe Safety-Kopie erstellen, isoliert geprüften Backup wiederherstellen und **Server-Epoch vor erneutem Clientzugriff erneuern**. `server/database/epoch.ts` enthält die interne Rotation; kein unauthentifizierter Reset-Endpoint. Instanz/UUIDs/Revisionen nicht manuell neu zuordnen. Clients müssen bewusst neu abgleichen und unklare Journale bewahren.

Normales Redeploy rotiert weder Instanz noch Epoch und setzt keine Daten zurück. Rollback nur mit kompatiblem Schema; veröffentlichte Migrations-SQL/Prüfsummen bleiben unverändert.

Siehe [Betrieb](dokploy.md), [API-Vertrag](sync-api.md) und [Entwicklung](development.md).
