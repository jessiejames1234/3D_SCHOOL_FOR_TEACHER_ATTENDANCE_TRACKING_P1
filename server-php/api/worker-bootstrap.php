<?php
// server-php/api/worker-bootstrap.php
// Lightweight health-check endpoint to ensure the attendance worker task is running.

if (!function_exists('json_response')) {
    require_once __DIR__ . '/../helpers/functions.php';
}

if (!function_exists('wb_quote_win')) {
    function wb_quote_win(string $value): string
    {
        return '"' . str_replace('"', '\"', $value) . '"';
    }
}

if (!function_exists('wb_exec_command')) {
    function wb_exec_command(string $command): array
    {
        if (!function_exists('exec')) {
            return [
                'ok' => false,
                'code' => -1,
                'lines' => ['exec() is disabled in PHP configuration.'],
                'command' => $command,
            ];
        }

        $lines = [];
        $code = 0;
        exec($command . ' 2>&1', $lines, $code);

        return [
            'ok' => ((int)$code === 0),
            'code' => (int)$code,
            'lines' => $lines,
            'command' => $command,
        ];
    }
}

if (!function_exists('wb_extract_list_value')) {
    function wb_extract_list_value(array $lines, string $label): string
    {
        foreach ($lines as $line) {
            $trimmed = trim((string)$line);
            if ($trimmed === '') {
                continue;
            }
            $prefix = $label . ':';
            if (stripos($trimmed, $prefix) === 0) {
                return trim(substr($trimmed, strlen($prefix)));
            }
        }
        return '';
    }
}

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($request_method !== 'GET') {
    json_response(['error' => 'Invalid request method for worker bootstrap.'], 405);
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
$parts = explode('/', (string)$path);
$api_prefix_key = array_search('api', $parts, true);
$param1 = ($api_prefix_key !== false) ? ($parts[$api_prefix_key + 2] ?? 'ping') : 'ping';
$param1 = ($param1 === null || $param1 === '') ? 'ping' : $param1;

if ($param1 !== 'ping') {
    json_response(['error' => 'Worker bootstrap endpoint not found.'], 404);
}

$taskName = getenv('ATTENDANCE_WORKER_TASK') ?: '3D1.2_AcademicAttendanceWorker';

if (PHP_OS_FAMILY !== 'Windows') {
    json_response([
        'ok' => false,
        'message' => 'worker_bootstrap_unsupported_platform',
        'platform' => PHP_OS_FAMILY,
        'task' => $taskName,
    ]);
}

$queryCmd = 'schtasks /Query /TN ' . wb_quote_win($taskName) . ' /V /FO LIST';
$before = wb_exec_command($queryCmd);
if (!$before['ok']) {
    json_response([
        'ok' => false,
        'message' => 'worker_task_query_failed',
        'task' => $taskName,
        'code' => $before['code'],
        'details' => implode("\n", $before['lines']),
        'hint' => 'Run server-php/scripts/create_cron_worker_tasks.ps1 first.',
    ], 500);
}

$beforeStatus = wb_extract_list_value($before['lines'], 'Status');
$beforeResult = wb_extract_list_value($before['lines'], 'Last Result');
$isRunning = (stripos($beforeStatus, 'running') !== false);

$started = false;
$startError = null;
if (!$isRunning) {
    $runCmd = 'schtasks /Run /TN ' . wb_quote_win($taskName);
    $run = wb_exec_command($runCmd);
    if ($run['ok']) {
        $started = true;
    } else {
        $startError = implode("\n", $run['lines']);
    }
}

$after = wb_exec_command($queryCmd);
$afterStatus = $after['ok'] ? wb_extract_list_value($after['lines'], 'Status') : $beforeStatus;
$afterResult = $after['ok'] ? wb_extract_list_value($after['lines'], 'Last Result') : $beforeResult;

json_response([
    'ok' => ($startError === null),
    'task' => $taskName,
    'started' => $started,
    'before' => [
        'status' => $beforeStatus,
        'last_result' => $beforeResult,
    ],
    'after' => [
        'status' => $afterStatus,
        'last_result' => $afterResult,
    ],
    'message' => ($startError === null)
        ? ($started ? 'worker_started' : 'worker_already_running')
        : 'worker_start_failed',
    'error' => $startError,
]);
