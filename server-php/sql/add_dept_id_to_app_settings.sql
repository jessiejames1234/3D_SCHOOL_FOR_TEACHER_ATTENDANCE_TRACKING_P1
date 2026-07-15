-- Add dept_id to tbl_app_settings for per-department home text customization
-- Run this ONCE in your database (phpMyAdmin or SQL tool)

-- 1. Drop the old unique key first
ALTER TABLE `tbl_app_settings` DROP INDEX `unique_setting`;

-- 2. Add dept_id column (NULL = global fallback)
ALTER TABLE `tbl_app_settings`
    ADD COLUMN `dept_id` INT(11) NULL DEFAULT NULL AFTER `setting_group`,
    ADD CONSTRAINT `fk_app_settings_dept` FOREIGN KEY (`dept_id`) REFERENCES `tbl_departments` (`dept_id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Recreate unique key to allow same setting_key for different departments + global fallback
ALTER TABLE `tbl_app_settings`
    ADD UNIQUE KEY `unique_setting` (`setting_group`, `setting_key`, `dept_id`);