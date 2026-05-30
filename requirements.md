# Anforderungsdokument: Webbasierter Code-Editor mit KI-Unterstützung

**Dokument-Status:** v4  
**Zielplattform:** ChromeOS (Chromebook als Thin Client)  
**Architektur:** Thin-PWA-Client + PHP-Server-Backend  
**Server:** PHP 7.3.33, Editor unter `/devEditor/`, verwalteter Root: `dirname(__DIR__)` — eine Ebene oberhalb von `/devEditor/`, portabel auf jeden Server  
**Quellcode-Generierung:** Der gesamte Quellcode dieses Editors wird KI-generiert. Dieses Dokument definiert die vollständigen Anforderungen als Grundlage für die KI-gesteuerte Implementierung.

---

## Leitprinzip

Minimale Speicherauslastung und Minimalismus stehen über allem. Jede Komponente, jede Bibliothek und jede Funktion wird nur dann eingesetzt, wenn sie einen messbaren Mehrwert gegenüber einer einfacheren Alternative liefert. Das Chromebook dient als Anzeige- und Eingabegerät — Dateioperationen und Backup liegen vollständig auf dem Server.

---

## 1. UI/UX — Layout & Fensterstruktur

Fixes Drei-Spalten-Layout ohne Tabs, ohne Menüleiste, ohne weiteren Chrome.

**Linkes Fenster — Dateibaum & KI-Kontext**

- Permanente Anzeige der Verzeichnisstruktur des Webservers. Vertikal scrollbar, beliebige Tiefe.
- Versteckte Dateien und Ordner (Punkt-Prefix, z. B. `.htaccess`) sichtbar.
- Neben jedem Dateinamen: Dateigröße (`x.x KB`). Neben jedem Ordnernamen: Summengröße aller enthaltenen Dateien.
- Root-Verzeichnis als eigener Eintrag ganz oben (`🏠 / (Root)`), per Rechtsklick adressierbar.
- Toolbar: `↺ Aktualisieren`, `Backup`.
- Klick auf Datei → öffnet sie im Editor.
- Checkbox pro Datei → Datei in KI-Kontext aufnehmen (👁).
- Icon-Anzeige: 👁 = im KI-Kontext, ✏ = im Arbeitsverzeichnis (Schreibrecht).

**Kontextmenü Ordner / Root:**
`📁 Als Arbeitsverzeichnis setzen`, `+Datei`, `+Ordner`, Umbenennen, Löschen, Herunterladen.
Root hat kein Umbenennen/Löschen.

**Kontextmenü Datei:**
Umbenennen, Löschen, Herunterladen.

**Dateioperationen:** alle via `api.php`, Löschen mit Bestätigungsdialog.
**Download:** Einzeldatei direkt (max. 10 MB), Ordner als ZIP via `download.php`.
**Diff-Anzeige:** Solange KI-Vorschlag aussteht erscheint `+x / -y` grün neben dem Dateinamen. Verschwindet nach Bestätigung oder Ablehnung.

**Mittleres Fenster — Code-Editor**

- Reines `<textarea>` ohne Syntax-Highlighting, keine externe Bibliothek.
- Zeilennummern links (synchron scrollendes `<div>`).
- Tab-Taste → 4 Leerzeichen (Fokus-Wechsel per JS unterbunden).
- Ungespeicherte Änderungen bleiben beim Dateiwechsel erhalten (pro Datei gecacht).
- Ein einziges Dark-Mode-Theme.

**Rechtes Fenster — KI-Assistent**

- Dropdown: Claude API oder DeepSeek Coder API.
- Schaltfläche „✕" leert Chat-Verlauf und Gesprächshistorie.
- Anzeige: aktives Modell, Arbeitsverzeichnis (`📁 /pfad/`), geladene Dateien, Token-Zähler.
- Kein Arbeitsverzeichnis gesetzt → Kontext leer, Token = 0.

**Statusleiste**

Einzige Rückmeldungsebene — am unteren Rand, immer sichtbar.

| Ereignis | Text | Farbe | Verhalten |
|---|---|---|---|
| Backup gestartet | `Backup läuft — Speichern gepuffert` | grau | bleibt |
| Backup abgeschlossen | `Backup OK — 14:03` | grün | 4 s |
| Backup fehlgeschlagen | `Backup fehlgeschlagen: [Grund]` | rot | bleibt |
| Datei gespeichert | `Gespeichert` | grün | 4 s |
| Offline | `Offline — Änderungen werden gepuffert` | grau | bleibt |
| Reconnect | `Verbindung wiederhergestellt — Änderungen übertragen` | grün | 4 s |
| Schreibfehler | `Fehler beim Speichern: [Grund]` | rot | bleibt |
| Kontext laden | `Kontext wird geladen … 3/12` | grau | bleibt |
| Kontext bereit | `Kontext geladen — 12 Dateien` | grün | 4 s |
| KI arbeitet | `KI arbeitet …` | grau | bleibt |
| KI fertig | `Diff berechnet: +12 / -4` | grün | 4 s |
| API-Fehler | `KI-Fehler: [Grund]` | rot | bleibt |
| Token-Limit | `Kontext zu groß — Auswahl reduzieren` | rot | bleibt |

---

## 2. KI-Integration

### 2.1 Clientseitiges Diff-System

- Bibliothek: `diff-match-patch` (lokal als `diff_match_patch.js`, kein CDN, kein Build-Schritt).
- Mehrere Dateien: Alle `// FILE:` Blöcke einer KI-Antwort kommen in eine Queue, werden nacheinander im Diff-Panel angezeigt. Titel zeigt Anzahl ausstehender Diffs.
- Diff-Panel zeigt Hinzufügungen (grün) und Löschungen (rot), Bestätigung oder Ablehnung pro Datei.
- Nach Bestätigung/Ablehnung: Diff-Stat im Baum verschwindet, nächster Diff folgt automatisch.
- KI darf Dateien **ändern** und **neu anlegen** — niemals löschen, umbenennen oder Verzeichnisse entfernen.
- Leere `// FILE:` Blöcke (Löschversuch) werden vom Client ignoriert.

### 2.2 Token-Limit & Kostenkontrolle

- Live-Token-Zähler: kumulierte Zeichenanzahl aller gechecked Dateien (4 Zeichen ≈ 1 Token).
- Bei mehr als 40.000 Token: Senden-Button deaktiviert, Warnung in Statusleiste.

### 2.3 KI-Berechtigungsmodell

| Quelle | Recht |
|---|---|
| **Arbeitsverzeichnis** (per Rechtsklick gesetzt) | Lesen + Schreiben — KI darf ändern und neu anlegen |
| **Checkbox** (Dateien außerhalb des Arbeitsverzeichnisses) | Nur lesen — reiner Kontext |
| **Kein Arbeitsverzeichnis gesetzt** | Kontext leer — KI erhält keine Dateien |

- Arbeitsverzeichnis lädt alle enthaltenen Dateien automatisch in den Kontext.
- Checkbox aus → Datei aus Kontext entfernt, kein Lesen, kein Schreiben.
- KI erhält im System-Prompt explizit welche Dateien Schreibrecht haben.
- Neue Dateien die die KI vorschlägt bedürfen expliziter Nutzerbestätigung.
- KI darf im Arbeitsverzeichnis auch Unterverzeichnisse anlegen.

### 2.4 Arbeitsverzeichnis

- Setzen: Rechtsklick auf Ordner oder Root → „📁 Als Arbeitsverzeichnis setzen".
- Anzeige im rechten Panel: `📁 /pfad/`.
- Beim Start: kein Arbeitsverzeichnis — Nutzer setzt es explizit.
- Persistiert in `IndexedDB`.
- Die KI erhält im System-Prompt: „Dein Arbeitsverzeichnis ist `/pfad/`. Neue Dateien und Unterverzeichnisse legst du dort ab."

### 2.5 Gesprächsgedächtnis

Jede Anfrage wird aufgebaut aus:
- System-Prompt mit Dateiinhalt + Schreibrechte-Info
- Den letzten **10 Nachrichten** (5 Runden) als Gesprächshistorie
- Der aktuellen Nutzernachricht

„✕ Chat leeren" setzt Chat-Verlauf und Gesprächshistorie zurück.

### 2.6 KI-Proxy

Direkte API-Aufrufe sind wegen CORS nicht möglich — alle KI-Anfragen laufen über `proxy.php`:
- Claude: Modell `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-7`
- DeepSeek: Modell `deepseek-coder`, `deepseek-chat`
- OpenAI: Modell `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`
- API-Schlüssel ausschließlich in `proxy.php` — nie im Client.
- Datei-Upload per Drag & Drop ist nicht vorgesehen.

---

## 3. Ausfallsicherheit & Zustandserhalt

- **Session-Persistenz:** `IndexedDB` speichert: geöffneter Dateipfad, Cursor, Scroll, Checkbox-Auswahl, Arbeitsverzeichnis, ungespeicherte Änderungen pro Datei.
- **Crash-Schutz:** Ungespeicherte Änderungen sekündlich gecacht pro Datei. Nach Absturz oder Reload vollständige Wiederherstellung.
- **Dateiwechsel:** Ungespeicherte Änderungen bleiben beim Wechsel zu einer anderen Datei erhalten.
- **Offline-Queue:** WLAN-Verlust → Offline-Modus. Ctrl+S gepuffert. Reconnect via Browser-Event + 5-Sekunden-Polling-Fallback. Queue chronologisch abgearbeitet.

---

## 4. Backup

- Manuell ausgelöst: „Backup"-Knopf in der Toolbar.
- Inkrementell: Nur seit letztem Backup geänderte Dateien (`filemtime`).
- Filterung: Nur textbasierte Quellcode-Dateien; Binärdateien ausgeschlossen.
- ZIP: `ZipArchive` (PHP-nativ), `set_time_limit(120)`.
- Speicherort: `backups/` im Editor-Verzeichnis, Dateiname: `backup_YYYYMMDDThhmm.zip`.
- `backups/` via `.htaccess` vor Direktzugriff gesperrt.
- Keine automatische Rotation — manuelles Löschen.
- Schreibsperre: `backup.php` läuft synchron via `include` in `api.php` — Server blockiert während ZIP-Vorgang (~5–10 s), faktische Schreibsperre.

---

## 5. Server-Anbindung & Sicherheit

### 5.1 API-Kommunikation

- PWA ↔ Server via schlanke JSON-Nutzdaten (HTTP POST/GET).
- `api.php` Aktionen: `tree`, `read`, `write`, `rename`, `delete`, `mkdir`, `backup`.
- ROOT-Pfad: `dirname(__DIR__)` — relativ, portabel, kein hardcodierter Pfad.

### 5.2 Authentifizierung

HTTP Basic Auth via `.htaccess` — kein eigener PHP-Code:

```apache
AuthType Basic
AuthName "Editor"
AuthUserFile /absoluter/pfad/zu/devEditor/.htpasswd
Require valid-user
```

`AuthUserFile` ist serverspezifisch und muss einmalig angepasst werden. Einmalige Einrichtung ohne Shell via `setup.php` (danach sofort löschen).

---

## 6. Quelldatei-Struktur

Alle Dateien liegen in `/devEditor/`:

| Datei | Zuständigkeit |
|---|---|
| `index.html` | Frontend-Skelett, Drei-Spalten-Grid |
| `styles.css` | Grid-Layout, Dark-Mode-Theme |
| `app.js` | Zentrale Steuerung, Dateibaum, Editor, Session-Persistenz, Offline-Queue |
| `ai-diff.js` | KI-Schnittstellen, Token-Zähler, Diff-Queue, Berechtigungsmodell |
| `diff_match_patch.js` | Diff-Bibliothek (lokal, browserkompatibel) |
| `sw.js` | Service Worker, PWA-Basis |
| `api.php` | REST-Endpunkte, Datei-Operationen, Backup-Trigger |
| `backup.php` | ZIP-Erstellung, inkrementelles Backup |
| `proxy.php` | KI-API-Proxy (Claude + DeepSeek), API-Schlüssel |
| `download.php` | Einzel-Download und Ordner-ZIP |
| `setup.php` | Einmalige `.htpasswd`-Einrichtung — danach löschen |
| `.htaccess` | Basic Auth, `backups/` sperren |

**Codestyle:** Alle JavaScript-Dateien vollständig mit JSDoc kommentiert.

---

## 7. File Commander (`filecommander.html`)

Eigenständige Unterseite — erreichbar über einen Link im Editor oder direkt unter `/devEditor/filecommander.html`.

### 7.1 Konzept

Norton Commander-Stil: Zwei gleichgroße Panels nebeneinander, jedes zeigt einen Verzeichnisbaum. Operationen werden zwischen den Panels ausgeführt.

### 7.2 Layout

```
┌─────────────────────────┬─────────────────────────┐
│  Panel A                │  Panel B                │
│  /verzeichnis/          │  /anderes/verzeichnis/  │
│                         │                         │
│  datei1.php   1.2 KB    │  datei1.php   1.2 KB    │
│  datei2.js    3.4 KB    │  datei2.js    3.4 KB    │
│  unterordner/           │  unterordner/           │
├─────────────────────────┴─────────────────────────┤
│  F5 Kopieren  F6 Verschieben  F7 Neuer Ordner      │
│  F8 Löschen   Umbenennen      Neue Datei           │
└───────────────────────────────────────────────────┘
```

### 7.3 Funktionen

- **Navigation:** Klick auf Ordner öffnet ihn im jeweiligen Panel. `..` geht eine Ebene höher.
- **Auswahl:** Checkbox pro Datei/Ordner, Mehrfachauswahl möglich.
- **Kopieren (F5):** Ausgewählte Dateien von Panel A nach Panel B (oder umgekehrt).
- **Verschieben (F6):** Wie Kopieren, danach Original löschen.
- **Löschen (F8):** Mit Bestätigungsdialog.
- **Umbenennen:** Einzelne Datei/Ordner.
- **Neuer Ordner (F7) / Neue Datei:** Im aktiven Panel.
- **Tab:** Wechselt zwischen Panel A und B.

### 7.4 Technische Umsetzung

- Eigenständige HTML-Seite ohne Abhängigkeit von `app.js` oder `ai-diff.js`.
- Nutzt dieselbe `api.php` wie der Editor.
- Neue Aktion in `api.php`: `copy` — serverseitig via PHP `copy()`.
- Authentifizierung via `.htaccess` (gleicher Schutz wie der Editor).
- Kein KI-Kontext, kein Diff-System — reine Dateiverwaltung.
- Dark-Mode-Theme analog zu `styles.css`.

### 7.5 Neue API-Aktion: `copy`

```php
case 'copy': actionCopy($body); break;

function actionCopy(array $body): void {
    $from = safePath($body['from'] ?? '');
    $to   = safePath($body['to']   ?? '');
    if (!copy($from, $to)) throw new RuntimeException('Kopieren fehlgeschlagen');
    echo json_encode(['ok' => true]);
}
```

---

## 8. Offene Punkte (TODO)

| Priorität | Punkt |
|---|---|
| ✅ erledigt | File Commander implementieren (`filecommander.html`) — Session 4 |
| ✅ erledigt | API-Guthaben anzeigen (Claude + DeepSeek) — Session 5 |
| ✅ erledigt | Langes Dateinamen im Baum: vollständigen Pfad beim Hover in der Statusleiste anzeigen — Session 5 |
| ✅ erledigt | File Commander: Drag & Drop von Dateien/Ordnern vom lokalen PC-Laufwerk — Session 5 |
| ✅ erledigt | Browser-Tab zeigt die aktuell im Editor geöffnete Datei — Session 5 |
| ✅ erledigt | Kontrast überarbeiten — ok, kein Handlungsbedarf |
| ✅ erledigt | Schriftgröße auf 120% erhöht, rem-basiert — Session 5 |
| ✅ erledigt | API-Guthaben: nur DeepSeek hat öffentlichen Endpunkt, wird bei DeepSeek-Modellen angezeigt — Session 5 |
| ✅ erledigt | Farbliche Hervorhebung im Dateibaum für Dateien im KI-Kontext — Session 5 |