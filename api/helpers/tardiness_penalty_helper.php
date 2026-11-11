<?php

require_once __DIR__ . '/notification_helper.php';

const TARDINESS_POLICY_CODE = 'SEMESTER_LATE_3';
const TARDINESS_RED_FLAG_THRESHOLD = 3;

function tardiness_penalty_schema_ready($mysqli) {
    static $ready = null;
    if ($ready !== null) return $ready;
    $required = ['semester_id', 'source', 'policy_code', 'trigger_attendance_id', 'trigger_stage', 'status', 'voided_at'];
    $found = [];
    $res = $mysqli->query('SHOW COLUMNS FROM tbl_penalties');
    if (!$res) return $ready = false;
    while ($row = $res->fetch_assoc()) $found[(string)$row['Field']] = true;
    foreach ($required as $column) {
        if (!isset($found[$column])) return $ready = false;
    }
    return $ready = true;
}

function attendance_red_flag_policies() {
    return [
        'late' => ['code' => TARDINESS_POLICY_CODE, 'type' => 'Tardiness'],
        'absent' => ['code' => 'SEMESTER_ABSENT_3', 'type' => 'Absences'],
    ];
}

// The same two-of-three majority used by the attendance report.
function attendance_red_flag_sql($alias = 'ar') {
    return "CASE
        WHEN (COALESCE({$alias}.flag_in_id = 5, 0) + COALESCE({$alias}.flag_check_id = 5, 0) + COALESCE({$alias}.flag_out_id = 5, 0)) >= 2 THEN 'late'
        WHEN (COALESCE({$alias}.flag_in_id = 3, 0) + COALESCE({$alias}.flag_check_id = 3, 0) + COALESCE({$alias}.flag_out_id = 3, 0)) >= 2 THEN 'absent'
        ELSE '' END";
}

function attendance_policy_active_semester_id($mysqli) {
    $res = $mysqli->query("SELECT semester_id FROM tbl_semesters
        WHERE LOWER(TRIM(status)) = 'active' AND CURDATE() BETWEEN start_date AND end_date
        ORDER BY semester_id DESC LIMIT 1");
    if (!$res) throw new RuntimeException('Unable to find the active semester.');
    $row = $res->fetch_assoc();
    return (int)($row['semester_id'] ?? 0);
}

function attendance_red_flag_records($mysqli, $userId, $semesterId, $status) {
    $overall = attendance_red_flag_sql();
    $stmt = $mysqli->prepare("SELECT ar.attendance_id, ar.date AS late_date, 'overall' AS stage
        FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
        WHERE ar.user_id = ? AND cs.semester_id = ? AND ({$overall}) = ?
        ORDER BY ar.date, cs.start_time, ar.attendance_id");
    if (!$stmt) throw new RuntimeException('Unable to prepare overall attendance policy query.');
    $stmt->bind_param('iis', $userId, $semesterId, $status);
    if (!$stmt->execute()) throw new RuntimeException('Unable to count overall attendance records.');
    $rows = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    return $rows;
}

// Keep existing dashboard callers, now counting overall Late records.
function tardiness_late_checkpoints($mysqli, $userId, $semesterId) {
    return attendance_red_flag_records($mysqli, $userId, $semesterId, 'late');
}

function tardiness_program_head_recipient_ids($mysqli, $deptId, $programId) {
    $departmentId = (int)$deptId;
    $assignedProgramId = (int)$programId;
    if ($departmentId <= 0 || $assignedProgramId <= 0) return [];

    // assigned_program_head_id is the current multi-head program mapping.
    // tbl_programs.head_id remains a fallback only for a legacy Program Head
    // who does not yet have the current assignment field populated.
    $stmt = $mysqli->prepare("SELECT DISTINCT ph.user_id
        FROM tbl_programs p
        JOIN tbl_users ph
          ON ph.role_id = 3
         AND ph.dept_id = p.dept_id
         AND ph.status = 'active'
         AND (
              ph.assigned_program_head_id = p.program_id
              OR (ph.assigned_program_head_id IS NULL AND p.head_id = ph.user_id)
         )
        WHERE p.program_id = ?
          AND p.dept_id = ?
          AND p.status = 'active'");
    if (!$stmt) return [];
    $stmt->bind_param('ii', $assignedProgramId, $departmentId);
    if (!$stmt->execute()) {
        $stmt->close();
        return [];
    }
    $result = $stmt->get_result();
    $ids = [];
    while ($row = $result->fetch_assoc()) $ids[] = (int)$row['user_id'];
    $stmt->close();
    return $ids;
}

function tardiness_send_policy_notification($mysqli, $user, $semesterLabel, $lateCount, $action, $policyType = 'Tardiness') {
    $userId = (int)$user['user_id'];
    $deptId = isset($user['dept_id']) ? (int)$user['dept_id'] : 0;
    $programId = isset($user['assigned_program_head_id']) ? (int)$user['assigned_program_head_id'] : 0;
    $name = trim((string)$user['full_name']) ?: ('User #' . $userId);
    // Email is reserved for the affected user and the responsible Dean(s).
    // Secretaries and Program Heads still receive the in-system notification
    // and Web Push, but not another policy email.
    $emailRecipients = [$userId];
    $webPushOnlyRecipients = [];
    if ($deptId > 0) {
        $emailRecipients = array_merge($emailRecipients, notif_get_user_ids_by_role_dept($mysqli, 2, $deptId));
        $webPushOnlyRecipients = array_merge($webPushOnlyRecipients, notif_get_user_ids_by_role_dept($mysqli, 4, $deptId));
        if ($programId > 0) {
            $webPushOnlyRecipients = array_merge(
                $webPushOnlyRecipients,
                tardiness_program_head_recipient_ids($mysqli, $deptId, $programId)
            );
        }
    }

    $resultLabel = $policyType === 'Tardiness' ? 'Late' : 'Absent';
    if ($action === 'created') {
        $title = "{$policyType} RED FLAG";
        $message = "{$name} reached {$lateCount} overall {$resultLabel} attendance records for {$semesterLabel}. A {$policyType} RED FLAG was issued.";
    } elseif ($action === 'reactivated') {
        $title = "{$policyType} RED FLAG Reactivated";
        $message = "{$name} again has {$lateCount} overall {$resultLabel} records for {$semesterLabel}. The RED FLAG was reactivated.";
    } else {
        $title = "{$policyType} RED FLAG Voided";
        $message = "An approved attendance edit reduced {$name}'s overall {$resultLabel} count for {$semesterLabel} to {$lateCount}. The RED FLAG was voided.";
    }
    $emailRecipients = array_values(array_unique(array_filter(array_map('intval', $emailRecipients))));
    $emailRecipientLookup = array_fill_keys($emailRecipients, true);
    $webPushOnlyRecipients = array_values(array_unique(array_filter(array_map('intval', $webPushOnlyRecipients))));

    notif_insert_many($mysqli, $emailRecipients, $title, $message, '/report', null);
    foreach ($webPushOnlyRecipients as $recipientId) {
        if (isset($emailRecipientLookup[$recipientId])) continue;
        notif_insert_web_push($mysqli, $recipientId, $title, $message, '/report', null);
    }
}

// Reconciliation returns notification events separately so it can be tested
// against isolated tables without sending messages or altering live records.
function attendance_reconcile_red_flags($mysqli, $userId, $semesterId, $approvedCorrection = false) {
    $userId = (int)$userId;
    $semesterId = (int)$semesterId;
    if ($userId <= 0 || $semesterId <= 0 || !tardiness_penalty_schema_ready($mysqli)) {
        return ['late_count' => 0, 'absent_count' => 0, 'status' => 'unavailable', 'changed' => false, 'events' => []];
    }
    $events = [];
    $counts = ['late' => 0, 'absent' => 0];
    $states = [];
    $mysqli->begin_transaction();
    try {
        // Serialize both policies for this teacher, preventing duplicate inserts.
        $stmt = $mysqli->prepare("SELECT user_id, dept_id, assigned_program_head_id, role_id, status,
            CONCAT_WS(' ', first_name, last_name) AS full_name FROM tbl_users WHERE user_id = ? FOR UPDATE");
        $stmt->bind_param('i', $userId);
        $stmt->execute();
        $user = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        if (!$user || !in_array((int)$user['role_id'], [2, 3, 4, 5], true)
            || !in_array(strtolower(trim((string)$user['status'])), ['active', '1', 'true'], true)) {
            $mysqli->commit();
            return ['late_count' => 0, 'absent_count' => 0, 'status' => 'excluded', 'changed' => false, 'events' => []];
        }
        $stmt = $mysqli->prepare("SELECT CONCAT_WS(' - ', sy.session_name, sem.term) AS semester_label
            FROM tbl_semesters sem LEFT JOIN tbl_school_year sy ON sy.school_year_id = sem.school_year_id
            WHERE sem.semester_id = ?");
        $stmt->bind_param('i', $semesterId);
        $stmt->execute();
        $sem = $stmt->get_result()->fetch_assoc();
        $stmt->close();
        $semesterLabel = $sem['semester_label'] ?? 'the selected semester';
        foreach (attendance_red_flag_policies() as $key => $policy) {
            $records = attendance_red_flag_records($mysqli, $userId, $semesterId, $key);
            $count = $counts[$key] = count($records);
            $code = $policy['code'];
            $stmt = $mysqli->prepare("SELECT sanction_id, status FROM tbl_penalties
                WHERE user_id = ? AND semester_id = ? AND policy_code = ? LIMIT 1 FOR UPDATE");
            $stmt->bind_param('iis', $userId, $semesterId, $code);
            $stmt->execute();
            $existing = $stmt->get_result()->fetch_assoc();
            $stmt->close();
            $action = null;
            if ($count >= TARDINESS_RED_FLAG_THRESHOLD) {
                // The third overall record is the threshold trigger.
                $trigger = $records[TARDINESS_RED_FLAG_THRESHOLD - 1];
                $date = $trigger['late_date'];
                $attendanceId = (int)$trigger['attendance_id'];
                $stage = 'overall';
                $active = 'active';
                $reason = "Automatic {$policy['type']} RED FLAG: {$count} overall " . ucfirst($key) . " attendance records in {$semesterLabel}. Threshold: 3 per semester.";
                if (!$existing) {
                    $type = strtolower($policy['type']);
                    $stmt = $mysqli->prepare("SELECT penal_type_id FROM tbl_penalties_type WHERE LOWER(type_name) = ? LIMIT 1");
                    $stmt->bind_param('s', $type);
                    $stmt->execute();
                    $typeRow = $stmt->get_result()->fetch_assoc();
                    $stmt->close();
                    if (!$typeRow) throw new RuntimeException("{$policy['type']} penalty type is unavailable.");
                    $typeId = (int)$typeRow['penal_type_id'];
                    $source = 'automatic';
                    $stmt = $mysqli->prepare("INSERT INTO tbl_penalties
                        (issued_by, user_id, penal_type_id, semester_id, date, reason, source, policy_code,
                         trigger_attendance_id, trigger_stage, status, voided_at)
                        VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)");
                    $stmt->bind_param('iiissssiss', $userId, $typeId, $semesterId, $date, $reason, $source, $code, $attendanceId, $stage, $active);
                    $stmt->execute();
                    $stmt->close();
                    $action = 'created';
                } elseif (strtolower($existing['status']) === 'voided') {
                    $id = (int)$existing['sanction_id'];
                    $stmt = $mysqli->prepare("UPDATE tbl_penalties SET date = ?, reason = ?, trigger_attendance_id = ?,
                        trigger_stage = ?, status = ?, voided_at = NULL WHERE sanction_id = ?");
                    $stmt->bind_param('ssissi', $date, $reason, $attendanceId, $stage, $active, $id);
                    $stmt->execute();
                    $stmt->close();
                    $action = 'reactivated';
                }
                $states[$key] = 'red_flag';
            } elseif ($existing && strtolower($existing['status']) !== 'voided' && $approvedCorrection) {
                $id = (int)$existing['sanction_id'];
                $suffix = " Auto-voided after an approved attendance edit reduced the overall " . ucfirst($key) . " semester count to {$count}.";
                $stmt = $mysqli->prepare("UPDATE tbl_penalties SET status = 'voided', voided_at = NOW(), reason = CONCAT(reason, ?) WHERE sanction_id = ?");
                $stmt->bind_param('si', $suffix, $id);
                $stmt->execute();
                $stmt->close();
                $action = 'voided';
                $states[$key] = 'voided';
            } else {
                $states[$key] = $existing ? (strtolower($existing['status']) === 'voided' ? 'voided' : 'red_flag') : ($count > 0 ? 'warning' : 'none');
            }
            if ($action !== null) $events[] = ['type' => $policy['type'], 'count' => $count, 'action' => $action];
        }
        $mysqli->commit();
    } catch (Throwable $e) {
        $mysqli->rollback();
        error_log('attendance red flag reconciliation failed: ' . $e->getMessage());
        return ['late_count' => $counts['late'], 'absent_count' => $counts['absent'], 'status' => 'error', 'changed' => false, 'events' => []];
    }
    return ['late_count' => $counts['late'], 'absent_count' => $counts['absent'], 'status' => $states['late'],
        'absent_status' => $states['absent'], 'changed' => !empty($events), 'events' => $events, 'user' => $user, 'semester_label' => $semesterLabel];
}

function tardiness_reconcile_user_semester($mysqli, $userId, $semesterId, $approvedCorrection = false) {
    $result = attendance_reconcile_red_flags($mysqli, $userId, $semesterId, $approvedCorrection);
    foreach ($result['events'] ?? [] as $event) {
        tardiness_send_policy_notification($mysqli, $result['user'], $result['semester_label'], $event['count'], $event['action'], $event['type']);
    }
    return $result;
}

function tardiness_reconcile_for_attendance($mysqli, $attendanceId, $approvedCorrection = false) {
    $stmt = $mysqli->prepare("SELECT ar.user_id, cs.semester_id FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id WHERE ar.attendance_id = ? LIMIT 1");
    $stmt->bind_param('i', $attendanceId);
    $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc();
    $stmt->close();
    if (!$row) return ['status' => 'unavailable', 'changed' => false];
    return tardiness_reconcile_user_semester($mysqli, (int)$row['user_id'], (int)$row['semester_id'], $approvedCorrection);
}

function attendance_reconcile_active_semester($mysqli) {
    $semesterId = attendance_policy_active_semester_id($mysqli);
    if ($semesterId <= 0) return;
    $stmt = $mysqli->prepare("SELECT DISTINCT ar.user_id FROM tbl_attendance_records ar
        JOIN tbl_class_schedules cs ON cs.schedule_id = ar.schedule_id
        JOIN tbl_users u ON u.user_id = ar.user_id
        WHERE cs.semester_id = ? AND u.role_id IN (2, 3, 4, 5) AND LOWER(TRIM(u.status)) IN ('active', '1', 'true')");
    $stmt->bind_param('i', $semesterId);
    $stmt->execute();
    $users = $stmt->get_result()->fetch_all(MYSQLI_ASSOC);
    $stmt->close();
    foreach ($users as $user) {
        $result = tardiness_reconcile_user_semester($mysqli, (int)$user['user_id'], $semesterId);
        if (($result['status'] ?? '') === 'error') throw new RuntimeException('Automatic attendance red flag reconciliation failed.');
    }
}
