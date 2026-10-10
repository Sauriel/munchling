# Explizite Zusammenführung registrierter Lebensmittel

## Freigegebener Umfang

Zunächst **nur auf der Website**, unter Lebensmittel → „Registrierte Lebensmittel zusammenführen“. Die native App empfängt das Ergebnis über den bestehenden Sync. Kein Offline-Merge, kein automatischer Name-/EAN-Abgleich und keine allgemeine Alias- oder Barcode-Weiterleitung.

Alle sieben Nährwertfelder pro 100 g müssen **exakt gleich** sein. Schon geringe Unterschiede sperren die Vorschau. Die historischen Mahlzeiten werden weiterhin dynamisch berechnet; ein neues Snapshot-Modell wird nicht eingeführt. Diese Zusammenführung verändert ihre berechneten Nährwerte nicht. Spätere ausdrücklich vorgenommene Änderungen der Lebensmittelnährwerte bleiben wie bisher dynamisch wirksam.

Quelle und Ziel sind aktive registrierte UUIDs. Namen, Marke, EAN, Custom-Status und Portionsgröße des Ziels bleiben bestehen; die Quell-EAN wird nicht als zusätzlicher Barcode übernommen. Durch die Umstellung können auch die angezeigten Lebensmittelbezeichnungen alter Mahlzeiten wechseln. Mengen, historische Zeit-Literale, Profilportionen, Referenz-UUIDs und stabile IDs bleiben erhalten.

## Vorschau und atomare Übernahme

`shared/domain/food-merge.ts` plant ausschließlich aus einem vollständig validierten, konsistenten Serverbestand. Die Oberfläche zeigt beide Identitäten und Metadaten, sämtliche Nährwerte, direkt umzustellende Zutaten/Gerichte/Mahlzeiten sowie bekannte indirekte Gerichts- und Mahlzeitenreferenzen. Die Quelle wird entfernt, die gewählte Ziel-UUID bleibt bestehen.

Eine instanzgebundene Vorschaukennung und separate Checkbox sind erforderlich. Die Bestätigung verwendet **genau die damals erfassten Basisversionen, Payloads und Kinder-UUIDs**, nicht nachträglich frisch geladene Versionen. Änderungen am zurückgegebenen UI-Objekt verändern den privaten Schreibplan nicht. Auswahlwechsel oder Fehler verlangen eine neue Vorschau.

Der Plan nutzt ein gewöhnliches, bestehendes HTTP-v1-Aggregatbatch:

1. Ziel mit seinen unveränderten Daten erneut versioniert übertragen. Seine UUID, Metadaten, Nährwerte und technischen Fachzeitstempel bleiben erhalten; die Sync-Version steigt. Das ist ein wichtiger Schutz: ein offline vorgemerkter Zielentwurf muss die **gesamte** Empfangsgruppe blockieren, bevor umgehängte Referenzen seine möglicherweise abweichenden Nährwerte verwenden.
2. Direkte Zutaten-FKs auf das Ziel umstellen, mit vollständigen ursprünglichen Gerichtpayloads und stabilen Zutaten-UUIDs.
3. Direkte Lebensmittel-Mahlzeiten auf das Ziel umstellen; Zeitpunkte, Gesamtgramm und vollständige Profilportionen bleiben erhalten.
4. Quelle versioniert löschen/tombstonen. Keine Zusammenlegung von UUIDs. Die umgestellten Referenzen sind beim bestehenden Kaskadenlauf nicht mehr an die Quelle gebunden.

Erfasste indirekte Referenzen und weitere Abhängigkeiten werden versionsgebunden geschützt. Die serverseitige Haushaltsschreibsperre, Versionsprüfungen und Löschabhängigkeitsprüfung verhindern verdeckte Rennen. Eine neue unbekannte **direkte** Referenz nach der Vorschau blockiert das gesamte Batch statt durch eine Löschkaskade zu verschwinden. Neu entstandene indirekte Referenzen werden nicht verändert; ihre Berechnung bleibt durch gleiche Nährwerte erhalten.

## Ungewissheit und Empfang

Der vorhandene Web-Lock und dauerhafte Schreibjournal gelten unverändert: gespeicherte Anfrage vor HTTP, identische Wiederholung nach Antwortverlust, dauerhaft bestätigtes Receipt vor Ansichtsaktualisierung. Ein ungewisser Schreibvorgang blockiert weitere Zusammenführungen. Kein Umschreiben, Rebinding oder stilles Rebasing; Klärung über den vorhandenen Web-Schreibstatus.

Native Clients erhalten ein normales atomisches Change-Batch. Offene/inflight Bearbeitungen an Quelle, Ziel oder direkt umgestellten Aggregaten sowie nicht erfasste lokale Löschabhängigkeiten blockieren die Gruppe. Die bestehenden expliziten Konfliktentscheidungen bleiben erforderlich; originale Queue-/Journalinhalte werden nicht ersetzt.

SQLite **8**, MariaDB **4**, Fachbackup **4**, HTTP **1** und Capacitor-Verbindungsversion **1** bleiben unverändert. Kein neuer Endpoint und keine Änderung veröffentlichter Migrationen. Ein neues APK ist für den Empfang nicht erforderlich.

## Nachweise

- `tests/domain/food-merge.test.ts`: exakte Gleichheit jedes Nährwertfelds, Identitäten und Referenzabschluss, originalgetreue Payloads/Basen.
- `tests/domain/food-merge-web.test.ts`: ausdrückliche Bestätigung, geschützter privater Plan, unveränderliche Wiederholung und Receipt-vor-Refresh.
- `tests/database/food-merge-receive.test.ts`: native Empfangsgruppe, stabile Kinder-IDs/UUIDs, Gramm/Faktoren/Zeit-Literale/Nährwerte, keine Echo-Queue; inflight Ziel- und Gerichtsentwürfe bleiben unangetastet.
- `tests/server/food-merge.test.ts`: echte MariaDB, atomare Umstellung ohne Kaskadenverlust, erhaltene Daten/IDs, originale Receipts, Änderungen an Quelle/Ziel/Gericht/Mahlzeit und neu hinzugekommene direkte Referenzen.
- `tests/server/http.test.ts` und `scripts/browser-web-smoke.mjs`: echtes Nitro und Chromium; unterschiedliche Nährwerte gesperrt, ausdrückliche Vorschau/Checkbox und verifiziertes Serverergebnis.

Produktionsabnahme erst nach vollständig grünen Prüfungen und passendem Deployment. Keine echten Haushaltsdaten automatisch zu Testzwecken zusammenführen.
