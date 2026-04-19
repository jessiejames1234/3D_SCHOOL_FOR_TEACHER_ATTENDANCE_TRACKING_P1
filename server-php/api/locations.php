<?php
// server-php/api/locations.php
require_once __DIR__ . '/../helpers/socket_helper.php';
require_once __DIR__ . '/../helpers/log_helper.php'; // add system log helper

// Capture authenticated user (optional) so logs can record who performed the action
$authHeader = null;
$candidates = ['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_AUTHORIZATION', 'HTTP_X_API_TOKEN', 'HTTP_AUTH', 'AUTHORIZATION'];
foreach ($candidates as $k) { if (!empty($_SERVER[$k])) { $authHeader = $_SERVER[$k]; break; } }
if (empty($authHeader) && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    foreach (['Authorization','authorization','AUTHORIZATION'] as $h) { if (!empty($headers[$h])) { $authHeader = $headers[$h]; break; } }
}
$queryToken = $_GET['token'] ?? null;
if (empty($authHeader) && !empty($queryToken)) { $authHeader = 'Bearer ' . $queryToken; }
$authUserId = null; // default to null (system)
if (!empty($authHeader) && preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
    $token = $m[1];
    $sec = [];
    if (file_exists(__DIR__ . '/../config/security.php')) $sec = require __DIR__ . '/../config/security.php';
    $secret_key = $sec['jwt_secret'] ?? 'your-secret-key';
    try {
        $decoded = \Firebase\JWT\JWT::decode($token, new \Firebase\JWT\Key($secret_key, 'HS256'));
        $authUserId = isset($decoded->user_id) ? (int)$decoded->user_id : null;
    } catch (Throwable $_) { /* ignore invalid token for logging */ }
}

global $mysqli;

// Helper: find the first existing column name from candidates for a table
function find_existing_column($table, $candidates) {
    global $mysqli;
    foreach ($candidates as $c) {
        $c_esc = $mysqli->real_escape_string($c);
        $res = $mysqli->query("SHOW COLUMNS FROM `$table` LIKE '{$c_esc}'");
        if ($res && $res->num_rows) return $c;
    }
    return null;
}

$request_method = $_SERVER['REQUEST_METHOD'];
$input = get_input();

$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$parts = explode('/', $path);
$api_prefix_key = array_search('api', $parts);

$endpoint = $parts[$api_prefix_key + 1] ?? null;
$param1 = $parts[$api_prefix_key + 2] ?? null;
$param2 = $parts[$api_prefix_key + 3] ?? null;
$param3 = $parts[$api_prefix_key + 4] ?? null;

switch ($endpoint) {
    case 'buildings':
        if ($request_method === 'GET') {
            // Detect which columns exist and build a safe SELECT
            $latCol = find_existing_column('tbl_buildings', ['latitude','alt','altitude','lat']);
            $lonCol = find_existing_column('tbl_buildings', ['longitude','lon','lng','long']);
            $radCol = find_existing_column('tbl_buildings', ['radius','building_radius']);
            $descCol = find_existing_column('tbl_buildings', ['location_description','description','building_description']);

            $select = [ 'b.building_id', 'b.building_name', 'b.status AS status' ];
            // include school association if present
            $select[] = 'b.school_id';
            $select[] = 's.school_name AS school_name';
            $select[] = $descCol ? "b.`{$descCol}` AS location_description" : "NULL AS location_description";
            $select[] = $latCol ? "b.`{$latCol}` AS latitude" : "NULL AS latitude";
            $select[] = $lonCol ? "b.`{$lonCol}` AS longitude" : "NULL AS longitude";
            $select[] = $radCol ? "b.`{$radCol}` AS radius" : "NULL AS radius";

            // Single building
            if (is_numeric($param1)) {
                $sql = 'SELECT ' . implode(', ', $select) . ' FROM tbl_buildings b LEFT JOIN tbl_school s ON b.school_id = s.school_id WHERE b.building_id = ? LIMIT 1';
                $stmt = $mysqli->prepare($sql);
                if (!$stmt) json_response(['error' => 'Failed to prepare query', 'details' => $mysqli->error], 500);
                $stmt->bind_param('i', $param1);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                if (!$row) json_response(['error' => 'building_not_found'], 404);
                json_response($row);
            }

            // join with tbl_school to expose school_name (if exists)
            $sql = 'SELECT ' . implode(', ', $select) . ' FROM tbl_buildings b LEFT JOIN tbl_school s ON b.school_id = s.school_id ORDER BY b.building_name';
            $result = $mysqli->query($sql);
            if (!$result) {
                json_response(['error' => 'Failed to fetch buildings: ' . $mysqli->error], 500);
            }
            json_response($result->fetch_all(MYSQLI_ASSOC));

        } elseif ($request_method === 'POST' && is_numeric($param1) && ($param2 === 'update' || $param2 === null)) {
            // Backward-compatible update endpoint: POST /buildings/{id}/update
            $id = (int)$param1;
            // Validate input
            $name = isset($input['building_name']) ? trim($input['building_name']) : null;
            $latitude = array_key_exists('latitude', $input) ? ($input['latitude'] === '' ? null : (float)$input['latitude']) : null;
            $longitude = array_key_exists('longitude', $input) ? ($input['longitude'] === '' ? null : (float)$input['longitude']) : null;
            $radius = isset($input['radius']) ? (int)$input['radius'] : null;
            $status = isset($input['status']) ? $input['status'] : null;

            // Detect description and lat/lon column names
            $descCol = find_existing_column('tbl_buildings', ['location_description','description','building_description']);
            $school_id = array_key_exists('school_id', $input) ? (int)$input['school_id'] : null;
            $latCol = find_existing_column('tbl_buildings', ['latitude','alt','altitude','lat']);
            $lonCol = find_existing_column('tbl_buildings', ['longitude','lon','lng','long']);

            // name uniqueness check
            if ($name) {
                $nstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE LOWER(building_name) = LOWER(?) AND building_id != ? LIMIT 1");
                $nstmt->bind_param('si', $name, $id);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A building with the same name already exists'], 409);
            }
            // lat/lon unique pair check when both provided
            if ($latitude !== null && $longitude !== null && $latCol && $lonCol) {
                $lstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE ABS(COALESCE(`{$latCol}`,0) - ?) < 0.0000001 AND ABS(COALESCE(`{$lonCol}`,0) - ?) < 0.0000001 AND building_id != ? LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('ddi', $latitude, $longitude, $id);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_latlon', 'message' => 'Another building with same latitude/longitude exists'], 409);
                }
            }

            // Build update dynamically
            $sets = [];
            $types = '';
            $vals = [];
            if ($name !== null) { $sets[] = 'building_name = ?'; $types .= 's'; $vals[] = $name; }
            if ($school_id !== null) { $sets[] = 'school_id = ?'; $types .= 'i'; $vals[] = $school_id; }
            if ($descCol && array_key_exists('location_description', $input)) { $sets[] = "`{$descCol}` = ?"; $types .= 's'; $vals[] = $input['location_description']; }
            if ($radius !== null) { $sets[] = 'radius = ?'; $types .= 'i'; $vals[] = $radius; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if ($latCol && array_key_exists('latitude', $input)) { $sets[] = "`{$latCol}` = ?"; $types .= 'd'; $vals[] = $latitude; }
            if ($lonCol && array_key_exists('longitude', $input)) { $sets[] = "`{$lonCol}` = ?"; $types .= 'd'; $vals[] = $longitude; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);

            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_buildings SET ' . implode(', ', $sets) . ' WHERE building_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log the update (use building name for a professional text-only message)
            $logName = $name ?? null;
            if (!$logName) {
                $q = $mysqli->prepare("SELECT building_name FROM tbl_buildings WHERE building_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logName = $r['building_name'] ?? null; }
            }
            $logMsg = $logName ? "Updated building details for '{$logName}'" : 'Updated building details';
            log_system_action($mysqli, $authUserId, 'update_building', $logMsg);
            json_response(['ok' => true, 'building_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'PUT' && is_numeric($param1)) {
            // Accept PUT /buildings/{id} as update (same validations as POST /buildings/{id}/update)
            $id = (int)$param1;
            // Validate input
            $name = isset($input['building_name']) ? trim($input['building_name']) : null;
            $latitude = array_key_exists('latitude', $input) ? ($input['latitude'] === '' ? null : (float)$input['latitude']) : null;
            $longitude = array_key_exists('longitude', $input) ? ($input['longitude'] === '' ? null : (float)$input['longitude']) : null;
            $radius = isset($input['radius']) ? (int)$input['radius'] : null;
            $status = isset($input['status']) ? $input['status'] : null;
            $school_id = array_key_exists('school_id', $input) ? (int)$input['school_id'] : null;

            // Detect description and lat/lon column names
            $descCol = find_existing_column('tbl_buildings', ['location_description','description','building_description']);
            $latCol = find_existing_column('tbl_buildings', ['latitude','alt','altitude','lat']);
            $lonCol = find_existing_column('tbl_buildings', ['longitude','lon','lng','long']);

            // name uniqueness check
            if ($name) {
                $nstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE LOWER(building_name) = LOWER(?) AND building_id != ? LIMIT 1");
                if ($nstmt) {
                    $nstmt->bind_param('si', $name, $id);
                    $nstmt->execute();
                    if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A building with the same name already exists'], 409);
                }
            }
            // lat/lon unique pair check when both provided
            if ($latitude !== null && $longitude !== null && $latCol && $lonCol) {
                $lstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE ABS(COALESCE(`{$latCol}`,0) - ?) < 0.0000001 AND ABS(COALESCE(`{$lonCol}`,0) - ?) < 0.0000001 AND building_id != ? LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('ddi', $latitude, $longitude, $id);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_latlon', 'message' => 'Another building with same latitude/longitude exists'], 409);
                }
            }

            // Build update dynamically
            $sets = [];
            $types = '';
            $vals = [];
            if ($name !== null) { $sets[] = 'building_name = ?'; $types .= 's'; $vals[] = $name; }
            if ($school_id !== null) { $sets[] = 'school_id = ?'; $types .= 'i'; $vals[] = $school_id; }
            if ($descCol && array_key_exists('location_description', $input)) { $sets[] = "`{$descCol}` = ?"; $types .= 's'; $vals[] = $input['location_description']; }
            if ($radius !== null) { $sets[] = 'radius = ?'; $types .= 'i'; $vals[] = $radius; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if ($latCol && array_key_exists('latitude', $input)) { $sets[] = "`{$latCol}` = ?"; $types .= 'd'; $vals[] = $latitude; }
            if ($lonCol && array_key_exists('longitude', $input)) { $sets[] = "`{$lonCol}` = ?"; $types .= 'd'; $vals[] = $longitude; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);

            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_buildings SET ' . implode(', ', $sets) . ' WHERE building_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log the update (PUT) with professional message
            $logName = $name ?? null;
            if (!$logName) {
                $q = $mysqli->prepare("SELECT building_name FROM tbl_buildings WHERE building_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logName = $r['building_name'] ?? null; }
            }
            $logMsg = $logName ? "Updated building details for '{$logName}'" : 'Updated building details';
            log_system_action($mysqli, $authUserId, 'update_building', $logMsg);
            json_response(['ok' => true, 'building_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'POST') {
            // Insert into buildings table. Keep insert minimal to avoid errors when latitude/longitude columns are missing.
            $name = isset($input['building_name']) ? trim($input['building_name']) : '';
            if ($name === '') json_response(['error' => 'missing_name', 'message' => 'Building name is required'], 400);

            // duplicate name check (case-insensitive)
            $nstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE LOWER(building_name) = LOWER(?) LIMIT 1");
            $nstmt->bind_param('s', $name);
            $nstmt->execute();
            if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A building with the same name already exists'], 409);

            $latitude = array_key_exists('latitude', $input) && $input['latitude'] !== '' ? (float)$input['latitude'] : null;
            $longitude = array_key_exists('longitude', $input) && $input['longitude'] !== '' ? (float)$input['longitude'] : null;
            $latCol = find_existing_column('tbl_buildings', ['latitude','alt','altitude','lat']);
            $lonCol = find_existing_column('tbl_buildings', ['longitude','lon','lng','long']);
            if ($latitude !== null && $longitude !== null && $latCol && $lonCol) {
                $lstmt = $mysqli->prepare("SELECT building_id FROM tbl_buildings WHERE ABS(COALESCE(`{$latCol}`,0) - ?) < 0.0000001 AND ABS(COALESCE(`{$lonCol}`,0) - ?) < 0.0000001 LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('dd', $latitude, $longitude);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_latlon', 'message' => 'Another building with same latitude/longitude exists'], 409);
                }
            }

            // Build insert dynamically depending on available columns
            $descCol = find_existing_column('tbl_buildings', ['location_description','description','building_description']);
            $insertCols = ['building_name', 'radius', 'status'];
            $placeholders = ['?', '?', '?'];
            $types = 'sis';
            $vals = [$name, isset($input['radius']) ? (int)$input['radius'] : 0, 'active'];

            if ($descCol && isset($input['location_description'])) {
                array_unshift($insertCols, $descCol);
                array_unshift($placeholders, '?');
                $types = 's' . $types;
                array_unshift($vals, $input['location_description']);
            }

            // accept optional school_id on insert
            if (isset($input['school_id'])) {
                array_unshift($insertCols, 'school_id');
                array_unshift($placeholders, '?');
                $types = 'i' . $types;
                array_unshift($vals, (int)$input['school_id']);
            }

            $sql = 'INSERT INTO tbl_buildings (' . implode(', ', $insertCols) . ') VALUES (' . implode(', ', $placeholders) . ')';
            $stmt = $mysqli->prepare($sql);
            if (!$stmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $stmt->bind_param($types, ...$vals);
            $stmt->execute();
            $newId = $stmt->insert_id;
            // Log create building (text-only message)
            $logMsg = $name ? "Created building: {$name}" : 'Created a new building';
            log_system_action($mysqli, $authUserId, 'create_building', $logMsg);

            // If any latitude/longitude-like column exists, update it with provided payload values
            $latCol = find_existing_column('tbl_buildings', ['latitude','alt','altitude','lat']);
            $lonCol = find_existing_column('tbl_buildings', ['longitude','lon','lng','long']);
            if ($latCol || $lonCol) {
                $parts = [];
                $types2 = '';
                $vals2 = [];
                if ($latCol && isset($input['latitude'])) { $parts[] = "`{$latCol}` = ?"; $types2 .= 'd'; $vals2[] = (float)$input['latitude']; }
                if ($lonCol && isset($input['longitude'])) { $parts[] = "`{$lonCol}` = ?"; $types2 .= 'd'; $vals2[] = (float)$input['longitude']; }
                if (!empty($parts)) {
                    $types2 .= 'i'; $vals2[] = $newId;
                    $ustmt = $mysqli->prepare("UPDATE tbl_buildings SET " . implode(', ', $parts) . " WHERE building_id = ?");
                    if ($ustmt) {
                        $ustmt->bind_param($types2, ...$vals2);
                        $ustmt->execute();
                    }
                }
            }

            json_response(['building_id' => $newId] + $input, 201);
        }
        break;

    case 'floors':
         if ($request_method === 'GET') {
            // Support optional building_id filter
            if (isset($_GET['building_id']) && is_numeric($_GET['building_id'])) {
                $bId = (int)$_GET['building_id'];
                $fstmt = $mysqli->prepare("SELECT f.floor_id, f.building_id, b.building_name, f.floor_name, f.baseline_altitude, f.floor_meter_vertical, f.qr_token, f.status FROM tbl_floors f JOIN tbl_buildings b ON f.building_id = b.building_id WHERE f.building_id = ? ORDER BY f.floor_name");
                if ($fstmt === false) json_response(['error' => 'Failed to prepare floors query', 'sql_error' => $mysqli->error], 500);
                $fstmt->bind_param('i', $bId);
                $fstmt->execute();
                $floors_res = $fstmt->get_result();
                json_response($floors_res->fetch_all(MYSQLI_ASSOC));
            } else {
                $result = $mysqli->query("SELECT f.floor_id, f.building_id, b.building_name, f.floor_name, f.baseline_altitude, f.floor_meter_vertical, f.qr_token, f.status FROM tbl_floors f JOIN tbl_buildings b ON f.building_id = b.building_id ORDER BY f.building_id, f.floor_name");
                if (!$result) json_response(['error' => 'Failed to fetch floors: ' . $mysqli->error], 500);
                json_response($result->fetch_all(MYSQLI_ASSOC));
            }
        } elseif ($request_method === 'POST' && is_numeric($param1) && ($param2 === 'update' || $param2 === null)) {
            // Update floor: POST /floors/{id}/update
            $id = (int)$param1;
            $building_id = isset($input['building_id']) ? (int)$input['building_id'] : null;
            $floor_name = isset($input['floor_name']) ? trim($input['floor_name']) : null;
            $baseline_altitude = array_key_exists('baseline_altitude', $input) && $input['baseline_altitude'] !== '' ? (float)$input['baseline_altitude'] : null;
            $floor_meter_vertical = array_key_exists('floor_meter_vertical', $input) && $input['floor_meter_vertical'] !== '' ? (float)$input['floor_meter_vertical'] : null;
            $status = isset($input['status']) ? $input['status'] : null;

            // basic validation
            if ($floor_name) {
                $nstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE LOWER(floor_name) = LOWER(?) AND building_id = ? AND floor_id != ? LIMIT 1");
                $nstmt->bind_param('sii', $floor_name, $building_id, $id);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A floor with the same name already exists in this building'], 409);
            }
            if ($baseline_altitude !== null && $building_id !== null) {
                $lstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE ABS(COALESCE(baseline_altitude,0) - ?) < 0.0000001 AND building_id = ? AND floor_id != ? LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('dii', $baseline_altitude, $building_id, $id);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_altitude', 'message' => 'Another floor with same baseline altitude exists in this building'], 409);
                }
            }

            // Build update
            $sets = [];
            $types = '';
            $vals = [];
            if ($building_id !== null) { $sets[] = 'building_id = ?'; $types .= 'i'; $vals[] = $building_id; }
            if ($floor_name !== null) { $sets[] = 'floor_name = ?'; $types .= 's'; $vals[] = $floor_name; }
            if ($baseline_altitude !== null) { $sets[] = 'baseline_altitude = ?'; $types .= 'd'; $vals[] = $baseline_altitude; }
            if ($floor_meter_vertical !== null) { $sets[] = 'floor_meter_vertical = ?'; $types .= 'd'; $vals[] = $floor_meter_vertical; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_floors SET ' . implode(', ', $sets) . ' WHERE floor_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log floor update
            $logFloor = $floor_name ?? null;
            if (!$logFloor) {
                $q = $mysqli->prepare("SELECT floor_name FROM tbl_floors WHERE floor_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logFloor = $r['floor_name'] ?? null; }
            }
            $logMsg = $logFloor ? "Updated floor details for '{$logFloor}'" : 'Updated floor details';
            log_system_action($mysqli, $authUserId, 'update_floor', $logMsg);
            json_response(['ok' => true, 'floor_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'PUT' && is_numeric($param1)) {
            // Accept PUT /floors/{id} as an update (same validations as POST update)
            $id = (int)$param1;
            $building_id = isset($input['building_id']) ? (int)$input['building_id'] : null;
            $floor_name = isset($input['floor_name']) ? trim($input['floor_name']) : null;
            $baseline_altitude = array_key_exists('baseline_altitude', $input) && $input['baseline_altitude'] !== '' ? (float)$input['baseline_altitude'] : null;
            $floor_meter_vertical = array_key_exists('floor_meter_vertical', $input) && $input['floor_meter_vertical'] !== '' ? (float)$input['floor_meter_vertical'] : null;
            $status = isset($input['status']) ? $input['status'] : null;

            // basic validation (duplicate name / altitude)
            if ($floor_name) {
                $nstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE LOWER(floor_name) = LOWER(?) AND building_id = ? AND floor_id != ? LIMIT 1");
                $nstmt->bind_param('sii', $floor_name, $building_id, $id);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A floor with the same name already exists in this building'], 409);
            }
            if ($baseline_altitude !== null && $building_id !== null) {
                $lstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE ABS(COALESCE(baseline_altitude,0) - ?) < 0.0000001 AND building_id = ? AND floor_id != ? LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('dii', $baseline_altitude, $building_id, $id);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_altitude', 'message' => 'Another floor with same baseline altitude exists in this building'], 409);
                }
            }

            // Build update
            $sets = [];
            $types = '';
            $vals = [];
            if ($building_id !== null) { $sets[] = 'building_id = ?'; $types .= 'i'; $vals[] = $building_id; }
            if ($floor_name !== null) { $sets[] = 'floor_name = ?'; $types .= 's'; $vals[] = $floor_name; }
            if ($baseline_altitude !== null) { $sets[] = 'baseline_altitude = ?'; $types .= 'd'; $vals[] = $baseline_altitude; }
            if ($floor_meter_vertical !== null) { $sets[] = 'floor_meter_vertical = ?'; $types .= 'd'; $vals[] = $floor_meter_vertical; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_floors SET ' . implode(', ', $sets) . ' WHERE floor_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log floor update (PUT)
            $logFloor = $floor_name ?? null;
            if (!$logFloor) {
                $q = $mysqli->prepare("SELECT floor_name FROM tbl_floors WHERE floor_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logFloor = $r['floor_name'] ?? null; }
            }
            $logMsg = $logFloor ? "Updated floor details for '{$logFloor}'" : 'Updated floor details';
            log_system_action($mysqli, $authUserId, 'update_floor', $logMsg);
            json_response(['ok' => true, 'floor_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'POST' && !$param1) {
            // Create floor and generate QR token
            $token = generate_random_token();
            $building_id = isset($input['building_id']) ? (int)$input['building_id'] : null;
            $floor_name = isset($input['floor_name']) ? trim($input['floor_name']) : '';
            $baseline_altitude = isset($input['baseline_altitude']) ? (float)$input['baseline_altitude'] : null;
            $floor_meter_vertical = isset($input['floor_meter_vertical']) ? (float)$input['floor_meter_vertical'] : null;
            if (!$building_id || $floor_name === '') json_response(['error' => 'missing_fields', 'message' => 'Building and floor name are required'], 400);

            // duplicate checks
            $nstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE LOWER(floor_name) = LOWER(?) AND building_id = ? LIMIT 1");
            $nstmt->bind_param('si', $floor_name, $building_id);
            $nstmt->execute();
            if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A floor with the same name already exists in this building'], 409);
            if ($baseline_altitude !== null) {
                $lstmt = $mysqli->prepare("SELECT floor_id FROM tbl_floors WHERE ABS(COALESCE(baseline_altitude,0) - ?) < 0.0000001 AND building_id = ? LIMIT 1");
                if ($lstmt) {
                    $lstmt->bind_param('di', $baseline_altitude, $building_id);
                    $lstmt->execute();
                    if ($lstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_altitude', 'message' => 'Another floor with same baseline altitude exists in this building'], 409);
                }
            }

            $stmt = $mysqli->prepare("INSERT INTO tbl_floors (building_id, floor_name, baseline_altitude, floor_meter_vertical, qr_token, status) VALUES (?, ?, ?, ?, ?, 'active')");
            $stmt->bind_param("isdds", $building_id, $floor_name, $baseline_altitude, $floor_meter_vertical, $token);
            $stmt->execute();
            // Log floor creation: include building name (no raw numeric ids)
            $bName = null;
            $qb = $mysqli->prepare("SELECT building_name FROM tbl_buildings WHERE building_id = ? LIMIT 1");
            if ($qb) { $qb->bind_param('i', $building_id); $qb->execute(); $rb = $qb->get_result()->fetch_assoc(); $bName = $rb['building_name'] ?? null; }
            $logFloorName = $floor_name ? "{$floor_name}" : 'a new floor';
            $logMsg = $bName ? "Created floor '{$logFloorName}' for building '{$bName}'" : "Created floor '{$logFloorName}'";
            log_system_action($mysqli, $authUserId, 'create_floor', $logMsg);
            json_response(['floor_id' => $stmt->insert_id, 'qr_token' => $token, 'status' => 'active'] + $input, 201);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'qr' && $param3 === 'regenerate') {
            // Regenerate QR token for a specific floor; also ensure status=active
            $newToken = generate_random_token();
            $stmt = $mysqli->prepare("UPDATE tbl_floors SET qr_token = ?, status = 'active' WHERE floor_id = ?");
            $stmt->bind_param("si", $newToken, $param1);
            $stmt->execute();
            json_response(['ok' => true, 'floor_id' => (int)$param1, 'qr_token' => $newToken, 'status' => 'active']);
        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'qr' && $param3 === 'toggle-active') {
            // Toggle floor status between active/inactive (use 'status' column)
            $active = isset($input['active']) && $input['active'] ? 'active' : 'inactive';
            $stmt = $mysqli->prepare("UPDATE tbl_floors SET status = ? WHERE floor_id = ?");
            $stmt->bind_param("si", $active, $param1);
            $stmt->execute();
            json_response(['ok' => true, 'floor_id' => (int)$param1, 'status' => $active]);
        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'toggle') {
            // POST /floors/{id}/toggle - toggle active/inactive
            $id = (int)$param1;
            // fetch current status
            $cstmt = $mysqli->prepare("SELECT status FROM tbl_floors WHERE floor_id = ? LIMIT 1");
            if ($cstmt) {
                $cstmt->bind_param('i', $id);
                $cstmt->execute();
                $cur = $cstmt->get_result()->fetch_assoc();
                $curStatus = $cur['status'] ?? null;
            } else {
                $curStatus = null;
            }
            $newStatus = ($curStatus && strtolower($curStatus) === 'active') ? 'inactive' : 'active';
            // allow explicit status in payload
            if (isset($input['status']) && in_array(strtolower($input['status']), ['active','inactive','archive'])) {
                $newStatus = $input['status'];
            }
            $ust = $mysqli->prepare("UPDATE tbl_floors SET status = ? WHERE floor_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('si', $newStatus, $id);
            $ust->execute();
            json_response(['ok' => true, 'floor_id' => $id, 'status' => $newStatus]);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'archive') {
            // POST /floors/{id}/archive - mark as archived and deactivate QR
            $id = (int)$param1;
            $ust = $mysqli->prepare("UPDATE tbl_floors SET status = 'archive' WHERE floor_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('i', $id);
            $ust->execute();
            // ensure qr considered inactive by status field
            json_response(['ok' => true, 'floor_id' => $id, 'status' => 'archive']);
        }
        break;

    case 'rooms':
        if ($request_method === 'GET' && !$param1) {
            // Return a lightweight list used by dropdowns when ?list=1 is provided
            if (!empty($_GET['list'])) {
                $sql = "SELECT room_id, room_name, floor_id, status FROM tbl_rooms ORDER BY room_name";
                $result = $mysqli->query($sql);
                if (!$result) json_response(['error' => 'query_failed', 'message' => $mysqli->error], 500);
                $out = [];
                while ($r = $result->fetch_assoc()) {
                    $out[] = [
                        'room_id' => isset($r['room_id']) ? (int)$r['room_id'] : null,
                        'room_name' => $r['room_name'] ?? null,
                        'floor_id' => isset($r['floor_id']) ? (int)$r['floor_id'] : null,
                        'status' => $r['status'] ?? null,
                    ];
                }
                json_response($out);
            }

            // Lightweight list mode for dropdowns
            if (isset($_GET['list'])) {
                $bId = isset($_GET['building_id']) && is_numeric($_GET['building_id']) ? (int)$_GET['building_id'] : null;
                if ($bId) {
                    $stmt = $mysqli->prepare("SELECT room_id, room_name FROM tbl_rooms WHERE building_id = ? ORDER BY room_name");
                    if ($stmt) { $stmt->bind_param('i', $bId); $stmt->execute(); $res = $stmt->get_result(); $out=[]; while($r=$res->fetch_assoc()){ $out[]=['id'=>$r['room_id'],'label'=>$r['room_name']]; } $stmt->close(); echo json_encode($out); exit; }
                } else {
                    $res = $mysqli->query("SELECT room_id, room_name FROM tbl_rooms ORDER BY room_name");
                    $out = [];
                    if ($res) { while($r = $res->fetch_assoc()) $out[] = ['id' => $r['room_id'], 'label' => $r['room_name']]; }
                    echo json_encode($out); exit;
                }
            }
            // Rooms list: bring QR info from their floor (floors now own the QR)
            // Detect room lat/lon column names to avoid Unknown column errors
            $roomLatCol = find_existing_column('tbl_rooms', ['latitude','lat','alt','altitude']);
            $roomLonCol = find_existing_column('tbl_rooms', ['longitude','lon','lng','long']);
            $roomRadiusCol = find_existing_column('tbl_rooms', ['radius']);
            if (isset($_GET['building_id']) && is_numeric($_GET['building_id'])) {
                $bId = (int)$_GET['building_id'];
                $select = [ 'r.room_id', 'r.room_name' ];
                $select[] = $roomLatCol ? "r.`{$roomLatCol}` AS latitude" : "NULL AS latitude";
                $select[] = $roomLonCol ? "r.`{$roomLonCol}` AS longitude" : "NULL AS longitude";
                $select[] = $roomRadiusCol ? "r.`{$roomRadiusCol}` AS radius" : "NULL AS radius";
                $select[] = 'r.status AS status';
                $select[] = 'f.qr_token';
                $select[] = 'f.status AS qr_status';
                $select[] = 'r.building_id';
                $select[] = 'r.floor_id';
                $select[] = 'b.building_name';
                $select[] = 'f.floor_name';
                $sql = 'SELECT ' . implode(', ', $select) . ' FROM tbl_rooms r LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id LEFT JOIN tbl_buildings b ON r.building_id = b.building_id WHERE r.building_id = ? ORDER BY r.room_name';
                $rstmt = $mysqli->prepare($sql);
                if ($rstmt === false) json_response(['error' => 'Failed to prepare rooms query', 'sql_error' => $mysqli->error], 500);
                $rstmt->bind_param('i', $bId);
                $rstmt->execute();
                $res = $rstmt->get_result();
                json_response($res->fetch_all(MYSQLI_ASSOC));
            } else {
                $select = [ 'r.room_id', 'r.room_name' ];
                $select[] = $roomLatCol ? "r.`{$roomLatCol}` AS latitude" : "NULL AS latitude";
                $select[] = $roomLonCol ? "r.`{$roomLonCol}` AS longitude" : "NULL AS longitude";
                $select[] = $roomRadiusCol ? "r.`{$roomRadiusCol}` AS radius" : "NULL AS radius";
                $select[] = 'r.status AS status';
                $select[] = 'f.qr_token';
                $select[] = 'f.status AS qr_status';
                $select[] = 'r.building_id';
                $select[] = 'r.floor_id';
                $select[] = 'b.building_name';
                $select[] = 'f.floor_name';
                $sql = 'SELECT ' . implode(', ', $select) . ' FROM tbl_rooms r LEFT JOIN tbl_floors f ON r.floor_id = f.floor_id LEFT JOIN tbl_buildings b ON r.building_id = b.building_id ORDER BY r.room_name';
                $result = $mysqli->query($sql);
                if (!$result) json_response(['error' => 'Failed to fetch rooms: ' . $mysqli->error], 500);
                json_response($result->fetch_all(MYSQLI_ASSOC));
            }
        } elseif ($request_method === 'POST' && !$param1) {
            // Rooms no longer store QR fields; floors own the QR token
            $stmt = $mysqli->prepare("INSERT INTO tbl_rooms (building_id, floor_id, latitude, longitude, radius, room_name) VALUES (?, ?, ?, ?, ?, ?)");
            // types: building_id (i), floor_id (i), latitude (d), longitude (d), radius (d), room_name (s)
            $stmt->bind_param("iiddds", $input['building_id'], $input['floor_id'], $input['latitude'], $input['longitude'], $input['radius'], $input['room_name']);
            $stmt->execute();
            // Log room creation using names (no numeric ids)
            $roomName = $input['room_name'] ?? null;
            $floorName = null; $buildingName = null;
            $qf = $mysqli->prepare("SELECT f.floor_name, b.building_name FROM tbl_floors f JOIN tbl_buildings b ON f.building_id = b.building_id WHERE f.floor_id = ? LIMIT 1");
            if ($qf) { $qf->bind_param('i', $input['floor_id']); $qf->execute(); $rf = $qf->get_result()->fetch_assoc(); $floorName = $rf['floor_name'] ?? null; $buildingName = $rf['building_name'] ?? null; }
            $parts = [];
            if ($roomName) $parts[] = "room '{$roomName}'";
            if ($floorName) $parts[] = "on floor '{$floorName}'";
            if ($buildingName) $parts[] = "in building '{$buildingName}'";
            $logMsg = !empty($parts) ? 'Created ' . implode(' ', $parts) : 'Created a new room';
            log_system_action($mysqli, $authUserId, 'create_room', $logMsg);
            json_response(['room_id' => $stmt->insert_id] + $input, 201);
        } elseif ($request_method === 'POST' && is_numeric($param1) && ($param2 === 'update' || $param2 === null)) {
            // Update room: POST /rooms/{id}/update
            $id = (int)$param1;
            $building_id = isset($input['building_id']) ? (int)$input['building_id'] : null;
            $floor_id = isset($input['floor_id']) ? (int)$input['floor_id'] : null;
            $room_name = isset($input['room_name']) ? trim($input['room_name']) : null;
            $latitude = array_key_exists('latitude', $input) && $input['latitude'] !== '' ? (float)$input['latitude'] : null;
            $longitude = array_key_exists('longitude', $input) && $input['longitude'] !== '' ? (float)$input['longitude'] : null;
            $radius = array_key_exists('radius', $input) && $input['radius'] !== '' ? (float)$input['radius'] : null;
            $status = isset($input['status']) ? $input['status'] : null;

            // validation: duplicate room name within same building+floor
            if ($room_name && $building_id !== null && $floor_id !== null) {
                $nstmt = $mysqli->prepare("SELECT room_id FROM tbl_rooms WHERE LOWER(room_name) = LOWER(?) AND building_id = ? AND floor_id = ? AND room_id != ? LIMIT 1");
                $nstmt->bind_param('siii', $room_name, $building_id, $floor_id, $id);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A room with the same name already exists in this floor'], 409);
            }

            $sets = [];
            $types = '';
            $vals = [];
            if ($building_id !== null) { $sets[] = 'building_id = ?'; $types .= 'i'; $vals[] = $building_id; }
            if ($floor_id !== null) { $sets[] = 'floor_id = ?'; $types .= 'i'; $vals[] = $floor_id; }
            if ($room_name !== null) { $sets[] = 'room_name = ?'; $types .= 's'; $vals[] = $room_name; }
            if ($latitude !== null) { $sets[] = 'latitude = ?'; $types .= 'd'; $vals[] = $latitude; }
            if ($longitude !== null) { $sets[] = 'longitude = ?'; $types .= 'd'; $vals[] = $longitude; }
            if ($radius !== null) { $sets[] = 'radius = ?'; $types .= 'd'; $vals[] = $radius; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_rooms SET ' . implode(', ', $sets) . ' WHERE room_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log room update
            $logRoom = $room_name ?? null;
            if (!$logRoom) {
                $q = $mysqli->prepare("SELECT room_name FROM tbl_rooms WHERE room_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logRoom = $r['room_name'] ?? null; }
            }
            $logMsg = $logRoom ? "Updated room details for '{$logRoom}'" : 'Updated room details';
            log_system_action($mysqli, $authUserId, 'update_room', $logMsg);
            json_response(['ok' => true, 'room_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'PUT' && is_numeric($param1)) {
            // Accept PUT /rooms/{id} as update
            $id = (int)$param1;
            $building_id = isset($input['building_id']) ? (int)$input['building_id'] : null;
            $floor_id = isset($input['floor_id']) ? (int)$input['floor_id'] : null;
            $room_name = isset($input['room_name']) ? trim($input['room_name']) : null;
            $latitude = array_key_exists('latitude', $input) && $input['latitude'] !== '' ? (float)$input['latitude'] : null;
            $longitude = array_key_exists('longitude', $input) && $input['longitude'] !== '' ? (float)$input['longitude'] : null;
            $radius = array_key_exists('radius', $input) && $input['radius'] !== '' ? (float)$input['radius'] : null;
            $status = isset($input['status']) ? $input['status'] : null;

            if ($room_name && $building_id !== null && $floor_id !== null) {
                $nstmt = $mysqli->prepare("SELECT room_id FROM tbl_rooms WHERE LOWER(room_name) = LOWER(?) AND building_id = ? AND floor_id = ? AND room_id != ? LIMIT 1");
                $nstmt->bind_param('siii', $room_name, $building_id, $floor_id, $id);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A room with the same name already exists in this floor'], 409);
            }

            $sets = [];
            $types = '';
            $vals = [];
            if ($building_id !== null) { $sets[] = 'building_id = ?'; $types .= 'i'; $vals[] = $building_id; }
            if ($floor_id !== null) { $sets[] = 'floor_id = ?'; $types .= 'i'; $vals[] = $floor_id; }
            if ($room_name !== null) { $sets[] = 'room_name = ?'; $types .= 's'; $vals[] = $room_name; }
            if ($latitude !== null) { $sets[] = 'latitude = ?'; $types .= 'd'; $vals[] = $latitude; }
            if ($longitude !== null) { $sets[] = 'longitude = ?'; $types .= 'd'; $vals[] = $longitude; }
            if ($radius !== null) { $sets[] = 'radius = ?'; $types .= 'd'; $vals[] = $radius; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_rooms SET ' . implode(', ', $sets) . ' WHERE room_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log room update (PUT)
            $logRoom = $room_name ?? null;
            if (!$logRoom) {
                $q = $mysqli->prepare("SELECT room_name FROM tbl_rooms WHERE room_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logRoom = $r['room_name'] ?? null; }
            }
            $logMsg = $logRoom ? "Updated room details for '{$logRoom}'" : 'Updated room details';
            log_system_action($mysqli, $authUserId, 'update_room', $logMsg);
            json_response(['ok' => true, 'room_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'toggle') {
            // POST /rooms/{id}/toggle - toggle active/inactive on room
            $id = (int)$param1;
            $cstmt = $mysqli->prepare("SELECT status FROM tbl_rooms WHERE room_id = ? LIMIT 1");
            if ($cstmt) {
                $cstmt->bind_param('i', $id);
                $cstmt->execute();
                $cur = $cstmt->get_result()->fetch_assoc();
                $curStatus = $cur['status'] ?? null;
            } else {
                $curStatus = null;
            }
            $newStatus = ($curStatus && strtolower($curStatus) === 'active') ? 'inactive' : 'active';
            if (isset($input['status']) && in_array(strtolower($input['status']), ['active','inactive','archive'])) {
                $newStatus = $input['status'];
            }
            $ust = $mysqli->prepare("UPDATE tbl_rooms SET status = ? WHERE room_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('si', $newStatus, $id);
            $ust->execute();
            json_response(['ok' => true, 'room_id' => $id, 'status' => $newStatus]);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'archive') {
            // POST /rooms/{id}/archive - mark room archived
            $id = (int)$param1;
            $ust = $mysqli->prepare("UPDATE tbl_rooms SET status = 'archive' WHERE room_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('i', $id);
            $ust->execute();
            json_response(['ok' => true, 'room_id' => $id, 'status' => 'archive']);
        } elseif ($request_method === 'GET' && $param1 === 'qr' && $param2) {
             // Lookup by QR token — now stored on floors; find the room that belongs to that floor (if any)
             $stmt = $mysqli->prepare("SELECT r.room_id, r.room_name, r.latitude, r.longitude, r.radius, r.status AS status, f.status AS qr_status, b.building_id, b.building_name, f.floor_id, f.floor_name, f.baseline_altitude FROM tbl_rooms r JOIN tbl_buildings b ON r.building_id = b.building_id JOIN tbl_floors f ON r.floor_id = f.floor_id WHERE f.qr_token = ? LIMIT 1");
            $stmt->bind_param("s", $param2);
            $stmt->execute();
            $room = $stmt->get_result()->fetch_assoc();
            if (!$room) json_response(['error' => 'room_not_found'], 404);
            if (strtolower($room['qr_status'] ?? '') !== 'active') json_response(['error' => 'qr_disabled'], 403);
            json_response($room);
        } elseif ($request_method === 'GET' && is_numeric($param1)) {
            $stmt = $mysqli->prepare("SELECT r.room_id, r.room_name, r.latitude, r.longitude, r.radius, r.status AS status, f.qr_token, f.status AS qr_status, b.building_id, b.building_name, f.floor_id, f.floor_name, f.baseline_altitude FROM tbl_rooms r JOIN tbl_buildings b ON r.building_id = b.building_id JOIN tbl_floors f ON r.floor_id = f.floor_id WHERE r.room_id = ? LIMIT 1");
            $stmt->bind_param("i", $param1);
            $stmt->execute();
            $room = $stmt->get_result()->fetch_assoc();
            if (!$room) json_response(['error' => 'room_not_found'], 404);
            json_response($room);
        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'qr' && $param3 === 'regenerate') {
            // Regenerate QR token for the floor that this room belongs to
            $newToken = generate_random_token();
            $stmt = $mysqli->prepare("UPDATE tbl_floors f JOIN tbl_rooms r ON f.floor_id = r.floor_id SET f.qr_token = ?, f.status = 'active' WHERE r.room_id = ?");
            $stmt->bind_param("si", $newToken, $param1);
            $stmt->execute();
            json_response(['ok' => true, 'room_id' => (int)$param1, 'qr_token' => $newToken, 'status' => 'active']);
        }  elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'qr' && $param3 === 'toggle-active') {
            $active = isset($input['active']) && $input['active'] ? 'active' : 'inactive';
            $stmt = $mysqli->prepare("UPDATE tbl_floors f JOIN tbl_rooms r ON f.floor_id = r.floor_id SET f.status = ? WHERE r.room_id = ?");
            $stmt->bind_param("si", $active, $param1);
            $stmt->execute();
            json_response(['ok' => true, 'room_id' => (int)$param1, 'status' => $active]);
        }
        break;

    case 'school':
        if ($request_method === 'GET') {
            // Single school
            if (is_numeric($param1)) {
                $id = (int)$param1;
                $stmt = $mysqli->prepare("SELECT school_id, school_name, status FROM tbl_school WHERE school_id = ? LIMIT 1");
                if (!$stmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
                $stmt->bind_param('i', $id);
                $stmt->execute();
                $row = $stmt->get_result()->fetch_assoc();
                if (!$row) json_response(['error' => 'school_not_found'], 404);
                json_response($row);
            }

            $result = $mysqli->query("SELECT school_id, school_name, status FROM tbl_school ORDER BY school_name");
            if (!$result) json_response(['error' => 'Failed to fetch schools: ' . $mysqli->error], 500);
            json_response($result->fetch_all(MYSQLI_ASSOC));

        } elseif ($request_method === 'POST' && !$param1) {
            // Create school
            $name = isset($input['school_name']) ? trim($input['school_name']) : '';
            if ($name === '') json_response(['error' => 'missing_name', 'message' => 'School name is required'], 400);

            // duplicate name check (case-insensitive)
            $nstmt = $mysqli->prepare("SELECT school_id FROM tbl_school WHERE LOWER(school_name) = LOWER(?) LIMIT 1");
            if ($nstmt) {
                $nstmt->bind_param('s', $name);
                $nstmt->execute();
                if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A school with the same name already exists'], 409);
            }

            $stmt = $mysqli->prepare("INSERT INTO tbl_school (school_name, status) VALUES (?, 'active')");
            if (!$stmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $stmt->bind_param('s', $name);
            $stmt->execute();
            // Log school creation (text only)
            $logMsg = $name ? "Created school: {$name}" : 'Created a new school';
            log_system_action($mysqli, $authUserId, 'create_school', $logMsg);
            json_response(['school_id' => $stmt->insert_id, 'school_name' => $name, 'status' => 'active'] + $input, 201);

        } elseif ($request_method === 'POST' && is_numeric($param1) && ($param2 === 'update' || $param2 === null)) {
            // Update school: POST /school/{id}/update
            $id = (int)$param1;
            $name = isset($input['school_name']) ? trim($input['school_name']) : null;
            $status = isset($input['status']) ? $input['status'] : null;

            // duplicate name check
            if ($name) {
                $nstmt = $mysqli->prepare("SELECT school_id FROM tbl_school WHERE LOWER(school_name) = LOWER(?) AND school_id != ? LIMIT 1");
                if ($nstmt) {
                    $nstmt->bind_param('si', $name, $id);
                    $nstmt->execute();
                    if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A school with the same name already exists'], 409);
                }
            }

            $sets = [];
            $types = '';
            $vals = [];
            if ($name !== null) { $sets[] = 'school_name = ?'; $types .= 's'; $vals[] = $name; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_school SET ' . implode(', ', $sets) . ' WHERE school_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log school update with friendly message (no raw ids)
            $logName = $name ?? null;
            if (!$logName) {
                $q = $mysqli->prepare("SELECT school_name FROM tbl_school WHERE school_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logName = $r['school_name'] ?? null; }
            }
            $logMsg = $logName ? "Updated school details for '{$logName}'" : 'Updated school details';
            log_system_action($mysqli, $authUserId, 'update_school', $logMsg);
            json_response(['ok' => true, 'school_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'PUT' && is_numeric($param1)) {
            // Accept PUT /school/{id} as update
            $id = (int)$param1;
            $name = isset($input['school_name']) ? trim($input['school_name']) : null;
            $status = isset($input['status']) ? $input['status'] : null;

            if ($name) {
                $nstmt = $mysqli->prepare("SELECT school_id FROM tbl_school WHERE LOWER(school_name) = LOWER(?) AND school_id != ? LIMIT 1");
                if ($nstmt) {
                    $nstmt->bind_param('si', $name, $id);
                    $nstmt->execute();
                    if ($nstmt->get_result()->fetch_assoc()) json_response(['error' => 'duplicate_name', 'message' => 'A school with the same name already exists'], 409);
                }
            }

            $sets = [];
            $types = '';
            $vals = [];
            if ($name !== null) { $sets[] = 'school_name = ?'; $types .= 's'; $vals[] = $name; }
            if ($status !== null) { $sets[] = 'status = ?'; $types .= 's'; $vals[] = $status; }

            if (empty($sets)) json_response(['ok' => true, 'message' => 'no_changes']);
            $types .= 'i'; $vals[] = $id;
            $sql = 'UPDATE tbl_school SET ' . implode(', ', $sets) . ' WHERE school_id = ?';
            $ustmt = $mysqli->prepare($sql);
            if (!$ustmt) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ustmt->bind_param($types, ...$vals);
            $ustmt->execute();
            // Log school update with friendly message (no raw ids)
            $logName = $name ?? null;
            if (!$logName) {
                $q = $mysqli->prepare("SELECT school_name FROM tbl_school WHERE school_id = ? LIMIT 1");
                if ($q) { $q->bind_param('i', $id); $q->execute(); $r = $q->get_result()->fetch_assoc(); $logName = $r['school_name'] ?? null; }
            }
            $logMsg = $logName ? "Updated school details for '{$logName}'" : 'Updated school details';
            log_system_action($mysqli, $authUserId, 'update_school', $logMsg);
            json_response(['ok' => true, 'school_id' => $id, 'message' => 'updated']);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'toggle') {
            // POST /school/{id}/toggle - toggle active/inactive
            $id = (int)$param1;
            $cstmt = $mysqli->prepare("SELECT status FROM tbl_school WHERE school_id = ? LIMIT 1");
            if ($cstmt) {
                $cstmt->bind_param('i', $id);
                $cstmt->execute();
                $cur = $cstmt->get_result()->fetch_assoc();
                $curStatus = $cur['status'] ?? null;
            } else {
                $curStatus = null;
            }
            $newStatus = ($curStatus && strtolower($curStatus) === 'active') ? 'inactive' : 'active';
            if (isset($input['status']) && in_array(strtolower($input['status']), ['active','inactive','archive'])) {
                $newStatus = $input['status'];
            }
            $ust = $mysqli->prepare("UPDATE tbl_school SET status = ? WHERE school_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('si', $newStatus, $id);
            $ust->execute();
            json_response(['ok' => true, 'school_id' => $id, 'status' => $newStatus]);

        } elseif ($request_method === 'POST' && is_numeric($param1) && $param2 === 'archive') {
            // POST /school/{id}/archive - mark as archived
            $id = (int)$param1;
            $ust = $mysqli->prepare("UPDATE tbl_school SET status = 'archive' WHERE school_id = ?");
            if (!$ust) json_response(['error' => 'db_prepare_failed', 'details' => $mysqli->error], 500);
            $ust->bind_param('i', $id);
            $ust->execute();
            json_response(['ok' => true, 'school_id' => $id, 'status' => 'archive']);
        }
        break;

    default:
        json_response(['error' => 'Endpoint not found in locations API file.'], 404);
        break;
}
