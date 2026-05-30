<?php
/**
 * backup.php — Inkrementelles Backup-Skript
 *
 * - Erstellt ein ZIP mit allen seit dem letzten Backup geänderten Dateien
 * - Sichert ausschließlich textbasierte Quellcode-Dateien
 * - Dateiname: backup_YYYYMMDDThhmm.zip im /backups/-Verzeichnis
 * - Wird manuell via Backup-Knopf ausgelöst (über api.php → actionBackup)
 * - Schreibsperre: Lockfile während des ZIP-Vorgangs
 * - PHP 7.3+
 */

declare(strict_types=1);
set_time_limit(120);

// ── KONFIGURATION ──────────────────────────────────────────────────────────

defined('ROOT')             || define('ROOT',             dirname(__DIR__) . '/');
defined('BACKUP_DIR')       || define('BACKUP_DIR',       ROOT . 'backups/');
defined('LOCK_FILE')        || define('LOCK_FILE',        ROOT . '.backup.lock');
defined('LAST_BACKUP_FILE') || define('LAST_BACKUP_FILE', ROOT . '.backup_last');

/** Erlaubte Dateiendungen für das Backup */
const ALLOWED_EXTENSIONS = ['php', 'js', 'css', 'html', 'htm', 'json', 'txt', 'md', 'xml', 'htaccess', 'env', 'ini', 'sql', 'sh'];

/** Verzeichnisse die vom Backup ausgeschlossen werden */
const EXCLUDED_DIRS = ['backups', '.git', 'node_modules', 'vendor'];

// ── ZEITSTEMPEL ────────────────────────────────────────────────────────────

$now = time();

// ── LOCKFILE SETZEN (Schreibsperre) ────────────────────────────────────────

if (file_exists(LOCK_FILE)) {
    // Backup läuft bereits
    return;
}

file_put_contents(LOCK_FILE, (string)$now);

// ── BACKUP-VERZEICHNIS ANLEGEN ──────────────────────────────────────────────

if (!is_dir(BACKUP_DIR)) {
    mkdir(BACKUP_DIR, 0755, true);
}

// ── DATEIEN SAMMELN ────────────────────────────────────────────────────────

/**
 * Sammelt alle zu sichernden Dateien.
 * Nur geänderte Dateien seit dem letzten Backup, nur erlaubte Endungen.
 *
 * @param  string $dir        Aktuelles Verzeichnis
 * @param  int    $sinceTime  Letzter Backup-Zeitpunkt (Unix-Timestamp)
 * @return array  Liste absoluter Dateipfade
 */
function collectFiles(string $dir, int $sinceTime): array {
    $files   = [];
    $entries = @scandir($dir);
    if ($entries === false) return $files;

    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..') continue;

        // Versteckte Systemdateien des Backups überspringen
        if ($entry === '.backup.lock' || $entry === '.backup_last') continue;

        $abs = $dir . $entry;

        // Ausgeschlossene Verzeichnisse überspringen
        if (is_dir($abs)) {
            $relDir = str_replace(ROOT, '', $abs);
            if (in_array($relDir, EXCLUDED_DIRS, true)) continue;
            $files = array_merge($files, collectFiles($abs . '/', $sinceTime));
            continue;
        }

        if (!is_file($abs)) continue;

        // Endung prüfen
        $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
        // .htaccess hat keine Endung, wird über den Namen erkannt
        if ($entry !== '.htaccess' && !in_array($ext, ALLOWED_EXTENSIONS, true)) continue;

        // Inkrementell: Nur geänderte Dateien
        if ($sinceTime > 0 && filemtime($abs) <= $sinceTime) continue;

        $files[] = $abs;
    }

    return $files;
}

$lastBackup    = file_exists(LAST_BACKUP_FILE) ? (int)file_get_contents(LAST_BACKUP_FILE) : 0;
$filesToBackup = collectFiles(ROOT, $lastBackup);

if (empty($filesToBackup)) {
    // Keine Änderungen — Lockfile entfernen und Zeitstempel aktualisieren
    file_put_contents(LAST_BACKUP_FILE, (string)$now);
    unlink(LOCK_FILE);
    return;
}

// ── ZIP ERSTELLEN ──────────────────────────────────────────────────────────

$zipName = 'backup_' . date('Ymd\THi') . '.zip';
$zipPath = BACKUP_DIR . $zipName;

$zip = new ZipArchive();
if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
    unlink(LOCK_FILE);
    error_log('backup.php: ZIP konnte nicht erstellt werden: ' . $zipPath);
    exit(1);
}

foreach ($filesToBackup as $absPath) {
    $relPath = str_replace(ROOT, '', $absPath);
    $zip->addFile($absPath, $relPath);
}

$zip->close();

// ── ABSCHLUSS ──────────────────────────────────────────────────────────────

file_put_contents(LAST_BACKUP_FILE, (string)$now);
unlink(LOCK_FILE);

return;