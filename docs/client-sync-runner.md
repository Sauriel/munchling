# Manueller Native-Sync: Handy ↔ Server/Web

## Bedienung nach dem Update

Der Server muss mit MariaDB, korrekter HTTPS-Adresse und der exakten Android-Origin `https://localhost` erreichbar sein. Für mkcert siehe [native-homelab-https.md](native-homelab-https.md). Den aktuellen Stand in Dokploy deployen und die **Android-App ebenfalls mit `pnpm android:update` aktualisieren**; ein Server-Deployment allein aktualisiert keine installierte APK.

Einmalig unter Einstellungen:

1. Serveradresse eintragen und das Vertrauen in Adresse/Netzwerk bestätigen. Die Adresse wird beim Verlassen des Felds und vor der Prüfung lokal gespeichert; dieses Speichern verbindet oder sendet noch nichts.
2. **Verbindung und Bestand prüfen** → **Serverbestand zwischenspeichern**.
3. **Erstabgleich prüfen** → **Beide behalten** → gewählte Übernahme bestätigen → **Entscheidung prüfen und übernehmen**. Die App speichert vorher `backups/before-sync-decision.json`. Der Handybestand bleibt erhalten, Serverdaten werden hinzugefügt. UUIDs, nicht Namen, bestimmen Identität; unerwartete Konflikte werden zurückgehalten.
4. **Jetzt synchronisieren: senden und empfangen**. Jetzt werden vorgemerkte Handyänderungen tatsächlich hochgeladen und Serveränderungen übernommen.
5. Auf der Webseite neue Einträge anlegen/bearbeiten und anschließend auf dem Handy wieder **Jetzt synchronisieren** drücken. Bereits bestehende lokale Root-IDs bleiben stabil; die Listen und Nährwertansichten werden aktualisiert.

Nach App-Neustart erscheint die gespeicherte Adresse (laufender Download / verbindliche Serverbindung vor Adresseinstellung). Das Vertrauenshäkchen wird nicht als automatische Netzwerk-/Upload-Erlaubnis dauerhaft gespeichert. Eine bestehende Bindung kann nicht durch Bearbeiten des Eingabefelds unbemerkt gewechselt werden: dafür ist die separate bestätigte Trennung erforderlich.

**Kein automatischer Sync:** keine Start-/Resume-/Änderungs-/Reconnect-Trigger und kein Hintergrunddienst. `sync_state.enabled` bleibt 0; manueller Start ist eine ausdrückliche Einzelaktion. Offline-Nutzung bleibt möglich.

## Ablauf und Sicherungen

- Additive SQLite-Schema **v4**: getrennte `draft_url` und ein `sync_upload`-Journal. Fachschema/UUIDs unverändert, veröffentlichte Migrationen v1/v2/v3 unverändert; Capacitor-Verbindungsversion **1**, Backupformat **v2**, Server-/HTTP-Schema **2**.
- Pro gemeinsamer SQLite-Fassade exakt ein laufender Runner, auch über Komponentenwechsel hinweg. HTTP besitzt bestehende Größen-/Deadline-/Binding-Prüfungen; ein Klick startet keine endlose Wiederholungsschleife.
- Vorhandene unsichere Uploads werden zuerst geklärt, anschließend Pull → vorgemerkte Transaktionsgruppen hochladen → abschließender Pull. Die Initialisierung bleibt eine separate Entscheidung, kein automatisches Merge.
- Claim und vollständige unveränderliche Anfrage (URL, lokaler Epoch-Kontext, Batch-/Operations-IDs, Basen, Payloads) werden in derselben SQLite-Transaktion gespeichert **vor** HTTP. Neue lokale Entwürfe verändern diesen Upload nicht.
- Validiertes Receipt wird persistent gespeichert, bevor Queue-Quittierung erfolgt. Quittierung und Journal-Löschung sind atomar. Nach Absturz/Antwortverlust wird nur dieselbe Anfrage wiederholt; bei bereits gespeichertem Receipt wird nicht erneut gepostet.
- Nur bestätigte eigene Vorgänger dürfen spätere vorgemerkte Basen fortschreiben. Gewöhnlicher Pull ändert niemals die Basen offener lokaler Änderungen. Empfang eigener bereits bestätigter Vorgänger überschreibt keine neueren lokalen Entwürfe.
- Ganze inkompatible Empfangsgruppen bleiben in `sync_inbox`/`sync_conflicts`. Ein Fortschrittscursor bedeutet dauerhaften Empfang, nicht konfliktfreie Anwendung. Offene Gruppen stoppen neue Uploads; die bestehenden manuellen Konfliktentscheidungen/EAN-Zuordnungen bleiben verfügbar.
- Nur kanonische transaktionale 409 `versionConflict`/`dependencyConflict`/`identityConflict` und 422 `reference`/`duplicate`/`cycle` beweisen Nicht-Commit. Dann bleibt der Batch mit denselben Inhalten/Basen pending, das Journal wird atomar freigegeben und aktuelle Änderungen werden zum Konfliktnachweis eingelesen. Netzwerk-/5xx-/Origin-/Epoch-/Idempotenz-/Decoderfehler lassen Anfrage und inflight-Status unangetastet.
- Löschungen senden die lokal bestätigten Kaskadenoperationen mit ihren **captured** Basen. Keine frisch geladenen Guards hinter einer alten Bestätigung: unbekannte/neue Serverabhängigkeiten müssen eine Ablehnung erzeugen, nicht ungefragt verschwinden.
- Restore/Trennung darf keinen unsicheren Upload vernichten. Restore ist bis zur Klärung gesperrt; nach einem erlaubten Restore werden Empfangs-/Journal-/Adress-Metadaten gelöscht, der lokale Epoch erneuert und Sync bleibt aus. Keine Server-Restore-/Reset-API.

## Abnahme

`tests/database/runner.test.ts`: Upload/Pull, neue Webdaten und neuere lokale Entwürfe, identische Wiederholung über Restart, Konfliktblockierung/unveränderte Basen, definitive Ablehnung, Single-Flight/Consent, persistentes Receipt bei später Quittierungsstörung, Restore-Sperre bei Ungewissheit.

`tests/database/sync-address.test.ts`: Adresse nach Restart, keine implizite Bindung/Enable/Netzwerkoperation, keine stille Änderung einer verbindlichen Adresse.

`tests/server/http.test.ts`: echte Nitro-/MariaDB-Abnahme mit zwei unabhängigen SQLite-Clients, allen sechs Fachtabellen, Web-CRUD, Neustart, stabilen Root-IDs/UUIDs, historischen `logged_at`-Literalen, exakten Portionswerten, ohne Echo-Outbox; echte verlorene Commit-Antwort und eine Webrace zwischen Pull und Push. Technische UTC-Zeitstempel werden beim Vergleich kanonisiert, historische Zeiten nicht.

Geräteabnahme muss zusätzlich WebCrypto, Dateisicherung, native SQLite-Brücke und echte HTTP-/CA-/Origin-Verhältnisse prüfen. iOS bleibt eine separate Runtime-Abnahme auf macOS/Gerät; Android-Erfolg ist kein iOS-Nachweis.
