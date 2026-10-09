# Nächste Schritte

## Arbeitsweise

- Die folgenden übergeordneten Punkte sind der maßgebliche Arbeitsplan; zunächst in der aufgeführten Reihenfolge arbeiten. Unterpunkte dürfen zur Umsetzung ergänzt werden.
- Token- und testeffizient arbeiten: gezielte Prüfungen der betroffenen Funktionen, keine wiederholten vollständigen Testsuiten ohne konkreten Anlass. Datenmigrationen, Backup- und Sync-Sicherheit weiterhin angemessen prüfen.
- Live-Tests auf dem Handy und der Dokploy-Webseite erst nach vollständiger Implementierung eines übergeordneten Punktes, nicht nach einzelnen Unterpunkten.
- Deployment und bisheriger Native-Sync sind vom Benutzer abgenommen (#32, #39); DNS-Probleme sind behoben. Automatischer Sync bleibt bis zu seiner ausdrücklichen Umsetzung ausgeschaltet.

## Priorisierte Anforderungen

- [ ] Bei "Mahlzeit eintragen" soll man nicht mehr Typ und Lebensmittel/Gericht als Dropdown haben, sondern es soll ein Suchfeld geben. Dieses durchsucht die Daten (sortiert nach: erst Gerichte, dann Lebensmittel, dann die Daten aus der Food Datenbank).
  - [x] Gemeinsames Suchfeld mit gruppierten Ergebnissen; eigene Namen (DE/EN), Marke und EAN durchsuchen.
  - [x] Verzögerte BLS-Suche ab zwei Zeichen, veraltete Antworten ignorieren, expliziter Lebensmittel-Import bei Auswahl.
  - [x] Vorhandene Mahlzeitenbearbeitung, Profildaten und Nährwertvorschau beibehalten; vier gezielte Tests und Typecheck bestanden.
  - [ ] Live-Abnahme des vollständigen Punkts auf Handy und Dokploy: Gericht/eigenes Lebensmittel/BLS auswählen, Mahlzeit speichern und bearbeiten.
- [ ] Bei Lebensmitteln und Gerichten, die man einträgt soll man auch eine Portionsgröße in Gramm angeben können. Damit soll es möglich sein bei "Mahlzeit eintragen" zwischen Gramm und Portionen wählen zu können.
- [ ] Beim Lebensmittel und beim Gerichte Tab soll es neben "Bearbeiten" und "Löschen" auch einen Button geben um direkt von dort eine Mahlzeit einzutragen
- [ ] Es soll einen neuen Tab "Aktivitäten" geben bei denen man aktivitäten eintragen kann. Diese bestehen aus einem Namen, einer Dauer und einer Kalorienanzahl. Im Dashboard kann man dann auch eine Aktivität hinzufügen (Man kann auswählen wie viele "Einheiten" man davon hinzufügen will) Diese Aktivitäten erhöhen das tägliche Kalorienlimit (aber nur für diesen Tag) Auch über die AKtivitätenliste sollte man sie hinzufügen können.
- [ ] Unter Einstellungen sollte die Checkbox "Ich vertraue dieser Adresse und ..." auch persistiert werden.
- [ ] Die Webseiten Ansicht sollte Responsive auf die Volle Bildschirmbreite ausgelegt sein (Das Layout darf dafür angepasst werden) Wir brauchen am Ende eine Mobile ( und App) Ansicht und eine Desktop / Tablet Ansicht. Wir verfolgen dabei dem Mobile-First Ansatz.
- [ ] Es muss möglich sein automatisches synchronisieren anschalten zu können (Beim App Start und beim wechseln in die App zurück, falls sie im Hintergrund lief) Dies sollte granular konfigurierbar sein.
  - Bestehenden manuellen Runner und dessen Single-Flight-, Journal- und Konfliktschutz wiederverwenden; Start und Rückkehr aus dem Hintergrund getrennt schaltbar, standardmäßig aus.

## Übernommene offene Aufgaben (nachrangig)

- [ ] Bereits serverregistrierte Lebensmittel ausdrücklich zusammenführen können (bisher #31).
  - Versionsgebundene Vorschau mit sämtlichen betroffenen Referenzen und Konflikten; keine automatische Zusammenführung nach Name/EAN und kein stilles Überschreiben.
- [ ] Web-Schreibkonflikte komfortabler darstellen und referenzierte Löschungen ausdrücklich ermöglichen.
  - Basis, eigenen Entwurf und Serverstand gegenüberstellen.
  - Versionsgebundene Kaskaden-/Löschvorschau mit ausdrücklicher Bestätigung; bestehende Löschsperren bis dahin erhalten.

