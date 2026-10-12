# Profilstatistik, Web-Druck und einheitliche Sortierung

## Umfang

Beide Funktionen werden gemeinsam ausgeliefert; keine Installation oder Website-Auslieferung nach nur einem Teil. Gesamt-Abnahme bleibt bis zur ausdrücklichen Nutzerbestätigung offen. Keine neue Migration, kein neues Backup-/Sync-Format und keine Änderung gespeicherter Historien oder ursprünglicher Uploads.

## Statistik

`/statistics` ist über das allgemeine Dashboard und das Profil-Dashboard erreichbar. Profilwahl bleibt ID-gebunden, verändert nicht die globale Auswahl und verwendet die gemeinsame Namenssortierung. Vorgabe: letzte 30 Tage; frei wählbar bis 366 Kalendertage pro Bericht, Ende spätestens heute. Längere Zeiträume können in mehrere Berichte geteilt werden.

`shared/domain/profile-statistics.ts` berechnet rein lesend:

- Den gespeicherten Grundzielstand je lokalem Gültigkeitstag, niemals das heutige manuelle Ziel für unbekannte frühere Tage; mehrere Änderungen am selben Tag folgen der Ereignissequenz.
- Geschätzten Bedarf ausschließlich bei damaligem Automatikmodus, unverändert aus dem gespeicherten Modellstand, ohne erneute Berechnung.
- Separat gebuchten Bewegungsbonus und Tagesbudget. Bonus 0 bedeutet keine gebuchte Zusatzbewegung, nicht keine körperliche Bewegung.
- Aufnahme aus den bestehenden Mahlzeit-/Portionsdaten. Mahlzeit-Tageszuordnung entspricht SQLite `date(logged_at)` und dem Webadapter: UTC für Zeitstempel mit Offset und für alte Zeitstempel ohne Offset. Gewicht/Ziel und Aktivitäten behalten ihre ausdrücklichen Kalenderdaten.
- Gewicht nur an tatsächlichen Messtagen. Bei mehreren Beobachtungen desselben Messtags gilt die höchste Ereignissequenz; keine Fortschreibung oder Interpolation fehlender Tagesgewichte.

Keine Mahlzeit bedeutet unbekannte Aufnahme (`null`), nicht 0 kcal. Eine tatsächlich gebuchte 0-kcal-Mahlzeit bleibt erfasst. Auch Tage mit Einträgen können unvollständig sein. Durchschnitte nennen ihre jeweilige Abdeckung und verwenden nur erfasste/bekannte Tage; bei unterschiedlicher Abdeckung sind Aufnahme-/Zielmittel nicht direkt vergleichbar.

Wichtige bestehende Datenbegrenzung: Aufnahme verwendet gespeicherte Portionen und aktuell hinterlegte Lebensmittel-/Gerichtnährwerte. Das sind **keine unveränderlichen historischen Nährwert-Snapshots**. Die Oberfläche und der Ausdruck erläutern diese Grenze. Keine medizinischen Diagnosen oder behaupteten sicheren Zielwerte.

Kalorienlinien brechen an unbekannten Tagen; Bedarf/Ziele/Budgets werden als Stufen gezeigt. Gewichte sind ausschließlich Messpunkte. Die Tageswerttabelle liefert genaue Werte und kennzeichnet fehlende/nicht anwendbare Werte mit `—`.

## Druck / PDF

Druckfunktion im Webbrowser, nicht als unbestätigte native WebView-Druckfunktion. A4 mit Profil, Zeitraum, Erstellungszeit, Datenhinweisen, Diagrammen, Einheiten, Legenden und vollständiger Tageswerttabelle. Navigation, Statusbanner und Eingaben entfallen. Diagramme/Zusammenfassungen bleiben zusammen; Tabellenkopf wiederholt sich, Tabellenzeilen werden nicht getrennt. PDF über den Browser-Druckdialog.

Unvollständiges Laden zeigt keinen Bericht. Nach Änderung der Filter wird ein alter Bericht nicht angezeigt/gedruckt; erneutes Anzeigen ist erforderlich. Überholte asynchrone Antworten dürfen keinen neueren Bericht ersetzen.

## Sortierung

`shared/domain/profile-order.ts` enthält feste, plattformunabhängige Regeln ohne SQL-Collation oder geräteabhängige Locale:

- Führende/abschließende Leerzeichen nur für die Sortierung ignorieren; Originalnamen nicht verändern.
- Groß-/Kleinschreibung ignorieren; Umlaute/diakritische Zeichen nach Grundbuchstaben einordnen (`ä` wie `a`, `ö` wie `o`, `ü` wie `u`), `ß` wie `ss`.
- Gleichwertige Namen nach UUID sortieren. Nur alte DTOs ohne UUID haben einen deterministischen lokalen ID-Fallback und folgen gleichnamigen UUID-Datensätzen.
- Kopien sortieren, niemals Originaldaten oder ID-/UUID-Zuordnungen verändern.

Anbindung: `useProfiles`, SQLite-Profilliste, Web-Profilliste und Profilportionen in nativer/Web-Mahlzeitanzeige. Damit verwenden Profilverwaltung, Dashboard, Statistik sowie Mahlzeit-/Aktivitätsauswahl dieselbe Reihenfolge. Auswahl und Mengen bleiben ID-gebunden.

## Schlanke Prüfung

Vier neue Domänentests bündeln Sortierung/Identität, Datenlücken, historische Ziele/Beobachtungen/Profilportionen/Zusatzbonus sowie Kalender-/Zeitzonenregeln. Mit vorhandenen Repository-/Webadaptertests 25 Prüfungen grün; CLI-Typecheck, Server-/Mobile-Build und Android-Capacitor-Sync/APK-Build bestanden; APK noch nicht installiert. LSP war unbestätigt und wird nicht als sauber gewertet.

Ein isolierter Chromium-Smoke prüfte alphabetische Profilauswahl, 30 Tageszeilen, 360/768/1280 px ohne Seitenüberlauf, ausgeblendete Drucknavigation/-eingaben und PDF-Erzeugung. Keine ungewollten Browserfehler oder fehlenden Assets. Ausschließlich temporäre Testdaten, kein Haushaltszugriff.

Gemeinsamer Handy-/Website-Rollout und Nutzerabnahme stehen noch aus. Das autorisierte Android-Gerät war bei der abschließenden Geräteprüfung nicht verbunden; keine andere Gerätekennung verwenden.
