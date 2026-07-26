CREATE TABLE IF NOT EXISTS `tbl_3d_camera_presets` (
    `building_code` VARCHAR(8) NOT NULL,
    `position_json` VARCHAR(255) NOT NULL,
    `target_json` VARCHAR(255) NOT NULL,
    `updated_by` INT(11) NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`building_code`),
    KEY `updated_by` (`updated_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
