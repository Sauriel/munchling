# Portionsgrößen bei Lebensmitteln, Gerichten und Mahlzeiten

Lebensmittel und Gerichte haben optional `portionSizeGrams`: Gramm pro Portion, positiv und endlich oder `null`. Leer lassen bedeutet unbekannt, nicht automatisch 100 g. Die Formulare erlauben Ändern und ausdrückliches Entfernen. BLS-Imports erhalten ohne verlässliche Portionsangabe keine Vorgabe.

Bei **Mahlzeit eintragen** kann die Menge je Profil in Gramm oder Portionen eingegeben werden. Bruchteile wie 0,5 oder 1,5 sind erlaubt. Portionen sind nur verfügbar, wenn die ausgewählte Quelle eine Portionsgröße hat. Einheitenwechsel verändert keine Grammmenge; bei einem Quellenwechsel bleibt die Grammmenge erhalten und wird gegebenenfalls als anderer Portionsanteil angezeigt. Neue Eingaben werden auf zwei Gramm-Nachkommastellen gerundet.

Mahlzeiten speichern weiterhin Gramm und die bisherigen Profilfaktoren. Änderungen der Portionsgröße rechnen historische Mahlzeiten nicht um. Beim Bearbeiten startet die Mengenwahl in Gramm; Portionsgrößen verändern weder Rezeptzutaten noch Nährwerte pro 100 g.

## Persistenz und Kompatibilität

- Additive SQLite-Migration **v5** und MariaDB-Migration **v3** ergänzen `portion_size_grams` bei `foods` und `recipes`. Alte Zeilen bleiben unverändert, neue Spalten starten mit `NULL`. Veröffentlichte Migrationen bleiben unverändert; Checksummen von MariaDB v1/v2 sind explizit abgesichert.
- Outbox, vollständige Aggregate, Remote-Empfang und Online-Webadapter übertragen das Feld. Fehlende Felder aus älteren Change-Logs/Snapshots sind lesbar. Alte persistierte Uploads werden nicht umgeschrieben; auf dem Server bewahrt ein fehlendes Feld beim Update die vorhandene Portionsgröße, ausdrückliches `null` entfernt sie.
- HTTP-Protokoll bleibt **1**, Server-Schema wird **3**. Der aktuelle Client erwartet Schema 3. Server und APK müssen deshalb zusammen aktualisiert werden; ältere Apps dürfen nicht als portionsfähige Clients verwendet werden. Instanz/Epoch bleibt erhalten, kein neuer Erstabgleich nötig.
- Neue lokale Sicherungen verwenden Backup **v3 / schemaVersion 3**. V1/v2 bleiben importierbar; fehlende Portionsangaben werden `null`. V3 schützt davor, dass eine alte App neue Sicherungen still ohne Portionsgrößen wiederherstellt. UUIDs, Löschmarker und Restore-/Unsicherheitssperren bleiben erhalten. Capacitor-Verbindungsversion bleibt 1.

## Gezielte Prüfung

`tests/database/portions.test.ts` prüft Validierung, Teilmengen, Migration/Rollback, unveränderte alte Outbox-Anfragen, Backup-/Legacy-Restore und veröffentlichte MariaDB-Checksummen. Der tatsächliche Vue-Setup-Test `meal-source-picker.test.ts` prüft kanonische Grammwerte bei Einheiten-/Quellenwechsel. Die vorhandene Nitro/MariaDB-HTTP-Abnahme prüft Portionsgrößen Handy → Web → zwei Handys über Neustart sowie identische Legacy-Replays und ausdrückliches Entfernen.

Live-Abnahme erfolgt erst nach Implementierung des vollständigen NEXT_STEPS-Punkts. Auf Handy und Webseite eine Portionsgröße anlegen, Bruchteile eintragen, Einheiten wechseln und vorhandene Mahlzeiten vergleichen; keine Debugging-Schreibvorgänge am Haushaltsbestand ohne ausdrückliche Entscheidung.
