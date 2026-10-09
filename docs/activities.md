# Aktivitäten und Tagesbonus

## Fachvertrag

- Vorlagen sind haushaltsweit gemeinsam: Name, positive Dauer in Minuten und nichtnegative Kalorien pro Einheit. Bruchteile einer Einheit sind erlaubt (30 Minuten / 200 kcal × 1,5 = 45 Minuten / 300 kcal).
- Aktivitätenliste und Dashboard ohne ausgewähltes Profil erlauben mehrere Profile mit individuellen Einheiten. Im Profil-Dashboard wird ausschließlich dieses Profil angeboten; ein fehlendes Profil darf nicht auf andere Profile zurückfallen.
- Einträge enthalten Profil, ausdrückliches lokales Kalenderdatum, Einheiten und Kopien von Vorlagenname/Dauer/Kalorien. Es gibt absichtlich keinen Fremdschlüssel zur Vorlage. Vorlagenänderung oder -löschung verändert alte Einträge nicht.
- Der Bonus wird nur für das konkrete Profil und Datum aufsummiert. Dauerhafte Profilziele und Makroziele werden nicht verändert. Der gestrichelte historische Diagrammvergleich bleibt das dauerhafte Basisziel, nicht ein nachträglich umgeschriebener Aktivitätsbonus.
- Das Löschen eines Tagesbuchungseintrags entfernt dessen Tagesbonus; die Vorlage bleibt erhalten. Profil-Löschung umfasst zugehörige Aktivitätseinträge mit den bestehenden Konflikt-/Kaskadensicherungen.

## Persistenz und Schutz

SQLite v6 und MariaDB v4 ergänzen `activities` und `activity_logs` als eigenständige UUID-Aggregate. Veröffentlichte Migrationen bleiben unverändert; die Capacitor-Verbindung bleibt Version 1. Profilreferenzen sind auf dem Transport UUIDs, numerische IDs nur stabile lokale/Web-Ansichtsaliase.

Mehrprofil-Buchungen werden als eine Transaktion/ein unveränderliches Outbox-Batch gespeichert. Fehler beim letzten Profil lassen weder Teilbuchungen noch Teil-Outbox zurück. Offline-Snapshots sind unabhängig von der späteren Existenz/Version der Vorlage synchronisierbar. Neue Online-Eingaben prüfen dagegen die ausdrücklich ausgewählte Vorlagenrevision im selben Serverbatch; native neue Eingaben prüfen lokale und empfangene Revisionen vor dem Kopieren. Vorlagenformulare behalten ebenfalls ihre ausgewählte Revision.

Backup v4 enthält Vorlagen und historische Tagesbuchungen, inklusive UUIDs und Löschmarkern. V1/V2/V3 bleiben importierbar. Ein lokaler Restore ersetzt nie den Serverbestand und erhält die bestehenden Unsicherheits-/Sicherheitskopie-Sperren. Server und APK gemeinsam aktualisieren: HTTP-Protokoll 1, erwartetes Serverschema 4. Automatischer Sync bleibt aus.

## Gezielte Prüfungen

- `tests/database/activities.test.ts`: Bruchteile, Profil/Datum-Isolation, historische Snapshots, atomarer Rollback mit Outbox, Backup/Restore, v5→v6 DDL-Rollback, alte MariaDB-Prüfsummen und Receive ohne Echo sowie Löschkonflikte.
- `tests/domain/activity-entry.test.ts`: tatsächliches Vue-SFC-Setup mit mehreren Profilen, fest gewähltem Profil, fehlendem Profil und keinem automatischen Speichern.
- `tests/server/activities.test.ts`: echte MariaDB, SQLite-Outbox-Verträge, idempotente Wiederholung, Vorlagenschutz, Tagesvalidierung, atomare Online-Mehrprofil-Batches, stabile Ansichts-IDs und versionsgebundene Profil-Löschungen.
- Betroffene bestehende Backup-, Receive-, Entscheidung-, Runner-, Web- und API-Tests sowie beide Typechecks; Android-Build/Installation ohne Zurücksetzen.

Die tatsächliche App-/Dokploy-Abnahme folgt erst nach vollständiger Implementierung. Dort Vorlagen anlegen, 0,5/1,5 Einheiten für verschiedene Profile/Datumswerte buchen, heutiges Limit vergleichen, Vorlagen bearbeiten/löschen und bewusst manuell synchronisieren. Native und Web-Live-Abnahme sind kein iOS-Nachweis.
