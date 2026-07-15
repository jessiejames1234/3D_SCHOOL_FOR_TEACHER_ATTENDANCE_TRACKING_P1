-- Ensure the department admin role exists for the add-user role dropdown.
INSERT INTO tbl_roles (role_id, role_name)
SELECT 6, 'department_admin'
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1
  FROM tbl_roles
  WHERE role_id = 6
     OR LOWER(role_name) = LOWER('department_admin')
);
