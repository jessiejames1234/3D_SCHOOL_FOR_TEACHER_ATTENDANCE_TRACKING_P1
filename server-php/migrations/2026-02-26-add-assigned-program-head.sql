ALTER TABLE tbl_users
  ADD COLUMN assigned_program_head_id INT(11) NULL AFTER dept_id,
  ADD KEY assigned_program_head_id (assigned_program_head_id),
  ADD CONSTRAINT tbl_users_ibfk_3 FOREIGN KEY (assigned_program_head_id) REFERENCES tbl_programs(program_id);
