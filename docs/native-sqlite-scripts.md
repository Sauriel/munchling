# Native SQLite-Skripte und Trigger

## Warum Android beim Start eine 500-Seite zeigen konnte

Die Nuxt-500-Seite ist auch ein allgemeiner **Client-Initialisierungsfehler**, nicht zwangsläufig eine Antwort des Haushaltsservers. Die native Anwendung bleibt beim Start lokal.

`@capacitor-community/sqlite` Android zerlegt `execute()`-Skripte in `UtilsSQLite.getStatementsArray()` an `;\n`. `concatRemoveEnd()` hängt nur das unmittelbar vor `END` liegende Fragment wieder zusammen. Mehrere Befehle in einem `CREATE TRIGGER … BEGIN … END` werden damit als unvollständige Einzelbefehle ausgeführt (`incomplete input`). SQL.js/Browser-Tests verwenden den SQLite-Parser direkt und konnten diesen Bridge-Unterschied nicht entdecken.

## Korrektur ohne Schemaänderung

- Veröffentlichte Migrationen v1/v2/v3 bleiben unverändert.
- `app/utils/database/script.ts` erkennt Grenzen außerhalb von Literalen/Bezeichnern/Kommentaren und hält komplette Trigger einschließlich `CASE … END` zusammen.
- Der native Treiber führt vollständige einzelne Befehle über `CapacitorSQLite.run(..., transaction:false)` aus. SQLite kompiliert den **gesamten** Trigger; der problematische `execute()`-Delimiter wird umgangen.
- Im Migrationscallback bleibt die vorhandene gemeinsame Transaktion Besitzer von DDL, Backfill, Versionsmarker und initialer Outbox. Kein verschachteltes Begin/Commit.
- Standalone `execute(...,true)` umschließt sämtliche Befehle mit Begin/Commit/Rollback; malformed Grenzen werden vor jedem SQL abgewiesen. Nach Rollback-Versagen verweigert derselbe Script-Executor weitere Skripte.
- Browser-Ausführung bleibt bei der bestehenden Jeep-/SQL.js-Anbindung. iOS verwendet ebenfalls den vollständigen nativen Einzelstatement-Pfad; ein iOS-Gerätetest steht weiterhin aus.

## Abnahme und Wiederholschutz

`tests/database/script.test.ts` prüft Grenzen/Literale/Kommentare/verschachtelte CASE-Trigger, atomare native-artige Migrationen von v1 nach v3 mit bestehenden Daten, spätes Trigger-Versagen und Retry, UUID-Unveränderlichkeit/Outbox sowie Commit-/Rollback-Besitz.

Auf dem angeschlossenen Android-Gerät wurde nach zusätzlicher unabhängiger Sicherung ein **Update mit `adb install -r`**, kein Uninstall/Reset, durchgeführt. Start und v1→v3-Migration erfolgreich; Integrität `ok`, keine FK-Verletzungen. Originale Spalten/IDs/Werte aller sechs Fachtabellen stimmen exakt mit dem vorab kopierten Stand überein. Die WebView rendert wieder ein `main` ohne Nuxt-500-Seite.

Das ist eine Start-/Migrationsabnahme, keine vollständige Abnahme von Native-Sync, Backup-Export/Restore, Lifecycle oder iOS.

## Debugging-Hinweise

- Bei Nuxt-500 zuerst App-PID und **Startup-Fehlerzeilen** aus `adb logcat` ansehen. Nicht automatisch DB löschen oder den Haushaltsserver zurücksetzen.
- Debug-Capacitor-Logs enthalten vollständige SQL-Parameter und Datenzeilen. Nur relevante Error-/DDL-Zeilen ausgeben; keine kompletten Haushaltsdaten in Reports/Logs kopieren.
- Vor Änderungen DB und unabhängige Migration-Sicherung sichern. Debug-App erlaubt `run-as`; bei WAL alle Dateien konsistent sichern oder unabhängige JSON-Sicherung verwenden.
- Falls UIAutomator nur Lockscreen zeigt, kann eine Debug-WebView über `webview_devtools_remote_<pid>` per ADB-Forward/CDP geprüft werden. Nur Statusbooleans auswerten; nach der Prüfung Forward entfernen. Einen gesperrten Benutzerbildschirm nicht eigenmächtig entsperren.
