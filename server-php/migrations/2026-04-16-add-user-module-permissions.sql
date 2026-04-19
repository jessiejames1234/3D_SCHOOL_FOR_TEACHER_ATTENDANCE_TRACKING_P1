ALTER TABLE tbl_users
  ADD COLUMN permission_mode ENUM('default', 'custom') NOT NULL DEFAULT 'default',
  ADD COLUMN module_permissions LONGTEXT NULL;
