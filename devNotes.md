# devNotes.md — Entwicklungsprotokoll

Dieses Dokument protokolliert alle relevanten Änderungen, Bugfixes, Designentscheidungen und Auffälligkeiten während der Entwicklung des Editors — von Deployment-Problemen beim ersten Live-Test bis zu nachträglichen Erweiterungen.

---

## 1. Deployment

### `.htaccess` — `php_flag` nicht erlaubt
**Problem:** Apache-Fehler `Invalid command 'php_flag'` — Server erlaubt keine PHP-Direktiven in `.htaccess`.  
**Lösung:** `php_flag display_errors off` und `php_value error_reporting 0` aus `.htaccess` entfernt.

### `AuthUserFile` — falscher Pfad
**Problem:** Apache konnte `.htpasswd` nicht finden, da Pfad `/devEditor/.htpasswd` relativ statt absolut war.  
**Lösung:** Absoluten Serverpfad aus dem Apache-Fehlerlog übernommen: `/var/www/.../devEditor/.htpasswd`

### `ROOT` in `api.php` und `backup.php` — falscher Pfad
**Problem:** `realpath(__DIR__)` lieferte nicht den erwarteten Pfad.  
**Lösung:** Absoluten Pfad direkt eingetragen: `/var/www/.../devEditor/`

---

## 2. Authentifizierung

### `setup.php` — APR1-Hash funktionierte nicht
**Problem:** `crypt()` mit `$apr1$`-Salt erzeugte einen Hash den Apache nicht akzeptierte (`Password Mismatch`).  
**Lösung:** Auf SHA1-Format gewechselt: `{SHA}` + `base64(sha1(password))`.

### SHA1 ebenfalls abgelehnt
**Problem:** Auch SHA1-Hash führte zu `Password Mismatch`.  
**Lösung:** Plaintext-Passwort direkt in `.htpasswd` eingetragen (`user:passwort`). Funktioniert auf diesem Server.

### `setup.php` hinter `.htaccess` nicht erreichbar
**Problem:** Sobald `.htaccess` aktiv war, schützte sie auch `setup.php` — Passwortabfrage vor der Einrichtung.  
**Lösung:** `.htaccess` erst nach erfolgreich angelegter `.htpasswd` hochladen.

---

## 3. JavaScript-Fehler

### `elDiffPanel` doppelt deklariert
**Problem:** `Uncaught SyntaxError: Identifier 'elDiffPanel' has already been declared` — Variable wurde sowohl in `app.js` als auch in `ai-diff.js` als `const` deklariert.  
**Lösung:** `elDiffPanel` aus `ai-diff.js` entfernt, da bereits in `app.js` vorhanden.

### `manifest.json` — 401 Unauthorized
**Problem:** Service Worker versuchte `manifest.json` zu cachen, scheiterte aber an der Basic-Auth-Sperre.  
**Lösung:** `<link rel="manifest">` aus `index.html` entfernt, Precache-Liste in `sw.js` geleert.

### `diff-match-patch` — CDN-URL 404
**Problem:** CDN-URL `cdnjs.cloudflare.com/.../diff-match-patch.js` lieferte 404 (Bibliothek nicht mehr verfügbar).  
**Zweiter Versuch:** `unpkg.com/diff-match-patch` lieferte Node.js-Modul mit `module.exports` — nicht browserkompatibel (`ReferenceError: module is not defined`).  
**Lösung:** Bibliothek direkt von GitHub (`google/diff-match-patch`) heruntergeladen und als lokale Datei `diff_match_patch.js` eingebunden.

---

## 4. API-Kommunikation

### `ai-diff.js` — KI-Kontext via GET statt POST
**Problem:** `buildContext()` rief `api.php?action=read&path=...` per GET auf — `api.php` erwartete `path` aber im POST-Body.  
**Lösung:** Auf POST-Anfrage mit JSON-Body umgestellt. Zusätzlich GET-Parameter in `api.php` in `$body` gemergt für Kompatibilität.

### CORS — direkte Anthropic/DeepSeek API-Aufrufe blockiert
**Problem:** Browser blockierte direkte Fetch-Anfragen an `api.anthropic.com` und `api.deepseek.com` mit CORS-Fehler.  
**Lösung:** `proxy.php` erstellt — alle KI-Anfragen laufen serverseitig über PHP (`file_get_contents` mit Stream-Context).

### Claude — Modell nicht gefunden (404)
**Problem:** Modelle `claude-sonnet-4-20250514`, `claude-3-5-sonnet-20241022` und `claude-3-haiku-20240307` lieferten alle HTTP 404.  
**Ursache:** Neue Accounts ohne Credits haben keinen Zugriff auf ältere Modelle; neuere Modell-Strings waren falsch.  
**Lösung:** Credits bei Anthropic gekauft, korrekten Modell-String aus der offiziellen Dokumentation übernommen: `claude-haiku-4-5-20251001`.

### DeepSeek — 402 Payment Required
**Problem:** DeepSeek-API lieferte 402 trotz API-Key.  
**Lösung:** Guthaben auf `platform.deepseek.com` aufgeladen.

---

## 6. Noch ausstehende Tests

| Test | Status |
|---|---|
| Rechtsklick-Kontextmenü (Umbenennen, Löschen, KI-Berechtigung, Download) | ✅ ok |
| Neue Datei anlegen via +Datei-Knopf | ✅ ok |
| Neuen Ordner anlegen via +Ordner-Knopf | ✅ ok |
| Datei umbenennen | ✅ ok |
| Datei löschen (mit Bestätigungsdialog) | ✅ ok |
| Einzeldatei-Download (max. 10 MB) | ✅ ok |
| Ordner-Download als ZIP | ✅ ok |
| Backup-Knopf — ZIP in `/backups/` | ✅ ok |
| Lazy-Cron — Backup nach 2 Stunden automatisch | ~~entfernt~~ — manuell genügt |
| Offline-Modus — Speichern in Queue | ✅ ok |
| Reconnect — Queue wird abgearbeitet | ✅ ok |
| Crash-Schutz — ungespeicherter Stand nach Reload wiederhergestellt | ✅ ok |
| Token-Limit — Senden-Button bei >40.000 Token gesperrt | ✅ ok |
| Schreibsperre während Backup sichtbar in Statusleiste | ~~akzeptiert~~ — Server blockiert synchron, faktische Sperre |

---


## 7. Bekannte Bugs & Beobachtungen

### `exec()` nicht verfügbar — Backup-Prozess
**Problem:** `backup.php` wurde via `exec()` als Hintergrundprozess gestartet — auf diesem Server ist `exec()` gesperrt.  
**Lösung:** `backup.php` wird direkt via `include` in `api.php` eingebunden.

### Backup-Verzeichnis `/backups/` fehlte
**Problem:** Verzeichnis wurde nicht automatisch angelegt.  
**Lösung:** `backup.php` legt es jetzt selbst an wenn es fehlt.

### Neue Datei in Unterordner — gelöst durch Kontextmenü
**Problem:** Beim +Datei-Knopf konnte kein Zielverzeichnis ausgewählt werden.  
**Lösung:** +Datei und +Ordner aus der Toolbar entfernt. Stattdessen Rechtsklick auf Ordner/Root → +Datei / +Ordner — der Pfad wird aus dem geklickten Verzeichnis abgeleitet.

### Schreibsperre während Backup — implizit durch Serverblockierung
**Beobachtung:** Da `backup.php` via `include` synchron in `api.php` läuft, blockiert der Server während des ZIP-Vorgangs alle eingehenden Requests. Die Schreibsperre ist damit faktisch gegeben — nicht durch explizites Client-Signaling.  
**Status:** Akzeptiert — für die typische ZIP-Dauer von 5–10 Sekunden ausreichend.

### Sonstige Beobachtungen
- `_manifest.json` taucht im Dateibaum auf (Unterstrich-Präfix) — Checkbox manuell deaktiviert lassen.
- Plaintext-Passwort in `.htpasswd` ist funktional aber nicht ideal — bei Gelegenheit auf korrekten Hash-Typ wechseln wenn Shell-Zugang verfügbar wird.
- API-Guthaben (Claude/DeepSeek) — in Session 5 umgesetzt, TODO in `requirementWebEditor.md` als erledigt markiert.

---

## 8. Nachträgliche Änderungen & Erkenntnisse

### ROOT-Pfad — hardcodiert → relativ
**Problem:** ROOT war hardcodiert auf `/var/www/.../devEditor/` — nicht portabel.  
**Lösung 1:** Auf absoluten Serverpfad eine Ebene höher geändert.  
**Lösung 2:** Auf `dirname(__DIR__)` umgestellt — relativ, portabel, kein hardcodierter Pfad.

### KI-Berechtigungsmodell vereinfacht
**Ursprünglich:** Drei Stufen pro Verzeichnis (lesen / lesen+schreiben / kein Zugriff) per Rechtsklick.  
**Jetzt:** Checkbox = lesen, Arbeitsverzeichnis = lesen+schreiben. Kein separater Toggle mehr nötig.

### Arbeitsverzeichnis — kein Auto-Root
**Problem:** Ohne gesetztes Arbeitsverzeichnis wurden alle Dateien automatisch in den Kontext geladen — bei großen Servern zu viele Token.  
**Lösung:** Kein Arbeitsverzeichnis gesetzt = leerer Kontext. Nutzer setzt es explizit per Rechtsklick.

### Dateiwechsel ohne Speichern — Änderungen gingen verloren
**Problem:** Beim Klick auf eine andere Datei im Baum wurden ungespeicherte Änderungen überschrieben.  
**Lösung:** Ungespeicherte Änderungen werden pro Datei in `IndexedDB` gecacht (`fileCache`). Beim Zurückwechseln wird der gecachte Stand geladen.

### KI versuchte zu löschen via leere FILE-Blöcke
**Problem:** KI lieferte `// FILE: pfad` mit leerem Inhalt als Lösch-Simulation.  
**Lösung:** Leere Code-Blöcke werden im Client gefiltert. System-Prompt verbietet explizit Löschen.

### KI-Diff-Queue — mehrere Dateien nacheinander
**Ursprünglich:** Nur ein Diff auf einmal, weitere wurden ignoriert.  
**Jetzt:** Alle `// FILE:` Blöcke einer Antwort kommen in eine Queue, werden nacheinander bestätigt/abgelehnt. Titel zeigt Anzahl ausstehender Diffs.

### Verzeichnisgröße im Dateibaum
Ordner zeigen die rekursive Summengröße aller enthaltenen Dateien.

### `+Datei` / `+Ordner` Toolbar-Buttons entfernt
Ersetzt durch Rechtsklick-Kontextmenü auf Ordner/Root — kontextsensitiv, kein falscher Root-Pfad mehr.

### cURL statt file_get_contents in proxy.php
**Problem:** Server-Timeouts (504) bei großen KI-Anfragen — `file_get_contents` hatte einen zu kurzen Timeout.  
**Lösung:** `proxy.php` auf cURL umgestellt mit `CURLOPT_TIMEOUT = 180` (3 Minuten).

### Drag & Drop Upload im File Commander
**Neu:** Dateien und Ordner vom lokalen PC per Drag & Drop in ein Panel-Verzeichnis hochladen.  
- `api.php` — neue Aktion `upload` (multipart/form-data, `$_FILES['file']`). Parameter: `dir` (Zielverzeichnis), `relPath` (relativer Pfad inkl. Dateiname, unterstützt Unterordner).  
- `filecommander.html` — `registerDropZone()` auf beiden `.panel-list`-Elementen. `dragenter`/`dragover`/`dragleave`/`drop`-Handler. Dashed-Outline als visuelles Feedback während Drag.  
- Ordner-Upload via `webkitGetAsEntry()` + `readEntryRecursive()` — liest Verzeichnisstruktur vollständig rekursiv (je 100 Einträge per `readEntries`-Batch). Fallback auf `getAsFile()` wenn `webkitGetAsEntry` nicht verfügbar.  
- Upload-Bar (20px, zwischen Funktionsleiste und Statusleiste) zeigt `N/Gesamt — aktueller Pfad`.  
- Fehlerhafte Einzeldateien stoppen den Upload nicht — am Ende Zusammenfassung.

### Ordner-Checkbox für KI-Kontext
**Änderung:** Checkbox bei Ordnern selektiert/deselektiert alle Dateien im Ordner rekursiv. Halb-gefüllte Checkbox zeigt Teilauswahl an. Checkbox-Status wird aus den Kinderdateien abgeleitet — Ordnerpfade landen nicht in `checkedPaths`.

### Dateiname als anklickbarer Link
**Änderung:** Der Dateiname in der Editor-Toolbar ist jetzt ein Link der die Datei direkt im Browser öffnet (↗, neuer Tab).

### OpenAI als dritter KI-Provider
**Änderung:** `proxy.php`, `ai-diff.js` und `index.html` um GPT-4o, GPT-4o mini und GPT-4.1 erweitert.
---

## 9. Nachträgliche Bugfixes & Verbesserungen (Session 2)

### Dateibaum klappt nach Löschen zu
**Problem:** Nach dem Löschen einer Datei wurden alle geöffneten Ordner zugeklappt.  
**Ursache:** `loadTree()` leerte mit `elTree.innerHTML = ''` den DOM bevor `renderTree()` die offenen Pfade auslesen konnte — das Set war damit immer leer.  
**Lösung:** In `loadTree()` werden die offenen Ordnerpfade **vor** dem `innerHTML = ''` in `elTree._savedOpenPaths` gespeichert. `renderTree()` liest dieses Set statt den bereits geleerten DOM. Gilt für alle Aktionen die `loadTree()` aufrufen (Löschen, Umbenennen, Neuer Ordner, Refresh).

### KI-Panel: Dateiliste schlecht lesbar
**Problem:** `#ai-file-list` nutzte `--text2` (`#666`) — kaum vom Hintergrund unterscheidbar.  
**Lösung:** Auf `--text1` (`#aaa`) hochgesetzt.

### KI-Panel: (r)/(w)-Kennzeichnung hinter Dateinamen
**Neu:** Jede Datei im KI-Kontext zeigt jetzt ihre Berechtigung:  
- **(r)** blau (`#7aaed6`) — nur lesen (Checkbox)  
- **(w)** grün (`#7ec8a0`) — lesen + schreiben (Arbeitsverzeichnis)  

### KI-Nachrichten werden abgeschnitten
**Problem:** Lange KI-Antworten wurden abgeschnitten, kein Scrollen möglich.  
**Ursache:** `#ai-messages` hatte `flex: 1` aber kein `min-height: 0` — Flex-Container schrumpft ohne das nicht unter seine natürliche Inhaltshöhe.  
**Lösung:** `min-height: 0` auf `#ai-messages`, `overflow-wrap: anywhere` + `min-width: 0` auf `.ai-msg`, `max-width: 100%` auf `.ai-msg-ai`.

### Dateibaum: Alter der Datei
**Neu:** `api.php` liefert jetzt `mtime` (Unix-Timestamp) für jede Datei. Im Baum wird das Alter kompakt angezeigt: `5s` / `12m` / `3h` / `14d` / `2y`.  
CSS-Klasse `item-age` in `--text2`, 10px Mono-Font.

### Dateibaum: Breite erhöht
240px → **280px**.

### Arbeitsverzeichnis beim Start aufklappen
**Problem:** Das gespeicherte Arbeitsverzeichnis war beim Laden zwar aktiv, aber im Baum nicht sichtbar — der Ordner blieb zugeklappt.  
**Lösung:** In `init()` nach `restoreSession()`: alle Pfad-Segmente des `workDir` werden in ein Set aufgeteilt und via `_savedOpenPaths` + `renderTree()` aufgeklappt.
---

## 12. Nachträgliche Änderungen (Session 5)

### Lazy-Cron entfernt
**Entscheidung:** Automatisches Backup nach 2 Stunden via Lazy-Cron entfernt — manueller Backup-Knopf ist ausreichend.  
`BACKUP_INTERVAL`, `BACKUP_FORCE` und der Cron-Check aus `backup.php` entfernt. `actionBackup()` in `api.php` vereinfacht.  
`requirementWebEditor.md` entsprechend aktualisiert.

### api.php — multipart/form-data Routing-Bug
**Problem:** Upload-Requests (multipart) landeten mit „Unbekannte Aktion" — `api.php` las `action` nur aus `$_GET` und JSON-Body, nie aus `$_POST`.  
**Lösung:** Routing auf `$_GET → $_POST → JSON` erweitert, `$body` mergt alle drei Quellen.

### api.php — neue Aktion `upload`
Nimmt `multipart/form-data` entgegen (`$_FILES['file']`), schreibt Datei nach `ROOT/dir/relPath`. Legt fehlende Unterverzeichnisse automatisch an — ermöglicht Ordner-Upload mit Verzeichnisstruktur im `relPath`.

### File Commander: Drag & Drop Upload vom lokalen PC
- `registerDropZone()` auf beiden `.panel-list`-Elementen — `dragenter`/`dragover`/`dragleave`/`drop`.
- Dashed-Outline (`drop-over`) als visuelles Feedback während Drag.
- Ordner-Upload via `webkitGetAsEntry()` + `readEntryRecursive()` — traversiert rekursiv in 100er-Batches. Fallback auf `getAsFile()`.
- Upload-Bar (20px) zwischen Funktionsleiste und Statusleiste zeigt Fortschritt `N/Gesamt — Pfad`.
- Fehlerhafte Einzeldateien stoppen den Upload nicht — Zusammenfassung am Ende.

### API-Guthaben-Anzeige im KI-Toolbar
**Neu:** `#ai-balance`-Span im `#ai-toolbar` zeigt Guthaben des aktiven Providers.  
- `proxy.php` — neuer `model: 'balance'`-Zweig ruft `https://api.deepseek.com/user/balance` ab.  
- `ai-diff.js` — `loadBalance()` fetcht beim Start und per Klick. `balanceCache` verhindert erneuten API-Call beim Modellwechsel. `renderBalance()` zeigt nur den aktiven Provider.  
- Farbe: grün ≥ $1, amber < $1, rot = $0 / Fehler.  
- Claude und OpenAI haben keinen öffentlichen Balance-Endpunkt — Span bleibt bei diesen Modellen leer.

### Schriftgröße auf 120% erhöht — rem-basiert
Alle `font-size`-Werte in `styles.css` und `filecommander.html` auf `rem` umgestellt. Einzige Basis: `font-size: 16px` auf `body` — dort zentral änderbar.

### Hover-Pfad in Statusleiste
`showHoverPath(path)` / `clearHoverPath()` in `app.js`. Zeigt vollständigen Pfad beim Hover über Dateibaum-Einträge. Greift nicht wenn persistenter Status aktiv (×-Button sichtbar). `data-hover`-Attribut verhindert gegenseitiges Überschreiben mit echten Statusmeldungen.

### Browser-Tab zeigt geöffnete Datei
`document.title = dateiname + ' — devEditor'` in `openFile()`. Basis-Titel `devEditor` in `index.html` ergänzt.

### Farbliche Hervorhebung im Dateibaum für KI-Kontext
`perm-read` (blau) / `perm-write` (grün) als Klassen direkt auf `.tree-item` gesetzt. CSS liefert Hintergrund, linken Rand und Hover-Verstärkung. Emojis (👁/✏) kommen ausschließlich via `::after` — kein `textContent` mehr im JS (war zuvor doppelt).

### Implementierung `filecommander.html`
Eigenständige HTML-Seite ohne Abhängigkeit von `app.js` oder `ai-diff.js`. Nutzt dieselbe `api.php`. Dark-Mode-Theme mit denselben CSS-Variablen wie `styles.css`.

### `api.php` — neue Aktion `copy`
`actionCopy()` kopiert Dateien via PHP `copy()`, Verzeichnisse rekursiv via `copyDir()`. Wird von Kopieren (F5) und Verschieben (F6) genutzt.

### `index.html` — Link zum File Commander
Link „📁 NC" oben links in der Tree-Toolbar, öffnet `filecommander.html` in neuem Tab.

### Bekannte Designentscheidungen & Bugfixes

**Keine Checkboxen:** Auswahl wird durch goldgelbe Hervorhebung angezeigt (NC-Stil). Klick auf Datei toggelt Auswahl, Doppelklick öffnet Ordner.

**`..`-Eintrag per Tastatur erreichbar:** Bekommt `data-idx="-1"`, Pfeiltasten gehen bis `-1` runter, Enter auf `-1` löst `navigateUp` aus.

**Shift+Pfeil:** Markiert den Eintrag unter dem Cursor und bewegt den Cursor einen Schritt weiter — klassischer NC-Auswahlmodus.

**Tab wechselt nur logischen Cursor:** Kein `tabindex` auf den Panel-Listen, kein DOM-Fokus-Wechsel. `setActivePanel` ruft `updateCursor` auf damit der Cursor sofort im neuen Panel erscheint und im alten verschwindet.

**Enter aus Modal blubbert durch:** `e.stopPropagation()` im Modal-Input-Keydown verhindert dass Enter den globalen Keyboard-Handler auslöst (Ordner betreten).

**Beide Panels nach Operationen neu laden:** Alle Änderungsoperationen (mkdir, newfile, rename, delete, copy/move) laden beide Panels via `Promise.all([loadPanel('a'), loadPanel('b')])`.

**Scrollposition beibehalten:** `renderPanel` sichert `el.scrollTop` vor und stellt ihn nach dem Rendern wieder her. Verzeichnispfad (`p.path`) wird nie zurückgesetzt — beide Panels bleiben nach Operationen in ihrem jeweiligen Verzeichnis.

**Markierungszähler:** Panel-Toolbar zeigt `· N markiert` wenn Einträge ausgewählt sind. Wird bei jeder `toggleCheck`→`renderPanel`-Kette aktualisiert.

**Ordnergröße:** Rekursive Summengröße aller enthaltenen Dateien (wie im Editor-Dateibaum), in `--text2` dargestellt.

**Chromebook F-Tasten:** Nur mit externer Tastatur verfügbar. Alle Funktionen alternativ per Mausklick auf die Buttons in der Funktionsleiste.