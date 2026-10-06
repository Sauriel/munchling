# Geführte lokale EAN-Zuordnung und Trennen der Verbindung

## EAN-Import-Zuordnung

`createFoodAliases()` in `app/utils/sync/food-alias.ts` bietet nach Erstabgleich einen bewusst eingeschränkten, sicheren Ablauf:

- Quelle: aktives lokales Lebensmittel mit `server_revision=0`, dessen UUID im **gesamten** aktuellen Serverregister weder aktiv noch gelöscht vorkommt.
- Ziel: aktives Server-Lebensmittel mit derselben exakten EAN und ohne offene lokale Zielbearbeitung. Namen sind kein Identitätskriterium.
- Es ist eine **lokale Import-Zuordnung**, kein Zusammenlegen/Löschen bereits registrierter gemeinsamer Lebensmittel. Solche Fälle bleiben bei normalen Versionsentscheidungen bzw. einer späteren expliziten serverseitigen Merge-Funktion.

Die native Oberfläche zeigt beide Lebensmittel/Nährwerte, direkte Zutaten-/Mahlzeitenzahlen und zusammenhängende Queue-Begleiter. Sie warnt ausdrücklich: nach Zuordnung gelten die Server-Nährwerte auch für bestehende Gerichte und historische Mahlzeiten (deren dynamische Berechnung bleibt unverändert). Mengen, Verzehrzeit-Literale, Profilzuordnungen und Portionsfaktoren bleiben erhalten.

Vor Bestätigung ist eine Vorschau erforderlich; vor Übernahme wird erneut ein konsistenter Server-Snapshot geladen. SHA-Tickets binden kompletten lokalen und Serverzustand plus beide UUIDs. Neue Server-/lokale Änderungen erzwingen eine neue Vorschau. Unsichere In-flight-Ausgänge, falsche EAN, fremde UUID-Besitzer, bearbeitete Ziele und serverregistrierte Quellen werden verweigert.

Im gemeinsamen SQLite-Commit:

1. Unabhängige validierte v2-Sicherungsdatei `backups/before-sync-decision.json` schreiben; sonst keine Änderung.
2. Vollständige transitive Pending-Batch-Closure erfassen: Quelle, aktuelle Referenzen, historische noch nicht versandte UUID-Referenzen und alle Transaktionsbegleiter. Nicht betroffene Batches bleiben unverändert.
3. Nur die temporäre Quell-EAN ohne Echo freigeben und das Serverziel mit UUID→lokaler ID übernehmen; ein bereits vorhandenes Ziel behält seine ID.
4. Zutaten- und direkte Mahlzeiten-FKs auf die Ziel-ID umstellen **bevor** die Quelle entfernt wird. Keine Löschkaskade; Zutaten-/Portions-UUIDs und IDs bleiben stabil. Lokale Trigger erhöhen betroffene Revisionen.
5. Alte unversandte Transaktionen durch neue vollständige aktuelle Operationen ersetzen. **Ihre bisherigen tatsächlichen Basisrevisionen bleiben erhalten**, selbst wenn die frische Serveransicht bereits eine neuere Begleiterversion zeigt. Ein späterer Upload kann deshalb weiterhin korrekt in einen Versionskonflikt laufen. Uneinheitliche alte Basen werden nicht still verdichtet.
6. Quell-UUID als lokalen Tombstone behalten; kein Source-Delete-Upload und kein Löschen auf dem Server. Auditzeile in Inbox mit Zuordnung und ersetzten Batch-IDs.

Der Pull-Cursor bleibt unverändert. Andere zurückgehaltene Gruppen werden nicht übersprungen oder als aufgelöst behauptet: anschließend erneut normale Konfliktentscheidungen prüfen. Es findet kein Upload und keine Sync-Aktivierung statt. Sicherung oder spätes SQL-Versagen rollen FK-, Fach-, Registry- und Queue-Mutationen gemeinsam zurück.

## Offline-fähiges lokales Trennen

`createSyncDisconnect()` in `app/utils/sync/disconnect.ts` benötigt **keinen Serverrequest**. Vorschau, lokale Zustandsbindung, gesonderte Bestätigung und dieselbe unabhängige Sicherheitsdatei sind erforderlich. Ein unbestätigter In-flight-Batch muss vorher eindeutig geklärt werden.

Alle Fachdaten, numerischen IDs, UUIDs, Referenzen und Tombstones bleiben erhalten. Technische Bindung/Epoch/Cursor, alte Inbox-/Konflikt-/Baseline-Daten und alte Requests werden zurückgesetzt. Eine neue lokale Epoch schützt vor verspäteten Antworten; der neueste lokale Fachstand wird als ungebundener Initialbatch mit Basis `0` vorgemerkt. Sync bleibt ausgeschaltet. Die Adresse muss erneut bestätigt werden, und vor Wiederverbindung ist ein neuer Erstabgleich Pflicht. Für einen anderen Server oder eine nach MariaDB-Restore erneuerte Epoch niemals lediglich URL/Epoch/Cursor austauschen.

## Nachweise und verbleibende Grenzen

203 lokale Tests und 80 MariaDB/Nitro-Tests. SQLite: FK-Umstellung mit stabilen Kinder-IDs/UUIDs, historische Mahlzeiten/Portionsfaktoren, gleiches Ziel-ID-Mapping, Quellregistrierung/Zielentwurf/In-flight-Sperren, ganze Pending-Batches/historische Referenzen, unveränderte frühere Basen, Backup-/späte SQL-Fehler, Neustart, lokales Trennen und Schutz gegen alte Antworten. Echter Nitro-Test: EAN-Mapping auf eine Server-UUID, anschließend nur das umgestellte Rezept hochladen; die Quell-UUID ist nie auf dem Server registriert.

Beide Typprüfungen, Backend-/Mobile-Build und Browser-Smoke geprüft. Native Android/iOS-Laufzeit weiterhin ausstehend. Eine allgemeine Merge-Funktion für bereits serverregistrierte Lebensmittel, Native-Runner, Web-HTTP-Adapter und Deployment sind nicht Teil dieses lokalen Schritts.
