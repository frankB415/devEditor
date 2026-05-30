# Anleitung: Webbasierter Code-Editor

---

## 1. Erster Start & Einrichtung

### Schritt 1 — Passwort einrichten

Der Editor ist durch HTTP Basic Auth geschützt. Beim ersten Aufruf erscheint eine Browser-Passwortabfrage.

Das Passwort wird direkt in der Datei `.htpasswd` im Editor-Verzeichnis gespeichert:

**Datei:** `/devEditor/.htpasswd`  
**Format:** `benutzername:passwort` (Klartext funktioniert auf diesem Server)

Beispiel:
```
benutzername:meinPasswort
```

Die Datei kann per FTP-Client bearbeitet werden.

---

### Schritt 2 — API-Schlüssel eintragen

Die KI-Funktionen benötigen API-Schlüssel. Diese werden **ausschließlich serverseitig** in einer Datei konfiguriert — niemals im Browser.

**Datei:** `/devEditor/apikeys.php`

```php
define('CLAUDE_API_KEY',   'sk-ant-...');   // Claude
define('DEEPSEEK_API_KEY', 'sk-...');        // DeepSeek
define('OPENAI_API_KEY',   'sk-proj-...');   // OpenAI
```

**Claude API-Schlüssel holen:**
1. Auf [console.anthropic.com](https://console.anthropic.com) einloggen
2. Links: **API Keys** → **Create Key**
3. Schlüssel kopieren, Guthaben aufladen unter **Billing**

**DeepSeek API-Schlüssel holen:**
1. Auf [platform.deepseek.com](https://platform.deepseek.com) einloggen
2. **API Keys** → **Create new API key**
3. Schlüssel kopieren, Guthaben aufladen

**OpenAI API-Schlüssel holen:**
1. Auf [platform.openai.com](https://platform.openai.com) einloggen
2. **API keys** → **Create new secret key**
3. Schlüssel kopieren (wird nur einmal angezeigt!), Guthaben aufladen

---

## 2. Benutzeroberfläche

Der Editor ist in drei Spalten aufgeteilt:

```
┌─────────────────┬──────────────────────┬─────────────────┐
│  Dateibaum      │  Code-Editor         │  KI-Assistent   │
│  (links)        │  (mitte)             │  (rechts)       │
└─────────────────┴──────────────────────┴─────────────────┘
│                      Statusleiste                         │
└───────────────────────────────────────────────────────────┘
```

### Linkes Panel — Dateibaum

| Element | Funktion |
|---|---|
| `🏠 / (Root)` | Wurzelverzeichnis des Webservers |
| `↺` | Dateibaum neu laden |
| `Backup` | Backup jetzt erstellen |
| Klick auf Dateiname | Datei im Editor öffnen |
| Checkbox (Datei) | Datei in KI-Kontext aufnehmen (👁) |
| Checkbox (Ordner) | Alle Dateien im Ordner rekursiv in KI-Kontext aufnehmen |
| Halb-gefüllte Checkbox | Nur manche Dateien im Ordner ausgewählt |
| `👁` | Datei wird von KI gelesen |
| `✏` | Datei liegt im KI-Arbeitsverzeichnis (KI darf schreiben) |
| `x.x KB` | Dateigröße / Ordner-Gesamtgröße |
| `5s` / `12m` / `3h` / `14d` / `2y` | Alter der Datei seit letzter Änderung |
| `+12 / -4` | Ausstehender KI-Änderungsvorschlag |

**Rechtsklick auf Ordner:**
- `📁 Als Arbeitsverzeichnis setzen` — KI arbeitet in diesem Verzeichnis
- `+Datei` — neue Datei im Ordner anlegen
- `+Ordner` — neuen Unterordner anlegen
- `Umbenennen` — Ordner umbenennen
- `Löschen` — Ordner löschen (mit Bestätigung)
- `Herunterladen` — Ordner als ZIP herunterladen

**Rechtsklick auf Datei:**
- `Umbenennen` — Datei umbenennen
- `Löschen` — Datei löschen (mit Bestätigung)
- `Herunterladen` — Datei herunterladen (max. 10 MB)

### Mittleres Panel — Editor

- **Datei öffnen:** Klick auf Dateiname im Baum
- **Im Browser öffnen:** Klick auf den Dateinamen in der Editor-Toolbar (↗) — öffnet die Datei direkt im Browser in neuem Tab
- **Speichern:** `Ctrl+S` oder Schaltfläche „Speichern"
- **Tab:** fügt 4 Leerzeichen ein
- Ungespeicherte Änderungen bleiben beim Dateiwechsel erhalten (werden sekündlich gecacht)

### Rechtes Panel — KI-Assistent

| Element | Funktion |
|---|---|
| Dropdown oben | KI-Modell auswählen |
| `✕` | Chat-Verlauf leeren |
| `📁 /pfad/` | Aktuelles Arbeitsverzeichnis |
| Dateiliste | Dateien im KI-Kontext mit Berechtigung: **(r)** = nur lesen, **(w)** = lesen + schreiben |
| Token-Anzeige | Geschätzte Token-Anzahl |
| Prompt-Feld | Eingabe für KI |
| `Ctrl+Enter` | Prompt senden (alternativ zu Senden-Button) |

---

## 3. KI-Modelle

| Modell | Provider | Geschwindigkeit | Kosten | Empfehlung |
|---|---|---|---|---|
| Claude Haiku 4.5 | Anthropic | ⚡ sehr schnell | 💰 günstig | Alltagsaufgaben |
| Claude Sonnet 4.6 | Anthropic | 🔄 mittel | 💰💰 mittel | Komplexer Code |
| Claude Opus 4.7 | Anthropic | 🐢 langsam | 💰💰💰 teuer | Schwierige Probleme |
| GPT-4o | OpenAI | 🔄 mittel | 💰💰 mittel | Allgemein |
| GPT-4o mini | OpenAI | ⚡ schnell | 💰 günstig | Alltagsaufgaben |
| GPT-4.1 | OpenAI | 🔄 mittel | 💰💰 mittel | Code |
| DeepSeek Coder | DeepSeek | ⚡ schnell | 💰 günstig | Code-Generierung |
| DeepSeek Chat | DeepSeek | ⚡ schnell | 💰 günstig | Allgemeine Fragen |

**Hinweis:** Bei sehr großem Kontext (>40.000 Token) wird der Senden-Button gesperrt. Bei >~100.000 Token kann es zu Server-Timeouts kommen (504). Arbeitsverzeichnis auf relevante Unterordner beschränken.

---

## 4. KI-Berechtigungen

Die KI kann nur auf Dateien zugreifen die du explizit freigibst:

**Lesen (👁):** Checkbox aktivieren → KI sieht den Dateiinhalt als Kontext, darf aber nicht schreiben.

**Lesen + Schreiben (✏):** Rechtsklick auf Ordner → „📁 Als Arbeitsverzeichnis setzen" → alle Dateien im Ordner bekommen Lese- und Schreibrecht.

**Kein Zugriff:** Checkbox deaktiviert → KI sieht die Datei nicht.

**Wichtig:** Die KI darf Dateien nur **ändern** und **neu anlegen** — niemals löschen oder umbenennen. Diese Operationen bleiben dem Nutzer vorbehalten.

---

## 5. KI-Workflow — typischer Ablauf

1. **Arbeitsverzeichnis setzen:** Rechtsklick auf Projektordner → „📁 Als Arbeitsverzeichnis setzen"
2. **Zusätzliche Referenzdateien:** Checkbox bei Dateien außerhalb des Arbeitsverzeichnisses aktivieren (nur lesen)
3. **Token prüfen:** Token-Anzeige im rechten Panel — bei >40.000 Token Auswahl reduzieren
4. **Prompt eingeben:** Aufgabe beschreiben, `Ctrl+Enter` oder Senden
5. **Warten:** Statusleiste zeigt den Fortschritt — `Kontext wird geladen … 3/12` → `KI arbeitet …`
6. **Diff bestätigen:** KI-Vorschläge erscheinen als Diff-Panel — grün = neu, rot = gelöscht
7. **Übernehmen oder Verwerfen:** Pro Datei einzeln bestätigen

**Statusleiste — Übersicht:**

| Meldung | Bedeutung |
|---|---|
| `Kontext wird geladen … 3/12` | Dateien werden vom Server gelesen |
| `Kontext geladen — 12 Dateien` | Bereit zum Senden |
| `KI arbeitet …` | Warten auf KI-Antwort |
| `Diff berechnet: +12 / -4` | KI hat Änderungen vorgeschlagen |
| `Gespeichert` | Datei erfolgreich gespeichert |
| `Offline — Änderungen werden gepuffert` | Kein WLAN |
| `Backup läuft — Speichern gepuffert` | Backup wird erstellt |

**Tipp:** Die KI hat ein Gedächtnis von 10 Nachrichten (5 Runden). Für komplexe Aufgaben in mehreren Schritten arbeiten — nach jeder Änderung speichern bevor die nächste Anfrage gestellt wird.

---

## 6. Backup

Backups werden automatisch alle 2 Stunden erstellt (Lazy-Cron) oder manuell über den „Backup"-Knopf.

**Speicherort:** `/devEditor/backups/`  
**Dateiname:** `backup_YYYYMMDDThhmm.zip` (z. B. `backup_20260524T1403.zip`)  
**Inhalt:** Nur textbasierte Quellcode-Dateien, keine Binärdateien  
**Rotation:** Keine automatische — alte Backups manuell per FTP löschen

---

## 7. Offline-Betrieb

Verliert das Chromebook die WLAN-Verbindung:
- Statusleiste zeigt: `Offline — Änderungen werden gepuffert`
- `Ctrl+S` speichert lokal in einer Queue
- Nach Reconnect wird die Queue automatisch übertragen
- Statusleiste zeigt: `Verbindung wiederhergestellt — Änderungen übertragen`

---

## 8. Wichtige Dateien auf dem Server

| Datei | Inhalt | Zugriff |
|---|---|---|
| `/devEditor/.htpasswd` | Login-Passwort | FTP-Client |
| `/devEditor/proxy.php` | API-Schlüssel (Zeile 16–17) | FTP-Client |
| `/devEditor/backups/` | ZIP-Backups | FTP-Client |
| `/devEditor/.backup_last` | Zeitstempel letztes Backup | automatisch |

---

## 9. Troubleshooting

| Problem | Lösung |
|---|---|
| Browser fragt Passwort → falsch | `.htpasswd` per FTP bearbeiten |
| KI antwortet nicht | API-Schlüssel in `proxy.php` prüfen, Guthaben prüfen |
| Token-Limit überschritten | Weniger Dateien per Checkbox auswählen |
| Dateibaum zeigt alte Struktur | `↺` Aktualisieren klicken |
| Ungespeicherte Änderungen weg nach Reload | Werden automatisch wiederhergestellt — Editor neu laden |
| Editor verhält sich seltsam nach Update | F12 → Application → IndexedDB → `editor-session` löschen → neu laden |
---

## 10. File Commander

Erreichbar über den Link „📁 NC" oben links in der Editor-Toolbar — öffnet in neuem Tab.

### Layout

Zwei gleichgroße Panels nebeneinander. Das aktive Panel hat einen helleren Toolbar-Hintergrund. Die Toolbar jedes Panels zeigt den aktuellen Pfad, die Anzahl der Einträge (`3D 12F`) und — wenn etwas markiert ist — `· 2 markiert`.

### Navigation

| Aktion | Tastatur | Maus |
|---|---|---|
| Panel wechseln | Tab | Klick ins Panel |
| Ordner öffnen | Enter | Doppelklick |
| Ebene höher | Backspace | ↑-Button oder Klick auf `..` |
| Cursor bewegen | Pfeil hoch/runter | — |
| Aktualisieren | — | ↺-Button |

### Auswahl

| Aktion | Tastatur | Maus |
|---|---|---|
| Eintrag markieren/demarkieren | Leertaste | Klick auf Datei |
| Mehrere markieren | Shift+Pfeil hoch/runter | Mehrfach klicken |

Markierte Einträge werden goldgelb hervorgehoben. Ist nichts markiert, wirken alle Operationen auf den Eintrag unter dem Cursor. Die Auswahl wird nach jeder Operation automatisch geleert.

### Operationen

| Taste | Button | Aktion |
|---|---|---|
| F3 | Anzeigen | Datei unter Cursor als Plain-Text in neuem Tab öffnen |
| F5 | Kopieren | Auswahl vom aktiven ins andere Panel kopieren |
| F6 | Verschieben | Wie Kopieren, Original wird danach gelöscht |
| F7 | Neuer Ordner | Neuen Ordner im aktiven Panel anlegen |
| F8 | Löschen | Auswahl löschen (mit Bestätigungsdialog) |
| F9 | Umbenennen | Einzelnen Eintrag umbenennen |
| F10 | Neue Datei | Neue leere Datei im aktiven Panel anlegen |

Kopieren/Verschieben geht immer vom aktiven Panel ins andere. Ordner werden rekursiv kopiert/gelöscht.

**Hinweis Chromebook:** F-Tasten sind nur mit angeschlossener externer Tastatur direkt verfügbar. Alle Funktionen sind alternativ per Maus über die Buttons in der Funktionsleiste erreichbar.