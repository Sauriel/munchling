# Android: private Homelab-Adresse mit mkcert

Eine erfolgreiche Navigation in Firefox beweist weder DNS-/CA-Vertrauen der App-WebView noch CORS-Freigabe. Eine Browser-Zertifikatsausnahme und das Munchling-Vertrauenshäkchen installieren **keine CA in Android**. Das Häkchen bestätigt nur die bewusst gewählte sichere Serveradresse/Netzwerkgrenze.

## 1. DNS zuerst

`net::ERR_NAME_NOT_RESOLVED` tritt vor TLS/HTTP auf. Android muss `munchling.homelab.lan` auf den Haushaltsserver auflösen können. Keine IP-Adresse statt Hostname eintragen: Das mkcert-Zertifikat gilt für den DNS-Namen, nicht automatisch für die IP.

- Im WLAN/VPN die vorgesehenen internen DNS-Server verwenden. Alle per DHCP/IPv6 angebotenen Resolver müssen die interne Zone kennen; ein öffentlicher/Router-Fallback, der NXDOMAIN liefert, ist kein gleichwertiger Ersatz.
- DNS benötigt normalerweise **UDP und TCP Port 53**. Bei DNS-Containern beide Ports veröffentlichen und Firewall/LAN-Zugriff prüfen. Wenn `dig @DNS HOST A` scheitert, `dig @DNS HOST A +tcp` aber funktioniert, TCP allein reicht für gewöhnliche Android-Anfragen nicht.
- Privates DNS/Browser-DoH separat prüfen, nicht ohne Diagnose dauerhaft abschalten. Nach DNS-Korrektur WLAN neu verbinden bzw. App neu starten, um alte negative Auflösung loszuwerden.

## 2. mkcert-CA bewusst installieren

Die App erlaubt unter `android/app/src/main/res/xml/network_security_config.xml` zusätzlich benutzerinstallierte CA-Zertifikate **nur für exakt `munchling.homelab.lan`**, ohne Subdomains. Andere Server behalten Android-System-CA-Vertrauen; Klartext bleibt verboten. Signatur, Gültigkeit und Hostname werden weiterhin geprüft. Keine Root-CA und kein Schlüssel werden in die APK eingebettet; keine `SslErrorHandler.proceed()`-/Trust-all-Ausnahme.

Auf dem vertrauenswürdigen mkcert-Rechner:

```sh
# Ausschließlich das öffentliche CA-Zertifikat, niemals rootCA-key.pem!
openssl x509 -in "$(mkcert -CAROOT)/rootCA.pem" -outform DER -out munchling-homelab-ca.crt
openssl x509 -in "$(mkcert -CAROOT)/rootCA.pem" -noout -fingerprint -sha256
adb push munchling-homelab-ca.crt /sdcard/Download/munchling-homelab-ca.crt
```

Das öffentliche CA-Zertifikat muss zur tatsächlich ausstellenden Server-CA passen; Fingerprint vor der Installation über den vertrauenswürdigen Rechner vergleichen. Kein beliebiges Zertifikat aus einer Warnseite installieren.

Am Handy selbst (Menüs unterscheiden sich je nach Hersteller): **Einstellungen → Sicherheit/Datenschutz → Weitere Sicherheitseinstellungen → Verschlüsselung und Anmeldedaten → Zertifikat installieren → CA-Zertifikat**. Datei `Download/munchling-homelab-ca.crt` auswählen und die Vertrauensentscheidung bewusst bestätigen. Ein CA-Zertifikat ist eine mächtige Vertrauensentscheidung: Apps, die Benutzer-CAs akzeptieren, können dadurch Zertifikaten dieser CA vertrauen. Nicht lediglich als WLAN-/Clientzertifikat installieren. Gerät nicht fremdgesteuert entsperren; Installation erledigt der Eigentümer.

Für einen anderen Haushaltsnamen muss die eng begrenzte App-Domainregel ausdrücklich angepasst und die APK neu gebaut werden. Kein globales `src="user"` in die Basisregel setzen. iOS-Vertrauen ist separat einzurichten und nicht durch Android-Tests abgenommen.

## 3. Exakte native Origin im laufenden Server erlauben

Diese Android-App hat `androidScheme: "https"`, daher ist die echte Request-Origin **`https://localhost`**, nicht `http://localhost`:

```env
NUXT_SYNC_PUBLIC_ORIGIN=https://munchling.homelab.lan
NUXT_SYNC_ALLOWED_ORIGINS=capacitor://localhost,https://localhost,http://localhost
```

In Dokploy als **Runtime-Variablen** setzen und neu deployen. Keine Wildcards/Credentials-Freigabe. iOS normalerweise `capacitor://localhost`; HTTP-Origin nur freigeben, wenn eine entsprechende vertrauenswürdige Clientkonfiguration benötigt wird.

Mit korrektem DNS/CA muss der GET-Preflight funktionieren:

```sh
curl -i -X OPTIONS 'https://munchling.homelab.lan/api/sync/info' \
  -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: X-Munchling-Protocol'
```

Erwartet: **204**, `Access-Control-Allow-Origin: https://localhost`. 403/fehlender CORS-Header kann in `fetch()` als allgemeines `network` erscheinen; der Browser kann die Fehlermeldung dann nicht lesen. TLS nicht mit `curl -k` umgehen, um Erfolg zu behaupten.

## Diagnose ohne Umbindung/Uploads

Debug-WebView via ADB-Forward/CDP: nur einen GET auf `/api/sync/info` mit Versionsheader und `credentials:omit` ausführen. `Network.loadingFailed` unterscheidet Name-/CA-/CORS-Fehler; keine automatischen Snapshot-/Upload-Retries, keine Serverbindung verändern. Nur Status/Fehler und Origin ausgeben, keine Haushaltsbestände. Forward anschließend entfernen. Android-Debug-SQL-Logs enthalten private Daten.

`tests/domain/native-network.test.ts` schützt die eng begrenzte Benutzer-CA-Regel und die Deployment-Origin-Beispiele; echte Nitro-Tests in `tests/server/http.test.ts` prüfen Android-GET-/POST-Preflight, CORS und abgewiesene fremde/lookalike Origins. APK-Build validiert die Android-XML-Ressource. Das ersetzt keine tatsächliche DNS-/CA-Installation-/Sync-Abnahme auf dem Gerät.
