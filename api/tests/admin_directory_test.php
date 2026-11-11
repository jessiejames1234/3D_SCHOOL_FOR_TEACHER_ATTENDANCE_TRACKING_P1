<?php
require_once __DIR__ . '/../helpers/admin_directory_helper.php';
function directory_check($ok, $message) { if (!$ok) throw new RuntimeException($message); }
$owner = ['user_id'=>72, 'role_id'=>1, 'email'=>'jeca.parajes.coc@phinmaed.com'];
$admin = ['user_id'=>2, 'role_id'=>1, 'email'=>'aone.admin.coc@phinmaed.com'];
$otherAdmin = ['user_id'=>3, 'role_id'=>1, 'email'=>'other.coc@phinmaed.com'];
$teacher = ['user_id'=>5, 'role_id'=>5, 'email'=>'teacher.coc@phinmaed.com'];
directory_check(admin_directory_is_owner($owner), 'Owner identity not recognized.');
$movedOwner = array_merge($owner, ['user_id'=>999, 'email'=>'JECA.PARAJES.COC@PHINMAED.COM']);
directory_check(admin_directory_is_owner($movedOwner), 'Identity must not depend on ID or email case.');
directory_check(!admin_directory_is_owner(array_merge($owner, ['role_id'=>2])), 'Non-Admin must not gain privilege.');
directory_check(admin_directory_can_edit($owner, $admin), 'Owner must edit other Admin details.');
directory_check(!admin_directory_can_edit($admin, $owner), 'Other Admin must not edit owner.');
directory_check(!admin_directory_can_edit($admin, $otherAdmin), 'Regular Admin must not edit other Admins.');
directory_check(admin_directory_can_edit($admin, $teacher), 'Ordinary user management must remain available.');
directory_check(admin_directory_can_edit($admin, $admin), 'Own profile access must remain.');
directory_check(!admin_directory_email_allowed($admin, $owner['email']), 'Reserved email cannot be claimed.');
directory_check(!admin_directory_email_allowed(null, $owner['email']), 'Reserved email cannot be imported or created through ordinary form.');
directory_check(!admin_directory_email_allowed($owner, 'changed.coc@phinmaed.com'), 'Owner email must not lose protection.');
directory_check(admin_directory_email_allowed($admin, 'updated.coc@phinmaed.com'), 'Other Admin email edits must work.');
directory_check(admin_directory_email_allowed($owner, $owner['email']), 'Unchanged owner email must work.');
echo "Admin directory permission tests passed.\n";
