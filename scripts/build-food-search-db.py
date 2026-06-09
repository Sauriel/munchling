#!/usr/bin/env python3
from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
XLSX_PATH = ROOT / "data" / "BLS_4_0_Daten_2025_DE.xlsx"
OUT_DIR = ROOT / "public" / "databases"
DB_PATH = OUT_DIR / "bls-foods.db"
SQL_WASM_SOURCE = ROOT / "node_modules" / "sql.js" / "dist" / "sql-wasm.wasm"
SQL_WASM_TARGET = ROOT / "public" / "sql-wasm.wasm"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COLUMNS = {
    "bls_code": 0,
    "name_de": 1,
    "name_en": 2,
    "calories_per_100g": 6,
    "protein_per_100g": 12,
    "fat_per_100g": 15,
    "carbs_per_100g": 18,
    "fiber_per_100g": 21,
    "salt_per_100g": 120,
    "sugar_per_100g": 219,
}


def column_index(cell_ref: str) -> int:
    letters = re.match(r"[A-Z]+", cell_ref or "")
    if not letters:
        return 0
    index = 0
    for char in letters.group(0):
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def numeric(value: str | None) -> float:
    if value is None or value == "" or value == "-":
        return 0.0
    try:
        return round(float(value), 4)
    except ValueError:
        return 0.0


def load_shared_strings(zip_file: ZipFile) -> list[str]:
    root = ET.fromstring(zip_file.read("xl/sharedStrings.xml"))
    shared_strings: list[str] = []
    for item in root.findall("m:si", NS):
        text = "".join(
            part.text or ""
            for part in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")
        )
        shared_strings.append(text)
    return shared_strings


def iter_rows():
    with ZipFile(XLSX_PATH) as zip_file:
        shared_strings = load_shared_strings(zip_file)
        with zip_file.open("xl/worksheets/sheet1.xml") as sheet:
            for event, elem in ET.iterparse(sheet, events=("end",)):
                if not elem.tag.endswith("}row"):
                    continue
                row_number = int(elem.attrib.get("r", "0"))
                if row_number == 1:
                    elem.clear()
                    continue

                values: dict[int, str] = {}
                for cell in elem.findall("m:c", NS):
                    value_element = cell.find("m:v", NS)
                    value = value_element.text if value_element is not None else ""
                    if cell.attrib.get("t") == "s" and value:
                        value = shared_strings[int(value)]
                    values[column_index(cell.attrib.get("r", ""))] = value

                yield {
                    key: values.get(index, "")
                    for key, index in COLUMNS.items()
                }
                elem.clear()


def main() -> None:
    if not XLSX_PATH.exists():
        raise SystemExit(f"Missing source XLSX: {XLSX_PATH}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    connection = sqlite3.connect(DB_PATH)
    cursor = connection.cursor()
    cursor.execute("PRAGMA journal_mode = OFF")
    cursor.execute("PRAGMA synchronous = OFF")
    cursor.execute(
        """
        CREATE TABLE bundled_foods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bls_code TEXT NOT NULL UNIQUE,
            name_de TEXT NOT NULL,
            name_en TEXT NOT NULL,
            search_text TEXT NOT NULL,
            calories_per_100g REAL NOT NULL,
            fat_per_100g REAL NOT NULL,
            carbs_per_100g REAL NOT NULL,
            sugar_per_100g REAL NOT NULL,
            fiber_per_100g REAL NOT NULL,
            protein_per_100g REAL NOT NULL,
            salt_per_100g REAL NOT NULL
        )
        """
    )

    insert_sql = """
        INSERT INTO bundled_foods (
            bls_code, name_de, name_en, search_text,
            calories_per_100g, fat_per_100g, carbs_per_100g,
            sugar_per_100g, fiber_per_100g, protein_per_100g, salt_per_100g
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    count = 0
    for row in iter_rows():
        name_de = str(row["name_de"]).strip()
        name_en = str(row["name_en"]).strip()
        bls_code = str(row["bls_code"]).strip()
        if not bls_code or not name_de:
            continue
        cursor.execute(
            insert_sql,
            (
                bls_code,
                name_de,
                name_en or name_de,
                f"{name_de} {name_en}".lower(),
                numeric(row["calories_per_100g"]),
                numeric(row["fat_per_100g"]),
                numeric(row["carbs_per_100g"]),
                numeric(row["sugar_per_100g"]),
                numeric(row["fiber_per_100g"]),
                numeric(row["protein_per_100g"]),
                numeric(row["salt_per_100g"]),
            ),
        )
        count += 1

    cursor.execute("CREATE INDEX idx_bundled_foods_search_text ON bundled_foods(search_text)")
    cursor.execute("CREATE INDEX idx_bundled_foods_name_de ON bundled_foods(name_de)")
    connection.commit()
    connection.close()

    if SQL_WASM_SOURCE.exists():
        SQL_WASM_TARGET.write_bytes(SQL_WASM_SOURCE.read_bytes())

    print(f"Wrote {count} bundled foods to {DB_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
