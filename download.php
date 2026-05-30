<?php
/**
 * download.php — Datei- und Ordner-Download
 *
 * Einzeldatei: max. 10 MB, direkt als Download
 * Ordner:      serverseitig als ZIP komprimiert, dann als Download
 * PHP 7.3+
 */

declare(strict_types=1);
set_time_limit(60);

// ── KONFIGURATION ──────────────────────────────────────────────────────────

define('ROOT',             dirname(__DIR__) . '/');
define('MAX_FILE_BYTES',   10 * 1024 * 1024); // 10 MB

// ── PARAMETER ──────────────────────────────────────────────────────────────

$relPath = $_GET['path'] ?? '';
$type    = $_GET['type'] ?? 'file';

if ($relPath === '') {
    http_response_code(400);
    echo 'Kein Pfad angegeben';
    exit;
}

$absPath = safePath($relPath);

// ── EINZELDATEI ────────────────────────────────────────────────────────────

if ($type === 'file') {
    if (!is_file($absPath)) {
        http_response_code(404);
        echo 'Datei nicht gefunden';
        exit;
    }

    $size = filesize($absPath);
    if ($size > MAX_FILE_BYTES) {
        http_response_code(413);
        echo 'Datei zu groß (max. 10 MB)';
        exit;
    }

    $name = basename($absPath);
    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . addslashes($name) . '"');
    header('Content-Length: ' . $size);
    header('Cache-Control: no-cache');
    readfile($absPath);
    exit;
}

// ── ORDNER ALS ZIP ─────────────────────────────────────────────────────────

if ($type === 'dir') {
    if (!is_dir($absPath)) {
        http_response_code(404);
        echo 'Ordner nicht gefunden';
        exit;
    }

    $zipName = basename($absPath) . '_' . date('Ymd_His') . '.zip';
    $tmpPath = sys_get_temp_dir() . '/' . $zipName;

    $zip = new ZipArchive();
    if ($zip->open($tmpPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        http_response_code(500);
        echo 'ZIP konnte nicht erstellt werden';
        exit;
    }

    addDirToZip($zip, $absPath, basename($absPath));
    $zip->close();

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . addslashes($zipName) . '"');
    header('Content-Length: ' . filesize($tmpPath));
    header('Cache-Control: no-cache');
    readfile($tmpPath);
    unlink($tmpPath);
    exit;
}

http_response_code(400);
echo 'Unbekannter Typ';

// ── HILFSFUNKTIONEN ────────────────────────────────────────────────────────

/**
 * Fügt ein Verzeichnis rekursiv zum ZIP hinzu.
 *
 * @param ZipArchive $zip    ZIP-Archiv
 * @param string     $dir    Absoluter Pfad des Verzeichnisses
 * @param string     $base   Relativer Pfad im ZIP
 */
function addDirToZip(ZipArchive $zip, string $dir, string $base): void {
    $zip->addEmptyDir($base);
    foreach (scandir($dir) as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $abs = $dir . '/' . $entry;
        $rel = $base . '/' . $entry;
        if (is_dir($abs)) {
            addDirToZip($zip, $abs, $rel);
        } else {
            $zip->addFile($abs, $rel);
        }
    }
}

/**
 * Validiert und normalisiert einen Pfad relativ zu ROOT.
 *
 * @param  string $rel Relativer Pfad
 * @return string Absoluter, validierter Pfad
 */
function safePath(string $rel): string {
    $abs = realpath(ROOT . $rel);
    if ($abs === false || strpos($abs, ROOT) !== 0) {
        http_response_code(403);
        echo 'Ungültiger Pfad';
        exit;
    }
    return $abs;
}