import React from 'react';
import ReactDOM from 'react-dom';
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import StatisticsBoxs from "../../components/statistics_boxs.jsx";
import { apiGet, apiPost, apiPut } from '../../services/api.js';

const PROGRAM_REQUIRED_ROLE_IDS = ['2', '3', '4', '5'];
const roleNeedsProgram = (roleId) => PROGRAM_REQUIRED_ROLE_IDS.includes(String(roleId));

export default function UserIndex(){
  const [users, setUsers] = React.useState([]);
  const [roles, setRoles] = React.useState([]);
  const [departments, setDepartments] = React.useState([]);
  const [programHeads, setProgramHeads] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [form, setForm] = React.useState({ first_name:'', last_name:'', email:'', password:'', contact_no:'', role_id: '', id_number: '', dept_id: '', assigned_program_head_id: '' });
  const [editImageUrl, setEditImageUrl] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [allUsers, setAllUsers] = React.useState(null);
  const [importing, setImporting] = React.useState(false);
  const [importSummary, setImportSummary] = React.useState(null);
  const [importErrors, setImportErrors] = React.useState([]);
  const [showImportModal, setShowImportModal] = React.useState(false);
  const [importDraftRows, setImportDraftRows] = React.useState([]);
  const [importRowErrors, setImportRowErrors] = React.useState({});
  const [importDraftSummary, setImportDraftSummary] = React.useState(null);
  const [importFileName, setImportFileName] = React.useState('');
  const [importProcessing, setImportProcessing] = React.useState(false);
  const [importPage, setImportPage] = React.useState(1);
  const [showAddRoleModal, setShowAddRoleModal] = React.useState(false);
  const [addRoleForm, setAddRoleForm] = React.useState({ role_name: '' });
  const [addRoleLoading, setAddRoleLoading] = React.useState(false);
  const [addRoleError, setAddRoleError] = React.useState('');
  const [showAddDeptModal, setShowAddDeptModal] = React.useState(false);
  const [addDeptForm, setAddDeptForm] = React.useState({ dept_name: '' });
  const [addDeptLoading, setAddDeptLoading] = React.useState(false);
  const [addDeptError, setAddDeptError] = React.useState('');
  const fileInputRef = React.useRef(null);
  const importPreviewSeq = React.useRef(0);
  const importAutoValidateTimerRef = React.useRef(null);
  const formRef = React.useRef(form);
  const emailDomainRegex = /^[A-Za-z0-9._%+-]+@phinmaed\.com$/i;
  const idNumberRegex = /^\d{2}-\d{3}-[A-Za-z]$/;
  const IMPORT_PAGE_SIZE = 10;

  // Filters for the user table
  const [searchTerm, setSearchTerm] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('');
  const [deptFilter, setDeptFilter] = React.useState('');

  // Authentication & Role Check logic
  const currentUser = React.useMemo(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; }
  }, []);

  const isAdmin = Number(currentUser?.role_id) === 1;
  const isDean = Number(currentUser?.role_id) === 2;
  const isProgramHead = Number(currentUser?.role_id) === 3;
  const isSecretary = Number(currentUser?.role_id) === 4;
  const isTeacher = Number(currentUser?.role_id) === 5;
  const isDepartmentAdmin = Number(currentUser?.role_id) === 6;
  const isDeanScopedRole = isDean || isDepartmentAdmin;
  const canManageUsers = isAdmin || isDepartmentAdmin;
  const showProgramColumns = !(isDeanScopedRole || isSecretary || isProgramHead);
  const hasFixedDepartmentScope = isDeanScopedRole || isSecretary || isProgramHead;
  const fixedDeptId = hasFixedDepartmentScope ? String(currentUser?.dept_id || '') : '';

  React.useEffect(() => {
    formRef.current = form;
  }, [form]);

  // When role becomes admin (1) ensure dept_id is cleared
  React.useEffect(()=>{
    if (form && String(form.role_id) === '1' && form.dept_id) {
      setForm(f => ({ ...f, dept_id: '' }));
    }
    if (form && !roleNeedsProgram(form.role_id) && form.assigned_program_head_id) {
      setForm(f => ({ ...f, assigned_program_head_id: '' }));
    }
  }, [form.role_id]);

  const normalizeStatus = React.useCallback((user) => {
    return String(user?._status || user?.status || '').toLowerCase().trim();
  }, []);

  const applyRoleScope = React.useCallback((list) => {
    let scoped = Array.isArray(list) ? list.slice() : [];

    // Hide Admin role from user management view
    scoped = scoped.filter(u => String(u?.role_id) !== '1');

    // --- ROLE-BASED VISIBILITY FILTERING ---
    if (isDeanScopedRole) {
      // Dean-like roles: view program heads, secretaries, and teachers in own department.
      const deptId = Number(currentUser?.dept_id || 0);
      if (!deptId) {
        scoped = [];
      } else {
        scoped = scoped.filter(u => [3, 4, 5].includes(Number(u.role_id)) && Number(u.dept_id) === deptId);
      }
    } else if (isSecretary) {
      // Secretary: view-only teachers within own department.
      const deptId = Number(currentUser?.dept_id || 0);
      if (!deptId) {
        scoped = [];
      } else {
        scoped = scoped.filter(u => Number(u.role_id) === 5 && Number(u.dept_id) === deptId);
      }
    } else if (isProgramHead) {
      // Program Head: view-only assigned teachers (server-enforced, with client safety filter if present).
      scoped = scoped.filter(u => Number(u.role_id) === 5);
    } else if (!isAdmin) {
      // Fallback for unknown/unauthorized roles
      scoped = [];
    }

    return scoped;
  }, [isDeanScopedRole, isSecretary, isProgramHead, isAdmin, currentUser]);

  const effectiveStatusFilter = (!isAdmin && statusFilter === 'archive') ? 'all' : statusFilter;
  const isArchiveView = effectiveStatusFilter === 'archive';

  const scopedUsers = React.useMemo(() => {
    const src = Array.isArray(allUsers) ? allUsers : users || [];
    return applyRoleScope(src);
  }, [allUsers, users, applyRoleScope]);

  const statusFilteredUsers = React.useMemo(() => {
    let list = scopedUsers.slice();
    if (effectiveStatusFilter === 'archive') {
      list = list.filter(u => normalizeStatus(u) === 'archive');
    } else if (effectiveStatusFilter === 'active') {
      list = list.filter(u => normalizeStatus(u) === 'active');
    } else if (effectiveStatusFilter === 'inactive') {
      list = list.filter(u => normalizeStatus(u) === 'inactive');
    } else {
      list = list.filter(u => normalizeStatus(u) !== 'archive');
    }
    return list;
  }, [scopedUsers, effectiveStatusFilter, normalizeStatus]);

  // Derived filtered users for table display
  const filteredUsers = React.useMemo(() => {
    let list = statusFilteredUsers.slice();

    if (searchTerm && searchTerm.trim()) {
      const q = searchTerm.trim().toLowerCase();
      list = list.filter(u => (`${u.first_name || ''} ${u.last_name || ''} ${u.email || ''} ${u.id_number || ''}`).toLowerCase().includes(q));
    }
    if (roleFilter) list = list.filter(u => String(u.role_id) === String(roleFilter));
    if (deptFilter) list = list.filter(u => String(u.dept_id) === String(deptFilter));

    if (effectiveStatusFilter === 'all') {
      const priority = { active: 0, inactive: 1 };
      list = list.slice().sort((a, b) => {
        const aKey = priority[normalizeStatus(a)] ?? 2;
        const bKey = priority[normalizeStatus(b)] ?? 2;
        if (aKey !== bKey) return aKey - bKey;
        const aName = `${a.first_name || ''} ${a.last_name || ''}`.trim().toLowerCase();
        const bName = `${b.first_name || ''} ${b.last_name || ''}`.trim().toLowerCase();
        if (aName < bName) return -1;
        if (aName > bName) return 1;
        return 0;
      });
    }

    return list;
  }, [statusFilteredUsers, searchTerm, roleFilter, deptFilter, effectiveStatusFilter, normalizeStatus]);

  const userStats = React.useMemo(() => {
    let total = 0;
    let active = 0;
    let inactive = 0;
    let archived = 0;
    (scopedUsers || []).forEach((u) => {
      const s = normalizeStatus(u);
      if (s === 'archive') {
        archived += 1;
        return;
      }
      total += 1;
      if (s === 'active') active += 1;
      else if (s === 'inactive') inactive += 1;
    });
    return { total, active, inactive, archived };
  }, [scopedUsers, normalizeStatus]);

  const statsItems = React.useMemo(() => {
    const items = [
      { key: 'all', label: 'All Users', value: userStats.total, subLabel: 'Active + Inactive' },
      { key: 'active', label: 'Total Active Users', value: userStats.active, subLabel: 'Status: Active' },
      { key: 'inactive', label: 'Total Inactive Users', value: userStats.inactive, subLabel: 'Status: Inactive' }
    ];
    if (isAdmin) {
      items.push({ key: 'archive', label: 'Archived Users', value: userStats.archived, subLabel: 'Status: Archived' });
    }
    return items;
  }, [userStats, isAdmin]);

  const roleFilterOptions = React.useMemo(() => {
    const list = Array.isArray(roles) ? roles : [];
    const noAdmin = list.filter(r => String(r?.role_id) !== '1');
    if (isDeanScopedRole) return noAdmin.filter(r => [3, 4, 5].includes(Number(r.role_id)));
    if (isProgramHead) return noAdmin.filter(r => Number(r.role_id) === 5);
    return noAdmin;
  }, [roles, isDeanScopedRole, isProgramHead]);

  const normalizeRoleToken = React.useCallback((value) => {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  }, []);

  const adminRoleTokens = React.useMemo(() => {
    const tokens = new Set(['1', 'admin', 'administrator']);
    (Array.isArray(roles) ? roles : []).forEach((r) => {
      if (String(r?.role_id) === '1') {
        const name = r?.role_name || r?.name || '';
        const token = normalizeRoleToken(name);
        if (token) tokens.add(token);
      }
    });
    return tokens;
  }, [roles, normalizeRoleToken]);

  const isAdminRoleValue = React.useCallback((value) => {
    const token = normalizeRoleToken(value);
    return token ? adminRoleTokens.has(token) : false;
  }, [adminRoleTokens, normalizeRoleToken]);

  const resolveRoleIdValue = React.useCallback((value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);
    const token = normalizeRoleToken(raw);
    const match = (Array.isArray(roles) ? roles : []).find((r) => {
      const roleName = r?.role_name || r?.name || '';
      return normalizeRoleToken(roleName) === token;
    });
    return match ? Number(match.role_id) : null;
  }, [roles, normalizeRoleToken]);

  const departmentFilterOptions = React.useMemo(() => {
    const list = Array.isArray(departments) ? departments : [];
    if (!hasFixedDepartmentScope) return list;
    if (!fixedDeptId) return [];
    return list.filter(d => String(d.dept_id) === fixedDeptId);
  }, [departments, hasFixedDepartmentScope, fixedDeptId]);

  const departmentOptionsForForm = React.useMemo(() => {
    return Array.isArray(departments) ? departments : [];
  }, [departments]);

  const fixedDeptLabel = React.useMemo(() => {
    if (!fixedDeptId) return '';
    const dept = (Array.isArray(departments) ? departments : []).find(d => String(d.dept_id) === String(fixedDeptId));
    return dept ? (dept.dept_name || dept.name || String(fixedDeptId)) : String(fixedDeptId);
  }, [departments, fixedDeptId]);

  React.useEffect(() => {
    if (!roleFilter) return;
    const isValid = roleFilterOptions.some(r => String(r.role_id) === String(roleFilter));
    if (!isValid) setRoleFilter('');
  }, [roleFilter, roleFilterOptions]);

  React.useEffect(() => {
    if (!hasFixedDepartmentScope) return;
    setDeptFilter(fixedDeptId);
  }, [hasFixedDepartmentScope, fixedDeptId]);

  // Helper: normalize and prettify role names
  const formatRoleName = (name) => {
    if (!name) return 'N/A';
    return name.toString().replace(/_/g, ' ').split(/\s+/).map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '').join(' ').trim();
  };

  // Helper to show SweetAlert safely
  const safeSwal = async (options) => {
    if (typeof window === 'undefined' || !window.Swal) {
      if (options && options.showCancelButton) {
        const confirmed = confirm(options.title || options.text || 'Are you sure?');
        return { isConfirmed: confirmed };
      }
      return { isConfirmed: true };
    }

    const body = document.body;
    const prevOverflow = body.style.overflow || '';
    const prevPaddingRight = body.style.paddingRight || '';
    try {
      const hasScrollbar = document.documentElement.scrollHeight > window.innerHeight;
      if (hasScrollbar) {
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
        if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
      }
      body.style.overflow = 'hidden';

      const res = await window.Swal.fire(options);
      return res || {};
    } catch (e) {
      console.error('safeSwal error', e);
      return { isConfirmed: false };
    } finally {
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPaddingRight;
    }
  };

  function KebabMenu({ onEdit, onToggle, onArchive, onUnarchive, archived = false }){
    const [open, setOpen] = React.useState(false);
    const containerRef = React.useRef(null);
    const menuRef = React.useRef(null);
    const [menuStyle, setMenuStyle] = React.useState(null);

    React.useEffect(()=>{
      const onDocClick = (e)=>{
        const withinBtn = containerRef.current && containerRef.current.contains(e.target);
        const withinMenu = menuRef.current && menuRef.current.contains(e.target);
        if (!withinBtn && !withinMenu) setOpen(false);
      };
      document.addEventListener('click', onDocClick);
      return ()=> document.removeEventListener('click', onDocClick);
    }, []);

    React.useEffect(()=>{
      if (!open) { setMenuStyle(null); return; }
      const btn = containerRef.current && containerRef.current.querySelector('button');
      if (!btn) return;
      const compute = ()=>{
        const rect = btn.getBoundingClientRect();
        const vh = window.innerHeight; const vw = window.innerWidth;
        const minW = 160;
        const estimatedH = archived ? 40 * 2 : 40 * 3; 
        const naturalH = menuRef.current ? menuRef.current.scrollHeight : estimatedH;
        const maxH = Math.floor(vh * 0.6);
        const menuH = Math.min(naturalH, maxH);
        const spaceBelow = vh - rect.bottom;
        const top = (spaceBelow >= menuH + 8) ? rect.bottom + 6 : Math.max(6, rect.top - menuH - 6);
        const preferLeft = rect.left + minW <= vw - 8;
        const style = { position: 'fixed', top: `${top}px`, zIndex: 99999, maxHeight: `${maxH}px`, overflowY: 'auto', minWidth: `${minW}px` };
        if (preferLeft) style.left = `${Math.max(8, rect.left)}px`; else style.right = `${Math.max(8, vw - rect.right)}px`;
        setMenuStyle(style);
      };
      const raf = requestAnimationFrame(compute);
      window.addEventListener('resize', compute);
      window.addEventListener('scroll', compute, true);
      return ()=>{ cancelAnimationFrame(raf); window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
    }, [open, archived]);

    const menuNode = open ? React.createElement('div', { ref: menuRef, className: 'card', style: { ...(menuStyle || { position:'fixed', top:0, right:0 }), boxShadow:'0 6px 18px rgba(0,0,0,0.12)' }, onClick: e=> e.stopPropagation() },
      React.createElement('div', { className: 'list-group list-group-flush', style: { padding:0 } },
        archived ? React.createElement(React.Fragment, null,
          React.createElement('button', { type:'button', className:'list-group-item list-group-item-action', onClick: ()=>{ setOpen(false); onEdit && onEdit(); } }, 'Edit'),
          React.createElement('button', { type:'button', className:'list-group-item list-group-item-action text-primary', onClick: ()=>{ setOpen(false); onUnarchive ? onUnarchive() : (onToggle && onToggle()); } }, 'Unarchive')
        ) : React.createElement(React.Fragment, null,
          React.createElement('button', { type:'button', className:'list-group-item list-group-item-action', onClick: ()=>{ setOpen(false); onEdit && onEdit(); } }, 'Edit'),
          React.createElement('button', { type:'button', className:'list-group-item list-group-item-action', onClick: ()=>{ setOpen(false); onToggle && onToggle(); } }, 'Toggle'),
          React.createElement('button', { type:'button', className:'list-group-item list-group-item-action text-danger', onClick: ()=>{ setOpen(false); onArchive && onArchive(); } }, 'Archive')
        )
      )
    ) : null;

    return (
      React.createElement('div', { ref: containerRef, className: 'position-relative d-inline-block' },
        React.createElement('button', { type:'button', className:'btn btn-light btn-sm', onClick: ()=> setOpen(s=>!s), 'aria-haspopup':'true', 'aria-expanded': open, style:{ width:36, height:36, padding:0, borderRadius:6 } }, React.createElement('span', { style:{ fontSize:18, lineHeight:'36px' } }, '\u22EE')),
        menuNode && ReactDOM.createPortal(menuNode, document.body)
      )
    );
  }

  const handleStatusSelect = (key)=>{
    const allowed = ['all','active','inactive','archive'];
    const next = allowed.includes(String(key)) ? String(key) : 'all';
    if (!isAdmin && next === 'archive') return;
    setStatusFilter(next);
  };

  const handleUnarchive = async (user)=>{
    try{
      const res = await safeSwal({ title: 'Unarchive user?', text: 'This will restore the user and set status to inactive.', icon: 'warning', showCancelButton: true });
      if (!res.isConfirmed) return;
      await apiPost(`users/${user.user_id}/toggle`, {});
      await new Promise(r=>setTimeout(r, 120));
      await apiPost(`users/${user.user_id}/toggle`, {});
      await fetchUsers();
      try { await safeSwal({ icon:'success', title: 'Unarchived', timer:1200, showConfirmButton:false }); } catch(e){}
    }catch(err){ console.error(err); setError(err.body?.error || err.message || 'Failed to unarchive user'); try { await safeSwal({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to unarchive' }); } catch(e){} }
  };

  // Base Columns available for everyone allowed to see the page
  const columns = [
    { key: 'avatar', label: 'Image', render: (u)=>{
      const src = u.avatar || u.image || '/src/assets/unknown.jpg';
      return React.createElement('img', { src, alt: `${u.first_name || ''} ${u.last_name || ''}`, style: { width:40, height:40, borderRadius:'50%', objectFit:'cover', border: '1px solid #ddd' } });
    }},
    { key: 'name', label: 'Name', render: u=> `${u.first_name} ${u.last_name}` },
    { key: 'school_id', label: 'School ID', render: u=> {
      const val = u?.id_number ?? u?.school_id ?? (u?.school && (u.school.school_id ?? u.school.id)) ?? null;
      return val !== null && val !== undefined && String(val) !== '' ? String(val) : 'N/A';
    } },
    { key: 'department', label: 'Department', render: u=> u.dept_name || u.department || (u.dept_id? String(u.dept_id): 'N/A') },
    { key: 'email', label: 'Email' },
    { key: 'contact_no', label: 'Contact' },
    { key: 'role_name', label: 'Role', render: u=> {
      const raw = (u.role_name || u.role || '').toString();
      const display = formatRoleName(raw);
      const key = raw.toLowerCase().replace(/\s+/g, '_');
      const map = {
        admin: 'bg-blue-100 text-blue-700',
        dean: 'bg-purple-100 text-purple-700',
        program_head: 'bg-teal-100 text-teal-700',
        secretary: 'bg-gray-100 text-gray-700',
        teacher: 'bg-green-100 text-green-700'
      };
      const cls = map[key] || 'bg-indigo-100 text-indigo-700';
      return React.createElement('span', { className: `d-inline-flex align-items-center gap-2 px-2 py-1 rounded-2 ${cls}`, style:{fontSize:13, fontWeight:600} },
        React.createElement('span', { style:{width:10,height:10,display:'inline-block',borderRadius:999,marginRight:8, background: cls.includes('blue')? '#bfdbfe' : cls.includes('purple')? '#e9d5ff' : cls.includes('teal')? '#d1fae5' : cls.includes('gray')? '#f3f4f6' : cls.includes('green')? '#bbf7d0' : '#c7d2fe' } }),
        display || 'N/A'
      );
    } },
    { key: 'status', label: 'Status', render: u=> {
      const s = String(u.status || '').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : s);
      return React.createElement('span', { className: `badge ${cls}` }, text);
    }}
  ];

  if (showProgramColumns) {
    columns.splice(4, 0,
      { key: 'program_name', label: 'Program', render: u=> u.assigned_program_name || 'N/A' }
    );
  }

  // Append the Action Button column for accounts allowed to manage users.
  if (canManageUsers) {
    columns.push({ 
      key: 'actions', 
      label: 'Actions', 
      render: u=> React.createElement(KebabMenu, { 
        archived: isArchiveView, 
        onEdit: ()=> handleEdit(u), 
        onToggle: ()=> handleToggleActive(u), 
        onArchive: ()=> handleArchive(u), 
        onUnarchive: ()=> handleUnarchive(u) 
      }) 
    });
  }

  React.useEffect(()=>{
    const token = localStorage.getItem('token');
    if (!token) { window.location.hash = '#/login'; return; }
    fetchUsers(); fetchRoles(); fetchDepartments();
  }, []);

  const fetchUsers = async ()=>{
    try{
      const data = await apiGet('users');
      if (!Array.isArray(data)) { setUsers([]); setAllUsers([]); return; }
      const normalized = data.map(u => ({ ...u, _status: String(u.status || '').toLowerCase().trim() }));
      setAllUsers(normalized);
      setUsers(normalized);
    }catch(err){ console.error(err); setError('Failed to load users'); }
  };
  const fetchRoles = async ()=>{
    try{ const data = await apiGet('roles'); setRoles(Array.isArray(data)? data: []); }catch(e){ console.error(e); }
  };
  const fetchDepartments = async ()=>{
    try{
      const d = await apiGet('departments');
      const list = Array.isArray(d) ? d.filter(x => String(x.status || '').toLowerCase() !== 'archive') : [];
      setDepartments(list);
      return list;
    }catch(e){ console.error('Failed to load departments', e); return []; }
  };
  const fetchProgramHeads = async (deptId = '', roleId = form.role_id, ownerUserId = form.user_id || '')=>{
    try{
      if (!deptId) {
        setProgramHeads([]);
        return;
      }
      const data = await apiGet('programs');
      let list = Array.isArray(data) ? data : [];
      list = list.filter(p => String(p.status || '').toLowerCase() === 'active');
      list = list.filter(p => String(p.dept_id) === String(deptId));
      const mapped = list.map(p => {
        const headName = `${p.head_first || ''} ${p.head_last || ''}`.trim();
        const label = headName ? `${p.program_name} (${headName})` : `${p.program_name}`;
        return { id: p.program_id, label };
      });
      setProgramHeads(mapped);
    }catch(e){
      console.error('Failed to load program heads', e);
      setProgramHeads([]);
    }
  };

  React.useEffect(()=>{
    let cancelled = false;
    let refreshing = false;

    const refreshViaHttps = async ()=>{
      if (cancelled || document.hidden || refreshing || !localStorage.getItem('token')) return;
      refreshing = true;
      try {
        await Promise.all([fetchUsers(), fetchRoles(), fetchDepartments()]);
        const currentForm = formRef.current || {};
        if (roleNeedsProgram(currentForm.role_id) && currentForm.dept_id) {
          await fetchProgramHeads(currentForm.dept_id, currentForm.role_id, currentForm.user_id || '');
        }
      } catch(e) {
        console.error('Failed to refresh users via HTTPS', e);
      } finally {
        refreshing = false;
      }
    };

    const intervalId = window.setInterval(refreshViaHttps, 3000);
    const handleFocusRefresh = ()=> refreshViaHttps();
    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleFocusRefresh);

    return ()=>{
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleFocusRefresh);
    };
  }, []);

  React.useEffect(()=>{
    if (!isAdmin || !showModal) return;
    if (!roleNeedsProgram(form.role_id)) {
      setProgramHeads([]);
      return;
    }
    if (!form.dept_id) {
      setProgramHeads([]);
      return;
    }
    fetchProgramHeads(form.dept_id || '', form.role_id, form.user_id || '');
  }, [isAdmin, showModal, form.role_id, form.dept_id, form.user_id]);

  React.useEffect(() => {
    if (!showModal) return;
    if (!form.dept_id) return;
    const valid = departmentOptionsForForm.some(d => String(d.dept_id) === String(form.dept_id));
    if (!valid) {
      setForm(prev => ({ ...prev, dept_id: departmentOptionsForForm[0]?.dept_id || '', assigned_program_head_id: '' }));
    }
  }, [showModal, form.dept_id, departmentOptionsForForm]);

  React.useEffect(() => {
    if (!showModal) return;
    if (!roleNeedsProgram(form.role_id)) return;
    if (!form.assigned_program_head_id) return;
    const valid = programHeads.some(ph => String(ph.id) === String(form.assigned_program_head_id));
    if (!valid) setForm(prev => ({ ...prev, assigned_program_head_id: '' }));
  }, [showModal, form.role_id, form.assigned_program_head_id, programHeads]);

  const openModal = ()=>{ 
    const defaultRoleId = roleFilterOptions[0]?.role_id || '';
    const defaultDeptId = isDepartmentAdmin ? fixedDeptId : (String(defaultRoleId) === '1' ? '' : (departments[0]?.dept_id || ''));
    setForm({ first_name:'', last_name:'', email:'', password:'', contact_no:'', role_id: defaultRoleId, id_number: '', dept_id: defaultDeptId, assigned_program_head_id: '' });
    setEditImageUrl('');
    setError('');
    setShowModal(true);
  };
  const closeModal = ()=> setShowModal(false);
  const handleChange = (e)=>{
    const { name, value } = e.target;
    if (name === 'contact_no') {
      const digits = (value || '').toString().replace(/\D/g, '');
      setForm(prev => ({ ...prev, contact_no: digits }));
      return;
    }
    if (name === 'id_number') {
      const clean = (value || '').toString().replace(/[^0-9\-]/g, '');
      setForm(prev => ({ ...prev, id_number: clean }));
      return;
    }
    if (name === 'dept_id' && roleNeedsProgram(form.role_id)) {
      setForm(prev=> ({ ...prev, dept_id: value, assigned_program_head_id: '' }));
      return;
    }
    if (name === 'role_id') {
      setForm(prev=> ({ ...prev, role_id: value, assigned_program_head_id: '' }));
      return;
    }
    setForm(prev=> ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e)=>{
    e && e.preventDefault && e.preventDefault();
    setLoading(true); setError('');
    try{
      let createdEmailNotification = null;
      if (!form.first_name || !form.last_name || !form.email || !form.role_id) { setError('Please fill required fields'); setLoading(false); return; }
      if (String(form.role_id) === '1') { setError('Admin role is not allowed here'); setLoading(false); return; }
      const normalizedEmail = String(form.email || '').trim().toLowerCase();
      if (!emailDomainRegex.test(normalizedEmail)) { setError('Email must use @phinmaed.com'); setLoading(false); return; }
      const normalizedIdNumber = String(form.id_number || '').trim();
      if (!normalizedIdNumber) { setError('ID number is required'); setLoading(false); return; }
      if (!idNumberRegex.test(normalizedIdNumber)) { setError('ID number must match format ##-###-letter (e.g. 24-018-F)'); setLoading(false); return; }

      if (form.contact_no) {
        if (!/^09\d+$/.test(form.contact_no)) { setError('Contact number must start with 09 and contain digits only'); setLoading(false); return; }
        if (form.contact_no.length !== 11) { setError('Contact number must be 11 digits (e.g. 09123456789)'); setLoading(false); return; }
      }

      const payload = { ...form, email: normalizedEmail, id_number: normalizedIdNumber };
      if (form.user_id) delete payload.password;
      if (isDepartmentAdmin) payload.dept_id = fixedDeptId;
      if (String(form.role_id) === '1') delete payload.dept_id;
      if (String(form.role_id) !== '1' && !payload.dept_id) {
        setError('Department is required for this role');
        setLoading(false);
        return;
      }
      if (roleNeedsProgram(form.role_id)) {
        if (!payload.assigned_program_head_id) {
          setError(String(form.role_id) === '3' ? 'Owned Program is required for program heads' : 'Assigned Program is required for this role');
          setLoading(false);
          return;
        }
      } else {
        delete payload.assigned_program_head_id;
      }

      if (isDepartmentAdmin && String(payload.dept_id || '') !== fixedDeptId) {
        setError('Department admin can only manage users in their assigned department');
        setLoading(false);
        return;
      }

      if (form.user_id) {
        await apiPut(`users/${form.user_id}`, payload);
      } else {
        if (!form.password) { setError('Password is required for new user'); setLoading(false); return; }
        const createResult = await apiPost('users', payload);
        createdEmailNotification = createResult?.email_notification || null;
      }

      await fetchUsers();
      closeModal();
      try {
        if (!form.user_id && createdEmailNotification && createdEmailNotification.sent === false) {
          await safeSwal({
            icon: 'warning',
            title: 'User created',
            text: 'User was created, but account email could not be sent. Please verify mail settings.',
          });
        } else {
          await safeSwal({ icon:'success', title: form.user_id ? 'User updated' : 'User created', timer: 1400, showConfirmButton: false });
        }
      } catch(e){}
    }catch(err){ console.error(err); setError(err.body?.error || err.message || 'Failed to create user'); }
    finally{ setLoading(false); }
  };

  const handleEdit = (user)=>{
    const editRoleId = String(user.role_id || '');
    setForm({
      user_id: user.user_id,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: user.email || '',
      password: '',
      contact_no: user.contact_no || '',
      role_id: user.role_id || '',
      id_number: user.id_number || '',
      dept_id: isDepartmentAdmin ? fixedDeptId : (user.dept_id || ''),
      assigned_program_head_id: roleNeedsProgram(editRoleId) ? (user.assigned_program_head_id || user.assigned_program_id || '') : ''
    });
    setEditImageUrl(user?.avatar || user?.image || '/src/assets/unknown.jpg');
    setError('');
    setShowModal(true);
  };
  const handleToggleActive = async (user)=>{
    try{
      await apiPost(`users/${user.user_id}/toggle`, {});
      await fetchUsers();
      try { await safeSwal({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    }catch(err){ console.error(err); setError(err.message || 'Failed to toggle user'); }
  };
  const handleArchive = async (user)=>{
    try{
      const res = await safeSwal({ title: 'Archive user?', text: 'This will remove the user from the active list.', icon: 'warning', showCancelButton: true });
      if (!res.isConfirmed) return;
      await apiPost(`users/${user.user_id}/archive`, {});
      await fetchUsers();
      try { await safeSwal({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    }catch(err){ console.error(err); setError(err.body?.error || err.message || 'Failed to archive user'); try { await safeSwal({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); } catch(e){} }
  };

  const openAddRoleModal = ()=>{
    setAddRoleForm({ role_name: '' });
    setAddRoleError('');
    setShowAddRoleModal(true);
  };

  const closeAddRoleModal = ()=>{
    setShowAddRoleModal(false);
    setAddRoleForm({ role_name: '' });
    setAddRoleError('');
  };

  const handleAddRoleChange = (e)=>{
    const { value } = e.target;
    setAddRoleForm({ role_name: value });
    setAddRoleError('');
  };

  const handleAddRoleSubmit = async (e)=>{
    e && e.preventDefault && e.preventDefault();
    setAddRoleLoading(true);
    setAddRoleError('');
    try{
      if (!addRoleForm.role_name || !addRoleForm.role_name.trim()) {
        setAddRoleError('Role name is required');
        setAddRoleLoading(false);
        return;
      }

      const newRole = await apiPost('roles', { role_name: addRoleForm.role_name.trim() });
      await fetchRoles();
      closeAddRoleModal();
      try {
        await safeSwal({ icon:'success', title: 'Role created', text: `Role "${newRole.role_name}" has been added successfully.`, timer: 1400, showConfirmButton: false });
      } catch(e){}
    }catch(err){
      console.error(err);
      const errorMsg = err.body?.message || err.message || 'Failed to create role';
      setAddRoleError(errorMsg);
    }finally{
      setAddRoleLoading(false);
    }
  };

  const openAddDeptModal = ()=>{
    setAddDeptForm({ dept_name: '' });
    setAddDeptError('');
    setShowAddDeptModal(true);
  };

  const closeAddDeptModal = ()=>{
    setShowAddDeptModal(false);
    setAddDeptForm({ dept_name: '' });
    setAddDeptError('');
  };

  const handleAddDeptChange = (e)=>{
    const { value } = e.target;
    setAddDeptForm({ dept_name: value });
    setAddDeptError('');
  };

  const handleAddDeptSubmit = async (e)=>{
    e && e.preventDefault && e.preventDefault();
    setAddDeptLoading(true);
    setAddDeptError('');
    try{
      const deptName = String(addDeptForm.dept_name || '').trim();
      if (!deptName) {
        setAddDeptError('Department name is required');
        setAddDeptLoading(false);
        return;
      }

      const newDept = await apiPost('departments', { dept_name: deptName });
      const list = await fetchDepartments();
      const newDeptId = newDept?.dept_id || (list || []).find(d => String(d.dept_name || '').toLowerCase() === deptName.toLowerCase())?.dept_id || '';
      if (newDeptId) {
        setForm(prev => ({ ...prev, dept_id: newDeptId, assigned_program_head_id: '' }));
      }
      closeAddDeptModal();
      try {
        await safeSwal({ icon:'success', title: 'Department added', timer: 1400, showConfirmButton: false });
      } catch(e){}
    }catch(err){
      console.error(err);
      const errorMsg = err.body?.message || err.message || 'Failed to create department';
      setAddDeptError(errorMsg);
    }finally{
      setAddDeptLoading(false);
    }
  };

  const getFileArrayBuffer = (file) => {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const parseSpreadsheet = async (file) => {
    if (!window.XLSX) throw new Error('Spreadsheet parser is not available. Please reload the page.');
    const buffer = await getFileArrayBuffer(file);
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) return [];
    const worksheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
    return Array.isArray(rows) ? rows : [];
  };

  const normalizeImportKey = (key) => String(key || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_');
  const prettifyImportFieldLabel = (field) => {
    const map = {
      first_name: 'First Name',
      last_name: 'Last Name',
      email: 'Email',
      school_id: 'School ID',
      id_number: 'ID Number',
      contact_no: 'Contact No',
      role: 'Role',
      role_id: 'Role',
      department: 'Department',
      dept_id: 'Department',
      program: 'Program',
      assigned_program_head_id: 'Program'
    };
    const raw = String(field || '').trim();
    if (!raw) return '';
    const key = raw.toLowerCase();
    if (map[key]) return map[key];
    return raw
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ');
  };
  const prettifyImportErrorMessage = (msg) => {
    const text = String(msg || '');
    if (!text) return text;
    const missingMatch = text.match(/missing required fields\s*\(([^)]+)\)/i);
    if (missingMatch) {
      const fields = missingMatch[1]
        .split(',')
        .map(f => f.trim())
        .filter(Boolean)
        .map(prettifyImportFieldLabel);
      return text.replace(missingMatch[0], `Missing required fields (${fields.join(', ')})`);
    }
    let out = text;
    ['first_name', 'last_name', 'email', 'school_id', 'id_number', 'contact_no', 'role', 'role_id', 'department', 'dept_id', 'program', 'assigned_program_head_id'].forEach((raw) => {
      const pretty = prettifyImportFieldLabel(raw);
      out = out.replace(new RegExp(`\\b${raw}\\b`, 'gi'), pretty);
    });
    return out;
  };

  const mapRowsToImportDraft = (rows) => {
    const pick = (normalized, keys) => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(normalized, key)) {
          const val = normalized[key];
          if (val !== null && val !== undefined && String(val).trim() !== '') {
            return String(val).trim();
          }
        }
      }
      return '';
    };

    return (rows || []).map((row, idx) => {
      const normalized = {};
      Object.entries(row || {}).forEach(([k, v]) => {
        const nk = normalizeImportKey(k);
        if (!nk) return;
        normalized[nk] = typeof v === 'string' ? v.trim() : v;
      });
      return {
        _row: idx + 2,
        first_name: pick(normalized, ['first_name', 'firstname', 'first', 'given_name']),
        last_name: pick(normalized, ['last_name', 'lastname', 'last', 'family_name']),
        email: pick(normalized, ['email', 'email_address', 'mail']),
        school_id: pick(normalized, ['school_id', 'schoolid', 'id_number', 'id_no', 'id', 'school_id_number']),
        contact_no: pick(normalized, ['contact_no', 'contact', 'contact_number', 'phone', 'mobile']),
        role: pick(normalized, ['role_id', 'role', 'role_name']),
        department: isDepartmentAdmin ? fixedDeptId : pick(normalized, ['dept_id', 'department_id', 'department', 'dept', 'dept_name']),
        program: pick(normalized, ['assigned_program_head_id', 'assigned_program_id', 'assigned_program', 'program_id', 'program', 'program_name', 'program_head_assigned'])
      };
    });
  };

  const buildImportPayloadRows = (rows) => {
    return (rows || []).map(r => ({
      first_name: String(r?.first_name || '').trim(),
      last_name: String(r?.last_name || '').trim(),
      email: String(r?.email || '').trim(),
      school_id: String(r?.school_id || '').trim(),
      contact_no: String(r?.contact_no || '').trim(),
      role: String(r?.role || '').trim(),
      department: isDepartmentAdmin ? fixedDeptId : String(r?.department || '').trim(),
      program: String(r?.program || '').trim()
    }));
  };

  const buildImportErrorMap = (errs) => {
    const map = {};
    (Array.isArray(errs) ? errs : []).forEach((err) => {
      const rowNum = Number(err?.row || 0);
      if (!rowNum) return;
      if (!Array.isArray(map[rowNum])) map[rowNum] = [];
      map[rowNum].push(prettifyImportErrorMessage(err?.message || err?.error || 'Invalid data'));
    });
    return map;
  };

  const buildAdminImportErrors = (rows) => {
    const errors = [];
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      if (isAdminRoleValue(row?.role)) {
        errors.push({ row: row?._row, message: 'Admin role is not allowed.' });
      }
      if (isDepartmentAdmin) {
        const roleId = resolveRoleIdValue(row?.role);
        if (roleId && ![3, 4, 5].includes(roleId)) {
          errors.push({ row: row?._row, message: 'Department admin can only import Program Head, Secretary, and Teacher users.' });
        }
        if (!fixedDeptId) {
          errors.push({ row: row?._row, message: 'Your account has no assigned department.' });
        }
      }
    });
    return errors;
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const showImportIssuesSwal = async (errs, title = 'Validation issues') => {
    const issueList = (Array.isArray(errs) ? errs : []).slice(0, 20);
    if (!issueList.length) return;
    const rowsHtml = issueList.map((err, idx) => {
      const rowNum = err?.row || (idx + 1);
      const msg = prettifyImportErrorMessage(err?.message || err?.error || 'Invalid data');
      return `<li>Row ${escapeHtml(rowNum)}: ${escapeHtml(msg)}</li>`;
    }).join('');
    await safeSwal({
      icon: 'warning',
      title,
      html: `<div style="text-align:left"><div style="margin-bottom:8px">Please fix these rows first:</div><ul style="margin:0;padding-left:18px">${rowsHtml}</ul></div>`
    });
  };

  const totalImportPages = React.useMemo(() => {
    return Math.max(1, Math.ceil(importDraftRows.length / IMPORT_PAGE_SIZE));
  }, [importDraftRows.length, IMPORT_PAGE_SIZE]);

  React.useEffect(() => {
    if (importPage <= totalImportPages) return;
    setImportPage(totalImportPages);
  }, [importPage, totalImportPages]);

  const pagedImportDraftRows = React.useMemo(() => {
    const start = (importPage - 1) * IMPORT_PAGE_SIZE;
    return importDraftRows.slice(start, start + IMPORT_PAGE_SIZE).map((row, offset) => ({
      row,
      globalIndex: start + offset
    }));
  }, [importDraftRows, importPage, IMPORT_PAGE_SIZE]);

  const inferImportErrorFields = (messages) => {
    const fields = new Set();
    (Array.isArray(messages) ? messages : []).forEach((msg) => {
      const text = String(msg || '').toLowerCase();
      if (!text) return;
      if (text.includes('missing required fields')) {
        ['first_name', 'last_name', 'email', 'school_id', 'role'].forEach(f => fields.add(f));
      }
      if (text.includes('first_name') || text.includes('first name')) fields.add('first_name');
      if (text.includes('last_name') || text.includes('last name')) fields.add('last_name');
      if (text.includes('email')) fields.add('email');
      if (text.includes('school id') || text.includes('school_id') || text.includes('id_number')) fields.add('school_id');
      if (text.includes('contact')) fields.add('contact_no');
      if (text.includes('role')) fields.add('role');
      if (text.includes('department')) fields.add('department');
      if (text.includes('program') || text.includes('assigned')) fields.add('program');
    });
    return fields;
  };

  const runImportPreview = async (draftRows) => {
    const seq = ++importPreviewSeq.current;
    const importPath = 'users/impor' + 't';
    const payloadRows = buildImportPayloadRows(draftRows);
    const adminErrs = buildAdminImportErrors(draftRows);
    const preview = await apiPost(importPath, { rows: payloadRows, preview: true });
    const inserted = Number(preview?.inserted || 0);
    const skipped = Number(preview?.skipped || 0);
    const total = Number(preview?.total || payloadRows.length);
    const errs = (Array.isArray(preview?.errors) ? preview.errors : []).concat(adminErrs);
    const rowErrMap = buildImportErrorMap(errs);

    if (seq === importPreviewSeq.current) {
      setImportSummary({ mode: 'preview', inserted, skipped, total });
      setImportErrors(errs);
      setImportDraftSummary({ mode: 'preview', inserted, skipped, total });
      setImportRowErrors(rowErrMap);
    }

    return { inserted, skipped, total, errors: errs, rowErrMap };
  };

  const closeImportModal = (force = false) => {
    if (importProcessing && !force) return;
    setShowImportModal(false);
    setImportDraftRows([]);
    setImportRowErrors({});
    setImportDraftSummary(null);
    setImportFileName('');
    setImportPage(1);
  };

  const handleImportCellChange = (rowIndex, field, value) => {
    let nextValue = value;
    if (field === 'contact_no') nextValue = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (field === 'school_id') nextValue = String(value || '').replace(/[^0-9\-]/g, '');
    setImportDraftRows(prev => prev.map((row, idx) => (idx === rowIndex ? { ...row, [field]: nextValue } : row)));
  };

  React.useEffect(() => {
    if (!showImportModal) return;
    if (!importDraftRows.length) return;
    if (importProcessing) return;
    if (importAutoValidateTimerRef.current) {
      clearTimeout(importAutoValidateTimerRef.current);
      importAutoValidateTimerRef.current = null;
    }
    importAutoValidateTimerRef.current = setTimeout(() => {
      runImportPreview(importDraftRows).catch((err) => {
        console.error('Auto-validate failed', err);
      });
    }, 600);
    return () => {
      if (importAutoValidateTimerRef.current) {
        clearTimeout(importAutoValidateTimerRef.current);
        importAutoValidateTimerRef.current = null;
      }
    };
  }, [importDraftRows, showImportModal, importProcessing]);

  const handleImportDraftValidate = async () => {
    if (!importDraftRows.length) {
      setError('No rows to validate.');
      return;
    }
    setImportProcessing(true);
    setError('');
    try {
      const previewMeta = await runImportPreview(importDraftRows);
      if (previewMeta.errors.length > 0) {
        await showImportIssuesSwal(previewMeta.errors, 'Validation issues');
      }
    } catch (err) {
      console.error(err);
      setError(err?.body?.message || err?.body?.error || err?.message || 'Failed to validate import rows');
    } finally {
      setImportProcessing(false);
    }
  };

  const handleImportDraftSubmit = async () => {
    if (!importDraftRows.length) {
      setError('No rows to import.');
      return;
    }
    setImportProcessing(true);
    setError('');
    try {
      const previewMeta = await runImportPreview(importDraftRows);
      if (previewMeta.errors.length > 0) {
        await showImportIssuesSwal(previewMeta.errors, 'Cannot import yet');
        return;
      }

      const importPath = 'users/impor' + 't';
      const payloadRows = buildImportPayloadRows(importDraftRows);
      const result = await apiPost(importPath, { rows: payloadRows });
      const inserted = Number(result?.inserted || 0);
      const skipped = Number(result?.skipped || 0);
      const total = Number(result?.total || payloadRows.length);
      const errs = Array.isArray(result?.errors) ? result.errors : [];
      const rowErrMap = buildImportErrorMap(errs);
      const emailSent = Number(result?.email_notifications?.sent || 0);
      const emailFailed = Number(result?.email_notifications?.failed || 0);

      setImportSummary({ mode: 'imported', inserted, skipped, total });
      setImportErrors(errs);
      setImportDraftSummary({ mode: 'imported', inserted, skipped, total });
      setImportRowErrors(rowErrMap);

      if (errs.length > 0) {
        await showImportIssuesSwal(errs, 'Import completed with issues');
        return;
      }

      await fetchUsers();
      closeImportModal(true);
      if (inserted > 0) {
        try {
          if (emailFailed > 0) {
            await safeSwal({
              icon: 'warning',
              title: 'Import completed',
              text: `${inserted} user(s) imported. ${emailSent} email(s) sent, ${emailFailed} failed. Default password is School ID.`,
            });
          } else {
            await safeSwal({
              icon: 'success',
              title: 'Import completed',
              text: `${inserted} user(s) imported. Default password is School ID.`,
              timer: 1600,
              showConfirmButton: false
            });
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error(err);
      setError(err?.body?.message || err?.body?.error || err?.message || 'Failed to import users');
    } finally {
      setImportProcessing(false);
    }
  };

  const handleImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setImportSummary(null);
    setImportErrors([]);
    try {
      const rows = await parseSpreadsheet(file);
      const cleaned = rows.filter(r => Object.values(r || {}).some(v => String(v ?? '').trim() !== ''));
      if (!cleaned.length) {
        setError('No data rows found in the spreadsheet.');
        return;
      }
      const draftRows = mapRowsToImportDraft(cleaned);
      setImportDraftRows(draftRows);
      setImportFileName(file.name || '');
      setImportPage(1);
      setShowImportModal(true);

      const previewMeta = await runImportPreview(draftRows);
      if (previewMeta.errors.length > 0) {
        await showImportIssuesSwal(previewMeta.errors, 'Preview validation issues');
      } else if (previewMeta.inserted <= 0) {
        setError('No valid rows to import after preview checks.');
      }
    } catch (err) {
      console.error(err);
      setError(err?.body?.message || err?.body?.error || err?.message || 'Failed to import users');
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  React.useEffect(() => {
    let timer = null;
    let stopped = false;

    const pollUsers = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try { await fetchUsers(); } catch (e) { /* handled inside fetchUsers */ }
    };

    // Poll every 15 seconds for updates (HTTP/HTTPS polling)
    timer = setInterval(pollUsers, 15000);

    const onVisibility = () => { if (!stopped) pollUsers(); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, []);

  const filtersBar = React.useMemo(() => (
    React.createElement('div', { className: 'flex flex-col sm:flex-row gap-3 mb-4 items-center user-management-filters' },
      React.createElement('input', {
        type: 'search',
        placeholder: 'Search name, email or id...',
        className: 'form-control w-full sm:w-1/3',
        value: searchTerm,
        onChange: e => setSearchTerm(e.target.value)
      }),
      React.createElement('select', {
        className: 'form-select w-full sm:w-1/5',
        value: roleFilter,
        onChange: e => setRoleFilter(e.target.value)
      },
        React.createElement('option', { value: '' }, 'All roles'),
        roleFilterOptions.map(r => React.createElement('option', { key: r.role_id, value: r.role_id }, r.role_name || r.name || r.role_id))
      ),
      React.createElement('select', {
        className: 'form-select w-full sm:w-1/5',
        value: deptFilter,
        onChange: e => setDeptFilter(e.target.value),
        disabled: hasFixedDepartmentScope
      },
        !hasFixedDepartmentScope && React.createElement('option', { value: '' }, 'Department'),
        departmentFilterOptions.map(d => React.createElement('option', { key: d.dept_id, value: d.dept_id }, d.dept_name || d.name || d.dept_id))
      ),
      React.createElement('button', { type: 'button', className: 'btn btn-success', onClick: ()=>{ setSearchTerm(''); setRoleFilter(''); setDeptFilter(hasFixedDepartmentScope ? fixedDeptId : ''); } }, 'Clear')
    )
  ), [searchTerm, roleFilter, deptFilter, roleFilterOptions, departmentFilterOptions, hasFixedDepartmentScope, fixedDeptId]);

  // --- EARLY RETURN: Block Teacher entirely ---
  if (isTeacher) {
    return React.createElement('div', { className: 'container py-5 d-flex justify-content-center align-items-center', style: { minHeight: '50vh'} },
      React.createElement('h2', { className: 'text-danger fw-bold' }, 'Unauthorized Access')
    );
  }

  return (
    React.createElement('div', { className: 'container py-3 user-management-page' },
      React.createElement('div', { className: 'd-flex justify-content-between align-items-center mb-3 user-management-header' },
        React.createElement('h2', { className: 'mb-0 fw-bold fs-3' }, 'User Management'),
        
        canManageUsers ? React.createElement('div', { className: 'd-flex gap-2 user-management-actions' },
          canManageUsers && React.createElement('button', {
            className: 'btn btn-outline-primary',
            onClick: ()=> fileInputRef.current && fileInputRef.current.click(),
            disabled: importing
          }, importing ? 'Importing...' : 'Import Excel'),
          React.createElement('button', { className: 'btn btn-success', onClick: openModal, disabled: importing }, 'Add New User'),
          canManageUsers && React.createElement('input', {
            ref: fileInputRef,
            type: 'file',
            accept: '.xlsx,.xls,.csv',
            onChange: handleImportFile,
            style: { display: 'none' }
          })
        ) : null
      ),
      (!isAdmin && isProgramHead) && React.createElement(
        'div',
        { className: 'alert alert-info py-2' },
        'View-only access: You can only view teachers assigned to your program and department.'
      ),

      error && React.createElement('div', { className: 'alert alert-danger py-2' }, error),
      importSummary && React.createElement(
        'div',
        { className: `alert py-2 ${importErrors.length ? 'alert-warning' : 'alert-success'}` },
        `${importSummary.mode === 'preview' ? 'Preview summary' : 'Import summary'}: ${importSummary.inserted} valid, ${importSummary.skipped} skipped, ${importSummary.total} total rows. ${importSummary.mode === 'preview' ? 'No rows imported yet.' : 'Default password is School ID.'}`
      ),

      React.createElement(StatisticsBoxs, { items: statsItems, activeKey: effectiveStatusFilter, onSelect: handleStatusSelect, className: 'mb-4' }),
      filtersBar,
      React.createElement(Table, { columns: columns, data: filteredUsers, pageSize: 10, loading: loading, emptyText: 'No users found', horizontalScroll: true, wrapCells: true, className: 'user-table responsive-table', onRowClick: canManageUsers ? (u) => handleEdit(u) : null }),

      React.createElement(Modal, { show: showImportModal, title: 'Import Users (Preview & Edit)', size: 'xxl', onClose: closeImportModal, closeOnBackdrop: !importProcessing },
        React.createElement('div', { className: 'd-flex flex-wrap justify-content-between align-items-start gap-3 mb-3' },
          React.createElement('div', null,
            React.createElement('div', { className: 'fw-semibold' }, importFileName ? `File: ${importFileName}` : 'File: Imported spreadsheet'),
            React.createElement('div', { className: 'small text-muted' }, 'Rows with validation problems are highlighted in red. Edit them, then click Validate.')
          ),
          importDraftSummary && React.createElement('div', { className: `alert py-2 px-3 mb-0 ${Object.keys(importRowErrors || {}).length ? 'alert-warning' : 'alert-success'}` },
            `${importDraftSummary.mode === 'preview' ? 'Preview' : 'Import'}: ${importDraftSummary.inserted} valid, ${importDraftSummary.skipped} skipped, ${importDraftSummary.total} total`
          )
        ),
        isDepartmentAdmin && React.createElement('div', { className: 'alert alert-info py-2 small mb-3' },
          `Department admin import is restricted to ${fixedDeptLabel || 'your assigned department'} and allowed roles only.`
        ),
        React.createElement('div', { className: 'table-responsive border rounded', style: { maxHeight: '520px', overflow: 'auto' } },
          React.createElement('table', { className: 'table table-sm align-middle mb-0' },
            React.createElement('thead', { className: 'table-light' },
              React.createElement('tr', null,
                React.createElement('th', { style: { minWidth: 70 } }, 'Row'),
                React.createElement('th', { style: { minWidth: 140 } }, 'First Name'),
                React.createElement('th', { style: { minWidth: 140 } }, 'Last Name'),
                React.createElement('th', { style: { minWidth: 210 } }, 'Email'),
                React.createElement('th', { style: { minWidth: 140 } }, 'School ID'),
                React.createElement('th', { style: { minWidth: 140 } }, 'Contact'),
                React.createElement('th', { style: { minWidth: 130 } }, 'Role'),
                React.createElement('th', { style: { minWidth: 160 } }, 'Department'),
                React.createElement('th', { style: { minWidth: 160 } }, 'Program'),
                React.createElement('th', { style: { minWidth: 260 } }, 'Validation')
              )
            ),
            React.createElement('tbody', null,
              importDraftRows.length === 0
                ? React.createElement('tr', null,
                    React.createElement('td', { colSpan: 10, className: 'text-center text-muted py-4' }, 'No rows loaded')
                  )
                : pagedImportDraftRows.map(({ row, globalIndex }) => {
                    const rowMessages = importRowErrors?.[row._row] || [];
                    const errorFields = inferImportErrorFields(rowMessages);
                    const rowClass = rowMessages.length ? 'table-danger' : '';
                    const fieldClass = (fieldName) => `form-control form-control-sm ${errorFields.has(fieldName) ? 'is-invalid border-danger' : ''}`;
                    return React.createElement('tr', { key: `import-row-${row._row}-${globalIndex}`, className: rowClass },
                      React.createElement('td', { className: 'fw-semibold' }, row._row),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('first_name'),
                          value: row.first_name || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'first_name', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('last_name'),
                          value: row.last_name || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'last_name', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('email'),
                          value: row.email || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'email', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('school_id'),
                          value: row.school_id || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'school_id', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('contact_no'),
                          value: row.contact_no || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'contact_no', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('role'),
                          value: row.role || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'role', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: `${fieldClass('department')} ${isDepartmentAdmin ? 'bg-light' : ''}`,
                          value: isDepartmentAdmin ? fixedDeptLabel : (row.department || ''),
                          disabled: isDepartmentAdmin,
                          title: isDepartmentAdmin ? 'Fixed to your assigned department' : undefined,
                          onChange: (e) => handleImportCellChange(globalIndex, 'department', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        React.createElement('input', {
                          type: 'text',
                          className: fieldClass('program'),
                          value: row.program || '',
                          onChange: (e) => handleImportCellChange(globalIndex, 'program', e.target.value)
                        })
                      ),
                      React.createElement('td', null,
                        rowMessages.length
                          ? React.createElement('ul', { className: 'mb-0 ps-3 text-danger small' },
                              rowMessages.map((msg, msgIdx) =>
                                React.createElement('li', { key: `import-msg-${row._row}-${msgIdx}` }, msg)
                              )
                            )
                          : React.createElement('span', { className: 'text-success small fw-semibold' }, 'OK')
                      )
                    );
                  })
            )
          )
        ),
        importDraftRows.length > 0 && React.createElement('div', { className: 'd-flex justify-content-between align-items-center mt-2 flex-wrap gap-2' },
          React.createElement('div', { className: 'small text-muted' },
            `Showing ${((importPage - 1) * IMPORT_PAGE_SIZE) + 1}-${Math.min(importPage * IMPORT_PAGE_SIZE, importDraftRows.length)} of ${importDraftRows.length} row(s)`
          ),
          React.createElement('div', { className: 'd-flex align-items-center gap-2' },
            React.createElement('button', {
              type: 'button',
              className: 'btn btn-sm btn-light',
              disabled: importPage <= 1 || importProcessing,
              onClick: () => setImportPage(p => Math.max(1, p - 1))
            }, 'Prev'),
            React.createElement('span', { className: 'small text-muted' }, `Page ${importPage} of ${totalImportPages}`),
            React.createElement('button', {
              type: 'button',
              className: 'btn btn-sm btn-light',
              disabled: importPage >= totalImportPages || importProcessing,
              onClick: () => setImportPage(p => Math.min(totalImportPages, p + 1))
            }, 'Next')
          )
        ),
        React.createElement('div', { className: 'd-flex justify-content-between align-items-center mt-3 flex-wrap gap-2' },
          React.createElement('div', { className: 'small text-muted' },
            `${Object.keys(importRowErrors || {}).length} row(s) with errors`
          ),
          React.createElement('div', { className: 'd-flex gap-2' },
            React.createElement('button', { type: 'button', className: 'btn btn-light', onClick: closeImportModal, disabled: importProcessing }, 'Close'),
            React.createElement('button', { type: 'button', className: 'btn btn-outline-primary', onClick: handleImportDraftValidate, disabled: importProcessing || importDraftRows.length === 0 }, importProcessing ? 'Validating...' : 'Validate'),
            React.createElement('button', { type: 'button', className: 'btn btn-success', onClick: handleImportDraftSubmit, disabled: importProcessing || importDraftRows.length === 0 }, importProcessing ? 'Processing...' : 'Import Users')
          )
        )
      ),

      React.createElement(Modal, { show: showModal, title: form.user_id ? 'Edit User' : 'Add New User', size: 'md', onClose: closeModal },
        React.createElement('form', { onSubmit: handleSubmit },
          form.user_id && React.createElement('div', { className: 'mb-3 d-flex align-items-center gap-3' },
            React.createElement('img', {
              src: editImageUrl || '/src/assets/unknown.jpg',
              alt: `${form.first_name || ''} ${form.last_name || ''}`.trim() || 'User image',
              style: { width: 72, height: 72, borderRadius: '50%', objectFit: 'cover', border: '1px solid #ddd' }
            }),
            React.createElement('div', null,
              React.createElement('div', { className: 'fw-semibold' }, `${form.first_name || ''} ${form.last_name || ''}`.trim() || 'User'),
              React.createElement('div', { className: 'small text-muted' }, form.email || '')
            )
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'First Name'),
            React.createElement('input', { type: 'text', name: 'first_name', value: form.first_name, onChange: handleChange, className: 'form-control', required: true })
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Last Name'),
            React.createElement('input', { type: 'text', name: 'last_name', value: form.last_name, onChange: handleChange, className: 'form-control', required: true })
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'ID Number'),
            React.createElement('input', { type: 'text', name: 'id_number', value: form.id_number, onChange: handleChange, className: 'form-control', placeholder: 'e.g. 24-018-F', pattern: '\\d{2}-\\d{3}-[A-Za-z]', required: true })
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Email'),
            React.createElement('input', { type: 'email', name: 'email', value: form.email, onChange: handleChange, className: 'form-control', required: true, pattern: '[A-Za-z0-9._%+\\-]+@phinmaed\\.com', title: 'Use a @phinmaed.com email address' })
          ),
          !form.user_id && React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Password'),
            React.createElement('input', { type: 'password', name: 'password', value: form.password, onChange: handleChange, className: 'form-control', required: true })
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Contact No'),
            React.createElement('input', { type: 'text', name: 'contact_no', value: form.contact_no, onChange: handleChange, className: 'form-control', placeholder: 'e.g. 09123456789', inputMode: 'numeric', pattern: '09[0-9]+' , maxLength: 11 })
          ),
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Role'),
            React.createElement('select', { name: 'role_id', value: form.role_id, onChange: handleChange, className: 'form-select', required: true },
              React.createElement('option', { value: '' }, 'Select role'),
              roleFilterOptions.map(r => React.createElement('option', { key: r.role_id, value: r.role_id }, r.role_name))
            ),
            isAdmin && React.createElement('button', { type: 'button', className: 'btn btn-sm btn-outline-secondary mt-2 w-100', onClick: openAddRoleModal }, 'Add Role')
          ),
          String(form.role_id) !== '1' && (
            React.createElement('div', { className: 'mb-3' },
              React.createElement('div', { className: 'd-flex align-items-center justify-content-between gap-2 mb-1' },
                React.createElement('label', { className: 'form-label mb-0' }, 'Department'),
                isAdmin && React.createElement('button', { type: 'button', className: 'btn btn-sm btn-outline-success', onClick: openAddDeptModal }, 'Add New Dept')
              ),
              React.createElement('select', { value: form.dept_id || '', onChange: handleChange, name: 'dept_id', className: 'form-select', required: String(form.role_id) !== '1', disabled: isDepartmentAdmin },
                React.createElement('option', { value: '' }, 'Select Department'),
                (departmentOptionsForForm || []).map(d => React.createElement('option', { key: d.dept_id, value: d.dept_id }, d.dept_name || d.dept_id))
              )
            )
          ),
          roleNeedsProgram(form.role_id) && (
            React.createElement('div', { className: 'mb-3' },
              React.createElement('label', { className: 'form-label' }, String(form.role_id) === '3' ? 'Owned Program' : 'Assigned Program'),
              React.createElement('select', { value: form.assigned_program_head_id || '', onChange: handleChange, name: 'assigned_program_head_id', className: 'form-select', required: true, disabled: !form.dept_id },
                React.createElement('option', { value: '' }, form.dept_id ? 'Select Program' : 'Select Department first'),
                (programHeads || []).map(ph => React.createElement('option', { key: ph.id, value: ph.id }, ph.label))
              )
            )
          ),

          error && React.createElement('div', { className: 'alert alert-danger py-2' }, error),

          React.createElement('div', { className: 'd-flex justify-content-end gap-2 mt-3' },
            React.createElement('button', { type: 'button', className: 'btn btn-secondary', onClick: closeModal }, 'Cancel'),
            React.createElement('button', { type: 'submit', className: 'btn btn-success', disabled: loading }, loading? 'Saving...':'Save User')
          )
        )
      ),

      React.createElement(Modal, { show: showAddRoleModal, title: 'Add New Role', size: 'sm', onClose: closeAddRoleModal },
        React.createElement('form', { onSubmit: handleAddRoleSubmit },
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Role Name'),
            React.createElement('input', { type: 'text', name: 'role_name', value: addRoleForm.role_name, onChange: handleAddRoleChange, className: 'form-control', placeholder: 'e.g., Coordinator, Supervisor', required: true, autoFocus: true })
          ),
          addRoleError && React.createElement('div', { className: 'alert alert-danger py-2 mb-3' }, addRoleError),
          React.createElement('div', { className: 'd-flex justify-content-end gap-2' },
            React.createElement('button', { type: 'button', className: 'btn btn-secondary', onClick: closeAddRoleModal, disabled: addRoleLoading }, 'Cancel'),
            React.createElement('button', { type: 'submit', className: 'btn btn-success', disabled: addRoleLoading }, addRoleLoading ? 'Creating...' : 'Create Role')
          )
        )
      ),

      React.createElement(Modal, { show: showAddDeptModal, title: 'Add New Department', size: 'sm', onClose: closeAddDeptModal },
        React.createElement('form', { onSubmit: handleAddDeptSubmit },
          React.createElement('div', { className: 'mb-3' },
            React.createElement('label', { className: 'form-label' }, 'Department Name'),
            React.createElement('input', { type: 'text', name: 'dept_name', value: addDeptForm.dept_name, onChange: handleAddDeptChange, className: 'form-control', placeholder: 'e.g., Computer Studies', required: true, autoFocus: true })
          ),
          addDeptError && React.createElement('div', { className: 'alert alert-danger py-2 mb-3' }, addDeptError),
          React.createElement('div', { className: 'd-flex justify-content-end gap-2' },
            React.createElement('button', { type: 'button', className: 'btn btn-secondary', onClick: closeAddDeptModal, disabled: addDeptLoading }, 'Cancel'),
            React.createElement('button', { type: 'submit', className: 'btn btn-success', disabled: addDeptLoading }, addDeptLoading ? 'Creating...' : 'Create Department')
          )
        )
      )
    )
  );
}
