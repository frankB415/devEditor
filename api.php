<?php
/**
 * api.php — REST-Schnittstelle für Dateioperationen
 *
 * Aktionen: tree, read, write, rename, delete, mkdir, copy, backup, upload, apikeys
 * Authentifizierung: HTTP Basic Auth via .htaccess (kein eigener Code nötig)
 * PHP 7.3+
 */

declare(strict_types=1);

// ── KONFIGURATION ──────────────────────────────────────────────────────────

/**
 * Wurzelverzeichnis des verwalteten Projekts.
 */
define('ROOT', dirname(__DIR__) . '/');

/** API-Schlüssel für KI-Dienste (nie im Client exponieren) */
define('CLAUDE_API_KEY',   getenv('CLAUDE_API_KEY')   ?: '');
define('DEEPSEEK_API_KEY', getenv('DEEPSEEK_API_KEY') ?: '');

// ── HEADERS ────────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ── ROUTING ────────────────────────────────────────────────────────────────

$jsonInput = json_decode(file_get_contents('php://input'), true) ?? [];
$action    = $_GET['action'] ?? $_POST['action'] ?? ($jsonInput['action'] ?? '');

// GET-, POST- und JSON-Parameter mergen ($_POST deckt multipart/form-data ab)
$body = array_merge($_GET, $_POST, $jsonInput);

try {
    switch ($action) {
        case 'tree':    echo json_encode(['tree' => buildTree(ROOT)]);                break;
        case 'read':    actionRead($body);                                      break;
        case 'write':   actionWrite($body);                                     break;
        case 'rename':  actionRename($body);                                    break;
        case 'delete':  actionDelete($body);                                    break;
        case 'mkdir':   actionMkdir($body);                                     break;
        case 'copy':    actionCopy($body);                                      break;
        case 'backup':  actionBackup();                                         break;
        case 'upload':  actionUpload();                                         break;
        case 'apikeys': echo json_encode(['claude' => CLAUDE_API_KEY, 'deepseek' => DEEPSEEK_API_KEY]); break;
        default:        http_response_code(400); echo json_encode(['error' => 'Unbekannte Aktion']); break;
    }
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ── VERZEICHNISBAUM ────────────────────────────────────────────────────────

/**
 * Baut den Verzeichnisbaum als Array auf.
 *
 * @param string $dir  Absoluter Pfad
 * @param string $base Relativer Basispfad (für Ausgabe)
 * @return array
 */
function buildTree(string $dir, string $base = ''): array {
    $items = [];
    $entries = @scandir($dir);
    if ($entries === false) return $items;

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') continue;

        $absPath = $dir . $entry;
        $relPath = $base . $entry;

        if (is_dir($absPath)) {
            $items[] = [
                'type'     => 'dir',
                'name'     => $entry,
                'path'     => $relPath,
                'children' => buildTree($absPath . '/', $relPath . '/'),
            ];
        } else {
            $items[] = [
                'type'  => 'file',
                'name'  => $entry,
                'path'  => $relPath,
                'size'  => filesize($absPath),
                'mtime' => filemtime($absPath),
            ];
        }
    }

    // Ordner vor Dateien, dann alphabetisch
    usort($items, function ($a, $b) {
        if ($a['type'] !== $b['type']) return $a['type'] === 'dir' ? -1 : 1;
        return strcasecmp($a['name'], $b['name']);
    });

    return $items;
}

// ── DATEI LESEN ────────────────────────────────────────────────────────────

/**
 * Liest eine Datei und gibt den Inhalt zurück.
 *
 * @param array $body Request-Body
 */
function actionRead(array $body): void {
    $path = safePath($body['path'] ?? '');
    if (!is_file($path)) {
        http_response_code(404);
        echo json_encode(['error' => 'Datei nicht gefunden']);
        return;
    }
    echo json_encode(['content' => file_get_contents($path)]);
}

// ── DATEI SCHREIBEN ────────────────────────────────────────────────────────

/**
 * Schreibt Inhalt in eine Datei (erstellt Verzeichnisse bei Bedarf).
 *
 * @param array $body Request-Body
 */
function actionWrite(array $body): void {
    $path    = safePath($body['path'] ?? '');
    $content = $body['content'] ?? '';
    $dir     = dirname($path);

    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }

    if (file_put_contents($path, $content) === false) {
        throw new RuntimeException('Schreiben fehlgeschlagen: ' . $path);
    }

    echo json_encode(['ok' => true]);
}

// ── UMBENENNEN ─────────────────────────────────────────────────────────────

/**
 * Benennt eine Datei oder einen Ordner um.
 *
 * @param array $body Request-Body
 */
function actionRename(array $body): void {
    $from = safePath($body['from'] ?? '');
    $to   = safePath($body['to']   ?? '');

    if (!file_exists($from)) {
        throw new RuntimeException('Quelle nicht gefunden: ' . $from);
    }
    if (!rename($from, $to)) {
        throw new RuntimeException('Umbenennen fehlgeschlagen');
    }
    echo json_encode(['ok' => true]);
}

// ── LÖSCHEN ────────────────────────────────────────────────────────────────

/**
 * Löscht eine Datei oder einen Ordner rekursiv.
 *
 * @param array $body Request-Body
 */
function actionDelete(array $body): void {
    $path = safePath($body['path'] ?? '');

    if (is_dir($path)) {
        deleteDir($path);
    } elseif (is_file($path)) {
        unlink($path);
    } else {
        throw new RuntimeException('Pfad nicht gefunden: ' . $path);
    }

    echo json_encode(['ok' => true]);
}

/**
 * Löscht ein Verzeichnis rekursiv.
 *
 * @param string $dir Absoluter Pfad
 */
function deleteDir(string $dir): void {
    foreach (scandir($dir) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $sub = $dir . '/' . $entry;
        is_dir($sub) ? deleteDir($sub) : unlink($sub);
    }
    rmdir($dir);
}

// ── DATEI KOPIEREN ─────────────────────────────────────────────────────────

/**
 * Kopiert eine Datei oder ein Verzeichnis.
 * Verzeichnisse werden rekursiv kopiert.
 *
 * @param array $body Request-Body
 */
function actionCopy(array $body): void {
    $from = safePath($body['from'] ?? '');
    $to   = safePath($body['to']   ?? '');

    if (is_dir($from)) {
        copyDir($from, $to);
    } elseif (is_file($from)) {
        $dir = dirname($to);
        if (!is_dir($dir)) mkdir($dir, 0755, true);
        if (!copy($from, $to)) throw new RuntimeException('Kopieren fehlgeschlagen: ' . $from);
    } else {
        throw new RuntimeException('Quelle nicht gefunden: ' . $from);
    }

    echo json_encode(['ok' => true]);
}

/**
 * Kopiert ein Verzeichnis rekursiv.
 *
 * @param string $src  Absoluter Quellpfad
 * @param string $dst  Absoluter Zielpfad
 */
function copyDir(string $src, string $dst): void {
    if (!is_dir($dst)) mkdir($dst, 0755, true);
    foreach (scandir($src) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $s = $src . '/' . $entry;
        $d = $dst . '/' . $entry;
        if (is_dir($s)) {
            copyDir($s, $d);
        } else {
            if (!copy($s, $d)) throw new RuntimeException('Kopieren fehlgeschlagen: ' . $s);
        }
    }
}

// ── VERZEICHNIS ANLEGEN ────────────────────────────────────────────────────

/**
 * Legt ein neues Verzeichnis an.
 *
 * @param array $body Request-Body
 */
function actionMkdir(array $body): void {
    $path = safePath($body['path'] ?? '');
    if (!mkdir($path, 0755, true) && !is_dir($path)) {
        throw new RuntimeException('Verzeichnis konnte nicht angelegt werden');
    }
    echo json_encode(['ok' => true]);
}

// ── BACKUP ─────────────────────────────────────────────────────────────────

/**
 * Triggert das Backup-Skript direkt (exec() nicht verfügbar).
 */
function actionBackup(): void {
    ob_start();
    include __DIR__ . '/backup.php';
    ob_end_clean();
    echo json_encode(['ok' => true, 'message' => 'Backup ausgeführt']);
}

// ── DATEI-UPLOAD ───────────────────────────────────────────────────────────

/**
 * Nimmt eine hochgeladene Datei entgegen und schreibt sie ins Zielverzeichnis.
 *
 * Erwartet multipart/form-data mit:
 *   file     — die hochgeladene Datei ($_FILES['file'])
 *   dir      — Zielverzeichnis relativ zu ROOT ('' = Root)
 *   relPath  — optionaler relativer Pfad innerhalb des Zielverzeichnisses
 *              (für Ordner-Uploads: enthält Unterverzeichnisstruktur, z. B. "subdir/file.txt")
 */
function actionUpload(): void {
    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        $code = $_FILES['file']['error'] ?? -1;
        http_response_code(400);
        echo json_encode(['error' => 'Upload-Fehler (Code ' . $code . ')']);
        return;
    }

    $dir     = $_POST['dir']     ?? '';
    $relPath = $_POST['relPath'] ?? $_FILES['file']['name'];

    // Pfad zusammensetzen: ROOT / dir / relPath
    // relPath kann Unterverzeichnisse enthalten (Ordner-Upload via webkitGetAsEntry)
    $combined = ($dir !== '' ? $dir . '/' : '') . $relPath;
    $dest     = safePath($combined);

    // Zielverzeichnis anlegen falls nicht vorhanden
    $destDir = dirname($dest);
    if (!is_dir($destDir)) {
        mkdir($destDir, 0755, true);
    }

    if (!move_uploaded_file($_FILES['file']['tmp_name'], $dest)) {
        throw new RuntimeException('Speichern fehlgeschlagen: ' . $dest);
    }

    echo json_encode(['ok' => true, 'path' => $combined]);
}



/**
 * Validiert und normalisiert einen Pfad relativ zum ROOT.
 * Verhindert Path-Traversal-Angriffe.
 *
 * @param  string $rel Relativer Pfad aus dem Request
 * @return string Absoluter, validierter Pfad
 * @throws RuntimeException Bei ungültigem Pfad
 */
function safePath(string $rel): string {
    // Leeren Pfad ablehnen
    if ($rel === '') throw new RuntimeException('Kein Pfad angegeben');

    // Absoluten Pfad berechnen
    $abs = realpath(ROOT . $rel);

    // Wenn Datei noch nicht existiert (neu), Pfad ohne realpath prüfen
    if ($abs === false) {
        $abs = ROOT . str_replace(['../', '..\\', '../'], '', $rel);
    }

    // Sicherstellen dass der Pfad innerhalb von ROOT liegt
    if (strpos($abs, ROOT) !== 0) {
        throw new RuntimeException('Ungültiger Pfad');
    }

    return $abs;
}