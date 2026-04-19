-- One-time SQL to mark past "NA" (1) flags to "absent" (3) for class end times already passed
-- Run this once from MySQL client or phpMyAdmin to immediately mark past NA -> Absent

UPDATE tbl_attendance_records ar
JOIN tbl_class_schedules cs ON ar.schedule_id = cs.schedule_id
SET
  ar.flag_in_id = CASE WHEN ar.flag_in_id = 1 THEN 3 ELSE ar.flag_in_id END,
  ar.flag_check_id = CASE WHEN ar.flag_check_id = 1 THEN 3 ELSE ar.flag_check_id END,
  ar.flag_out_id = CASE WHEN ar.flag_out_id = 1 THEN 3 ELSE ar.flag_out_id END
WHERE (ar.flag_in_id = 1 OR ar.flag_check_id = 1 OR ar.flag_out_id = 1)
  AND TIMESTAMP(ar.date, cs.end_time) < NOW();

-- Example usage (MySQL CLI):
-- mysql -u root -p db_teacher_attendance_3d_school_with_altitude < mark_past_na_to_absent.sql
