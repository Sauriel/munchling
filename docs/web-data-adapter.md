# Online-Web-Datenadapter

`pnpm build:server` liefert die vorhandene Oberfläche mit `public.dataMode=online`. Der Mobile-/Entwicklungsbuild bleibt lokal. Der Online-Zweig in `database.client.ts` initialisiert weder Fachdaten-SQLite noch `jeep-sqlite` und stellt keine Backup-/Restore-Fähigkeit bereit. Keine automatische Übernahme alter Browser-SQLite-Daten; diese gehören nicht ungefragt zum gemeinsamen Haushalt.

## Lesen und Identitäten

`GET /api/sync/view?serverInstanceId=…&serverEpoch=…` verwendet dieselben Host-/Origin-/Protokollprüfungen wie Sync. Eine Repeatable-Read-Transaktion liest Instanz/Epoch/Cursor, vollständige Aggregate/Registry und stabile `view_id`-Werte. Diese IDs existieren bereits seit MariaDB-Migration v1; keine neue Migration. UUID bleibt die Identität beim Schreiben; `view_id` ist ausschließlich ein tabellenspezifischer numerischer UI-/Routenalias, unverändert bei Updates und Wiederanlage derselben UUID.

Die Antwort enthält eine vollständig konsistente einseitige Sicht plus UUID→view_id. Ihr Snapshot-Frame ist **keine reservierte Download-Lease** und darf nicht an Snapshot-Seiten-/Freigabe-Endpunkte übergeben werden. Antwort maximal 32 MiB; größere Haushalte benötigen später einen paginierten Web-Lesevertrag. Der Client validiert kompletten Graph, Registry/Referenzen und eindeutige positive Mapping-IDs vor jeder Übernahme.

`web-view.ts` projiziert dieselben DTOs wie SQLite. Gemeinsame Nährwertberechnung erhält Rundungen, Untergerichte und dynamische historische Berechnung. `logged_at` wird nicht verändert; Datumfilter berücksichtigen wie SQLite ISO-Offsets/UTC. Listenabrufe aktualisieren die Sicht; kein automatisches Polling und keine Offline-Fachdatenbank.

## Schreiben und veraltete Formulare

`http.ts` nutzt den bestehenden UUID-/Aggregat-Push. Alle Operationen sind vollständige, validierte Aggregate mit neuen unveränderlichen Batch-/Operations-IDs. Formulare speichern beim Öffnen ihre gelesene `revision`; Update/Delete übergeben diese zusätzlich zur numerischen ID. Der HTTP-Adapter verweigert fehlende oder inzwischen nicht mehr zur geladenen Sicht passende Revisionen. Er liest **keine frischere Basis hinter dem Formular**. Ein zusätzlicher Bearbeiter zwischen Anzeige und Upload wird weiterhin durch die serverseitige Versionsprüfung erkannt.

Veraltete Entwürfe bleiben im Formular erhalten und erzeugen eine verständliche Meldung. Keine automatische Wiederanlage gelöschter Zeilen, kein Namens-Merge, kein stiller Rebase. Eine komfortable Seitenansicht Basis/Entwurf/Server für Webformulare bleibt ein Folgeschritt; vorerst ausdrücklich neu laden/vergleichen und neu öffnen.

Rezepte und Mahlzeiten schreiben ihre Kinder gemeinsam. Normale Formular-Ersetzung erzeugt neue Kinder-UUIDs wie der lokale Replacement-Ablauf; einzelne Zutatenänderungen behalten ihre UUID. Mengen/Portionsfaktoren werden aus validierten Eingaben berechnet.

**Löschgrenze für den ersten Webstand:** Referenzierte Lebensmittel/Gerichte/Profile werden ohne fehlende Guards vom Server abgelehnt. Keine automatische Browser-Löschkaskade oder nachträglich frisch beschaffte Guard-Version hinter einer alten Bestätigung. Erst Verwendungen bearbeiten/entfernen; explizite versionsgebundene Kaskadenvorschauen können später ergänzt werden.

## Unklare Schreibantworten

Vor Fetch muss das unveränderliche Journal in `localStorage` gespeichert sein. Scheitert das Schreiben (z. B. Quota), findet kein Upload statt. Dieses kleine ausstehende Schreibjournal ist **kein Offline-Datenadapter**. Es enthält Fachpayloads im Klartext; dieselben Anforderungen an vertrauenswürdigen Browser/Haushaltszugang gelten. Keine Geheimnisse oder MariaDB-Zugangsdaten im Browser.

Web Locks serialisieren Journal/Fetch/Receipt über alle Tabs derselben Origin. Ohne Web Locks/secure context wird Schreiben verweigert: Produktion deshalb über HTTPS betreiben (Loopback ist für Tests ausgenommen). Unklare Transport-, 5xx-, Origin- oder Epoch-Fehler sperren weitere Writes; keine automatische Wiederholung. Der globale Banner bietet ausschließlich den expliziten Replay derselben gespeicherten IDs/Inhalte an.

Nach einem validierten Receipt wird der bestätigte Status gespeichert **bevor** die aktualisierte Sicht angefragt wird. Scheitert dieser Refresh, bleibt der Zaun erhalten; späterer Replay lädt nur die Sicht und erzeugt keinen zweiten Create. Canonical `versionConflict`/`dependencyConflict`/`identityConflict` sowie transaktionale `reference`/`duplicate`/`cycle`-Ablehnungen beweisen Nicht-Commit innerhalb derselben Bindung und geben den Schreibzaun frei. Bei Serverwechsel/Restore weder Journal löschen noch unter neuer Epoch erneut ausführen; gesonderte manuelle Klärung bleibt erforderlich.

## Nachweise

209 lokale und 83 MariaDB/Nitro-Tests. Reale API: Profile/Lebensmittel/Gerichte/Untergerichte/Mahlzeiten/Portionen, historische Zeiten, dynamische Nährwerte, stabile IDs über Neustart, konkurrierende Formulare, referenzierte Löschsperren und verlorenes Receipt mit identischem Replay. Chromium gegen den echten Nitro-/MariaDB-Prozess erzeugt/bearbeitet ein Profil, prüft Reload und Abwesenheit von Browser-SQLite.

Docker/Dokploy und Native-Runner folgen. Android-Gerätetests gemäß Priorisierung erst nach deploybarem Server. Automatische Native-Trigger und allgemeine serverseitige Dubletten-Merges bleiben nachrangig.
