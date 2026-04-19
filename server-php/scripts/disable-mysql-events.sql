-- server-php/scripts/disable-mysql-events.sql
-- Run once after switching to cron/worker, to avoid double-processing.

DROP EVENT IF EXISTS DailyAcademicUpdate;
DROP EVENT IF EXISTS RealTimeAttendanceManager;

