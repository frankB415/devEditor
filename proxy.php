<?php
/**
 * proxy.php — KI-API-Proxy
 * PHP 7.3+
 */

declare(strict_types=1);
set_time_limit(300);

error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
set_error_handler(function($errno, $errstr, $errfile, $errline) {
    header('Content-Type: application/json; charset=utf-8', true, 500);
    echo json_encode(['error' => "PHP $errno: $errstr in $errfile:$errline"]);
    exit;
});
set_exception_handler(function($e) {
    header('Content-Type: application/json; charset=utf-8', true, 500);
    echo json_encode(['error' => 'Exception: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine()]);
    exit;
});

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/.apikeys.php';

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
    $method   = $body['method']   ?? 'GET';
    $endpoint = $body['endpoint'] ?? '';
    if ($endpoint === '') {
        http_response_code(400);
        echo json_encode(['error' => 'Kein Endpoint angegeben']);
        exit;
    }
    $url = 'https://api.github.com' . $endpoint;
    $headers = [
        'Authorization'        => 'Bearer ' . GITHUB_TOKEN,
        'Accept'               => 'application/vnd.github+json',
        'X-GitHub-Api-Version' => '2022-11-28',
        'User-Agent'           => 'devEditor/1.0',
    ];
    if ($method !== 'GET') {
        $headers['Content-Type'] = 'application/json';
    }
    proxyRequestMethod($url, $headers, $method, $body['payload'] ?? null);

} elseif ($model === 'claude-stream') {
    // ── CLAUDE STREAMING ────────────────────────────────────────────────────
    $payload = $body['payload'] ?? [];
    $payload['stream'] = true;

    while (ob_get_level()) ob_end_clean();
    ob_implicit_flush(1);

    header('Content-Type: text/event-stream');
    header('Cache-Control: no-cache');
    header('X-Accel-Buffering: no');

    $headerLines = [
        'Content-Type: application/json',
        'x-api-key: ' . CLAUDE_API_KEY,
        'anthropic-version: 2023-06-01',
    ];

    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => $headerLines,
        CURLOPT_RETURNTRANSFER => false,
        CURLOPT_TIMEOUT        => 270,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_WRITEFUNCTION  => function($ch, $chunk) {
            $lines = explode("\n", $chunk);
            foreach ($lines as $line) {
                $line = trim($line);
                if (strncmp($line, 'data: ', 6) !== 0) continue;
                $json = json_decode(substr($line, 6), true);
                if (!$json) continue;
                $type = $json['type'] ?? '';
                if ($type === 'content_block_delta') {
                    $text = $json['delta']['text'] ?? '';
                    if ($text !== '') {
                        echo 'data: ' . json_encode(['t' => $text]) . "\n\n";
                        flush();
                    }
                } elseif ($type === 'message_stop') {
                    echo "data: [DONE]\n\n";
                    flush();
                } elseif ($type === 'error') {
                    echo 'data: ' . json_encode(['error' => $json['error']['message'] ?? 'Fehler']) . "\n\n";
                    flush();
                }
            }
            return strlen($chunk);
        },
    ]);
    curl_exec($ch);
    curl_close($ch);

} elseif ($model === 'balance') {
    $result = [];

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
    $result['claude'] = ['ok' => null];

    echo json_encode($result);

} else {
    http_response_code(400);
    echo json_encode(['error' => 'Unbekanntes Modell: ' . $model]);
}

// ── PROXY-FUNKTIONEN ────────────────────────────────────────────────────────

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
        CURLOPT_TIMEOUT        => 270,
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