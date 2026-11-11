<?php
// Request-local work only: no database queue, scheduler, or automatic retry.
// CLI workers have no browser response to finish and send synchronously.
function app_defer_email(callable $send) {
    if (PHP_SAPI === 'cli' || PHP_SAPI === 'phpdbg' || !function_exists('json_response')) {
        return false;
    }
    $GLOBALS['app_deferred_emails'][] = $send;
    return true;
}

function app_has_deferred_emails() {
    return !empty($GLOBALS['app_deferred_emails']);
}

function app_run_deferred_emails() {
    $jobs = $GLOBALS['app_deferred_emails'] ?? [];
    $GLOBALS['app_deferred_emails'] = [];
    // Prevent warnings/debug output from corrupting the completed response.
    ob_start(static function ($output) { return ''; });
    foreach ($jobs as $send) {
        @set_time_limit(120);
        try {
            $send();
        } catch (Throwable $error) {
            error_log('[deferred_email] Email was not sent: ' . $error->getMessage());
        }
    }
    ob_end_clean();
}
