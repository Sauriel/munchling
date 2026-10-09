# TK-Kalorienrechner – Rekonstruktionsnotizen für einen Implementierungs-Agenten

**Original:** https://www.tk.de/service/app/2004134/kalorienrechner/kalorienrechner.app  
**Stand der Analyse:** 9. Oktober 2026  
**Status:** Vorläufige Rekonstruktion aus der bisherigen Untersuchung; **keine verifizierte 1:1-Extraktion des Quellcodes**.

## 1. Ziel

Baue einen Kalorienbedarfsrechner nach dem Funktionsprinzip des TK-Kalorienrechners. Unterscheide strikt zwischen der gesicherten Berechnungsgrundlage und den noch zu verifizierenden Details. Erfinde keine vermeintlich originalen TK-MET-Faktoren.

## 2. Grundlage: MET-Methode

Der Rechner verwendet nach der bisherigen Analyse das **Metabolische Äquivalent (MET)**, also einen Aktivitätsfaktor für Energieverbrauch im Verhältnis zur Ruhe.

- Näherungsweise: **1 MET = 1 kcal / (kg Körpergewicht × Stunde)**.
- Für Schlaf wurde in der bisherigen Analyse **0,95 MET** angesetzt.
- Für Arbeit und Sport sind unterschiedliche MET-Faktoren je nach Tätigkeit/Intensität zu verwenden.

Allgemeine Formel:

```text
Kalorienverbrauch [kcal] = Körpergewicht [kg] × Σ(Dauer_i [h] × MET_i)
```

Mathematisch:

$$
E = m \cdot \sum_{i=1}^{n}(t_i\cdot MET_i)
$$

Diese MET-basierte Näherung erfordert für die reine Formel weder Körpergröße noch Alter noch Geschlecht. Das bedeutet **nicht**, dass diese Merkmale physiologisch irrelevant sind.

**TK-Hintergrundartikel:** https://www.tk.de/techniker/gesundheit-foerdern/gesunde-ernaehrung/uebergewicht-und-diaet/wie-viele-kalorien-pro-tag-2006758

## 3. Bisher identifizierte Eingaben

| Bereich | Eingabedaten | Zeiteinheit |
|---|---|---|
| Körpergewicht | Gewicht | kg |
| Schlaf | Schlafdauer | Stunden pro Tag |
| Arbeit | Art: sitzend, stehend, körperlich; Dauer | Stunden pro Tag |
| Sport | Sechs Intensitätskategorien; Dauer je Kategorie | Stunden pro Woche |

**Wichtig:** Die sechs Sportkategorien und deren konkrete Labels/MET-Faktoren müssen noch am Original überprüft werden.

Sport wird auf einen Tagesdurchschnitt umgerechnet:

```text
sportHoursPerDay = sportHoursPerWeek / 7
```

## 4. Vorläufig rekonstruierter Ablauf

1. Körpergewicht, Schlafdauer, Arbeitsart und -dauer sowie Sportdauern auslesen.
2. Sportstunden je Kategorie durch sieben teilen.
3. Durchschnittliche Aktivitätsstunden eines Tages summieren.
4. Noch unbelegte Tagesstunden ermitteln: `24 - schlaf - arbeit - sportProTag`.
5. Jeder Kategorie einen MET-Faktor zuordnen.
6. Die Summe `Stunden × MET` mit dem Körpergewicht multiplizieren.
7. Ergebnis als geschätzte kcal pro Tag anzeigen.

**Nicht verifiziert:** Schritt 4 und die Behandlung der übrigen Tagesstunden mit **1 MET** sind eine plausible **Modellannahme**, nicht als originale TK-Logik nachgewiesen. Auch mögliche Überschneidungen zwischen Arbeit und Sport sind ungeklärt.

Formel des vorläufigen Modells:

$$
E_{Tag}=m\left(0{,}95\,h_{Schlaf}+MET_{Arbeit}\,h_{Arbeit}+\sum_j MET_{Sport,j}\frac{h_{Sport,j,Woche}}7+MET_{Rest}\,h_{Rest}\right)
$$

mit

$$
h_{Rest}=24-h_{Schlaf}-h_{Arbeit}-\sum_j\frac{h_{Sport,j,Woche}}7
$$

Für die Demonstration wurde `MET_Rest = 1` angenommen.

## 5. Referenzimplementierung (TypeScript, **nicht originaler TK-Code**)

```ts
type Activity = {
  hours: number;
  met: number;
};

type CalorieInput = {
  weight: number;
  sleepHours: number;
  work: Activity;      // Stunden pro Tag
  sports: Activity[];  // Stunden pro Woche
  remainingMet?: number;
};

export function calculateCalories(input: CalorieInput): number {
  const {
    weight,
    sleepHours,
    work,
    sports,
    remainingMet = 1,
  } = input;

  const sportHoursPerDay = sports.reduce(
    (sum, sport) => sum + sport.hours / 7,
    0,
  );

  const remainingHours =
    24 - sleepHours - work.hours - sportHoursPerDay;

  if (remainingHours < 0) {
    throw new Error('Mehr als 24 Stunden erfasst');
  }

  const sleepMetHours = sleepHours * 0.95;
  const workMetHours = work.hours * work.met;
  const sportMetHours = sports.reduce(
    (sum, sport) => sum + (sport.hours / 7) * sport.met,
    0,
  );
  const remainingMetHours = remainingHours * remainingMet;

  return Math.round(
    weight * (
      sleepMetHours +
      workMetHours +
      sportMetHours +
      remainingMetHours
    ),
  );
}
```

### Illustrative Faktoren – **nicht als TK-Werte übernehmen**

Für einen Prototyp wurden folgende rein beispielhafte Faktoren verwendet:

| Tätigkeit | Illustrativer MET-Wert |
|---|---:|
| Schlafen | 0,95 |
| Sitzende Arbeit | 1,5 |
| Stehende Arbeit | 2,0 |
| Körperliche Arbeit | 3,5 |
| Leichter Sport | 3,0 |
| Moderater Sport | 4,5 |
| Ausdauersport | 6,0 |
| Intensiver Sport | 8,0 |
| Restliche Tageszeit | 1,0 |

Die tatsächliche TK-Zuordnung, insbesondere die sechs Sportkategorien, ist unbekannt.

## 6. Offene Fragen für eine originalgetreue Implementierung

- Wie heißen sämtliche Felder und Sportintensitätskategorien im Original genau?
- Welche MET-Faktoren verwendet die TK pro Arbeitsart und Sportkategorie?
- Wie werden die restlichen Stunden eines Tages bewertet?
- Werden Aktivitäten addiert, gegeneinander verrechnet oder anders priorisiert?
- Wie geht der Rechner mit Zeitüberschneidungen und Summen über 24 Stunden um?
- Welche Eingabegrenzen und Standardwerte sind hinterlegt?
- Welche Rundungsregeln und Ausgabetexte verwendet die Webseite?
- Berechnet oder zeigt die Webseite neben dem Verbrauch zusätzliche Werte an?

## 7. Arbeitsauftrag für den Agenten

1. Rufe die Originalseite auf und analysiere DOM, Formularfelder, Netzwerkanfragen und ausgelieferte JavaScript-Dateien.
2. Suche insbesondere nach Rechenfunktionen, Aktivitätskonstanten, MET-Mappings, Validierung und Rundung.
3. Falls die Logik serverseitig ist, dokumentiere die API-Eingaben und -Ausgaben, statt eine Clientimplementierung zu behaupten.
4. Erzeuge bei Bedarf eine Testmatrix mit unterschiedlichen Eingaben, um die vermutete Formel empirisch mit der Ausgabe des Originals zu vergleichen.
5. Implementiere die Logik als **reine TypeScript-Funktion** mit getrennten, austauschbaren Faktor-Konstanten sowie Tests.
6. Dokumentiere für jeden Faktor, ob er aus Originalcode, beobachteter Ausgabe, TK-Dokumentation oder einer Annahme stammt.
7. Bezeichne die Rekonstruktion erst als TK-kompatibel, wenn sie anhand repräsentativer Testfälle abgeglichen wurde.

## 8. Einschränkungen und Einordnung

- Die Formel liefert eine **Schätzung**, keinen individuell gemessenen Energiebedarf.
- Eine direkte lineare Skalierung nach dem gesamten Körpergewicht kann besonders bei starkem Übergewicht unpassende Schätzungen liefern.
- MET-Werte und Schlafwert sind Näherungswerte.
- Die bisherige Analyse war **keine vollständige Code- oder Netzwerkanalyse**. Insbesondere ist die TypeScript-Referenz oben ein Vorschlag und kein extrahierter TK-Quellcode.

## Quellen

- [TK-Kalorienrechner (Original)](https://www.tk.de/service/app/2004134/kalorienrechner/kalorienrechner.app)
- [TK: Wie viele Kalorien pro Tag?](https://www.tk.de/techniker/gesundheit-foerdern/gesunde-ernaehrung/uebergewicht-und-diaet/wie-viele-kalorien-pro-tag-2006758)
