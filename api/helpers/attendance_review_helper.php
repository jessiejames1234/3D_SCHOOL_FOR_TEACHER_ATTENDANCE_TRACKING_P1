<?php

function attendance_review_denial(array $actor, array $request): ?string {
    $role = (int)($actor['role_id'] ?? 0);
    $userId = (int)($actor['user_id'] ?? 0);
    $deptId = (int)($actor['dept_id'] ?? 0);
    if (!in_array($role, [2, 6], true)) return 'Only Dean and Department Admin can decide attendance edit requests.';
    if ($deptId <= 0 || (int)($request['teacher_dept_id'] ?? 0) !== $deptId) return 'Request belongs to another department.';
    if ($userId <= 0 || $userId === (int)($request['requested_by'] ?? 0) || $userId === (int)($request['teacher_id'] ?? 0)) return 'You cannot approve or reject your own attendance edit request.';
    $teacherRole = (int)($request['teacher_role_id'] ?? 0);
    if ($teacherRole === 2 && $role !== 6) return 'Only the Department Admin can decide a Dean\'s attendance edit request.';
    if (!in_array($teacherRole, [2, 3, 4, 5], true)) return 'This request does not belong to an eligible teaching account.';
    return null;
}
