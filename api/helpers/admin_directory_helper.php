<?php
// User Management privilege only. Password reset rules are unchanged.
function admin_directory_email(): string { return 'jeca.parajes.coc@phinmaed.com'; }
function admin_directory_account(mysqli $db, int $id): ?array {
    $stmt = $db->prepare('SELECT user_id, role_id, email FROM tbl_users WHERE user_id = ?');
    $stmt->bind_param('i', $id); $stmt->execute();
    $row = $stmt->get_result()->fetch_assoc(); $stmt->close();
    return $row ?: null;
}
function admin_directory_is_owner(?array $account): bool {
    return $account && (int)$account['role_id'] === 1
        && strtolower(trim($account['email'])) === admin_directory_email();
}
function admin_directory_can_edit(?array $actor, ?array $target): bool {
    if (!$actor || !$target) return false;
    if ((int)$actor['user_id'] === (int)$target['user_id']) return true;
    if (admin_directory_is_owner($target)) return false;
    return (int)$target['role_id'] !== 1 || admin_directory_is_owner($actor);
}
function admin_directory_email_allowed(?array $target, string $email): bool {
    $reserved = strtolower(trim($email)) === admin_directory_email();
    if (admin_directory_is_owner($target)) return $reserved;
    return !$reserved || ($target && strtolower(trim($target['email'])) === admin_directory_email());
}
