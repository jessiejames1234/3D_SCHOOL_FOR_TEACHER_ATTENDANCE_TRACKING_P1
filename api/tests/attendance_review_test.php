<?php
require __DIR__ . '/../helpers/attendance_review_helper.php';

$checks = 0;
foreach ([2, 6] as $actorRole) {
    $actor = ['user_id' => 10, 'role_id' => $actorRole, 'dept_id' => 1];
    foreach ([2, 3, 4, 5] as $teacherRole) {
        $request = ['requested_by' => 20, 'teacher_id' => 20, 'teacher_role_id' => $teacherRole, 'teacher_dept_id' => 1];
        $allowed = attendance_review_denial($actor, $request) === null;
        if ($allowed !== ($actorRole === 6 || $teacherRole !== 2)) throw new RuntimeException('Incorrect teaching-role review permission.');
        $checks++;
        foreach (['teacher_dept_id' => 2, 'requested_by' => 10, 'teacher_id' => 10] as $field => $value) {
            if (attendance_review_denial($actor, array_replace($request, [$field => $value])) === null) throw new RuntimeException('Cross-department or self-review was allowed.');
            $checks++;
        }
    }
    foreach ([null, 0] as $missingDept) {
        if (attendance_review_denial(array_replace($actor, ['dept_id' => $missingDept]), $request) === null) throw new RuntimeException('Reviewer without a department was allowed.');
        $checks++;
    }
    foreach ([1, 6, 0] as $invalidTeacherRole) {
        if (attendance_review_denial($actor, array_replace($request, ['teacher_role_id' => $invalidTeacherRole])) === null) throw new RuntimeException('Ineligible attendance subject was allowed.');
        $checks++;
    }
}
foreach ([1, 3, 4, 5, 0] as $blockedRole) {
    if (attendance_review_denial(['user_id' => 10, 'role_id' => $blockedRole, 'dept_id' => 1], $request) === null) throw new RuntimeException('Unauthorized role was allowed to review.');
    $checks++;
}
echo "PASS {$checks} attendance review authorization checks\n";
