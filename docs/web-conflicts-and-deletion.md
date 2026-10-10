# Web-Schreibkonflikte und geschützte Löschvorschau

## Freigegebene Grenze

Die neue Web-Kaskadenfunktion für Lebensmittel, Gerichte, Profile und Aktivitätsvorlagen darf **keine gebuchten Mahlzeiten/Aktivitätseinträge entfernen oder ihre historischen Berechnungen verändern**. Auch Mahlzeiten über beliebig tief verschachtelte Gerichte zählen. Historische Bezüge sperren die Kaskade; kein neues Archiv- oder Snapshot-Modell.

Die bisherigen ausdrücklich ausgewählten Korrekturen einzelner Mahlzeiten/Aktivitätsbuchungen und normalen Nährwert-/Gerichtsänderungen sind keine neue Kaskade und bleiben unverändert. Aktivitätsvorlagen haben keine FK zu ihren datierten Log-Snapshots; das Entfernen einer Vorlage verändert diese Logs nicht. Native Löschentscheidungen und die registrierte Lebensmittel-Zusammenführung verwenden ihre bestehenden Regeln.

## Vergleich ohne Überschreiben

`WebDataReview.client.vue` im bestehenden Web-Schreibstatus stellt erfasste Basis, eigenen Entwurf und Serverstand gegenüber. UUIDs, Ursprungsversionen und vollständige Felder sind einsehbar. Ein lokal bereits als veraltet erkanntes Formular zeigt die ursprünglichen Formularfelder statt eine erfundene komplette Schreibanfrage.

`createWebReviews()` bewahrt veränderte Lesebasen begrenzt auf 1000 Einträge/4 MiB auf. Fehlende ursprüngliche Daten werden ausdrücklich als unbekannt dargestellt, niemals durch frische Serverwerte ersetzt. Für gesendete Anfragen werden ursprüngliche Operations-/Guard-Basen als **zusätzliche Journal-Metadaten**, außerhalb der unveränderten HTTP-Anfrage, gespeichert. Alte Journale ohne diese Metadaten bleiben lesbar. Ungültige optionale Vergleichsmetadaten liefern keine Basis; sie dürfen die Originalanfrage weder ändern noch entsperren.

Nur eine kanonische, bindungsgleiche Transaktionsablehnung erlaubt das Entfernen des Schreibjournals. Danach wird für den Vergleich ein separater vollständiger Server-Cut gelesen, ohne die Formularansicht oder Schreibbasen zu ersetzen. Ein fehlgeschlagener Vergleichsabruf bedeutet nicht „gelöscht“. Ungewisse Transport-/Epoch-/Origin-/Serverfehler behalten exakt das bisherige Journal; keine automatischen Wiederholungen oder Konfliktentscheidungen.

Der Vergleich kann geschlossen werden, ohne das Formular zu ändern. Ein ausdrücklich angeforderter JSON-Download sichert Vergleich/Entwurf (kein importierbares Fachbackup). Neuladen erfordert eine eigene Bestätigung, dass alle ungespeicherten Seiteneingaben verloren gehen. Es gibt keine generische „meinen Entwurf mit frischen Versionen durchdrücken“-Funktion: gewünschte Änderungen müssen nach bewusstem Laden erneut eingegeben und geprüft werden.

## Versionsgebundene Kaskade

Ein vorhandener Löschknopf behält die bisherige erste Bestätigung. Die Web-Datenfunktion lädt anschließend einen konsistenten Cut und prüft **dieselbe erfasste Root-Version**. Für referenzierte Definitionen wird vor jedem POST eine neue Vorschau mit privaten, unveränderlichen Operations-/Guard-Daten erstellt. Angezeigt werden Root, direkte Referenzen, indirekte Gerichte und historische Sperrgründe. Eine weitere Checkbox bestätigt genau diese Vorschau; mutierte UI-Objekte können weder Guard-Versionen noch die Sperre verändern.

Alle direkten und indirekten Gerichtsreferenzen werden versionsgebunden geschützt. Der private Plan wird nicht bei Bestätigung frisch erzeugt. Unreferenzierte Definitionen benötigen keine zusätzliche Vorschau; ihre Löschung nutzt dennoch den serverseitigen Historien-Schutz.

HTTP-v1-Schreibbatches besitzen die additive, optionale Eigenschaft `preserveHistory: true`. Nur `true` oder Abwesenheit ist zulässig; bestehende Anfragen erhalten **keinen Default**, damit veröffentlichte Request-Hashes und Receipts identisch bleiben. Der bestehende Haushaltsschreib-Lock schützt folgende Prüfungen vor jeder Mutation:

1. Originale Root-/Guard-Versionen und direkte Löschabhängigkeiten.
2. Vollständiger aktueller Gerichts-Elternabschluss, ohne SQL-Rekursions-Tiefenlimit. Neu entstandene unbekannte indirekte Referenzen sperren ebenfalls (`dependencyConflict`).
3. Aktuell gebuchte direkte/indirekte Mahlzeiten sowie Profil-Aktivitätslogs (`historyConflict`). Ein nach der Vorschau neu gebuchtes indirektes Essen verändert keine Gerichtsrevision; deshalb ist diese Prüfung zusätzlich zu Versionsguards zwingend.
4. Prüfung erfolgt vor allen Batch-Mutationen. Ein gemischtes Batch kann Historie nicht zuerst entfernen/umhängen und dann den Schutz umgehen.

Idempotente Receipt-Wiederholung wird wie bisher vor den neuen Prüfungen beantwortet. Neue geschützte Löschanfragen erhalten genau dieselben Web-Lock-/Journal-/Receipt-vor-Refresh-Regeln. Native Clients senden das optionale Feld nicht; Empfangsformate bleiben unverändert. Keine neue Migration, kein neuer Endpoint: SQLite8/MariaDB4/Fachbackup4/HTTP1 und Capacitor-Verbindungsversion1 bleiben erhalten.

## Nachweise und Abnahme

- `tests/domain/deletion-review.test.ts`: vollständige direkte/indirekte Referenzen, historische Sperre, 2500 Ebenen und unveränderte Legacy-Anfragen.
- `tests/domain/web-reviews.test.ts`: ausdrückliche Tickets/Checkbox, UI-Manipulation, originale Wiederholung, drei Vergleichsstände, Lesecache, Vergleich nach Journal-Recovery, unerreichbarer Server und Ungewissheit.
- `tests/server/deletion-history.test.ts`: echte MariaDB; Historie, späte indirekte Buchung, neue indirekte Referenz, veraltete Guards, erlaubte ungebuchte Kaskade, Receipt-Replay und atomarer Schutz vor gemischtem Historienabbau.
- `scripts/browser-web-smoke.mjs`/`tests/server/http.test.ts`: tatsächliches Nitro/Chromium; mobiler Konflikt mit erhaltenem Formular, separate gerenderte Bestätigung, erfolgreicher ungebuchter Löschplan und gesperrte historische Berechnungen.

Gesamtabnahme bleibt bis zu allen Release-Prüfungen, Website-Rollout und ausdrücklicher Nutzer-Live-Abnahme offen. Automatische Tests verändern ausschließlich isolierte Loopback-Fixtures, niemals Haushaltsdaten.
