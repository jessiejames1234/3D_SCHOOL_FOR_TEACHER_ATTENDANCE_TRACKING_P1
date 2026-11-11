-- Optional daily time windows and selected teachers for existing calendar events.
-- Safe to run again; existing events remain all-day and cover their original scope.
SET @calendar_event_time_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tbl_calendar_events' AND COLUMN_NAME='start_time'), 'SELECT 1', 'ALTER TABLE tbl_calendar_events ADD COLUMN start_time TIME NULL');
PREPARE calendar_event_time_stmt FROM @calendar_event_time_sql;
EXECUTE calendar_event_time_stmt;
DEALLOCATE PREPARE calendar_event_time_stmt;
SET @calendar_event_time_sql = IF(EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tbl_calendar_events' AND COLUMN_NAME='end_time'), 'SELECT 1', 'ALTER TABLE tbl_calendar_events ADD COLUMN end_time TIME NULL');
PREPARE calendar_event_time_stmt FROM @calendar_event_time_sql;
EXECUTE calendar_event_time_stmt;
DEALLOCATE PREPARE calendar_event_time_stmt;
CREATE TABLE IF NOT EXISTS tbl_calendar_event_teachers (
    event_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (event_id,user_id),
    KEY idx_calendar_event_teacher_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
