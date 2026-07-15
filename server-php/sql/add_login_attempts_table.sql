-- Table to log all login attempts (success and failed)
CREATE TABLE IF NOT EXISTS `tbl_login_attempts` (
    `attempt_id` INT(11) NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `user_id` INT(11) NULL DEFAULT NULL,
    `attempt_time` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `status` ENUM('success', 'failed') NOT NULL DEFAULT 'failed',
    `ip_address` VARCHAR(45) NULL DEFAULT NULL,
    `details` VARCHAR(255) NULL DEFAULT NULL,
    PRIMARY KEY (`attempt_id`),
    KEY `email` (`email`),
    KEY `user_id` (`user_id`),
    KEY `attempt_time` (`attempt_time`),
    KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;