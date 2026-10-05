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

## Backup-Format v1

`shared/domain/backup.ts` definiert und validiert das JSON-Format:

```json
{
  "format": "munchling-backup",
  "version": 1,
  "schemaVersion": 1,
  "exportedAt": "2026-10-05T12:00:00.000Z",
  "data": {
    "profiles": [],
    "foods": [],
    "recipes": [],
    "recipeIngredients": [],
    "mealLogs": [],
    "mealLogProfiles": []
  }
}
```

Die Arrays enthalten die gespeicherten Fachdaten mit camelCase-Feldnamen. IDs, sämtliche Profilziele, optionale Werte, Flags, Zeitstempel, Zutaten, Gewichte und die **exakten gespeicherten Portionsfaktoren** bleiben erhalten. Mahlzeiten enthalten gespeicherte Felder, nicht abgeleitete Quellnamen oder berechnete Nährwerte.

Nicht enthalten sind: Migrationstabellen, interne SQLite-Sequenzen, Geräte-/UI-Einstellungen, BLS-Katalog, Suche und Formularentwürfe. Der Restore setzt ID-Sequenzen nicht zurück. Neue IDs liegen weiterhin oberhalb bisher verwendeter bzw. importierter IDs.

Der Import akzeptiert maximal **25 MiB und 100.000 fachliche Datensätze insgesamt**. Fehlende Tabellen oder Pflichtfelder, inkompatible Versionen, ungültige Werte, doppelte IDs/EANs/Profilzuordnungen, ungültige Referenzen und Rezeptzyklen werden abgewiesen. Es wird niemals SQL aus einer Datei ausgeführt.

Leere Arrays sind ausdrücklich zulässig: eine bestätigte Wiederherstellung einer leeren Sicherung leert den lokalen Fachbestand. Fehlende Arrays werden dagegen nicht als leer interpretiert.

Durch das bisherige Löschen von Profilen können bestehende Mahlzeiten ohne oder mit weniger Profilzuordnungen existieren. Das Backup bewahrt diese gespeicherten Zustände und berechnet weder Gesamtgewichte noch Portionsfaktoren neu. Altdaten, die andere Fachregeln verletzen, können exportiert werden, müssen für einen Import aber erst korrigiert werden.

## Sicherer Wiederherstellungsablauf

1. JSON einlesen, Größen-/Versions-/Fachprüfungen durchführen; importierte Daten für den Restore kopieren.
2. Vorschau der enthaltenen Profile, Lebensmittel, Gerichte und Mahlzeiten anzeigen.
3. Explizite Bestätigung verlangen: **gesamten lokalen Bestand ersetzen, nicht zusammenführen**.
4. Exklusiven SQLite-Zugriff und gemeinsame Transaktion öffnen.
5. Den aktuellen Bestand konsistent als Sicherheitssicherung exportieren und separat speichern.
6. Erst nach erfolgreicher Speicherung die Fachtabellen in referenzsicherer Reihenfolge leeren und importieren.
7. Bei SQL-Fehlern vollständig zurückrollen; bei Erfolg committen und den Browser-Store persistieren.
8. UI-Daten aktualisieren und das aktive Profil neu initialisieren.

Ein Fehler beim Speichern der Sicherheitssicherung verhindert die Wiederherstellung. Ein Persistenzfehler **nach** erfolgreichem SQL-Commit ist nicht rückrollbar; dafür steht ebenfalls die vorher gespeicherte Sicherheitssicherung bereit.

`restoreBackup()` verlangt einen Safety-Writer-Callback. Dieser darf innerhalb des Callbacks nicht erneut die globale, bereits gesperrte Datenbank verwenden. Die App verwendet ausschließlich die separate Dateisystem-Speicherung.

## Speicherung und Datenschutz

- Native Exporte: JSON-Datei im Cache und nativer Teilen-Dialog über Capacitor Filesystem/Share.
- Browser-Exporte: JSON-Download; der Browser bestimmt den Zielort. Das Auslösen eines Downloads garantiert nicht, dass die Person die Datei dauerhaft außerhalb des Geräts aufbewahrt.
- Automatische Sicherheitssicherung: `backups/before-restore.json` in `Directory.Data` (nativ app-privat, im Browser separate Filesystem-IndexedDB).
- Die jeweils letzte Sicherheitssicherung kann in den Einstellungen wieder exportiert werden. Ein weiterer Restore ersetzt sie durch den unmittelbar vorherigen Bestand.
- Dateien sind **nicht verschlüsselt**. Sie enthalten persönliche Ernährungsdaten und müssen geschützt aufbewahrt werden.
- App-Deinstallation, Löschen der Browser-Sitedaten oder Geräteschäden können auch die lokale Sicherheitssicherung entfernen. Deshalb vor Migrationen zusätzlich eine externe Kopie exportieren.
- Online-Serveradapter bekommen diese lokale Restore-Fähigkeit nicht automatisch; der gemeinsame Serverbestand darf nicht über einen lokalen Browser-Restore ersetzt werden.

## Voraussetzung für die nächste Schemaänderung

Das Format unterstützt zunächst ausschließlich das bisherige Datenbankschema v1. Export/Restore verweigern neuere Schema-Metadaten, statt neue technische Felder still zu verlieren. Mit Einführung von UUIDs/Outbox muss das Backup-Format erweitert werden: IDs/Sync-Zustand/Serverbindung, Import alter v1-Sicherungen und ein kontrollierter Sync-Neustart sind ausdrücklich festzulegen.

Vor automatischer Migration: externe Sicherung ermöglichen, konsistente lokale Sicherheitssicherung erzeugen und Wiederanlauf nach Abbruch testen. Die aktuelle Implementierung verändert noch nicht das Datenbankschema.

## Verifikation

- `pnpm test`: gemeinsame Validierung, echte SQLite-Repository-/Restore-Tests und gemockte native Dateisystem-/Share-Grenze.
- `pnpm typecheck`.
- `pnpm generate && pnpm test:browser`: echter Chromium-Smoke-Test für Browserstart, Export, Profilpersistenz, bestätigten Restore und persistente Sicherheitssicherung. Benötigt Node >= 22 und Chromium; bei Bedarf `CHROMIUM_BIN` setzen.
- `pnpm cap:sync`: bindet die nativen Plugins für Android/iOS ein.
- Android `assembleDebug` kompiliert die nativen Plugins; das ersetzt keinen Gerätetest des Dateiauswahldialogs und des Teilens.
- iOS-Build und native Laufzeittests benötigen macOS/Xcode bzw. geeignete Geräte. Das Privacy Manifest für Dateizeitstempel ist als Xcode-Ressource eingebunden.
