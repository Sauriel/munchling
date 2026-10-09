# Responsive Layout — freigegebener Plan

**Status: ausdrücklich freigegeben, umgesetzt, lokal geprüft und durch Nutzer auf Webseite und Handy live abgenommen.**

Die zentrale Hülle ist `app/app.vue` mit `AppShell` und `AppNavigation`: Nuxt 4 verwendet hier `app/` als Quellverzeichnis. Die frühere `app.vue` im Repository-Wurzelverzeichnis wurde nicht als App-Komponente geladen; der Web-Schreibstatus sitzt nun ebenfalls im tatsächlich verwendeten Rahmen.

## Ziel und Ausgangslage

Vor der Umstellung waren alle acht Seiten sowie die untere Navigation auf `max-w-md` begrenzt. Es gab kein gemeinsames Nuxt-Layout; Seiten enthielten ihre Navigation und Abstände jeweils selbst. Das Ergebnis war auch auf Tablet/Desktop ein schmaler Handy-Streifen.

Ziel ist eine einheitliche Mobile-first-Oberfläche für App und Webseite. Die Seitenfläche nutzt die verfügbare Breite; einzelne Texte, Formularspalten und Karten bleiben lesbar. Keine pauschale neue maximale Seitenbreite. Bestehende Farben, Rundungen, Dark Mode und Fachabläufe bleiben erhalten.

## Umgesetzte Größenbereiche

| Viewportbreite | Navigation | Inhaltslayout |
| --- | --- | --- |
| Unter 768 px | Untere Tabbar wie bisher, volle Breite, Safe Areas | Eine Hauptspalte; kompakte Feldpaare nur bei ausreichendem Platz |
| 768–1023 px | Kompakte obere Navigation | Volle Breite, zwei Karten-/Dashboardspalten, längere Formulare weiter untereinander |
| Ab 1024 px | Linke Navigation, ca. 208 px | Verbleibende Breite vollständig als Arbeitsfläche; Dashboard und Listen mehrspaltig |
| Ab ca. 1280 px | Dieselbe linke Navigation | Lange Editoren und Listen nebeneinander, sofern ihre Mindestbreiten passen |

Diese freigegebenen Werte sind umgesetzt. Entscheidend ist verfügbarer Platz, nicht Browser/App-Erkennung. Außenabstände ungefähr 16–20 px mobil, 24 px auf Tablet und 32 px auf Desktop; zwischen Karten 16–24 px. Sehr breite Ansichten erhalten zusätzliche Karten-/Listenfläche statt überbreiter Formularfelder.

## Gemeinsamer Rahmen

- Eine zentrale Layout-Hülle über Nuxt-Layout/App-Shell mit Navigation, Seitenbereich und sichtbaren Web-Schreib-/Fehlerhinweisen.
- Gemeinsame Navigationsdaten für Dashboard, Lebensmittel, Gerichte, Aktivitäten, Einstellungen; Profile bleiben wie bisher über Einstellungen erreichbar.
- Mobile Tabbar, Tablet-Topbar und Desktop-Seitenleiste sind responsive Darstellungen derselben Navigation. Aktive Seiten und direkte Mahlzeiteinstiege behalten ihre Zuordnung.
- Gemeinsame Seitenabstände und wiederverwendbare Grid-/Panel-Stile statt verstreuter Breitenklassen. Nicht jeden Fachbereich in neue Komponenten zerlegen.
- Pro Ansicht ein Hauptinhaltsbereich. Keine doppelt montierten Formulare, Listen oder Sync-Komponenten für verschiedene Bildschirmgrößen.
- Status-/Unsicherheitshinweise bleiben sichtbar und werden nicht hinter Navigation oder in nebensächlichen Spalten versteckt.

## Seitenbezogene Aufteilung

| Seite | Tablet/Desktop-Aufteilung |
| --- | --- |
| Dashboard ohne Profil | Profilkarten in einem adaptiven Grid. Aktivitätseingabe darunter bzw. in einem eigenen gut erreichbaren Panel; weiterhin mehrere Profile mit eigenen Einheiten. |
| Profil-Dashboard | Tagesübersicht, Kalorien-/Makroziele und Verlauf in einem Dashboard-Grid. Aktivitäten und heutige Mahlzeiten in getrennten Panels; Aktivitäten nur für dieses Profil. |
| Lebensmittel | Suche und Import gut sichtbar. Bei genügend Platz links ein kompakter Anlegen-/Bearbeitenbereich, rechts die Liste mit adaptiven Karten; auf kleineren Breiten untereinander. |
| Gerichte | Breiterer Editor für Zutaten und Nährwertvorschau; Liste daneben erst bei ausreichend Platz, insbesondere ab etwa 1280 px. Keine gequetschten Zutatenfelder. |
| Mahlzeit eintragen | Such-/Mengenformular und Verlauf nebeneinander bei ausreichend Platz. Profilauswahl und Nährwertvorschau im Formular sinnvoll gruppiert; Suchergebnisse bleiben im passenden Suchbereich. |
| Aktivitäten | Vorlagenformular und Tagesbuchung als Eingabepanels; Vorlagen und historische Einträge daneben/darunter. Die unterschiedliche Profilauswahl bleibt unverändert. |
| Profile | Formular und Profilkarten getrennt; Karten nutzen zusätzliche Breite. Bestehender Editierzustand bleibt erhalten. |
| Einstellungen | Allgemeine Einstellungen und die tatsächlich verfügbaren Daten-/Sync-Bereiche in sinnvollen Panels. Native Backup/Sync bleiben native-only; Web-Sicherheitshinweise bleiben erhalten. |

## Schematischer Desktop-Aufbau

```text
┌──────────────────┬────────────────────────────────────────────────────┐
│ Munchling        │ Seitentitel                   Hauptaktion           │
│                  ├────────────────────────────────────────────────────┤
│ Dashboard        │ Schreib-/Fehlerhinweis, wenn vorhanden              │
│ Lebensmittel     ├──────────────────────┬─────────────────────────────┤
│ Gerichte         │ Formular / Übersicht │ Liste / Verlauf / Karten    │
│ Aktivitäten      │                      │                             │
│ Einstellungen    │ lesbare Feldbreiten  │ nutzt zusätzliche Breite    │
└──────────────────┴──────────────────────┴─────────────────────────────┘
```

Mobil stehen dieselben Bereiche in sinnvoller Reihenfolge untereinander; unten bleibt die Tabbar. Das Schema ist eine gemeinsame Grundlage, kein identisches Zwei-Spalten-Raster für jede Seite.

## Umsetzungsreihenfolge

1. Zentrale Layout-Hülle und responsive Navigation einführen; wiederholte Seitenbreiten/Abstände entfernen.
2. Dashboard und Profil-Dashboard als Referenz umstellen.
3. Lebensmittel, Gerichte, Mahlzeitformular, Aktivitäten und Profile an ihre fachlich passende Aufteilung anpassen.
4. Einstellungen, Statusmeldungen, leere Zustände und lange Inhalte prüfen.
5. Gezielte responsive Browserprüfungen und Typprüfung, anschließend erforderliche Builds. App-/Dokploy-Live-Abnahme erst nach Abschluss des gesamten Layoutpunkts.

## Qualitäts- und Abnahmekriterien

- Stichproben bei 320/390 px, 768 px, 1024 px, 1440 px und etwa 1920 px; relevante Ansichten zusätzlich mit 200 % Browserzoom.
- Auf großen Bildschirmen kein zentraler `max-w-md`-Streifen mehr; Karten/Arbeitsbereiche nutzen die Breite tatsächlich.
- Kein horizontaler Seiten-Scroll durch lange Namen, EANs, Fehlermeldungen oder Zutaten. Technische Vollfeldanzeigen dürfen bei Bedarf lokal scrollen, nicht die ganze Seite verbreitern.
- Touchziele mindestens 44 px, Eingaben weiterhin mindestens 16 px; sinnvolle Tastaturreihenfolge, sichtbarer Fokus, Labels und Dark Mode erhalten.
- Keine Überdeckung durch Safe Areas, Navigation oder Bildschirmtastatur; Hoch-/Querformat prüfen.
- Ein Größenwechsel oder Drehen des Geräts verliert keine Entwürfe, Quellenauswahl, Profilmengen oder geöffnete Einträge und löst keine Speicherung/Synchronisierung aus.
- Direkte Mahlzeitlinks, Portionsgrößen, Aktivitätsbonus und vorhandene Sicherheits-/Schreibfences funktionieren unverändert.

## Bewusst nicht enthalten

Keine Änderungen an Datenmodellen, Migrationen, Backups, Sync-/Journal-Logik, automatischem Sync oder serverseitigen Zugriffsregeln. Kein neuer UI-Framework-Wechsel, keine zusätzlichen Navigationsziele und keine Komfortfeatures außerhalb der Roadmap. Planung allein verursacht keine Builds, APK-Installation, Pushes oder Deployments.

## Überprüfung

`pnpm generate && pnpm test:responsive` prüft die Seiten einschließlich der separaten Aktivitätseingabe mit gefüllten Testdaten und langen Namen/EANs bei 320/390/767/768/1023/1024/1440/1920 px. Dazu kommen zoomgroße CSS-Viewports, Querformat, verringerte Höhe für Bildschirmtastaturen, Dark Mode und die Position des Web-Schreibhinweises. Größenwechsel müssen dieselben Formular-DOM-Knoten und ungespeicherten Werte erhalten. Ein abschließender Backup-Export vergleicht die gespeicherten Fachdaten vollständig mit dem importierten Testbestand. Das läuft in einer isolierten Browserdatenbank, nicht auf den Haushaltsdaten.

Zur ursprünglichen Layoutabnahme: 38 gezielte UI-/Navigationsprüfungen, Typecheck, Server-/Static-/Android-Build, 69 responsive Browserfälle und der bestehende Browser-Backup-Smoke bestanden. Die Fachskripte aller acht Seiten sind unverändert; Logo und Kalorienanzeige bleiben auch mit langen Namen lesbar.

Die Dashboard-Aktivitätseingabe liegt nun auf `/activity-log`, optional mit `?profile=<id>` für genau ein Profil. Beide Dashboard-Ansichten laden ihren Aktivitätsbonus unabhängig vom Eingabeformular. Die erweiterte Browsermatrix prüft auch die Links, Profilbegrenzung, ungültige Profile und Formularentwürfe dieser Seite.

Die Browserprüfung ist keine iOS-Abnahme und ersetzt nicht den echten Handy-/Dokploy-Test. Optionale Bildschirmbilder bleiben unter `MUNCHLING_RESPONSIVE_ARTIFACT_DIR`; ohne diese Variable liegen sie beim temporären Browserprofil. Automatischer Sync bleibt aus.
