<?php
declare(strict_types=1);

// Redirect the project root to the public entry point.
$basePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$target = ($basePath === '' ? '' : $basePath) . '/public/';
$query = isset($_SERVER['QUERY_STRING']) && $_SERVER['QUERY_STRING'] !== ''
    ? ('?' . $_SERVER['QUERY_STRING'])
    : '';

header('Location: ' . $target . $query, true, 302);
exit;
