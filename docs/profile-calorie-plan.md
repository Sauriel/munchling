# Optionale Profilberechnung und datierte Ziele — Umsetzungsplan

## Aktueller Integrationsstand (ausgeliefert und abgenommen)

- Vollständiger Profilvertrag: SQLite9, MariaDB5, Backup5 und Sync-Schema5; HTTP-Protokoll1 und Capacitor-Verbindungsversion1 bleiben unverändert. Veröffentlichte MariaDB-Migrationen1–4 sind byteidentisch.
- Historien sind Profilkinder, keine einzeln schreibbaren Aggregate. Produktiver Batch, Registry, Snapshot, Changefeed, Web-DTO, Outbox, Backup/Restore und Receive sind angebunden. Bereits akzeptierte Kinder werden beim Empfang nicht aktualisiert oder neu angelegt.
- `X-Munchling-Schema: 5` ist für neue HTTP-Schreibvorgänge nötig. Die Prüfung erfolgt **nach** der Suche nach einer bereits akzeptierten Originalanfrage: deren unveränderte Receipt bleibt auch für einen alten Client replaybar. Unbekannte neue Legacy-Schreibversuche scheitern ohne Mutation; alte Request-/Journalbytes werden nicht angepasst.
- `ProfileCalories.vue`: ausdrückliche persönliche Eingaben, separat gespeichertes manuelles Ziel, optionaler Automatikmodus, 0-Startdefizit, kcal/Prozent, Vorschau und exakte Warnbestätigung. Gewichte können mit Datum nachgetragen werden; neue Zielstände wirken ab heute. Nach Tageswechsel muss ein alter Entwurf erneut geprüft werden.
- `ProfileCalorieHistory.vue`: gespeicherte Gewichts- und Grundzielwerte mit echten Kalenderabständen sowie letzte 30 unveränderliche Ereignisse. Keine erfundenen alten Ziele. Das Dashboard verwendet datierte Budgets inklusive zusätzlich gebuchter Aktivitäten; die Grundzielhistorie bleibt ohne Boni.
- 390 lokale Tests, 115 vollständige MariaDB-/HTTP-/Chromium-Tests und beide CLI-Typechecks grün. Der optionale Docker-Abnahmetest wurde nicht angefordert und separat übersprungen. Chromium prüft auch die geöffnete mobile Eingabe, Warnbestätigung/Entwertung, Speicherung/Reload, alte Messung ohne aktuelles Überschreiben und Rückkehr zum unabhängigen manuellen Ziel.
- Abschlussbuilds (einschließlich APK), Backup5-/Legacy1-Smoke und 85 Responsive-Fälle bestanden. Nutzer hat die App aktualisiert; installierte Assets auf b76fbc95 stimmen mit dem geprüften APK überein. Aktueller Handybestand unabhängig archiviert, SQLite9/Integrität und tatsächliche Historie geprüft; keine ungewissen Uploads. Die Archivierung fand nach dem vom Nutzer durchgeführten Update statt. Website-Featurecommit 121fc26 ist ausgeliefert: Readiness 200, Schema5/HTTP1 und neue Kalorien-/Profil-/Transport-Assets geprüft. Serverinstanz/Epoch, alle 134 ursprünglichen Aggregate (bytegleiche Snapshots), 279 Registry-UUIDs und Cursor sind erhalten. Nutzer hat App/Website einschließlich nativer Synchronisation ausdrücklich abgenommen: „Danke, alles läuft. Kannst du abhaken.“ Agent hat keine Haushaltsänderungen hochgeladen. iOS-Laufzeitabnahme bleibt separat. Keine Produktions-/Handydaten zu Testzwecken angelegt; Gesamtfeature nach ausdrücklicher Nutzerabnahme abgeschlossen.

## Vom Nutzer freigegeben

- Pro Profil opt-in: manuelles Ziel bleibt allein nutzbar und separat gespeichert. Abschalten der Automatik stellt nicht stillschweigend den letzten automatischen Wert als manuelles Ziel ein.
- MET-Tagesprofil, keine behauptete exakte TK-Kopie.
- Persönliche Werte müssen angegeben werden: kein erfundenes Gewicht, keine angenommenen Schlaf-/Arbeits-/Sportzeiten. Ausdrücklich eingegebene Nullstunden sind gültige Angaben.
- Nicht belegbare Modellfaktoren dürfen transparent geschätzt werden.
- Erstes Defizit: 0. Absolute kcal und Prozent sind verfügbar.
- Auffällige Ziele/Defizite warnen und verlangen Bestätigung; keine stille Untergrenze/Korrektur. Nicht positive oder ungültige Ziele ablehnen.
- Extra gebuchte Aktivitäten kommen ausdrücklich zusätzlich zum hinterlegten Bewegungsprofil hinzu. Keine automatische Verrechnung/Deduplizierung. Hinweise erklären, dass dieselbe Bewegung sonst doppelt zählen würde.

## Berechnung und Herkunft

Die reine TypeScript-Berechnung ist unabhängig von SQL, Transport und UI. Ein Tagesprofil deckt 24 Stunden ab:

`Bedarf ≈ Gewicht × (Schlafstunden × Schlaf-MET + Arbeitsstunden × Arbeits-MET + Σ(Sportstunden/Woche ÷ 7 × Sport-MET) + Reststunden × Rest-MET)`

`Reststunden = 24 − Schlafstunden − Arbeitsstunden − Σ(Sportstunden/Woche ÷ 7)`

Arbeitsstunden sind der ausdrücklich erfasste **durchschnittliche Tageswert über die ganze Woche**, nicht stillschweigend 8 Stunden an allen sieben Tagen. Die Oberfläche erklärt z. B. 40 Wochenstunden → 40/7 Durchschnittsstunden. Sport wird entsprechend aus Wochenstunden auf den täglichen Durchschnitt verteilt. Schlaf, Arbeit und Sport dürfen nicht überlappen oder zusammen mehr als 24 Durchschnittsstunden belegen. Reststunden werden aus den Eingaben abgeleitet, nicht als persönliche Angabe erfunden.

Geprüfte Referenzen aus dem aktuellen Compendium (keine individuellen Messwerte und keine TK-Originalfaktoren):

| Komponente | Vorgesehener MET | Referenz / Einordnung |
|---|---:|---|
| Schlaf | 1,0 | Compendium Inactivity 07030. Die alte lokale Demonstration mit 0,95 ist damit **nicht** verifiziert. |
| Sitzende leichte Arbeit | 1,5 | Occupation 11580; Computerarbeit speziell kann 1,3 sein. Kategorie ist eine Näherung. |
| Stehende leichte Arbeit | 1,8 | Occupation 11600; nicht mit bloßem ruhigem Stehen gleichsetzen. |
| Körperliche moderate Arbeit | 4,5 | Occupation 11476; keine pauschale Behauptung für alle körperlichen Berufe. |
| Nicht zugeordnete Restzeit | 1,3 | **Modellannahme** für überwiegend ruhigen Alltag, orientiert an ruhigem Stehen/leichter Inaktivität. Kein TK-Originalwert und kein gemessener persönlicher Alltag. |
| Regelmäßiger Sport | getrennte Intensitätsfaktoren | Allgemeine Intensitätsklassen als ausdrücklich gekennzeichnete Näherungen; kein Erfinden der sechs Original-TK-Kategorien. Faktoren und Herkunft getrennt vom Rechenalgorithmus halten. |

Die Näherung 1 MET ≈ 1 kcal/kg/Stunde bleibt sichtbar. Das Modell ist keine Grundumsatzmessung; Alter, Größe und Geschlecht werden in dieser gewählten Formel nicht verwendet. Gerade bei stark abweichendem Körpergewicht, Kindern, Erkrankungen oder besonderen Lebenssituationen können Ergebnisse unpassend sein. Keine medizinischen Diagnosen oder behauptete sichere Mindestzufuhr.

Berechnungs-/Faktorsatz-Version und tatsächlich verwendete Faktoren gehören in jeden gespeicherten automatischen Zielstand. Spätere Faktoränderungen gelten nur für neue Stände.

## Ziel, Defizit und Zusatzbudget

- Geschätzter Bedarf und Ziel nach Defizit getrennt anzeigen.
- `Grundziel = Bedarf − absolutes Defizit` oder `Bedarf × (1 − Prozent/100)`.
- Kein Zwischenrunden von Stunden/MET-Beiträgen. kcal-Rundung deterministisch und dokumentiert.
- In manuellem Modus ist das Grundziel der hinterlegte manuelle Wert.
- In beiden Modi: `Tagesbudget = für dieses Datum gültiges Grundziel + gebuchte Aktivitätsboni dieses Profils/Datums`.
- Boni bleiben eigenständige historische Buchungen und verändern weder das gespeicherte Grundziel noch das normale Bewegungsprofil.
- Warnschwellen sind technische Hinweise, keine medizinisch universellen Mindestwerte und keine Zusicherung, dass höhere Ziele sicher wären. Im ersten Rechenkern: Warnung bei Ziel < 1500 kcal oder Defizit > 30 % des ungerundeten Bedarfs. Keine stille Korrektur; Warnbestätigung muss an genau die geprüften Werte gebunden sein.
- Implementierter isolierter Kern: `shared/domain/calorie-model.ts`, Modellversion `met-household-v1`; Sportintensitäts-Näherungen 3/5/8 MET, ausdrücklich als Annahmen ausgewiesen. Abschließende kcal-Werte werden mit `Math.round` gerundet; Zusatzboni bleiben ihre gespeicherten Werte. Historienkern, Migrationen und Oberfläche sind inzwischen gemeinsam integriert; Auslieferung/Live-Abnahme siehe aktueller Integrationsstand.

## Historie und Datenintegrität

Jeder Änderungsstand bekommt eine eigene UUID und explizite lokale Kalenderdaten. Ein Stand umfasst den Ziel-/Einstellungssnapshot und gegebenenfalls die ausdrücklich eingegebene Gewichtsmessung; deren UUID ist dann die UUID dieses gemeinsamen Ereignisses. UTC-technische Zeitstempel dürfen diese Kalenderdaten nicht verschieben.

Neue Stände wirken ab dem angezeigten Gültigkeitsdatum. Gewicht/Einstellungen heute ändern keine früheren Ziele, Mahlzeiten oder Aktivitätswerte. Auch beim Umschalten auf manuell wird ein neuer datierter Zielstand erzeugt. Das manuelle Ziel bleibt als unabhängig wiederverwendbarer Wert bestehen.

Historische automatische Ziele speichern ihre damaligen Eingaben, Gewicht, Defizitmodus/-wert, Faktoren/Modellversion und das berechnete Ergebnis. Anzeigen verwenden diese gespeicherten Stände, nicht den heutigen Algorithmus mit alten Daten.

Bestehende Profile behalten ihr manuelles Ziel und bleiben standardmäßig im manuellen Modus. Für Zeiten ohne aufgezeichnetes Ziel wird keine rückwirkende Zielhistorie erfunden; spätere Statistiken müssen fehlende historische Ziele kennzeichnen. Das heutige manuelle Ziel kann weiter im aktuellen Dashboard verwendet werden, ohne es als bewiesenes altes Tagesziel auszugeben.

Implementierter technischer Weg: Historien als UUID-adressierte **Kinder des vorhandenen Profilaggregats**, damit Gewicht, Einstellung und dazugehöriger Zielstand atomar zusammen geschrieben/synchronisiert werden. Keine unabhängigen, konkurrierenden „eine Einstellung pro Profil“-UUIDs auf zwei Offline-Geräten. Historische Kinder dürfen nicht durch vollständigen Aggregate-Ersatz versehentlich entfernt oder neu nummeriert werden. Server/Receive/Restore prüfen unveränderte Identität und Originalwerte; ein Konflikt betrifft den ganzen Profilstand.

Neue SQLite-/MariaDB-Migrationen werden nur angehängt. Backup-Version/Manifeste, Wire-Spalten, UUID-Ownership, Outbox, Serverregistry, Journal/Receipts, Receive, Profil-Löschabhängigkeiten und Web-Projektion müssen gemeinsam erweitert werden. Alte Anfragen/Journale niemals umschreiben. Ein bestehendes ungewisses Profil-Upload bleibt eingezäunt, bis dessen ursprüngliche Anfrage geklärt ist. Native-Update und passender Server-Rollout gehören zur vollständigen Featureabnahme; ein altes APK darf unbekannte Erweiterungen nicht still übernehmen.

## Historienkern und SQLite-Anbindung

- `shared/domain/profile-calorie-history.ts`: UUID-adressierte Ereignisse mit profilbezogener Reihenfolge, lokalem Gültigkeitsdatum, separatem UTC-Erfassungszeitpunkt, optionaler datierter Messung und vollständigem Ziel-/Modussnapshot. Reihenfolge ist unabhängig von lokalen numerischen IDs oder Geräteuhren.
- Neue Zielstände beginnen in dieser Stufe am aktuellen lokalen Kalendertag; keine rückwirkende Änderung oder Zukunftsplanung. Nachgetragene ältere Messungen werden als Messung erhalten, ersetzen aber keine neuere aktuelle Messung und ändern keine früheren Ziele.
- Abschalten behält Berechnungsangaben separat, verwendet aber wieder den gespeicherten manuellen Wert. Gewichtsänderungen im manuellen Modus aktivieren nichts heimlich.
- Warnbestätigung enthält Profil, Datum und die tatsächlich bestätigte Berechnung. Andere Eingaben, anderes Profil oder Tageswechsel machen sie ungültig; kein dauerhaftes `confirmed=true`.
- SQLite9 `app/utils/database/profile-calorie-schema.ts`: unveränderliche Kinder `profile_calorie_history`, UUID-Registry und Profil-Outbox-Tracking. Die Migration ist im Arbeitsstand registriert; Profil-Batch-/Reply-/Registry-Vertrag, Backup5 und Receive sind gemeinsam integriert. Scoped Repository `repositories/profile-calorie-history.ts` schreibt Ziel-/Manuellwert und Ereignis gemeinsam in der vom Aufrufer gehaltenen Transaktion.
- Outbox nimmt bei vorhandenem Kandidatenschema alle historischen Kinder mit Profil-UUID auf. Leere/alte Profile erhalten keine neue Payload-Eigenschaft; bestehende Journale/Outboxzeilen werden nicht umgeschrieben.
- SQLite-Tests prüfen unveränderte Kinder-IDs/Werte, Ablehnung einzelner Änderungen/Löschungen, explizite Profil-Löschkaskade mit UUID-Tombstones, vollständige neue Outbox-Payloads und vollständigen Rollback bei Journalausfall. Scoped SQLite-Append verwendet inzwischen dieselbe Übergangsprüfung für neue Berechnungen wie der Serverkandidat.

## Wire und MariaDB-Anbindung

- `shared/domain/profile-calorie-wire.ts`: strikter, nicht mutierender Codec mit ursprünglichem `event_json`, Eigentümer-UUID, Sequenz, Gültigkeitsdatum und kanonischem UTC-Erfassungszeitpunkt. `DATETIME(3)` muss diesen Zeitpunkt exakt zurückgeben können; fehlende Zeitstempel werden nicht während der Validierung erfunden.
- Neue Änderungsstände werden gegen den tatsächlich gespeicherten vorherigen Stand geprüft. Gewichtsereignisse dürfen nicht nebenbei Modus oder Defizit ändern; manueller Live-Wert und letzter Zielstand müssen zusammenpassen. Nur neue automatische Berechnungen werden mit dem aktuellen Modell verglichen. Bereits gespeicherte unbekannte historische Modellversionen bleiben unveränderte Fakten, keine neuen gültigen Modellbehauptungen.
- Alte Kinder müssen vollständig und einschließlich originaler JSON-Bytes erhalten bleiben. Selbst bloßes Neuformatieren eines bereits akzeptierten `event_json` ist keine zulässige Aktualisierung. Reihenfolge des äußeren Arrays ist dagegen unerheblich.
- `server/database/profile-calorie-schema.ts` und `server/services/profile-calorie-history.ts`: registrierte MariaDB5-Migration und produktive Profil-Speicherung mit profilbezogener Sequenz, UUID-Registrierung, reinem Append unveränderlicher Kinder und gezielten Tombstones für eine ausdrücklich erlaubte ganze Profillöschung. Unveränderte Kinder werden weder neu angelegt noch in ihrer Revision hochgezählt.
- Echte isolierte MariaDB-Prüfungen belegen SQLite-Outbox→Server-Kandidat mit identischen UUIDs/JSON-Bytes, stabile `view_id`/Kinderrevision, fehlende/geänderte Historien, gefälschte Berechnung mit vollständigem Rollback und Schutz vor fremden oder tombstonierten UUIDs. Produktiver `writeServerBatch`-/HTTP-/Snapshot-/Changefeed-Pfad, Manifest/Version, Guards und Empfang sind inzwischen gemeinsam angebunden und zusätzlich getestet.
- Bestehende Legacy-Profile ohne Historie bleiben ohne erfundene alte Ziele lesbar. Historische manuelle Nullwerte bleiben erhalten; neu eingegebene manuelle Ziele müssen positiv sein.
- Die isolierte Vorstufe bestand bereits 381 lokale und 40 MariaDB-Tests. Der erweiterte aktuelle Prüfstand steht oben. Neue Konflikttests sichern insbesondere einen verworfenen Offline-Gewichtsentwurf vor ausdrücklicher Server-Auswahl und erhalten akzeptierte Kinder-IDs.

## UI und Prüfungen

Bestehenden Profileditor ergänzen, kein großer Navigations-/Layoutumbau: manueller Wert, ausgeschaltete Automatik, explizite Gewicht-/Alltagsangaben, Vorschau mit Annahmen, Defizit, Warnung/Bestätigung und datierter Verlauf. Ohne vollständige persönliche Angaben keine Aktivierung.

Prüfmatrix: fehlende und unplausible Eingaben, Stundenabschluss/Wochenumrechnung, exakte Zusatzbonus-Semantik, Defizit/Rundung/Warnbestätigung, spätere Gewichte ohne rückwirkende Zieländerung, Abschalten/erneutes Einschalten und getrenntes manuelles Ziel, Profilzuordnung, atomarer Rollback, Legacy-Backup ohne erfundene Historie, UUID-Erhalt, stale Web-Formulare, Offline-Konflikte und unveränderte unsichere Uploads.

Keine neuen Haushaltsdaten automatisch zu Testzwecken anlegen. Release/Live-Prüfung erst nach dem ganzen Top-Level-Feature; unabhängiges Handy-Sicherungsarchiv vor APK-Update, kein Reset. iOS-Abnahme bleibt separat.

## Quellen

- TK Originalseite: https://www.tk.de/service/app/2004134/kalorienrechner/kalorienrechner.app — öffentlich abrufbare Beschreibung bestätigt eine Schätzung, aber die verwendeten internen Faktoren wurden damit nicht extrahiert.
- Compendium Inactivity: https://pacompendium.com/inactivity/
- Compendium Occupation: https://pacompendium.com/occupation/
- Lokale vorläufige Rekonstruktion: `tk-kalorienrechner-rekonstruktion.md` (historische Demonstration, nicht verifizierte TK-Implementierung).
