<?php
// server-php/api/camera-positions.php

if (!isset($GLOBALS['mysqli']) || $GLOBALS['mysqli'] === null) {
    if (file_exists(__DIR__ . '/../config/database.php')) {
        require_once __DIR__ . '/../config/database.php';
    }
}

if (!function_exists('json_response')) {
    require_once __DIR__ . '/../helpers/functions.php';
}

global $mysqli;

// The 3D building camera presets are primarily intended for front-end navigation.
// Additional room/building presets can be published here if more accurate positions are needed.
$defaultPresets = [
    'Building_PhinmaHall' => [ 'position' => [-22, 10, 22], 'target' => [0, 3, 0] ],
    'Building_MainSouth' => [ 'position' => [22, 10, 16], 'target' => [0, 3, 0] ],
    'Building_MainNorth' => [ 'position' => [-22, 10, -16], 'target' => [0, 3, 0] ],
    'Building_MainWest' => [ 'position' => [22, 10, -16], 'target' => [0, 3, 0] ],
    'PhinmaHall' => [ 'position' => [-22, 10, 22], 'target' => [0, 3, 0] ],
    'MainSouth' => [ 'position' => [22, 10, 16], 'target' => [0, 3, 0] ],
    'MainNorth' => [ 'position' => [-22, 10, -16], 'target' => [0, 3, 0] ],
    'MainWest' => [ 'position' => [22, 10, -16], 'target' => [0, 3, 0] ]
];

json_response($defaultPresets);
