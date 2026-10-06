# Expliziter Erstabgleich und manuelle Entscheidungen

`app/utils/sync/decisions.ts` und die native `SyncDecisions.client.vue` ergänzen den bisherigen Empfang. **Kein automatischer Sync, kein Upload und keine Aktivierung.** Entscheidungen setzen ausdrückliche Bestätigung voraus. Dev-Seed-Bestände bleiben gesperrt; unbekannte Instanzen/Epochen werden nicht übernommen.

## Erstabgleich

Nach vollständigem, validiertem Staging zeigt die Vorschau die lokalen und serverseitigen Aggregate:

- **Beide behalten** (Vorgabe): lokale Daten/Queue erhalten, Serverdaten nach UUID hinzufügen. Gleiche Namen werden niemals automatisch zusammengelegt. Bei Konflikten bleibt die vollständige Snapshot-Gruppe in der Inbox zurückgehalten; anschließend manuell entscheiden.
- **Lokal starten**: nur wenn der Server keine aktiven Fachdaten enthält. Keine Löschung/Ersetzung eines bestehenden gemeinsamen Haushalts. Der lokale Bestand bleibt für den späteren Runner vorgemerkt.
- **Nur Serverdaten**: ausdrückliche lokale Ersetzung, einschließlich bisheriger Pending-Operationen. Neue lokale Epoch, Serverbindung und Snapshot-Cursor, keine Echo-Outbox. Der Server selbst wird nicht verändert. UI-Fachcaches, ausgewähltes Rezept und Profil werden anschließend erneuert.

Vor jeder Übernahme liest die UI einen **neuen konsistenten Server-Snapshot**. SHA-256-Tickets binden den Vorschauzustand an vollständige lokale Fach-/Registry-/Queue-/Konflikt-/Inbox-Daten sowie den vollständigen Serverbestand und dessen Cursor. Wenn sich lokal oder auf dem Server etwas geändert hat, wird `previewChanged` gemeldet und eine neue Vorschau verlangt. Unterschiedliche Snapshot-IDs/Ablaufzeiten allein ändern den fachlichen Ticketinhalt nicht.

## Basis / Lokal / Server

Die Konfliktvorschau verwendet den aktuellen lokalen Wire-Inhalt, nicht den beim ersten Konflikt eventuell veralteten Entwurf. Sie zeigt bestätigte Basis, lokalen Stand und aktuelle Serverrevision einschließlich Zutaten/Portionen und aller Felder/UUID-Referenzen.

Eine Entscheidung umfasst **alle aktuell zurückgehaltenen Gruppen**, zusätzlich die transitive Closure zusammenhängender Pending-Transaktionen, fehlender Remote-Referenzen, lokaler Löschabhängigkeiten und aktueller/historisch vorgemerkter EAN-Kollisionen. Eine lokale Transaktion wird nicht still in einen unentschiedenen Rest und einen verworfenen Teil zerlegt. Auch nach einer manuellen EAN-Korrektur müssen ältere, noch nicht versandte kollidierende Operationen ersetzt werden, statt später als veralteter Upload erneut zu scheitern.

- **Server übernehmen**: Pending-Intent der betroffenen vollständigen Transaktionen wird ersetzt; der aktuelle Server-Root samt UUID-Zuordnung/Basis übernommen. Das geht ausdrücklich auch dann, wenn die lokale bestätigte Revision bereits gleich ist, aber ein neuer lokaler Entwurf existiert.
- **Lokal behalten**: neue Batch-/Operations-IDs mit der bewusst gewählten aktuellen Serverbasis; kein stilles Rebasing einer alten Operation. Lokale Geschäftsdaten bleiben erhalten. Lokal gelöschte, dem Server völlig unbekannte UUIDs benötigen keinen Delete-Upload.
- Änderung-vs.-Löschung bzw. Wiederanlage verlangt eine zusätzliche Bestätigung.
- In-flight-Anfragen werden **nie** durch eine Entscheidung verworfen: ihr unbekanntes Serverergebnis muss erst eindeutig geklärt werden. Der zukünftige Runner braucht hierfür Receipt-/definitive-Rejection-Abwicklung; ein bloßer Snapshot beweist nicht, dass eine verlorene Anfrage nie mehr committen kann.

Bevor eine lokale Gewinner-Operation vorgemerkt wird, wird ihre Projektion gegen den **gesamten** aktuellen Servergraph geprüft: EANs, aktive Referenzen, UUID-Besitzer und Rezeptzyklen. Außerdem wird die lokale Kombination vor Serverübernahme auf Referenzen/Kaskaden geprüft. Unverträgliche Kombinationen verändern nichts. Gruppen werden erst nach erfolgreicher Entscheidung als `applied` mit `manualDecision` markiert; eine zusätzliche Inbox-Auditzeile enthält Auswahl, Quellgruppen und Snapshot-Cursor. Der Pull-Cursor bleibt bei manueller Auflösung unverändert: der neue Snapshot ist ein Versionsbeleg, keine Erlaubnis zum Überspringen ungelesener Feed-Gruppen.

Dies ist keine verteilte Transaktion: der Server kann **nach** dem frischen Snapshot erneut geändert werden. Ein späterer Upload verwendet die tatsächliche neue Basis und muss weiterhin am serverseitigen Optimistic-Concurrency-Check scheitern, statt den weiteren Bearbeiter zu überschreiben. Neuere Remote-Änderungen kommen über den normalen Feed.

## Sicherheitssicherung und Atomarität

Vor lokaler Übernahme wird unter `backups/before-sync-decision.json` ein validierter, unabhängig gespeicherter v2-Fachbackup geschrieben. Eigenes Ziel, niemals `before-restore.json` oder `before-schema-v2.json` überschreiben. Die native Entscheidungsoberfläche bietet den Export der letzten Entscheidungssicherung. Unverschlüsselt, 25 MiB/100.000 Datensätze; eine nicht rücksicherbare oder fehlgeschlagene Sicherung verhindert Änderungen.

Der SQL-Commit umfasst Fachwerte/UUIDs, ersetzte Queue-Intents, neue versionierte Operationen, Baselines, Konflikte und Gruppenstatus gemeinsam. Späte SQL-Fehler rollen alles zurück. Eine bereits geschriebene unabhängige Sicherung bleibt dabei erhalten. Browser-Persistierung/anschließende UI-Aktualisierung können nach einem SQL-Commit fehlschlagen; das ist kein nachträglicher SQL-Rollback. Tickets verhindern eine unbemerkte doppelte Entscheidung.

## EAN-Zuordnung und kontrolliertes Trennen

Geführte EAN-Zuordnung lokaler, noch nicht serverregistrierter Quellen sowie offline-fähiges lokales Trennen mit neuem Erstabgleich sind umgesetzt: [client-sync-food-alias.md](client-sync-food-alias.md).

## Noch offen

- Allgemeines serverseitiges Zusammenlegen bereits registrierter Lebensmittel bleibt ein eigener versions-/guardgeprüfter Ablauf; keine automatische Namens- oder EAN-Zusammenlegung.
- Konfliktbewusster Single-Flight-Runner einschließlich eindeutig abgelehnter/ungeklärter Uploads, Deletion-Guards, Aktivierung, Manual-Button und Lifecycle/Reconnect-Triggern.
- Web-HTTP-Datenadapter und Dokploy-Deployment.
- Native Android/iOS-Laufzeitprüfungen, einschließlich WebCrypto-Tickets/Netzwerk/Dateisicherung. Die native Oberfläche wird nicht durch den Browser-Backup-Smoke getestet.

## Nachweise

203 lokale und 80 MariaDB/Nitro-Tests, beide Typprüfungen und Backend-/Mobile-Build sowie Browser-Backup-Smoke. SQLite-Prüfungen: beide Bestände/gleichnamige UUIDs, lokale Ersetzung mit Sicherung/Epoch, Verbot shared-data replacement, veraltete Vorschauen, Backup-/SQL-Rollback, vollständige Pending-Batch-Closure, unveränderliche In-flight-Anfragen, neue versionierte lokale Gewinner nach Neustart, Restore, Löschabhängigkeiten und historische EAN-Intents. Echter Nitro/MariaDB-Test prüft frische Serverbelege, Änderung zwischen Anzeige/Entscheidung und einen weiteren Bearbeiter **nach** dem lokalen Gewinner: dessen Upload scheitert korrekt mit `versionConflict`.
