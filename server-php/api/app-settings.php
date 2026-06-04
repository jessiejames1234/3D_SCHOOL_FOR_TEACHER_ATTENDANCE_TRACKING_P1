<?php
// server-php/api/app-settings.php
global $mysqli, $authPayload;

$request_method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$input = get_input();
if (!is_array($input)) $input = [];

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);
$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null;

$ensure_settings_table = function() use ($mysqli) {
    $sql = "CREATE TABLE IF NOT EXISTS `tbl_app_settings` (
        `setting_id` INT(11) NOT NULL AUTO_INCREMENT,
        `setting_group` VARCHAR(100) NOT NULL,
        `setting_key` VARCHAR(100) NOT NULL,
        `setting_value` TEXT NULL,
        `value_type` VARCHAR(50) NOT NULL DEFAULT 'text',
        `updated_by` INT(11) NULL,
        `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (`setting_id`),
        UNIQUE KEY `unique_setting` (`setting_group`, `setting_key`),
        KEY `updated_by` (`updated_by`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
    if (!$mysqli->query($sql)) {
        json_response(['error' => 'settings_table_failed', 'message' => $mysqli->error], 500);
    }
};

$normalize_color = function($value, $fallback = '#c69500') {
    $color = trim((string)$value);
    if (preg_match('/^#[0-9a-fA-F]{6}$/', $color)) return strtolower($color);
    return $fallback;
};

$get_home_settings = function() use ($mysqli, $ensure_settings_table, $normalize_color) {
    $ensure_settings_table();

    $defaults = [
        'home_title' => 'Time is Gold',
        'home_title_color' => '#c69500',
    ];
    $settings = $defaults;

    $stmt = $mysqli->prepare("SELECT setting_key, setting_value FROM tbl_app_settings WHERE setting_group = 'home' AND setting_key IN ('home_title', 'home_title_color')");
    if (!$stmt) {
        json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    }
    $stmt->execute();
    $res = $stmt->get_result();
    while ($row = $res->fetch_assoc()) {
        $key = (string)($row['setting_key'] ?? '');
        if (!array_key_exists($key, $settings)) continue;
        $settings[$key] = (string)($row['setting_value'] ?? '');
    }
    $stmt->close();

    $settings['home_title'] = trim((string)$settings['home_title']) !== '' ? trim((string)$settings['home_title']) : $defaults['home_title'];
    $settings['home_title_color'] = $normalize_color($settings['home_title_color'], $defaults['home_title_color']);

    return $settings;
};

$save_setting = function($group, $key, $value, $type, $updatedBy) use ($mysqli) {
    $stmt = $mysqli->prepare("INSERT INTO tbl_app_settings (setting_group, setting_key, setting_value, value_type, updated_by)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), value_type = VALUES(value_type), updated_by = VALUES(updated_by)");
    if (!$stmt) {
        json_response(['error' => 'prepare_failed', 'message' => $mysqli->error], 500);
    }
    $stmt->bind_param('ssssi', $group, $key, $value, $type, $updatedBy);
    if (!$stmt->execute()) {
        json_response(['error' => 'save_failed', 'message' => $stmt->error], 500);
    }
    $stmt->close();
};

if ($endpoint !== 'app-settings') {
    json_response(['error' => 'not_found'], 404);
}

if ($param1 !== 'home') {
    json_response(['error' => 'not_found', 'message' => 'Settings group not found'], 404);
}

if ($request_method === 'GET') {
    json_response($get_home_settings());
}

if ($request_method === 'PUT' || $request_method === 'POST') {
    $ensure_settings_table();

    $title = trim(strip_tags((string)($input['home_title'] ?? '')));
    $color = $normalize_color($input['home_title_color'] ?? '#c69500');

    if ($title === '') {
        json_response(['error' => 'validation', 'message' => 'Home title is required.'], 400);
    }
    if (strlen($title) > 80) {
        json_response(['error' => 'validation', 'message' => 'Home title must be 80 characters or fewer.'], 400);
    }

    $updatedBy = isset($authPayload['user_id']) ? (int)$authPayload['user_id'] : null;
    $save_setting('home', 'home_title', $title, 'text', $updatedBy);
    $save_setting('home', 'home_title_color', $color, 'color', $updatedBy);

    json_response($get_home_settings());
}

json_response(['error' => 'method_not_allowed'], 405);
