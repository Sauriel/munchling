# Nächste Schritte

## Arbeitsweise

- Die folgenden übergeordneten Punkte sind der maßgebliche Arbeitsplan; zunächst in der aufgeführten Reihenfolge arbeiten. Unterpunkte dürfen zur Umsetzung ergänzt werden.
- Token- und testeffizient arbeiten: gezielte Prüfungen der betroffenen Funktionen, keine wiederholten vollständigen Testsuiten ohne konkreten Anlass. Datenmigrationen, Backup- und Sync-Sicherheit weiterhin angemessen prüfen.
- Live-Tests auf dem Handy und der Dokploy-Webseite erst nach vollständiger Implementierung eines übergeordneten Punktes, nicht nach einzelnen Unterpunkten.
- Deployment und bisheriger Native-Sync sind vom Benutzer abgenommen (#32, #39); DNS-Probleme sind behoben. Automatischer Sync bleibt bis zu seiner ausdrücklichen Umsetzung ausgeschaltet.

## Priorisierte Anforderungen

- [x] Bei "Mahlzeit eintragen" soll man nicht mehr Typ und Lebensmittel/Gericht als Dropdown haben, sondern es soll ein Suchfeld geben. Dieses durchsucht die Daten (sortiert nach: erst Gerichte, dann Lebensmittel, dann die Daten aus der Food Datenbank).
  - [x] Gemeinsames Suchfeld mit gruppierten Ergebnissen; eigene Namen (DE/EN), Marke und EAN durchsuchen.
  - [x] Verzögerte BLS-Suche ab zwei Zeichen, veraltete Antworten ignorieren, expliziter Lebensmittel-Import bei Auswahl.
  - [x] Vorhandene Mahlzeitenbearbeitung, Profildaten und Nährwertvorschau beibehalten; vier gezielte Tests und Typecheck bestanden.
  - [x] Live-Abnahme des vollständigen Punkts auf Handy und Dokploy: Gericht/eigenes Lebensmittel/BLS auswählen, Mahlzeit speichern und bearbeiten.
- [x] Bei Lebensmitteln und Gerichten, die man einträgt soll man auch eine Portionsgröße in Gramm angeben können. Damit soll es möglich sein bei "Mahlzeit eintragen" zwischen Gramm und Portionen wählen zu können.
  - [x] Optionale Gramm pro Portion in Lebensmittel-/Gerichtformularen, SQLite v5 und MariaDB v3; bestehende Daten und veröffentlichte Migrationen erhalten.
  - [x] Sync-/Webadapter und Backup v3 (alte v1/v2 lesbar) erweitern; alte gespeicherte Uploads bleiben unverändert wiederholbar.
  - [x] Mengenwahl Gramm/Portionen einschließlich Bruchteilen, ohne historische Grammwerte zu verändern; fehlende Portionsgröße erlaubt nur Gramm.
  - [x] Gezielte Persistenz-/Migrations-/Vertragstests (94 lokal, 46 Nitro/MariaDB) und beide Typechecks bestanden.
  - [x] Live-Abnahme des vollständigen Punkts auf Handy und Dokploy: Portionsgrößen speichern/synchronisieren, 0,5 bzw. 1,5 Portionen eintragen, Einheit wechseln und alte Mahlzeiten prüfen.
- [x] Beim Lebensmittel und beim Gerichte Tab soll es neben "Bearbeiten" und "Löschen" auch einen Button geben um direkt von dort eine Mahlzeit einzutragen
  - [x] Aktion in beiden Eintragskarten ergänzt; Mahlzeitformular mit eindeutiger Lebensmittel-/Gericht-Vorauswahl und vorhandener Portionsgröße öffnen, ohne automatisches Speichern.
  - [x] Ungültige/gelöschte Quellen abfangen; vorhandene Mahlzeitbearbeitung hat Vorrang. Acht gezielte Tests und Typecheck bestanden.
  - [x] Live-Abnahme des vollständigen Punkts auf Handy und Dokploy: beide Direkteinstiege öffnen, Mengen eingeben und bewusst speichern.
- [x] Es soll einen neuen Tab "Aktivitäten" geben bei denen man aktivitäten eintragen kann. Diese bestehen aus einem Namen, einer Dauer und einer Kalorienanzahl. Im Dashboard kann man dann auch eine Aktivität hinzufügen (Man kann auswählen wie viele "Einheiten" man davon hinzufügen will) Diese Aktivitäten erhöhen das tägliche Kalorienlimit (aber nur für diesen Tag) Auch über die AKtivitätenliste sollte man sie hinzufügen können.
  - [x] Gemeinsame Vorlagen und historische, profilbezogene Tagesbuchungen; Bruchteile skalieren Dauer und Kalorien, Vorlagenänderungen verändern keine alten Einträge.
  - [x] SQLite v6, MariaDB v4, Backup v4 (v1/v2/v3 bleiben lesbar), Sync- und Webadapter einschließlich atomarer Mehrprofil-Buchungen und Löschschutz erweitern.
  - [x] Aktivitäten-Tab und Dashboard-Eingabe: ohne Profilauswahl mehrere Profile mit eigenen Einheiten, bei gewähltem Profil nur dieses Profil; Kalorienbonus getrennt vom dauerhaften Profilziel.
  - [x] 141 gezielte lokale/UI-/Backup-/Receive-/Runner-Prüfungen und 85 MariaDB-/API-Tests, beide Typechecks und Browser-Backup-Smoke bestanden; Android ohne Zurücksetzen aktualisiert.
  - [x] Dokploy-Rollout durch Nutzer-Live-Abnahme bestätigt.
  - [x] Live-Abnahme des vollständigen Punkts auf Handy und Dokploy: mehrere Profile, Bruchteile, Datumswechsel, Vorlagenänderung/-löschung und Sync prüfen.
- [ ] Unter Einstellungen sollte die Checkbox "Ich vertraue dieser Adresse und ..." auch persistiert werden.
  - [x] Adress- und lokal-epochgebundene Zustimmung in SQLite v7; kein automatisches Vertrauen für bestehende Verbindungen, andere Adressen oder nach Restore/Trennen.
  - [x] Einstellungen stellen die Zustimmung ohne Netzwerkzugriff wieder her; explizites Setzen/Widerrufen und sofortiges Zurücknehmen bei Adresswechsel.
  - [x] 47 gezielte Persistenz-/Migrations-/UI-/Restore-/Runner-Prüfungen und Typecheck bestanden; Backend und APK gebaut, unabhängige Handy-Sicherung und Installation ohne Zurücksetzen.
  - [ ] Passenden Dokploy-Rollout bestätigen.
  - [ ] Live-Abnahme des vollständigen Punkts: Checkbox setzen, Einstellungen/App neu öffnen, widerrufen und erneut öffnen; Sync bleibt eine bewusste Aktion.
- [ ] Die Webseiten Ansicht sollte Responsive auf die Volle Bildschirmbreite ausgelegt sein (Das Layout darf dafür angepasst werden) Wir brauchen am Ende eine Mobile ( und App) Ansicht und eine Desktop / Tablet Ansicht. Wir verfolgen dabei dem Mobile-First Ansatz.
- [ ] Es muss möglich sein automatisches synchronisieren anschalten zu können (Beim App Start und beim wechseln in die App zurück, falls sie im Hintergrund lief) Dies sollte granular konfigurierbar sein.
  - Bestehenden manuellen Runner und dessen Single-Flight-, Journal- und Konfliktschutz wiederverwenden; Start und Rückkehr aus dem Hintergrund getrennt schaltbar, standardmäßig aus.

## Übernommene offene Aufgaben (nachrangig)

- [ ] Bereits serverregistrierte Lebensmittel ausdrücklich zusammenführen können (bisher #31).
  - Versionsgebundene Vorschau mit sämtlichen betroffenen Referenzen und Konflikten; keine automatische Zusammenführung nach Name/EAN und kein stilles Überschreiben.
- [ ] Web-Schreibkonflikte komfortabler darstellen und referenzierte Löschungen ausdrücklich ermöglichen.
  - Basis, eigenen Entwurf und Serverstand gegenüberstellen.
  - Versionsgebundene Kaskaden-/Löschvorschau mit ausdrücklicher Bestätigung; bestehende Löschsperren bis dahin erhalten.

