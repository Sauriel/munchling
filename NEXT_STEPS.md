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
- [x] Unter Einstellungen sollte die Checkbox "Ich vertraue dieser Adresse und ..." auch persistiert werden.
  - [x] Adress- und lokal-epochgebundene Zustimmung in SQLite v7; kein automatisches Vertrauen für bestehende Verbindungen, andere Adressen oder nach Restore/Trennen.
  - [x] Einstellungen stellen die Zustimmung ohne Netzwerkzugriff wieder her; explizites Setzen/Widerrufen und sofortiges Zurücknehmen bei Adresswechsel.
  - [x] 47 gezielte Persistenz-/Migrations-/UI-/Restore-/Runner-Prüfungen und Typecheck bestanden; Backend und APK gebaut, unabhängige Handy-Sicherung und Installation ohne Zurücksetzen.
  - [x] Passenden Dokploy-Rollout durch Nutzer-Live-Abnahme bestätigt.
  - [x] Live-Abnahme des vollständigen Punkts: Checkbox setzen, Einstellungen/App neu öffnen, widerrufen und erneut öffnen; Sync bleibt eine bewusste Aktion.
- [x] Die Webseiten Ansicht sollte Responsive auf die Volle Bildschirmbreite ausgelegt sein (Das Layout darf dafür angepasst werden) Wir brauchen am Ende eine Mobile ( und App) Ansicht und eine Desktop / Tablet Ansicht. Wir verfolgen dabei dem Mobile-First Ansatz.
  - [x] Bestehende Seitenstruktur prüfen und Mobile-first-Plan vorlegen: [Layoutplan](docs/responsive-layout-plan.md).
  - [x] Navigation und Mehrspaltenaufteilungen ausdrücklich durch Nutzer freigegeben.
  - [x] Gemeinsame App-Hülle und Navigation unten/oben/links, volle Arbeitsbreite und seitenbezogene Raster für alle acht Seiten; keine doppelten Formulare oder größenabhängigen Mounts.
  - [x] Abschlussprüfung: 38 gezielte UI-/Navigationsprüfungen, Typecheck, 69 gefüllte responsive Browserfälle, stabile Formularentwürfe/Portionen, unveränderte gespeicherte Fachdaten und Browser-Backup-Smoke; Server-/Static-/Android-Build bestanden.
  - [x] Live-Abnahme des vollständigen Layoutpunkts auf Handy und Dokploy durch Nutzer bestätigt: funktioniert auf Webseite und Handy perfekt.
- [x] Im Dashboard „Aktivität hinzufügen“ als Button analog „Mahlzeit eintragen“ auf eine eigene Eingabeseite verlagern.
  - [x] Allgemeines Dashboard: mehrere Profile mit eigenen Einheiten; Profil-Dashboard: nur das gewählte Profil. Eigene Seite `/activity-log` mit profilbezogenem Zurück-Link; ungültige/fehlende gewählte Profile führen nie zur Buchung für andere Profile.
  - [x] Bestehende Buchungslogik wiederverwendet; Dashboards laden den Tagesbonus auch ohne Inline-Formular selbst.
  - [x] 45 gezielte UI-/Routingprüfungen, Typecheck und 85 responsive Browserfälle bestanden; Server-/Static-/Android-Build und Handy-Update ohne Zurücksetzen mit frischer Sicherung.
  - [x] Live-Abnahme des vollständigen Punkts auf Webseite und Handy durch Nutzer bestätigt.
- [x] Es muss möglich sein automatisches synchronisieren anschalten zu können (Beim App Start und beim wechseln in die App zurück, falls sie im Hintergrund lief) Dies sollte granular konfigurierbar sein.
  - Bestehenden manuellen Runner und dessen Single-Flight-, Journal- und Konfliktschutz wiederverwenden; Start und Rückkehr aus dem Hintergrund getrennt schaltbar, standardmäßig aus.
  - [x] Persistenzgrundlage: SQLite v8 mit getrennten Gerätepräferenzen, standardmäßig aus und an vertrauenswürdige bestehende Bindung, lokale Epoch und Serveridentität gebunden. Widerruf/erneute Zustimmung aktiviert alte Automatik-Einstellungen nicht wieder; keine Übertragung durch Fachbackup oder Sync.
  - [x] Lifecycle-unabhängigen Koordinator mit getrennten Start-/Resume-Ereignissen, Single-Flight, Abbruch beim Hintergrundwechsel und Fehlercodes statt privater Fehlermeldungen testen; 47 gezielte Persistenz-/Backup-/Consent-/Runner-/Koordinatorprüfungen und Typecheck bestanden.
  - [x] Native App-Lifecycle und zwei unabhängige Einstellungsschalter angebunden; gemeinsamer Runner/Single-Flight, gesperrte parallele Entscheidungsaktionen, erneute Berechtigungsprüfung vor Netzwerk, Upload-Claim und Empfangsanwendung. Datenaktualisierung ohne Zurücksetzen offener Formularentwürfe; Automatik nur im Dashboard; Seitenwechsel brechen den Lauf ab und warten einschließlich Cache-Aktualisierung, bevor ein Editor öffnet.
  - [x] Status-/Fehleranzeige und Integrationsprüfungen: 78 gezielte Lifecycle-/UI-/Consent-/Runner-/Migrations-/Restore-/Backup-Tests, Typecheck, Browser-Backup-Smoke und 85 responsive Browserfälle bestanden. Schnelle Rückkehr wartet auf den abgebrochenen Lauf statt parallele Anfragen zu erzeugen.
  - [x] Server-/Static-/Android-Builds bestanden; unabhängige frische Handy-Sicherung und Update ohne Zurücksetzen. Native Migration v7→v8 geprüft: sämtliche Fachdaten/UUIDs/Historien sowie Bindung/Zustimmung unverändert, beide Automatik-Schalter aus.
  - [x] Live-Abnahme des vollständigen Automatik-Punkts durch Nutzer bestätigt: „Sieht gut aus, kannst du abhaken“. Gesamtpunkt abgeschlossen; iOS-Runtime-Abnahme bleibt separat.

## Übernommene offene Aufgaben (nachrangig)

- [ ] Bereits serverregistrierte Lebensmittel ausdrücklich zusammenführen können (bisher #31).
  - Freigegebener Umfang: zunächst Website, nur exakt gleiche Nährwerte pro 100 g; keine historischen Nährwert-Snapshots und keine automatische Zusammenführung nach Name/EAN.
  - [x] Konsistente Servervorschau mit beiden UUIDs/Metadaten/Nährwerten sowie direkten und bekannten indirekten Referenzen; ausdrückliche Bestätigung, ursprüngliche Versionen und unveränderte Kinder-IDs/Mengen/Zeitpunkte/Profilportionen.
  - [x] Atomarer bestehender Schreibpfad mit ursprünglichen Payloads, Web-Lock/Journal/Receipt, Schutz gegen neue direkte Referenzen und Ziel-Reaffirmierung als versioniertes Gruppenmitglied zum Schutz offener nativer Zielentwürfe. Keine neuen Migrationen, Formate oder Endpoints.
  - [x] 31 gezielte Domänen-/Webjournal-/SQLite-Tests und 27 echte MariaDB-/Nitro-/Chromium-Prüfungen einschließlich mobiler Oberfläche; beide Typechecks bestanden. Details: [registrierter Lebensmittel-Merge](docs/registered-food-merge.md).
  - [ ] Passenden Website-Rollout verifizieren und Nutzer-Live-Abnahme einschließlich anschließendem Native-Sync bestätigen; bestehende App kann das gewöhnliche HTTP-v1-Change-Batch bereits empfangen.
- [ ] Web-Schreibkonflikte komfortabler darstellen und referenzierte Löschungen ausdrücklich ermöglichen.
  - Basis, eigenen Entwurf und Serverstand gegenüberstellen.
  - Versionsgebundene Kaskaden-/Löschvorschau mit ausdrücklicher Bestätigung; bestehende Löschsperren bis dahin erhalten.

## Neue Anforderungen (am Ende der Roadmap)

Die folgenden Punkte sind zunächst nur dokumentiert; mit diesem Auftrag erfolgt keine Umsetzung.

- [ ] Profile um Gewicht und weitere Angaben zur automatischen Kalorienbedarfs- und Zielberechnung erweitern.
  - [ ] Grundlage prüfen: [TK-Kalorienrechner-Rekonstruktion](tk-kalorienrechner-rekonstruktion.md). Die MET-Methode ist eine Schätzung; die dort genannten Faktoren und Teile des Ablaufs sind vorläufig bzw. unbestätigt und dürfen nicht als verifizierte TK-Originalwerte übernommen werden.
  - [ ] Gewicht in kg und die für das geprüfte Berechnungsmodell benötigten Angaben erfassen, insbesondere Schlafdauer, Arbeitsart/-dauer sowie Sportdauer und Intensität (Wochenwerte korrekt auf den Tag umrechnen).
  - [ ] Geschätzten Tagesbedarf und angestrebtes Kalorienziel getrennt anzeigen. Ein gewünschtes Defizit wahlweise absolut in kcal/Tag oder prozentual vom Bedarf konfigurieren; Modus und Wert dauerhaft speichern.
  - [ ] Gewicht jederzeit mit Datum aktualisieren können. Bedarf und Ziel automatisch anhand des neuen Gewichts und der bestehenden Berechnungs-/Defiziteinstellungen anpassen; Eingaben und Zielwerte auf Plausibilität prüfen und vor zu niedrigen Zielen warnen.
  - [ ] Datierte Gewichts- und Zielkalorienhistorien einschließlich Gültigkeitsbeginn und Berechnungsgrundlage erhalten. Neue Gewichte oder Einstellungen dürfen frühere Zielwerte und Mahlzeitendaten nicht nachträglich verändern.
  - [ ] Gewichtsverlauf und Verlauf der Ziel-Kalorien in den Statistiken darstellen; Bedarf, Ziel nach Defizit und zusätzliche Tagesboni eindeutig unterscheiden. Die Abgrenzung zwischen bereits im Bedarfsmodell berücksichtigter Bewegung und gebuchten Aktivitäten festlegen, um Doppelzählungen zu vermeiden.
  - [ ] Bestehende manuelle Profilziele erhalten; automatische Berechnung ausdrücklich pro Profil aktivierbar machen. Neue Einstellungen und Historien in lokale Datenhaltung, Server, Sync und Backup/Restore integrieren, ohne Identitäten oder historische Werte zu verlieren.

- [ ] Eine bessere, profilbezogene Statistikseite mit druckbarer Web-Ansicht für Arzttermine bereitstellen.
  - [ ] Profil und Zeitraum auswählen; Gewicht, Ziel-Kalorien und tatsächliche Kalorienaufnahme mit verständlichen Diagrammen und Zusammenfassungen vergleichen. Historische Ziele statt des heutigen Ziels für frühere Tage verwenden.
  - [ ] Fehlende Messungen/Einträge erkennbar lassen und geschätzte Werte klar kennzeichnen; keine erfundenen Verlaufswerte oder medizinischen Diagnosen darstellen.
  - [ ] Drucklayout für die Webseite einschließlich „Als PDF speichern“ über den Browser vorsehen: lesbare Diagramme, Einheiten, Legenden, Zeitraum und Profilname, sinnvolle Seitenumbrüche und keine Navigation oder Eingabeformulare auf dem Ausdruck.

- [ ] Profile auf allen Geräten und der Webseite einheitlich alphabetisch sortieren.
  - [ ] Dieselbe Namenssortierung in Profilverwaltung, Dashboard sowie allen Profil-Auswahl- und Buchungsansichten verwenden; bestehende geräteabhängige Reihenfolgen beseitigen.
  - [ ] Einheitliche Regeln für Groß-/Kleinschreibung, Umlaute und eine stabile identitätsbezogene Reihenfolge bei gleichen Namen festlegen. Auswahl und Zuordnungen bleiben an IDs/UUIDs gebunden, nicht an Listenpositionen.

