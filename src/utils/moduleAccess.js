export const ROLE_ID_TO_NAME = {
  1: 'admin',
  2: 'dean',
  3: 'program_head',
  4: 'secretary',
  5: 'teacher',
};

export const PERMISSION_MATRIX = {
  dashboard: ['admin', 'dean', 'program_head', 'secretary'],
  faculty_dashboard: ['dean', 'program_head', 'secretary', 'teacher'],
  users: ['admin', 'dean', 'program_head', 'secretary'],
  attendance: ['dean', 'program_head', 'secretary', 'teacher'],
  attendancemgmt: ['admin', 'secretary', 'dean', 'program_head'],
  class_schedules: ['admin', 'dean', 'program_head', 'secretary'],
  '3d_building': ['admin', 'dean', 'program_head', 'secretary'],
  attendance_edits: ['dean'],
  schedule_edits: ['secretary'],
  academic_admin: ['admin'],
  academic_manage: ['admin', 'dean', 'program_head', 'secretary'],
  academic_program: ['admin', 'dean'],
  locations: ['admin'],
  reports: ['admin', 'dean', 'program_head', 'secretary', 'teacher'],
  leaves_file: ['secretary'],
  leaves_approvals: ['admin', 'dean', 'program_head'],
  substitutions: ['secretary', 'dean'],
  logs: ['admin', 'dean', 'program_head', 'secretary'],
  settings: ['admin', 'dean'],
  attendance_logs: ['admin', 'dean', 'program_head'],
};

export const MODULE_LABELS = {
  dashboard: 'Dashboard',
  faculty_dashboard: 'My Dashboard',
  users: 'User Management',
  attendance: 'Faculty Portal / Attendance',
  attendancemgmt: 'Attendance Records',
  class_schedules: 'Class Schedules',
  '3d_building': '3D Campus Map',
  attendance_edits: 'Attendance Edit Requests',
  schedule_edits: 'Schedule Edit Requests',
  academic_admin: 'Academic Admin (Dept/School Year)',
  academic_manage: 'Academic Manage (Sections/Subjects)',
  academic_program: 'Program Management',
  locations: 'Facility Management',
  reports: 'Reports',
  leaves_file: 'File Leave',
  leaves_approvals: 'Leave Approvals',
  substitutions: 'Substitutions',
  logs: 'System Logs',
  settings: 'General Settings',
  attendance_logs: 'Attendance Logs',
};

export const ALL_MODULES = Object.keys(PERMISSION_MATRIX);
const ALL_MODULE_LOOKUP = ALL_MODULES.reduce((acc, key) => {
  acc[key] = true;
  return acc;
}, {});

export function normalizeModuleToken(value) {
  const token = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!token) return '';
  return ALL_MODULE_LOOKUP[token] ? token : '';
}

export function resolveRoleName(userLike) {
  if (!userLike || typeof userLike !== 'object') return null;
  const possibleIds = [userLike.role_id, userLike.roleId, userLike.roleid, userLike.roleID];
  for (const id of possibleIds) {
    const num = Number(id);
    if (!Number.isNaN(num) && ROLE_ID_TO_NAME[num]) return ROLE_ID_TO_NAME[num];
  }
  const names = [userLike.role, userLike.role_name, userLike.roleName];
  for (const name of names) {
    const clean = String(name || '').trim().toLowerCase();
    if (clean) return clean;
  }
  return null;
}

export function getRoleDefaultModules(roleName) {
  const role = String(roleName || '').trim().toLowerCase();
  if (!role) return [];
  const out = [];
  for (const [moduleKey, roles] of Object.entries(PERMISSION_MATRIX)) {
    if (Array.isArray(roles) && roles.includes(role)) out.push(moduleKey);
  }
  out.sort();
  return out;
}

export function parseModulePermissions(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = null;
    }
  }
  const allowRaw = Array.isArray(parsed?.allow) ? parsed.allow : [];
  const denyRaw = Array.isArray(parsed?.deny) ? parsed.deny : [];
  const normalizeList = (list) => {
    const seen = {};
    const out = [];
    for (const entry of list) {
      const token = normalizeModuleToken(entry);
      if (!token || seen[token]) continue;
      seen[token] = true;
      out.push(token);
    }
    out.sort();
    return out;
  };
  return {
    allow: normalizeList(allowRaw),
    deny: normalizeList(denyRaw),
  };
}

export function getEffectiveModules(userLike) {
  const roleName = resolveRoleName(userLike);
  const base = getRoleDefaultModules(roleName);
  const bag = parseModulePermissions(userLike?.module_permissions);
  const effective = {};
  for (const m of base) effective[m] = true;
  for (const m of bag.allow) effective[m] = true;
  for (const m of bag.deny) delete effective[m];
  return Object.keys(effective).sort();
}

export function canAccessModule(userLike, moduleKey) {
  if (!moduleKey) return true;
  const token = normalizeModuleToken(moduleKey);
  if (!token) return false;
  const effective = getEffectiveModules(userLike);
  return effective.includes(token);
}

export function getDeanManageableModules() {
  const roleNames = ['program_head', 'secretary', 'teacher'];
  const bag = {};
  for (const roleName of roleNames) {
    const defaults = getRoleDefaultModules(roleName);
    for (const moduleKey of defaults) bag[moduleKey] = true;
  }
  return Object.keys(bag).sort();
}

export function getPermissionFromRoute(routePath) {
  const p = String(routePath || '').toLowerCase();
  if (p.startsWith('/login')) return null;
  if (p.startsWith('/faculty-dashboard')) return 'faculty_dashboard';
  if (p.startsWith('/attendancemgmt')) return 'attendancemgmt';
  if (p.startsWith('/attendance-logs') || p.startsWith('/logs') || p.startsWith('/attedance_audit')) return 'attendance_logs';
  if (p.startsWith('/system-logs') || p.startsWith('/systemlogs')) return 'logs';
  if (p.startsWith('/attendance-edit-requests')) return 'attendance_edits';
  if (p.startsWith('/schedule-edit-requests')) return 'schedule_edits';
  if (p.startsWith('/attendance-history') || p.startsWith('/my-attendance') || p.startsWith('/my-requested-edits') || p.startsWith('/attendance')) return 'attendance';
  if (p.startsWith('/dashboard')) return 'dashboard';
  if (p.startsWith('/users')) return 'users';
  if (p.startsWith('/3d-building')) return '3d_building';
  if (p.startsWith('/class-schedules')) return 'class_schedules';
  if (p.startsWith('/departments') || p.startsWith('/school_year')) return 'academic_admin';
  if (p.startsWith('/programs')) return 'academic_program';
  if (p.startsWith('/semesters')) return 'academic_admin';
  if (p.startsWith('/sections') || p.startsWith('/subjects') || p.startsWith('/subject-offerings')) return 'academic_manage';
  if (p.startsWith('/building') || p.startsWith('/floors') || p.startsWith('/rooms')) return 'locations';
  if (p.startsWith('/school')) return 'settings';
  if (p.startsWith('/file_leave')) return 'leaves_file';
  if (p.startsWith('/leave_approval')) return 'leaves_approvals';
  if (p.startsWith('/substitute') || p.startsWith('/substitutions')) return 'substitutions';
  if (p.startsWith('/reports')) return 'reports';
  if (p.startsWith('/settings')) return 'settings';
  return null;
}
