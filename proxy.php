<?php
/**
 * proxy.php — KI-API-Proxy
 *
 * Leitet Anfragen an Claude, DeepSeek und OpenAI serverseitig weiter.
 * Vermeidet CORS-Probleme im Browser.
 * API-Schlüssel werden hier konfiguriert — nie im Client exponiert.
 * PHP 7.3+
 */

declare(strict_types=1);
set_time_limit(120);

header('Content-Type: application/json; charset=utf-8');

// ── API-SCHLÜSSEL ──────────────────────────────────────────────────────────
// Schlüssel in .apikeys.php eintragen (gleicher Ordner wie proxy.php)

require_once __DIR__ . '/.apikeys.php';

// ── REQUEST ────────────────────────────────────────────────────────────────

$body = json_decode(file_get_contents('php://input'), true);
if (!$body) {
    http_response_code(400);
    echo json_encode(['error' => 'Kein Body']);
    exit;
}

$model = $body['model'] ?? 'claude';

if ($model === 'claude') {
    proxyRequest(
        'https://api.anthropic.com/v1/messages',
        [
            'Content-Type'      => 'application/json',
            'x-api-key'         => CLAUDE_API_KEY,
            'anthropic-version' => '2023-06-01',
        ],
        $body['payload'] ?? []
    );
} elseif ($model === 'deepseek') {
    proxyRequest(
        'https://api.deepseek.com/chat/completions',
        [
            'Content-Type'  => 'application/json',
            'Authorization' => 'Bearer ' . DEEPSEEK_API_KEY,
        ],
        $body['payload'] ?? []
    );
} elseif ($model === 'openai') {
    proxyRequest(
        'https://api.openai.com/v1/chat/completions',
        [
            'Content-Type'  => 'application/json',
            'Authorization' => 'Bearer ' . OPENAI_API_KEY,
        ],
        $body['payload'] ?? []
    );
} elseif ($model === 'github') {
    // ── GITHUB API PROXY ──────────────────────────────────────────────────
    // Leitet beliebige GitHub REST API Aufrufe weiter.
    // Erwartet: { model: 'github', method: 'GET'|'PUT'|'DELETE', endpoint: '/repos/...', payload: {...} }
    $method   = $body['method']   ?? 'GET';
    $endpoint = $body['endpoint'] ?? '';
    if ($endpoint === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Kein Endpoint angegeben']);
        exit;
    }
    $url = 'https://api.github.com' . $endpoint;
    $headers = [
        'Authorization' => 'Bearer ' . GITHUB_TOKEN,
        'Accept'        => 'application/vnd.github+json',
        'X-GitHub-Api-Version' => '2022-11-28',
        'User-Agent'    => 'devEditor/1.0',
    ];
    if ($method !== 'GET') {
        $headers['Content-Type'] = 'application/json';
    }
    proxyRequestMethod($url, $headers, $method, $body['payload'] ?? null);
} elseif ($model === 'balance') {
    // ── GUTHABEN ABFRAGEN ──────────────────────────────────────────────────
    // Fragt Claude- und DeepSeek-Guthaben parallel ab und gibt beide zurück.
    $result = [];

    // DeepSeek — GET /user/balance
    $ch = curl_init('https://api.deepseek.com/user/balance');
    curl_setopt_array($ch, [
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . DEEPSEEK_API_KEY, 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $r = curl_exec($ch);
    curl_close($ch);
    $decoded = $r ? json_decode($r, true) : null;
    $result['deepseek'] = ($decoded && isset($decoded['balance_infos']))
        ? ['ok' => true, 'usd' => $decoded['balance_infos'][0]['total_balance'] ?? '?', 'available' => $decoded['is_available'] ?? true]
        : ['ok' => false];

    // Claude — kein öffentlicher Guthaben-Endpunkt; liefert null (Platzhalter)
    $result['claude'] = ['ok' => null];

    echo json_encode($result);
} else {
    http_response_code(400);
    echo json_encode(['error' => 'Unbekanntes Modell']);
}

// ── PROXY-FUNKTION ─────────────────────────────────────────────────────────

/**
 * Sendet eine Anfrage an eine externe API (beliebige HTTP-Methode).
 *
 * @param string      $url     Ziel-URL
 * @param array       $headers HTTP-Header
 * @param string      $method  HTTP-Methode
 * @param array|null  $payload Request-Body (null für GET)
 */
function proxyRequestMethod(string $url, array $headers, string $method, ?array $payload): void {
    if (!function_exists('curl_init')) {
        http_response_code(500);
        echo json_encode(['error' => 'cURL nicht verfügbar']);
        return;
    }
    $headerLines = [];
    foreach ($headers as $key => $val) {
        $headerLines[] = $key . ': ' . $val;
    }
    $ch = curl_init($url);
    $opts = [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headerLines,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ];
    if ($payload !== null && $method !== 'GET') {
        $opts[CURLOPT_POSTFIELDS] = json_encode($payload);
    }
    curl_setopt_array($ch, $opts);
    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);
    if ($response === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Upstream nicht erreichbar: ' . $curlError]);
        return;
    }
    http_response_code($httpCode ?: 200);
    echo $response;
}

/**
 * Sendet eine Anfrage an eine externe API und gibt die Antwort zurück.
 *
 * @param string $url     Ziel-URL
 * @param array  $headers HTTP-Header
 * @param array  $payload Request-Body
 */
function proxyRequest(string $url, array $headers, array $payload): void {
    if (!function_exists('curl_init')) {
        http_response_code(500);
        echo json_encode(['error' => 'cURL nicht verfügbar']);
        return;
    }

    $headerLines = [];
    foreach ($headers as $key => $val) {
        $headerLines[] = $key . ': ' . $val;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => $headerLines,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 180,        // 3 Minuten
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($response === false) {
        http_response_code(502);
        echo json_encode(['error' => 'Upstream nicht erreichbar: ' . $curlError]);
        return;
    }

    http_response_code($httpCode ?: 200);
    echo $response;
}