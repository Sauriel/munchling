# Datenvalidierung und lokale Sicherungen

## Gemeinsame Fachregeln

Die Regeln liegen in `shared/domain/validation.ts`, ohne Nuxt-, Capacitor- oder SQL-Abhängigkeiten. Die lokalen Repositories wenden sie auch bei direkten Service-Aufrufen an; eine zukünftige Server-API soll dieselben Funktionen verwenden.

| Daten | Regeln |
| --- | --- |
| Profile | Name nicht leer; Kalorienziel ganzzahlig, endlich und nicht negativ; optionale Nährwertziele `null` oder endliche, nichtnegative Zahlen |
| Lebensmittel | DE-/EN-Name nicht leer; alle Nährwerte endlich und nicht negativ; Marke/EAN optional; Flags echte Booleans |
| EAN | Optionale leere Texte werden zu `null`; ansonsten eindeutig im gespeicherten Lebensmittelbestand. Prüfung und Schreiben in derselben Transaktion; DB-Unique-Constraint bleibt zusätzliche Absicherung |
| Gerichte | DE-/EN-Name nicht leer; Beschreibung optional; Untergericht-Flag boolean; Zutaten dürfen leer sein |
| Zutaten | Genau ein Lebensmittel oder Untergericht, existierende Referenz, positive endliche Grammmenge |
| Rezeptgraph | Keine direkte oder indirekte Selbstreferenz; mehrfach verwendete Untergerichte sind erlaubt. Prüfung innerhalb der Schreibtransaktion, mit Rollback bei Konflikt |
| Mahlzeiten | Genau ein existierendes Lebensmittel oder Gericht; mindestens eine positive Profilportion; keine doppelte Profilzuordnung |
| Portionen | Gültige vorhandene Profil-ID; Grammmenge positiv und endlich; Gesamtgewicht bleibt nach Rundung auf zwei Nachkommastellen positiv und endlich |
| IDs | Positive, sichere ganze Zahlen |
| Zeitpunkte | Gültige Kalenderdaten mit Uhrzeit; SQLite-Zeitstempel, datetime-local sowie ISO mit optionalem Offset werden akzeptiert; unmögliche Kalenderdaten werden abgewiesen |

Teilupdates prüfen nur tatsächlich übergebene Felder. Explizites `null` ist bei nullable Feldern zulässig, aber nicht bei obligatorischen Nährwerten. Validierungsfehler haben einen stabilen Code und Feldnamen (`DomainValidationError`) und werden in den Formularen auf Deutsch/Englisch angezeigt.

Die Berechnung historischer Nährwerte bleibt dynamisch. Die Validierung führt keine historischen Nährwert-Snapshots ein und verändert keine bereits gespeicherten Daten.

## Backup-Format v2 und v1-Kompatibilität

`shared/domain/backup.ts` definiert und validiert das JSON-Format:

```json
{
  "format": "munchling-backup",
  "version": 2,
  "schemaVersion": 2,
  "exportedAt": "2026-10-05T12:00:00.000Z",
  "data": {
    "profiles": [],
    "foods": [],
    "recipes": [],
    "recipeIngredients": [],
    "mealLogs": [],
    "mealLogProfiles": []
  },
  "identities": [],
  "tombstones": []
}
```

Die Arrays enthalten die gespeicherten Fachdaten mit camelCase-Feldnamen. IDs, sämtliche Profilziele, optionale Werte, Flags, Zeitstempel, Zutaten, Gewichte und die **exakten gespeicherten Portionsfaktoren** bleiben erhalten. Mahlzeiten enthalten gespeicherte Felder, nicht abgeleitete Quellnamen oder berechnete Nährwerte.

`identities` ordnet jede aktive Zeile einer globalen UUID zu: `{ entity, localId, uuid }`, mit den sechs SQLite-Tabellennamen als `entity`. `tombstones` bewahrt Löschungen einschließlich früherer Zutaten/Portionen: `{ entity, uuid, aggregateEntity, aggregateUuid, deletedAt }`. UUIDs sind kanonisch kleingeschrieben, global eindeutig und dürfen nicht zugleich aktiv und gelöscht sein. Jeder Löschmarker muss auf ein bekanntes aktives oder gelöschtes Aggregat zeigen.

Alte Sicherungen mit **version/schemaVersion 1** werden weiterhin akzeptiert. Ihre numerischen IDs und Fachwerte bleiben unverändert; für jede Zeile wird eine neue UUID erzeugt. V2-Sicherungen erhalten vorhandene UUIDs und Löschmarker. Wiederherstellen einer v1-Datei ist keine Rückmigration der Datenbank: das aktuelle Schema bleibt v2.

Nicht enthalten sind: Migrationstabellen, interne SQLite-Sequenzen, Geräte-/UI-Einstellungen, Geräte-ID, Serverbindung/Cursor, lokale und Serverversionen, Outbox-Operations-/Batch-IDs, Basisstände, Konflikte, BLS-Katalog, Suche und Formularentwürfe. Der Restore setzt ID-Sequenzen nicht zurück. Neue IDs liegen weiterhin oberhalb bisher verwendeter bzw. importierter IDs.

Der Import akzeptiert maximal **25 MiB und 100.000 Fachzeilen und Löschmarker insgesamt**. Fehlende Tabellen oder Pflichtfelder, inkompatible Versionen, ungültige Werte, doppelte IDs/EANs/Profilzuordnungen, ungültige Referenzen und Rezeptzyklen werden abgewiesen. Es wird niemals SQL aus einer Datei ausgeführt.

Leere Arrays sind ausdrücklich zulässig: eine bestätigte Wiederherstellung einer leeren Sicherung leert den lokalen Fachbestand. Fehlende Arrays werden dagegen nicht als leer interpretiert.

Durch das bisherige Löschen von Profilen können bestehende Mahlzeiten ohne oder mit weniger Profilzuordnungen existieren. Das Backup bewahrt diese gespeicherten Zustände und berechnet weder Gesamtgewichte noch Portionsfaktoren neu. Altdaten, die andere Fachregeln verletzen, können exportiert werden, müssen für einen Import aber erst korrigiert werden.

## Sicherer Wiederherstellungsablauf

1. JSON einlesen, Größen-/Versions-/Fachprüfungen durchführen; importierte Daten für den Restore kopieren.
2. Vorschau der enthaltenen Profile, Lebensmittel, Gerichte und Mahlzeiten anzeigen.
3. Explizite Bestätigung verlangen: **gesamten lokalen Bestand ersetzen, nicht zusammenführen**.
4. Exklusiven SQLite-Zugriff und gemeinsame Transaktion öffnen.
5. Den aktuellen Bestand konsistent als Sicherheitssicherung exportieren und separat speichern.
6. Erst nach erfolgreicher Speicherung die Fachtabellen in referenzsicherer Reihenfolge leeren und importieren.
7. Alte Outbox, Basisstände und Konflikte entfernen; Serverbindung/Cursor trennen, Sync ausschalten und die lokale Epoch erneuern. Geräte-ID bleibt gerätebezogen erhalten. Aktive Aggregate und importierte Aggregat-Löschmarker werden als ein neuer Snapshot-Batch vorgemerkt. Verbindungen dürfen später nur nach explizitem Erstabgleich wiederhergestellt werden.
8. Bei SQL-Fehlern **Fachdaten und alle Sync-Metadaten** vollständig zurückrollen; bei Erfolg gemeinsam committen und den Browser-Store persistieren.
9. UI-Daten aktualisieren und das aktive Profil neu initialisieren.

Ein Fehler beim Speichern der Sicherheitssicherung verhindert die Wiederherstellung. Ein Persistenzfehler **nach** erfolgreichem SQL-Commit ist nicht rückrollbar; dafür steht ebenfalls die vorher gespeicherte Sicherheitssicherung bereit.

`restoreBackup()` verlangt einen Safety-Writer-Callback. Dieser darf innerhalb des Callbacks nicht erneut die globale, bereits gesperrte Datenbank verwenden. Die App verwendet ausschließlich die separate Dateisystem-Speicherung.

## Speicherung und Datenschutz

- Native Exporte: JSON-Datei im Cache und nativer Teilen-Dialog über Capacitor Filesystem/Share.
- Browser-Exporte: JSON-Download; der Browser bestimmt den Zielort. Das Auslösen eines Downloads garantiert nicht, dass die Person die Datei dauerhaft außerhalb des Geräts aufbewahrt.
- Automatische Sicherheitssicherung: `backups/before-restore.json` in `Directory.Data` (nativ app-privat, im Browser separate Filesystem-IndexedDB).
- Die jeweils letzte Sicherheitssicherung kann in den Einstellungen wieder exportiert werden. Ein weiterer Restore ersetzt sie durch den unmittelbar vorherigen Bestand.
- Vor Schema-v2-Upgrades: separate `backups/before-schema-v2.json` in `Directory.Data`. Nach erfolgreichem Upgrade kann diese Datei in den Einstellungen exportiert werden; sie überschreibt niemals die Restore-Sicherheitssicherung.
- Dateien sind **nicht verschlüsselt**. Sie enthalten persönliche Ernährungsdaten und müssen geschützt aufbewahrt werden.
- App-Deinstallation, Löschen der Browser-Sitedaten oder Geräteschäden können auch die lokale Sicherheitssicherung entfernen. Deshalb vor Migrationen zusätzlich eine externe Kopie exportieren.
- Online-Serveradapter bekommen diese lokale Restore-Fähigkeit nicht automatisch; der gemeinsame Serverbestand darf nicht über einen lokalen Browser-Restore ersetzt werden.

## SQLite-Migration v2

Vor Installation eines Updates zusätzlich extern exportieren. Beim ersten Start mit einem gefüllten v1-Bestand wird die unabhängige v1-Sicherheitssicherung **vor** allen Schemaänderungen gespeichert. Scheitert das Speichern, bleibt die Datenbank unverändert. Neue leere Installationen benötigen keine Vorabdatei.

DDL, UUID-Backfill, Identitätsregister, Trigger, Initial-Outbox und Migrationsmarker werden gemeinsam transaktional übernommen. Ein Abbruch oder SQL-Fehler rollt diese Änderungen zurück; ein Wiederanlauf kann erneut migrieren. Bereits erfolgreich migrierte Bestände behalten ihre UUIDs. Bestehende numerische IDs, Beziehungen und Fachwerte werden nicht verändert.

Export/Restore verweigern weiterhin unbekannte neuere Schemaversionen. Die technische Sync-Grundlage ist dokumentiert in [local-sync-foundation.md](local-sync-foundation.md); Serverabgleich und Konfliktoberfläche sind noch nicht implementiert.

## Verifikation

- `pnpm test`: gemeinsame Validierung, echte SQLite-Repository-/Restore-Tests und gemockte native Dateisystem-/Share-Grenze.
- `pnpm typecheck`.
- `pnpm generate && pnpm test:browser`: echter Chromium-Smoke-Test für Browserstart, Export, Profilpersistenz, bestätigten Restore und persistente Sicherheitssicherung. Benötigt Node >= 22 und Chromium; bei Bedarf `CHROMIUM_BIN` setzen.
- `pnpm cap:sync`: bindet die nativen Plugins für Android/iOS ein.
- Android `assembleDebug` kompiliert die nativen Plugins; das ersetzt keinen Gerätetest des Dateiauswahldialogs und des Teilens.
- iOS-Build und native Laufzeittests benötigen macOS/Xcode bzw. geeignete Geräte. Das Privacy Manifest für Dateizeitstempel ist als Xcode-Ressource eingebunden.
