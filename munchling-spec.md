Hier ist ein Entwurf für eine System-Prompts- oder Spezifikations-Markdown-Datei. Diese Struktur ist so optimiert, dass ein KI-Codegenerator (wie z. B. Cursor, GitHub Copilot Workspace oder Claude) die Architektur, das Datenbankschema und die funktionalen Anforderungen präzise interpretieren und umsetzen kann.

***

# `munchling-spec.md`

```markdown
# Spezifikation: Munchling - Lokaler Kalorien- & Nährwerttracker

Munchling ist eine mobile Hybrid-App für iOS und Android, entwickelt mit Nuxt 4, Vue und Capacitor. Die App ermöglicht das lokale Tracking von Kalorien und Makronährstoffen für mehrere Profile auf demselben Gerät. Alle Daten verbleiben lokal auf dem Gerät in einer SQLite-Datenbank.

---

## 1. Technischer Stack

- **Frontend-Framework:** Nuxt 4 (Vue 3, Composition API)
- **Kompilierung/Mobile Bridge:** Capacitor (für iOS & Android)
- **Datenbank:** SQLite via `@capacitor-community/sqlite` (für lokalen Datenerhalt)
- **Styling:** Tailwind CSS oder UnoCSS (Unterstützung für System-Dark/Light-Mode)
- **Icons:** Iconify / Nuxt Icon
- **Lokalisierung:** Nuxt i18n (Unterstützte Sprachen: Deutsch `de`, Englisch `en`)
- **Barcode-Scanner:** `@capacitor-community/barcode-scanner` oder ein vergleichbares Capacitor-Plugin für nativen Kamera-Zugriff

---

## 2. Datenbank-Schema (SQLite)

Die lokale SQLite-Datenbank muss über Migrationen initialisiert werden. Folgendes relationales Schema ist zu implementieren:

```sql
-- 1. Profile
CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    daily_calories_target INTEGER NOT NULL,
    daily_protein_target INTEGER,
    daily_carbs_target INTEGER,
    daily_fat_target INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Lebensmittel (Einzelne Zutaten / Produkte)
CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_de TEXT NOT NULL,
    name_en TEXT NOT NULL,
    brand TEXT,
    ean TEXT UNIQUE, -- Kann NULL sein, wenn kein Barcode vorhanden
    calories_per_100g REAL NOT NULL,
    fat_per_100g REAL NOT NULL,
    carbs_per_100g REAL NOT NULL,
    sugar_per_100g REAL NOT NULL,
    fiber_per_100g REAL NOT NULL,
    protein_per_100g REAL NOT NULL,
    salt_per_100g REAL NOT NULL,
    is_custom INTEGER DEFAULT 0 -- 1 für selbst angelegte, 0 für Standarddatenbank
);

-- 3. Gerichte (Kombinationen aus Lebensmitteln oder anderen Gerichten)
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_de TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description TEXT,
    is_sub_recipe INTEGER DEFAULT 0 -- Kennzeichnung, ob es als Untergericht dient
);

-- 4. Rezept-Zutaten (Verknüpfungstabelle)
-- Ein Gericht kann aus Lebensmitteln (food_id) ODER anderen Gerichten (sub_recipe_id) bestehen.
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    food_id INTEGER,
    sub_recipe_id INTEGER,
    amount_grams REAL NOT NULL,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
    FOREIGN KEY (sub_recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    CHECK (
        (food_id IS NOT NULL AND sub_recipe_id IS NULL) OR 
        (food_id IS NULL AND sub_recipe_id IS NOT NULL)
    )
);

-- 5. Mahlzeiten-Logbucheinträge (Verknüpft ein Lebensmittel/Gericht mit dem Verzehrzeitpunkt)
CREATE TABLE IF NOT EXISTS meal_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    logged_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    food_id INTEGER,
    recipe_id INTEGER,
    total_weight_grams REAL NOT NULL,
    FOREIGN KEY (food_id) REFERENCES foods(id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
    CHECK (
        (food_id IS NOT NULL AND recipe_id IS NULL) OR 
        (food_id IS NULL AND recipe_id IS NOT NULL)
    )
);

-- 6. Mahlzeiten-Profile (Welcher Nutzer hat wie viel davon gegessen)
-- Erlaubt es, einen Log-Eintrag auf mehrere Personen mit unterschiedlichen Portionen aufzuteilen
CREATE TABLE IF NOT EXISTS meal_log_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meal_log_id INTEGER NOT NULL,
    profile_id INTEGER NOT NULL,
    portion_factor REAL NOT NULL DEFAULT 1.0, -- Multiplikator für den Anteil der Portion (z.B. 0.5 für die Hälfte)
    FOREIGN KEY (meal_log_id) REFERENCES meal_logs(id) ON DELETE CASCADE,
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);
```

---

## 3. Funktionale Anforderungen

### 3.1 Profilverwaltung (Multi-Personen)
- Screen zum Erstellen, Bearbeiten und Löschen von Profilen.
- Jedes Profil hat eigene Zielwerte (Kalorien, Fett, Kohlenhydrate, Zucker, Ballaststoffe, Eiweiß, Salz).
- Schneller Profilwechsler in der UI (z. B. im Header oder Dashboard), um das aktuelle Tracking-Profil umzuschalten.

### 3.2 Lebensmittel-Erfassung & Barcode-Scanner (EAN)
- **EAN-Scanner:** Integration eines nativen Barcode-Scanners über Capacitor. Beim Scannen wird die SQLite-Datenbank nach der EAN durchsucht. Falls nicht vorhanden, wird ein Formular zum Anlegen geöffnet.
- **Manuelles Anlegen:** Formular zur Eingabe von Name (DE/EN), Marke, EAN (optional) und den Nährwerten bezogen auf 100g/100ml.

### 3.3 Rezept- und Gerichte-Builder
- Erstellung von Gerichten, die aus einer Liste von Zutaten (Lebensmittel) bestehen.
- Unterstützung von Untergerichten (ein Gericht kann ein anderes Gericht als Zutat enthalten).
- Automatische Berechnung der Gesamtnährwerte des Gerichts basierend auf den Zutaten und deren Gewicht.

### 3.4 Logbuch (Mahlzeiten eintragen)
- Einem oder mehreren Profilen gleichzeitig eine Mahlzeit zuweisen.
- **Beispiel:** Ein Gericht "Nudeln mit Tomatensoße" wird für Profil A (Portionsgröße: 150g) und Profil B (Portionsgröße: 250g) im gleichen Schritt eingetragen.
- Kalorien- und Nährwertberechnung im Logbuch erfolgt dynamisch anhand der verzehrten Menge (Gramm) und der Nährwerte pro 100g des Lebensmittels/Gerichts.

### 3.5 Dashboard & Tracking-Anzeige
- Übersichtliche Darstellung des Tagesfortschritts für das aktuell ausgewählte Profil.
- Fortschrittsbalken oder Ringdiagramme für:
  - Kalorien (Ist vs. Soll)
  - Makronährstoffe (Fett, Kohlenhydrate, Eiweiß)
  - Mikronährstoffe (Zucker, Ballaststoffe, Salz)
- Historie der eingetragenen Mahlzeiten des aktuellen Tages mit Lösch- und Bearbeitungsoption.

---

## 4. UI/UX & Design-Richtlinien

- **Theme:** Modernes, minimalistisches Design. Vollständige Unterstützung von Light- und Dark-Mode über Tailwind CSS Media Queries (`dark:`-Klasse, die sich nach dem System-Theme des Betriebssystems richtet).
- **Navigation:** Tab-Bar am unteren Bildschirmrand (Dashboard, Lebensmittel/Gerichte, Profile, Einstellungen).
- **Mobile-first:** Alle UI-Komponenten müssen für Touch-Bedienung optimiert sein (ausreichend große Tap-Targets, Wischgesten wo sinnvoll).

---

## 5. Lokalisierung (i18n)

Alle Texte, Labels und Fehlermeldungen müssen über Übersetzungsdateien gelöst werden:
- `locales/de.json`
- `locales/en.json`

Die App liest die Systemsprache aus und stellt sich standardmäßig auf Deutsch oder Englisch ein. In den Einstellungen kann die Sprache manuell überschrieben werden.

---

## 6. Implementierungs-Fahrplan (Schritt-für-Schritt)

### Phase 1: Projekt-Setup & Capacitor
1. Initialisierung eines Nuxt 4 Projekts.
2. Integration von Capacitor für Android und iOS.
3. Installation und Konfiguration des SQLite-Plugins (`@capacitor-community/sqlite`).

### Phase 2: Datenbankschicht
1. Erstellung der Datenbank-Service-Klasse in Nuxt (z. B. als Plugin oder Composables).
2. Implementierung der Tabellen-Erstellung und Seeding-Skripte für erste Testdaten.
3. CRUD-Operationen für Profile, Foods und Recipes bereitstellen.

### Phase 3: Profil- und Lebensmittelverwaltung (UI)
1. Erstellung der UI für die Profilverwaltung.
2. Erstellung der UI für die Lebensmittelsuche und das manuelle Anlegen von Lebensmitteln.
3. Integration des Barcode-Scanners über Capacitor.

### Phase 4: Gerichte & Logbuch-Logik
1. Implementierung des Rezept-Builders inklusive der Berechnung verschachtelter Nährwerte.
2. Erstellung des Formulars zur Eintragung von Mahlzeiten (inklusive Multi-Nutzer-Auswahl und Gewichtsanpassung).

### Phase 5: Dashboard & i18n
1. Gestaltung des Dashboards mit Nährwertfortschritten für das ausgewählte Profil.
2. Implementierung des Sprachwechsels.
3. Feinschliff des Dark/Light-Modes basierend auf den Systemeinstellungen.
```
