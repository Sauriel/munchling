#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Confirmation must come from the caller, not a permanently saved .env value.
BACKUP_CONFIRMATION="${ANDROID_BACKUP_CONFIRMED:-false}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
if [[ -f "$ENV_FILE" ]]; then
	# Local configuration is shell code: only source a file you trust.
	set -a
	# shellcheck disable=SC1090
	source "$ENV_FILE"
	set +a
fi

# Respect explicit settings; otherwise use standard SDK/JDK discovery.
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [[ -z "$ANDROID_HOME" ]]; then
	for candidate in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "$HOME/android-sdk"; do
		if [[ -d "$candidate" ]]; then ANDROID_HOME="$candidate"; break; fi
	done
fi
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
ADB_BIN="${ADB_BIN:-${ANDROID_HOME:+$ANDROID_HOME/platform-tools/adb}}"
if [[ -z "$ADB_BIN" || ! -x "$ADB_BIN" ]]; then ADB_BIN="$(command -v adb || true)"; fi
if [[ -z "$ADB_BIN" || ! -x "$ADB_BIN" ]]; then
	echo "ADB nicht gefunden. Setze ANDROID_HOME oder ADB_BIN." >&2; exit 1
fi

if [[ -z "${JAVA_HOME:-}" ]]; then
	if [[ -x /usr/libexec/java_home ]]; then
		JAVA_HOME="$(/usr/libexec/java_home -v 21)"
	else
		java_path="$(command -v java || true)"
		if [[ -n "$java_path" ]]; then
			JAVA_HOME="$("$java_path" -XshowSettings:properties -version 2>&1 | awk '/^[[:space:]]*java.home = / { sub(/^[[:space:]]*java.home = /, ""); print }')"
		fi
	fi
fi
if [[ -z "${JAVA_HOME:-}" || ! -x "$JAVA_HOME/bin/java" || ! -x "$JAVA_HOME/bin/javac" ]]; then
	echo "JDK 21 nicht gefunden. Setze JAVA_HOME." >&2; exit 1
fi
java_version="$("$JAVA_HOME/bin/java" -version 2>&1 | head -n 1)"
if [[ ! "$java_version" =~ \"21([.\"]|$) ]]; then
	echo "JDK 21 erforderlich; bitte JAVA_HOME prüfen." >&2; exit 1
fi
export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:${ANDROID_HOME:+$ANDROID_HOME/platform-tools:}$PATH"

# Acknowledgement is not a backup: make a fresh independent external copy first.
if [[ "$BACKUP_CONFIRMATION" != "true" ]]; then
	echo "Vor Installation den aktuellen Bestand extern sichern." >&2
	echo "Danach: ANDROID_BACKUP_CONFIRMED=true pnpm android:update" >&2
	exit 1
fi

if [[ -z "${ADB_SERIAL:-}" ]]; then
	devices=()
	while IFS=$'\t' read -r serial state; do
		if [[ "$state" == "device" ]]; then devices+=("$serial"); fi
	done < <("$ADB_BIN" devices)
	if [[ ${#devices[@]} != 1 ]]; then
		echo "Genau ein freigegebenes Gerät verbinden oder ADB_SERIAL ausdrücklich setzen." >&2; exit 1
	fi
	ADB_SERIAL="${devices[0]}"
fi
ADB_ARGS=(-s "$ADB_SERIAL")
if [[ "$("$ADB_BIN" "${ADB_ARGS[@]}" get-state)" != "device" ]]; then
	echo "Gewähltes Gerät nicht bereit; kein automatisches Entsperren." >&2; exit 1
fi

GRADLE_TASK="${GRADLE_TASK:-assembleDebug}"
APK_PATH="${APK_PATH:-$ROOT_DIR/android/app/build/outputs/apk/debug/app-debug.apk}"
if [[ "$APK_PATH" != /* ]]; then APK_PATH="$ROOT_DIR/$APK_PATH"; fi
APP_ID="${APP_ID:-dev.munchling.app}"
OPEN_AFTER_INSTALL="${OPEN_AFTER_INSTALL:-false}"
cd "$ROOT_DIR"
echo "→ Baue gebündelte Lebensmittel-Datenbank"
pnpm food-db:build
echo "→ Generiere Nuxt Static Build"
pnpm generate
echo "→ Synchronisiere Capacitor Android"
pnpm exec cap sync android
echo "→ Baue Android APK ($GRADLE_TASK)"
(cd android && ./gradlew "$GRADLE_TASK")
if [[ ! -f "$APK_PATH" ]]; then echo "APK nicht gefunden: $APK_PATH" >&2; exit 1; fi
# Recheck the same device after the build; never silently choose a replacement.
if [[ "$("$ADB_BIN" "${ADB_ARGS[@]}" get-state)" != "device" ]]; then
	echo "Gewähltes Gerät nach Build nicht bereit." >&2; exit 1
fi
echo "→ Aktualisiere APK ohne Reset"
"$ADB_BIN" "${ADB_ARGS[@]}" install -r "$APK_PATH"
if [[ "$OPEN_AFTER_INSTALL" == "true" ]]; then
	echo "→ Starte App"
	"$ADB_BIN" "${ADB_ARGS[@]}" shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null
fi
echo "✓ Android-App wurde aktualisiert."
