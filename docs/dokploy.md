# Dokploy: Online-Website und MariaDB

## Lieferstand und Sicherheitsgrenze

Der Docker-Build liefert einen Nitro-Node-Server mit der bearbeitbaren Online-Website. Fachdaten liegen in MariaDB; Browser-SQLite/Restore sind deaktiviert. Native Sync bleibt optional und ausgeschaltet; der Native-Runner folgt. Android-Prüfung erst mit deploybarem Server.

**Keine Anwendungsauthentifizierung. Nicht als frei zugängliche Internet-Anwendung veröffentlichen.** Website **und alle API-/Health-Pfade** durch VPN/privates Netz bzw. eine tatsächlich getestete vorgeschaltete Zugangsbeschränkung schützen. TLS allein beschränkt keinen Zugriff. Der Client verwendet derzeit `credentials: omit`; eine vorgeschaltete Cookie-/Basic-Auth-Lösung ist deshalb nicht ohne Anpassung/Abnahme zugesichert. VPN/Netzwerkbeschränkung ist der einfache Weg.

## 1. MariaDB-Dienst

- MariaDB 11.4 als separaten Dokploy-Dienst erstellen.
- Persistentes Datenvolume bereitstellen; MariaDB-Port nicht öffentlich veröffentlichen.
- App und DB benötigen ein gemeinsames internes Netzwerk. Als Host den **internen DNS-Namen des DB-Dienstes**, nicht `localhost`, verwenden.
- Datenbank `munchling`, Charset `utf8mb4`, binäre Collation; dedizierten DB-Benutzer mit zufälligem Passwort einrichten. Keine Root-Zugangsdaten in die App.
- Vor App-Start sicherstellen, dass MariaDB erreichbar/initialisiert ist. Bei vorübergehendem Startfehler App erneut starten; Startup-Migrationen dürfen nicht durch einen vorgetäuschten Health-Erfolg übergangen werden.

Der App-Benutzer benötigt Fachrechte (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) plus die erforderlichen Schema-Rechte (`CREATE`, `ALTER`, `INDEX`, `REFERENCES`) **nur auf `munchling.*`**, weil dieser Stand beim Start versionierte Migrationen ausführt. Kein globales `GRANT ALL`, kein Benutzer-/Systemdatenbankzugriff. Schema-Migrationen mit checksumbasierten Markern und Lock; veröffentlichte Migrationen nicht verändern. Später kann ein separater Migrationsjob diese erweiterten Rechte aus dem Laufzeitnutzer entfernen; dieser Stand macht das noch nicht.

## 2. Anwendung aus dem Repository

1. Getesteten Code inklusive Dockerfile, Lockfile und `public/databases/bls-foods.db` in das Deployment-Repository übernehmen.
2. Dokploy-Anwendung mit **Dockerfile** als Buildtyp und `Dockerfile` im Projektroot konfigurieren; Build-Kontext Repositoryroot.
3. Containerport **3000** an den Dokploy-Reverse-Proxy anbinden, keine zusätzlichen offenen Direktports. TLS-Domain einrichten und Netzwerkzugang beschränken.
4. Runtime-Variablen setzen, **nicht als Build-Argumente**:

```dotenv
NUXT_SYNC_PUBLIC_ORIGIN=https://munchling.example.internal
NUXT_SYNC_ALLOWED_ORIGINS=capacitor://localhost,https://localhost,http://localhost
NUXT_MARIA_DB_HOST=INTERNER_DOKPLOY_DB_HOST
NUXT_MARIA_DB_PORT=3306
NUXT_MARIA_DB_DATABASE=munchling
NUXT_MARIA_DB_USER=munchling_app
NUXT_MARIA_DB_PASSWORD=EIN_ZUFAELLIGES_GEHEIMES_PASSWORT
NUXT_MARIA_DB_CONNECTION_LIMIT=5
NITRO_HOST=0.0.0.0
NITRO_PORT=3000
```

`NUXT_SYNC_PUBLIC_ORIGIN` ist die exakte externe Origin, ohne Pfad, Query oder Zugangsdaten. Für reine Webnutzung sind zusätzliche erlaubte Origins nicht erforderlich. Die angegebenen Capacitor-Origins nur freigeben, wenn die native App verwendet werden soll; keine Wildcards. Diese Android-App verwendet durch `androidScheme: "https"` tatsächlich **`https://localhost`**, iOS normalerweise `capacitor://localhost`. Nach einer Runtime-Änderung neu deployen. Native DNS-/CA-/CORS-Diagnose: [native-homelab-https.md](native-homelab-https.md).

Nuxt lädt im Produktionsstart **keine `.env` automatisch**. Variablen müssen dem Container tatsächlich als Runtime-Umgebung übergeben werden. `NUXT_PUBLIC_DATA_MODE` nicht auf `local` überschreiben; der Server-Build setzt `online`. MariaDB-Zugangsdaten bleiben ausschließlich serverseitig.

**Proxy:** Der tatsächliche `Host` der API-Anfrage muss zur konfigurierten externen Origin passen. Der Server vertraut `X-Forwarded-Host` ausdrücklich nicht. Dokploy-/Proxy-Routing deshalb mit erhaltenem ursprünglichem Host betreiben und testen. Externe TLS-Terminierung ist erlaubt; die innere Verbindung muss nicht ebenfalls HTTPS verwenden.

## 3. Image und Betrieb

Der Multi-Stage-Dockerfile verwendet die unterstützte Node-22-Linie auf Debian slim und festes pnpm 10.33.0 mit `--frozen-lockfile`. Das Node-Majortag erhält aktuelle Patch-/Sicherheitsupdates; für eingefrorene Release-Reproduktion das geprüfte Basisimage nach Sicherheitsprüfung zusätzlich per Digest pinnen. Updates regelmäßig erneut bauen/testen.

Der Build regeneriert Nuxt-Typen **nach** dem Kopieren der Quellen und im Servermodus: ein Paketcache-`postinstall` allein kennt noch nicht die Anwendung. Typprüfungen bleiben aktiv. BLS ist ein versioniertes Vorbuild-Artefakt; Python/XLSX werden nicht in den Docker-Build übernommen. WASM wird aus den gepinnten npm-Paketen vorbereitet.

Runtime enthält nur `.output`, läuft als Benutzer `node`, bindet auf `0.0.0.0:3000` und benötigt kein persistentes App-Volume. DB-Volume ist zwingend. `.dockerignore` schließt `.env`, private lokale Datenbanken, Git, Dependencies und native Build-Artefakte aus. Keine Secrets in Image/Buildlogs einbetten.

- Liveness: `GET /api/health/live`
- Readiness: `GET /api/health/ready`; Erfolg erst nach verfügbarer DB/Migration.
- Docker-Healthcheck fragt Readiness auf Loopback ab. Startperiode 60 s; bei größeren Migrationen bewusst anpassen.
- SIGTERM schließt Nitro und MariaDB-Pool. Stop-/Redeploy-Grace mindestens 15 s, bei lang laufenden Requests höher.
- Optional read-only Root-Filesystem mit beschreibbarem `/tmp`; isolierter Test läuft so erfolgreich. Im normalen Dokploy-Betrieb ist das kein notwendiger Sonderparameter.

## 4. Abnahme auf Dokploy

Nach Deployment:

1. Health prüfen, API-Info mit konfigurierter Host-/Origin und tatsächliches Proxy-Routing testen.
2. Website öffnen, Profil/Lebensmittel/Gericht/Mahlzeit anlegen und Browser neu laden: Bestand muss vom Server kommen.
3. Zweiter Tab/Browser: konkurrierende Formularbearbeitung muss Konflikt melden, ohne Entwurf still zu überschreiben.
4. API darf nicht von nicht freigegebenen Origins/Hosts akzeptiert werden. Netzwerkbeschränkung nicht nur über CORS behaupten.
5. Redeploy durchführen; IDs/Fachdaten müssen erhalten bleiben. Ein App-Redeploy ist **kein** DB-Reset.
6. Ausstehende Browser-Schreibjournale bewusst klären; nicht löschen, wenn ein Receipt verloren sein könnte. Keine automatischen Wiederholungen.
7. Erst jetzt Android-Netzwerk-/Laufzeittests anschließen. Native-Runner ist ein eigener anschließender Schritt, kein bereits aktiver Dienst.

## 5. Backup, Restore und Rollback

MariaDB regelmäßig extern sichern (einschließlich Sync-Registry, Receipts, Change-Log und Serverzustand). Backup und App-Version/Migrationsstand gemeinsam dokumentieren; Backup-Dateien enthalten Haushaltsdaten und gehören nicht ins Repository/Image. Wiederherstellung zunächst auf einer isolierten Instanz prüfen.

Bei MariaDB-Restore alle Writer stoppen, DB kontrolliert wiederherstellen und **Server-Epoch erneuern, bevor Clients zugreifen**. Verfahren und interne `rotateServerEpoch()`-Funktion: [server-foundation.md](server-foundation.md). Kein unauthentifizierter Restore-/Epoch-Reset-Endpunkt. Alte Browserjournale und native Bindungen dürfen nicht ungeprüft unter neuer Epoch neu gesendet werden.

Rollback bevorzugt auf ein vorher geprüftes App-Image **mit kompatiblem Schema**, nicht durch Zurückrollen/Löschen bereits bestätigter Daten. Bei künftig neuerem Schema kann eine ältere App absichtlich den Start verweigern. Migrationen nicht nachträglich editieren oder deren Checksummen manipulieren. Im Zweifel erst Backup/isolierter Recovery-Test.

## Lokale Deployment-Abnahme

```sh
pnpm test:deployment
```

Erstellt das Docker-Image und nutzt ausschließlich den bestehenden Weg zu einer wegwerfbaren, nur auf Loopback erreichbaren MariaDB 11.4. Erfordert Linux-Docker, Node ≥22 und Chromium (`CHROMIUM_BIN` optional). Der Runtime-Container nutzt hier **nur für den isolierten Test** Host-Netzwerk/Loopback; Produktion verwendet das private Dokploy-Dienstnetz.

Geprüft: non-root/read-only Runtime, echte Browser-Profilbearbeitung ohne SQLite, Docker-Healthcheck, SIGTERM/Exit 0, Neustart bei unverändertem DB-Bestand und stabilen UI-IDs. Das ersetzt nicht das noch ausstehende Deployment auf dem konkreten Dokploy-Host und dessen TLS-/Zugangs-/Proxy-Abnahme.
