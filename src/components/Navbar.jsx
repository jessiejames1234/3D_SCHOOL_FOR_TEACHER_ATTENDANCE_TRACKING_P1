import React, { useState, useEffect, useContext, useRef } from 'react';
import { AuthContext } from "../context/AuthContext.jsx";
import { canAccessModule, resolveRoleName as resolveRoleNameUtil } from "../utils/moduleAccess.js";

// Fallback avatar path that works on localhost subfolder deployments (e.g. /3D1.2)
const unknownImg = (() => {
  try {
    if (typeof window === 'undefined') return '/src/assets/unknown.jpg';
    const parts = window.location.pathname.split('/').filter(Boolean);
    let projectRoot = '';
    if (parts.length) {
      const first = String(parts[0]).toLowerCase();
      if (first !== 'public') projectRoot = '/' + parts[0];
    }
    return projectRoot + '/src/assets/unknown.jpg';
  } catch (e) {
    return '/src/assets/unknown.jpg';
  }
})();

export default function Navbar() {
  const { user, logout, login } = useContext(AuthContext);
  
  // State
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentHash, setCurrentHash] = useState(window.location.hash.slice(1) || '/home');
  const [menuOpen, setMenuOpen] = useState(false);
  const [openSubmenus, setOpenSubmenus] = useState({}); // Tracks expanded menus
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifLoaded, setNotifLoaded] = useState(false);
  const [notificationActioning, setNotificationActioning] = useState(false);
  const [notificationFilter, setNotificationFilter] = useState('all');

  // Profile State
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState(user || null);
  const [uploading, setUploading] = useState(false);
  const [profileForm, setProfileForm] = useState({ first_name: '', last_name: '', email: '', contact_no: '' });
  const [notificationAgeTick, setNotificationAgeTick] = useState(Date.now());

  // Avoid repeated profile fetches for the same user
  const fetchedProfileFor = React.useRef(null);
  const notificationPanelRef = useRef(null);

  const unreadNotifications = notifLoaded
    ? unreadCount
    : ((profileData && (profileData.unread_notifications || profileData.notifications_count || 0)) || 0);
  const profileUserId = user && (user.user_id || user.id || user.userId) ? (user.user_id || user.id || user.userId) : null;
  const notificationUserId = profileUserId;
  const canEditProfileContact = Boolean(profileUserId);
  const isOnNotificationRoute = String(currentHash || '').toLowerCase().includes('notification');
  const shouldAnimateNotificationBell = unreadNotifications > 0 && !notificationOpen && !isOnNotificationRoute;
  const filteredNotifications = notificationFilter === 'unread'
    ? notifications.filter((n) => Number(n?.is_read || 0) === 0)
    : notifications;

  // --- 1. DATA & SYNC LOGIC (Kept Exact) ---

  useEffect(() => { setProfileData(user || null); }, [user]);

  useEffect(() => {
    setProfileForm({
      first_name: (profileData && profileData.first_name) || '',
      last_name: (profileData && profileData.last_name) || '',
      email: (profileData && profileData.email) || '',
      contact_no: (profileData && profileData.contact_no) || '',
    });
  }, [profileData]);

  // Helper to build server-php API URLs that work for both localhost subfolder and devtunnel/public origins
  const buildServerPhpUrl = (p) => {
    try {
      if (typeof window === 'undefined') return '/server-php/api/' + p.replace(/^\/?/, '');
      if (window.API_BASE) {
        // window.API_BASE may be like 'https://host/.../server-php/index.php/api'
        return String(window.API_BASE).replace(/\/index\.php\/api\/?$/, '') + '/api/' + String(p).replace(/^\/?/, '');
      }
      const origin = window.location.origin.replace(/\/+$/, '');
      const parts = window.location.pathname.split('/').filter(Boolean);
      let projectRoot = '';
      if (parts.length) {
        const first = String(parts[0]).toLowerCase();
        if (first !== 'public') projectRoot = '/' + parts[0];
      }
      return origin + projectRoot + '/server-php/api/' + String(p).replace(/^\/?/, '');
    } catch (e) {
      return '/server-php/api/' + String(p).replace(/^\/?/, '');
    }
  };

  // Build routed API URLs (server-php/index.php/api/...) for endpoints handled by index.php
  const buildIndexApiUrl = (p) => {
    try {
      if (typeof window === 'undefined') return '/server-php/index.php/api/' + p.replace(/^\/?/, '');
      if (window.API_BASE) {
        return String(window.API_BASE).replace(/\/+$/, '') + '/' + String(p).replace(/^\/?/, '');
      }
      const origin = window.location.origin.replace(/\/+$/, '');
      const parts = window.location.pathname.split('/').filter(Boolean);
      let projectRoot = '';
      if (parts.length) {
        const first = String(parts[0]).toLowerCase();
        if (first !== 'public') projectRoot = '/' + parts[0];
      }
      return origin + projectRoot + '/server-php/index.php/api/' + String(p).replace(/^\/?/, '');
    } catch (e) {
      return '/server-php/index.php/api/' + String(p).replace(/^\/?/, '');
    }
  };

  const getAuthToken = () => {
    try { return localStorage.getItem('token') || ''; } catch (e) { return ''; }
  };

  const getAuthHeaders = () => {
    const token = getAuthToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const resetProfileEditor = () => {
    setProfileForm({
      first_name: (profileData && profileData.first_name) || '',
      last_name: (profileData && profileData.last_name) || '',
      email: (profileData && profileData.email) || '',
      contact_no: (profileData && profileData.contact_no) || '',
    });
  };

  const applyProfileUpdate = (nextUser) => {
    if (!nextUser) return;
    const merged = { ...(user || {}), ...(profileData || {}), ...nextUser };
    setProfileData(merged);
    try { if (login) login(merged); } catch (e) {}
  };

  const normalizeNotificationLink = (rawLink) => {
    let link = String(rawLink || '').trim();
    if (!link) return '/dashboard';
    if (link.startsWith('#')) link = link.slice(1);
    if (!link.startsWith('/')) link = '/' + link;
    return link;
  };

  const formatNotificationTime = (createdAt) => {
    if (!createdAt) return '';
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return String(createdAt);
    return dt.toLocaleString();
  };

  // Timer refreshes every 1 minute (no socket), based on local clock.
  const formatNotificationAge = (createdAt) => {
    if (!createdAt) return '';
    const dt = new Date(createdAt);
    if (Number.isNaN(dt.getTime())) return '';
    const baseMs = Number(notificationAgeTick || Date.now());
    let seconds = Math.floor((baseMs - dt.getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds <= 0) seconds = 1;
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}m`;
    const years = Math.floor(days / 365);
    return `${years}y`;
  };

  const cleanNotificationText = (txt) => {
    return String(txt || '').replace(/\s?#\d+\b/g, '').trim();
  };

  const inferActorNameFromMessage = (message) => {
    const msg = cleanNotificationText(message || '');
    if (!msg) return '';
    const m = msg.match(/^([A-Za-z][A-Za-z .'-]{1,80}?)\s+(requested|requests|approved|rejected|created|submitted|filed|assigned|updated|cancelled|canceled)\b/i);
    return m ? cleanNotificationText(m[1]) : '';
  };

  const getNotificationActorName = (notif) => {
    const fromActor = cleanNotificationText(notif?.actor_name || '');
    if (fromActor) return fromActor;
    const fromMessage = inferActorNameFromMessage(notif?.message || '');
    if (fromMessage) return fromMessage;
    const fromTitle = cleanNotificationText(notif?.title || '');
    return fromTitle || 'Notification';
  };

  const fetchNotifications = React.useCallback(async (silent = true) => {
    try {
      const token = getAuthToken();
      if (!notificationUserId || !token) {
        setNotifications([]);
        setUnreadCount(0);
        setNotifLoaded(true);
        return;
      }
      if (!silent) setNotificationsLoading(true);

      const res = await fetch(buildIndexApiUrl('notification?limit=10'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Failed to load notifications (${res.status})`);
      const payload = await res.json();
      const list = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.notifications) ? payload.notifications : []);
      setNotifications(list);
      const unread = Number(payload?.unread_count);
      setUnreadCount(Number.isFinite(unread) ? unread : list.filter((n) => Number(n?.is_read || 0) === 0).length);
      setNotificationsError('');
      setNotifLoaded(true);
    } catch (e) {
      if (!silent) setNotificationsError('Failed to load notifications');
      console.warn('[Navbar] notifications fetch error', e);
    } finally {
      if (!silent) setNotificationsLoading(false);
    }
  }, [notificationUserId]);

  // Fetch full profile once when user becomes available. Guard so we don't refetch repeatedly
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user) return;
        const uid = user.user_id || user.id || user.userId || null;
        if (!uid) return;
        // If we've already fetched for this user, skip
        if (fetchedProfileFor.current === uid) return;

        // If local stored user already has role and avatar, avoid fetching
        let stored = null;
        try { stored = JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { stored = null; }
        if (stored && stored.user_id == uid && stored.role_id && stored.avatar) {
          fetchedProfileFor.current = uid;
          return;
        }

        const url = buildServerPhpUrl(`user_profile.php?user_id=${uid}`);
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!alive) return;
        if (!res.ok) { console.warn('[Navbar] profile fetch failed', res.status); return; }
        const j = await res.json();
        if (j && j.user) {
          setProfileData(j.user);
          // Only update AuthContext if profile differs to avoid triggering context-loop
          const storedRaw = localStorage.getItem('user');
          let storedObj = null; try { storedObj = storedRaw ? JSON.parse(storedRaw) : null; } catch(e){ storedObj = null; }
          const needsLoginUpdate = !storedObj || Number(storedObj.role_id || -1) !== Number(j.user.role_id || -1) || storedObj.avatar !== j.user.avatar;
          if (needsLoginUpdate && typeof login === 'function') {
            login(j.user);
          }
        }
        fetchedProfileFor.current = uid;
      } catch (e) { console.error('[Navbar] profile fetch error', e); }
    })();
    return () => { alive = false; };
  }, [user, login]);

  useEffect(() => {
    const onHash = () => setCurrentHash(window.location.hash.slice(1) || '/home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setNotificationAgeTick(Date.now());
    }, 300000);
    return () => window.clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!notificationUserId) {
      setNotifications([]);
      setUnreadCount(0);
      setNotifLoaded(false);
      return;
    }

    fetchNotifications(true);
    const poller = window.setInterval(() => {
      fetchNotifications(true);
    }, 5000);
    return () => window.clearInterval(poller);
  }, [notificationUserId, fetchNotifications]);

  useEffect(() => {
    const onDocMouseDown = (event) => {
      if (!notificationPanelRef.current) return;
      if (!notificationPanelRef.current.contains(event.target)) {
        setNotificationOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const ensureSwalLoaded = async () => {
    if (typeof window === 'undefined' || window.Swal) return;
    if (!document.querySelector('link[data-swal]')) {
      const l = document.createElement('link'); l.rel='stylesheet'; l.href='https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css'; l.setAttribute('data-swal','1'); document.head.appendChild(l);
    }
    if (document.querySelector('script[data-swal]')) {
      const existing = document.querySelector('script[data-swal]');
      await new Promise((resolve,reject)=>{ existing.addEventListener('load',()=>resolve()); existing.addEventListener('error',()=>reject()); });
      if (window.Swal) return;
    }
    await new Promise((resolve,reject)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js'; s.async=true; s.setAttribute('data-swal','1'); s.onload=()=>resolve(); s.onerror=()=>reject(); document.head.appendChild(s); });
  };

  const handleLogout = async () => {
    try {
      await ensureSwalLoaded();
      try { if (window.Swal) await window.Swal.fire({ toast:true, position:'top', icon:'success', title: 'Logged out', showConfirmButton:false, timer:1200 }); } catch (e) {}
    } catch (e) { try { alert('Logged out'); } catch (e) {} }

    try {
      if (typeof logout === 'function') logout();
      else { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.hash = '#/login'; }
    } catch (e) { localStorage.removeItem('token'); localStorage.removeItem('user'); window.location.hash = '#/login'; }
  };

  // --- 2. NAVIGATION CONFIGURATION ---

  const navItems = [
    { label: "Home", path: "/home", permission: null },
    { label: "Dashboard", path: "/dashboard", permission: 'dashboard' },
    { label: "Users", path: "/users", permission: 'users' },

    // --- MODIFIED: Faculty Portal (Formerly Attendance Logs) ---
    // Permission 'attendance' allows: Dean, Program Head, Secretary, Teacher. (No Admin)
    { label: "Faculty Portal", path: "/faculty-portal", permission: 'attendance', children: [
      { label: "My Dashboard", path: "/faculty-dashboard", permission: 'faculty_dashboard' },
      { label: "Attendance", path: "/attendance", permission: 'attendance' },
      { label: "Attendance History", path: "/attendance-history", permission: 'attendance' },
      { label: "Teaching Schedule", path: "/my-attendance", permission: 'attendance' },
      { label: "Request Edit", path: "/my-requested-edits", permission: 'attendance' },
    ]},
    // ------------------------------------------------------------

    { label: "Attendance Records", path: "/attendancemgmt", permission: 'attendancemgmt' },
    { label: "Attendance Edit Request", path: "/attendance-edit-requests", permission: 'attendance_edits' },
    { label: "Attendance Adjustment Logs", path: "/attendance-logs", permission: 'attendance_logs' },
    { label: "Class Schedules", path: "/class-schedules", permission: 'class_schedules' },
    { label: "Schedule Edit Requests", path: "/schedule-edit-requests", permission: 'schedule_edits' },
    { label: "3D Campus Map", path: "/3d-building", permission: '3d_building' },

    // Grouped: Academic Management
    { label: 'Academic', path: '/academic', permission: null, children: [
      { label: 'Departments', path: '/departments', permission: 'academic_admin' },
      { label: 'Programs', path: '/programs', permission: 'academic_program' },
      { label: 'Sections', path: '/sections', permission: 'academic_manage' },
      { label: 'School Year', path: '/school_year', permission: 'academic_admin' },
      { label: 'Subjects', path: '/subjects', permission: 'academic_manage' },
    ]},

    // Grouped: Facility Management
    { label: 'Facility', path: '/facility', permission: null, children: [
      { label: 'Buildings', path: '/building', permission: 'locations' },
      { label: 'Floors', path: '/floors', permission: 'locations' },
      { label: 'Rooms', path: '/rooms', permission: 'locations' }
    ]},

    { label: 'File Leave', path: '/File_leave', permission: 'leaves_file' },
    { label: "Substitutions", path: "/substitutions", permission: 'substitutions' },
    // { label: "Penalties", path: "/penalties", permission: 'penalties' },
    { label: "Reports", path: "/reports", permission: 'reports' },
    { label: "Audit Trail", path: "/system-logs", permission: 'logs' },
    { label: "Notification", path: "/notifications", permission: null },
    { label: 'General Settings', path: '/settings/system', permission: 'settings' },

  ];

  // RBAC Logic
  const resolveRoleName = (obj) => resolveRoleNameUtil(obj);

  const currentAccessUser = React.useMemo(() => {
    try {
      const fromUser = user && resolveRoleName(user) ? user : null;
      if (fromUser) return fromUser;
      const stored = localStorage.getItem('user');
      if (!stored) return null;
      const parsed = JSON.parse(stored || '{}');
      return resolveRoleName(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }, [user]);

  const currentRole = resolveRoleName(currentAccessUser);

  // Debugging: log role resolution after access snapshot is resolved.
  try {
    console.log('Navbar RBAC debug:', {
      userSnapshot: currentAccessUser || user,
      storedUser: localStorage.getItem('user'),
      resolvedRole: currentRole
    });
    try { window.__NAVBAR_ROLE = { resolvedRole: currentRole, userSnapshot: currentAccessUser || user, storedUser: localStorage.getItem('user') }; } catch(e) {}
  } catch (e) { /* ignore */ }

  // If role couldn't be resolved but we have a user ID, fetch full profile to obtain role info
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!currentRole && user) {
          const uid = user.user_id || user.id || user.userId || null;
          if (!uid) return;
          const url = buildServerPhpUrl(`user_profile.php?user_id=${uid}`);
          console.log('[Navbar] fetching profile for user_id=', uid, 'url=', url);
          const res = await fetch(url, { headers: getAuthHeaders() });
          if (!alive) return;
          if (!res.ok) { console.warn('[Navbar] profile fetch failed status=', res.status); return; }
          const j = await res.json();
          console.log('[Navbar] profile fetch response:', j);
          if (j && j.user) {
            // update AuthContext so role fields propagate
            try { if (login) { login(j.user); try { window.__NAVBAR_ROLE = { resolvedRole: resolveRoleName(j.user), userSnapshot: j.user, storedUser: localStorage.getItem('user') }; } catch(e) {} } } catch (e) { /* ignore */ }
          }
        }
      } catch (e) { console.error('[Navbar] profile fetch error', e); }
    })();
    return () => { alive = false; };
  }, [user, currentRole, login]);

  const canAccess = (perm) => {
    if (!perm) return true;
    if (!currentAccessUser) return false;
    return canAccessModule(currentAccessUser, perm);
  };

  // Compute visible items strictly based on RBAC (no permissive fallback)
  const visibleNavItems = navItems.map(item => {
    if (!item.children) return item;
    const children = item.children.filter(c => canAccess(c.permission));
    return { ...item, children };
  }).filter(item => {
    if (currentRole === 'teacher' && item.path === '/dashboard') return false;
    if (currentRole === 'admin' && ['/file_leave', '/substitutions'].includes(String(item.path || '').toLowerCase())) return false;
    if (!item.permission && item.children) return item.children.length > 0;
    return canAccess(item.permission);
  });

  // --- 3. HELPER FUNCTIONS ---

  const toggleSidebar = () => setSidebarOpen(s => !s);
  const navTo = (path) => { window.location.hash = '#' + path; setSidebarOpen(false); };
  
  const toggleSubmenu = (path) => {
    setOpenSubmenus(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const resolveNavIconKey = (path) => {
    const p = String(path || '').toLowerCase();
    if (p.startsWith('/home')) return 'home';
    if (p.startsWith('/dashboard')) return 'dashboard';
    if (p.startsWith('/faculty-dashboard')) return 'dashboard';
    if (p.startsWith('/users')) return 'users';
    if (p.startsWith('/faculty-portal')) return 'faculty';
    if (p.startsWith('/attendance-edit-requests') || p.startsWith('/my-requested-edits') || p.startsWith('/schedule-edit-requests')) return 'edit_request';
    if (p.startsWith('/attendance-history')) return 'history';
    if (p.startsWith('/attendance-logs') || p.startsWith('/system-logs') || p.startsWith('/logs')) return 'logs';
    if (p.startsWith('/attendance') || p.startsWith('/attendancemgmt') || p.startsWith('/my-attendance')) return 'attendance';
    if (p.startsWith('/class-schedules')) return 'schedule';
    if (p.startsWith('/3d-building')) return 'map3d';
    if (p.startsWith('/academic') || p.startsWith('/programs') || p.startsWith('/departments') || p.startsWith('/sections') || p.startsWith('/school_year') || p.startsWith('/semesters') || p.startsWith('/subjects') || p.startsWith('/subject-offerings')) return 'academic';
    if (p.startsWith('/facility') || p.startsWith('/building') || p.startsWith('/floors') || p.startsWith('/rooms')) return 'facility';
    if (p.startsWith('/file_leave') || p.startsWith('/leave_approval')) return 'leave';
    if (p.startsWith('/substitute') || p.startsWith('/substitutions')) return 'substitute';
    if (p.startsWith('/reports')) return 'reports';
    if (p.startsWith('/notifications')) return 'notification';
    if (p.startsWith('/settings') || p === '/school') return 'settings';
    if (p.startsWith('/penalties')) return 'warning';
    return 'default';
  };

  const NavIcon = ({ path, className = 'w-4 h-4' }) => {
    const iconKey = resolveNavIconKey(path);
    return (
      <svg
        className={`${className} flex-shrink-0`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {iconKey === 'home' && (
          <>
            <path d="M3 11 12 3l9 8" />
            <path d="M5 10v10h14V10" />
            <path d="M10 20v-6h4v6" />
          </>
        )}
        {iconKey === 'dashboard' && (
          <>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="4" rx="1" />
            <rect x="14" y="10" width="7" height="11" rx="1" />
            <rect x="3" y="13" width="7" height="8" rx="1" />
          </>
        )}
        {iconKey === 'users' && (
          <>
            <circle cx="8.5" cy="7" r="3" />
            <path d="M2 20a6.5 6.5 0 0 1 13 0" />
            <path d="M20 8v6" />
            <path d="M23 11h-6" />
          </>
        )}
        {iconKey === 'faculty' && (
          <>
            <rect x="3" y="4" width="18" height="12" rx="2" />
            <path d="M7 20h10" />
            <path d="M12 16v4" />
          </>
        )}
        {iconKey === 'attendance' && (
          <>
            <rect x="6" y="4" width="12" height="16" rx="2" />
            <path d="M9 4.5h6" />
            <path d="m9 12 2 2 4-4" />
            <path d="M9 17h6" />
          </>
        )}
        {iconKey === 'history' && (
          <>
            <path d="M3 3v5h5" />
            <path d="M3.5 8A9 9 0 1 0 6 4.5" />
            <path d="M12 7v5l3 2" />
          </>
        )}
        {iconKey === 'edit_request' && (
          <>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
          </>
        )}
        {iconKey === 'schedule' && (
          <>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4" />
            <path d="M8 3v4" />
            <path d="M3 10h18" />
          </>
        )}
        {iconKey === 'map3d' && (
          <>
            <path d="m12 2 8 4.5v11L12 22 4 17.5v-11L12 2z" />
            <path d="M12 22V11" />
            <path d="m4 6.5 8 4.5 8-4.5" />
          </>
        )}
        {iconKey === 'academic' && (
          <>
            <path d="m2 9 10-5 10 5-10 5-10-5z" />
            <path d="M6 11v4c0 2 2.7 3.5 6 3.5s6-1.5 6-3.5v-4" />
            <path d="M22 9v5" />
          </>
        )}
        {iconKey === 'facility' && (
          <>
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <path d="M9 8h2M13 8h2M9 12h2M13 12h2" />
            <path d="M11 21v-4h2v4" />
          </>
        )}
        {iconKey === 'leave' && (
          <>
            <path d="M7 3h8l2 2v16H7z" />
            <path d="M15 3v3h3" />
            <path d="m10 13 2 2 4-4" />
          </>
        )}
        {iconKey === 'substitute' && (
          <>
            <circle cx="9" cy="7" r="3" />
            <path d="M2 21a7 7 0 0 1 14 0" />
            <path d="M16 5h6" />
            <path d="m19 2 3 3-3 3" />
            <path d="M22 19h-6" />
            <path d="m19 22-3-3 3-3" />
          </>
        )}
        {iconKey === 'reports' && (
          <>
            <path d="M4 20V10" />
            <path d="M10 20V4" />
            <path d="M16 20v-7" />
            <path d="M22 20H2" />
          </>
        )}
        {iconKey === 'notification' && (
          <>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </>
        )}
        {iconKey === 'logs' && (
          <>
            <path d="M7 3h8l4 4v14H7z" />
            <path d="M15 3v4h4" />
            <path d="M10 12h6M10 16h6" />
          </>
        )}
        {iconKey === 'settings' && (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1A1.7 1.7 0 0 0 10 3.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4.7z" />
          </>
        )}
        {iconKey === 'warning' && (
          <>
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10 3 2 19a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 19L14 3a2 2 0 0 0-4 0z" />
          </>
        )}
        {iconKey === 'default' && <circle cx="12" cy="12" r="4" />}
      </svg>
    );
  };

  const markNotificationRead = async (notifId) => {
    const token = getAuthToken();
    if (!token || !notifId) return;
    try {
      await fetch(buildIndexApiUrl(`notification/${notifId}`), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_read: 1 }),
      });
    } catch (e) {
      console.warn('[Navbar] failed to mark notification as read', e);
    }
  };

  const markAllNotificationsRead = async () => {
    const token = getAuthToken();
    if (!token) return;
    setNotificationActioning(true);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      await fetch(buildIndexApiUrl('notification/read-all'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ is_read: 1 }),
      });
    } catch (e) {
      console.warn('[Navbar] failed to mark all notifications as read', e);
    } finally {
      setNotificationActioning(false);
    }
  };

  const confirmNotificationAction = async (title, text, confirmLabel = 'Confirm') => {
    try {
      await ensureSwalLoaded();
      if (window.Swal && typeof window.Swal.fire === 'function') {
        const result = await window.Swal.fire({
          icon: 'warning',
          title,
          text,
          showCancelButton: true,
          confirmButtonColor: '#dc2626',
          confirmButtonText: confirmLabel,
          cancelButtonText: 'Cancel',
        });
        return !!result?.isConfirmed;
      }
    } catch (e) {
      // fallback below
    }
    return window.confirm(text);
  };

  const clearNotifications = async (mode = 'read') => {
    const token = getAuthToken();
    if (!token || notificationActioning) return;

    const isAll = mode === 'all';
    const ok = await confirmNotificationAction(
      isAll ? 'Clear All Notifications?' : 'Clear Read Notifications?',
      isAll
        ? 'This will hide all notifications from the Navbar. They will still appear on the Notifications page.'
        : 'This will hide read notifications from the Navbar. They will still appear on the Notifications page.',
      isAll ? 'Clear All' : 'Clear Read'
    );
    if (!ok) return;

    setNotificationActioning(true);
    try {
      const endpoint = isAll ? 'notification/clear-all' : 'notification/clear-read';
      const res = await fetch(buildIndexApiUrl(endpoint), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to clear notifications (${res.status})`);

      if (isAll) {
        setNotifications([]);
        setUnreadCount(0);
      } else {
        setNotifications((prev) => prev.filter((n) => Number(n?.is_read || 0) === 0));
      }

      try {
        await ensureSwalLoaded();
        if (window.Swal && typeof window.Swal.fire === 'function') {
          window.Swal.fire({
            toast: true,
            position: 'top-end',
            icon: 'success',
            title: isAll ? 'Notifications hidden from Navbar' : 'Read notifications hidden from Navbar',
            showConfirmButton: false,
            timer: 1200,
          });
        }
      } catch (e) {
        // ignore toast failures
      }
    } catch (e) {
      console.warn('[Navbar] clear notifications error', e);
      setNotificationsError('Failed to clear notifications');
      await fetchNotifications(true);
    } finally {
      setNotificationActioning(false);
    }
  };

  const onNotificationItemClick = async (notif) => {
    if (!notif) return;
    const notifId = Number(notif.notif_id || 0);
    const wasUnread = Number(notif.is_read || 0) === 0;
    if (notifId > 0 && wasUnread) {
      setNotifications(prev => prev.map(n => Number(n.notif_id) === notifId ? { ...n, is_read: 1 } : n));
      setUnreadCount(c => Math.max(0, Number(c || 0) - 1));
      await markNotificationRead(notifId);
    }
    setNotificationOpen(false);
    const link = normalizeNotificationLink(notif.link);
    if (link) window.location.hash = '#' + link;
  };

  // Open profile modal and ensure profileData is loaded
  const openProfile = () => {
    setProfileOpen(true);
    // Lazy fetch profile if not present
    (async () => {
      try {
        if (profileData && profileData.user_id) {
          // If dept_name missing but dept_id present, try to resolve department name
          if ((!profileData.dept_name || profileData.dept_name === '') && profileData.dept_id) {
            try {
              const dres = await fetch(buildServerPhpUrl('dashboard.php'), { headers: getAuthHeaders() });
              if (dres.ok) {
                const dj = await dres.json();
                const depts = dj && dj.departments ? dj.departments : (dj && dj.data && dj.data.departments ? dj.data.departments : null);
                if (Array.isArray(depts)) {
                  const found = depts.find(dd => String(dd.dept_id) === String(profileData.dept_id));
                  if (found) setProfileData(p => ({ ...(p||{}), dept_name: found.dept_name }));
                }
              }
            } catch (e) { /* ignore */ }
          }
          return;
        }
        const uid = user && (user.user_id || user.id || user.userId) ? (user.user_id || user.id || user.userId) : null;
        if (!uid) return;
        const res = await fetch(buildServerPhpUrl(`user_profile.php?user_id=${uid}`), { headers: getAuthHeaders() });
        if (!res.ok) return;
        const j = await res.json();
        if (j && j.user) {
          let userProfile = j.user;
          // If server didn't include dept_name, attempt to resolve it from departments API
          if ((!userProfile.dept_name || userProfile.dept_name === '') && userProfile.dept_id) {
            try {
              const dres = await fetch(buildServerPhpUrl('dashboard.php'), { headers: getAuthHeaders() });
              if (dres.ok) {
                const dj = await dres.json();
                const depts = dj && dj.departments ? dj.departments : (dj && dj.data && dj.data.departments ? dj.data.departments : null);
                if (Array.isArray(depts)) {
                  const found = depts.find(dd => String(dd.dept_id) === String(userProfile.dept_id));
                  if (found) userProfile.dept_name = found.dept_name;
                }
              }
            } catch (e) { /* ignore */ }
          }
          setProfileData(userProfile);
        }
      } catch (e) { console.warn('openProfile fetch error', e); }
    })();
  };

  const handleSaveProfile = async () => {
    const uid = profileUserId;
    if (!uid) return alert('No user id');
    const contactNo = String(profileForm.contact_no || '').replace(/\D/g, '').slice(0, 11);
    const currentContactNo = String((profileData && profileData.contact_no) || '').replace(/\D/g, '').slice(0, 11);
    if (contactNo === currentContactNo) {
      return alert('No changes to save');
    }
    if (contactNo && (!/^09\d+$/.test(contactNo) || contactNo.length !== 11)) {
      return alert('Contact number must be 11 digits and start with 09.');
    }
    const fd = new FormData();
    fd.append('user_id', String(uid));
    fd.append('contact_no', contactNo);
    setUploading(true);
    try {
      const res = await fetch(buildServerPhpUrl('user_profile.php'), { method: 'POST', headers: getAuthHeaders(), body: fd });
      const j = await res.json();
      if (res.ok && j && j.ok) {
        applyProfileUpdate(j.user || profileData);
        try {
          await ensureSwalLoaded();
          if (window.Swal && typeof window.Swal.fire === 'function') {
            window.Swal.fire({
              toast: true,
              position: 'top-end',
              icon: 'success',
              title: 'Contact number updated',
              showConfirmButton: false,
              timer: 1500,
              timerProgressBar: true
            });
          } else {
            alert('Contact number updated');
          }
        } catch (e) { try { alert('Contact number updated'); } catch (e) {} }
        resetProfileEditor();
        setProfileOpen(false);
      } else { alert((j && (j.error || j.message)) || 'Profile update failed'); }
    } catch (e) { console.error(e); alert('Profile update failed'); } finally { setUploading(false); }
  };

  const avatarSrc = (profileData && profileData.avatar) || (user && (user.avatar || user.image)) || unknownImg;

  // --- 4. RENDER WITH TAILWIND ---

  return (
    <>
      {/* HEADER */}
      <header className="h-16 bg-[#1D8551] text-white flex items-center justify-between px-4 sticky top-0 z-40 shadow-md">
        {/* Left: Burger + Logo */}
        <div className="flex items-center gap-3">
          <button 
            onClick={toggleSidebar} 
            className="p-2 rounded-md bg-white/6 hover:bg-white/10 transition-colors focus:outline-none" 
            aria-label="Toggle Navigation"
          >
            <span className="w-5 h-0.5 bg-white rounded-full block"></span>
            <span className="w-5 h-0.5 bg-white rounded-full block mt-1"></span>
            <span className="w-5 h-0.5 bg-white rounded-full block mt-1"></span>
          </button>

          {/* Logo next to the burger */}
          <img src="cdoc-logo.png" alt="logo" className="w-9 h-9 rounded-md object-cover" />
        </div>

        {/* Center: Title */}
        <div className="flex-1 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-xs text-white/80 mt-0.5"><span className="font-medium">{user?.role_name || 'Panel'}</span></div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-4">
          {user ? (
            <>
                            {/* Notification Bell + Dropdown Panel */}
              <div className="relative" ref={notificationPanelRef}>
                <button
                  onClick={() => {
                    const next = !notificationOpen;
                    setNotificationOpen(next);
                    if (next) {
                      setNotificationFilter('all');
                      fetchNotifications(false);
                    }
                  }}
                  title="Notifications"
                  className={`relative p-2 rounded-full bg-white/6 hover:bg-white/10 transition-transform transform ${shouldAnimateNotificationBell ? 'hover:scale-105' : ''}`}
                >
                  <svg
                    className={`w-6 h-6 ${shouldAnimateNotificationBell ? 'animate-bounce' : ''}`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
                    <path d="M9 17a3 3 0 0 0 6 0" />
                  </svg>
                </button>

                {unreadNotifications > 0 && (
                  <div className="absolute -top-1 -right-1 flex items-center justify-center">
                    <span className="inline-flex min-w-[20px] h-5 px-1 items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none shadow">
                      {unreadNotifications}
                    </span>
                  </div>
                )}

                {notificationOpen && (
                  <div className="fixed right-2 top-16 w-80 max-w-[92vw] bg-white text-gray-800 border border-gray-100 rounded-lg shadow-xl z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
                      <div className="text-sm font-bold text-gray-800">Notifications</div>
                      {unreadNotifications > 0 ? (
                        <button
                          type="button"
                          onClick={markAllNotificationsRead}
                          disabled={notificationActioning}
                          className="text-xs font-semibold text-[#1D8551] hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {notificationActioning ? 'Working...' : 'Mark all read'}
                        </button>
                      ) : null}
                    </div>

                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                      <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setNotificationFilter('all')}
                          className={`px-3 py-1 text-xs font-semibold transition-colors ${notificationFilter === 'all' ? 'bg-[#1D8551] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setNotificationFilter('unread')}
                          className={`px-3 py-1 text-xs font-semibold transition-colors ${notificationFilter === 'unread' ? 'bg-[#1D8551] text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                        >
                          Unread
                        </button>
                      </div>
                    </div>

                    <div className={filteredNotifications.length >= 3 ? 'max-h-64 overflow-y-scroll' : 'overflow-y-visible'}>
                      {notificationsLoading ? (
                        <div className="px-4 py-5 text-sm text-gray-500">Loading notifications...</div>
                      ) : filteredNotifications.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-gray-500">
                          {notificationFilter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}
                        </div>
                      ) : (
                        filteredNotifications.map((notif) => {
                          const isUnread = Number(notif?.is_read || 0) === 0;
                          const actorName = getNotificationActorName(notif);
                          const actorAvatar = notif?.actor_avatar || unknownImg;
                          const titleText = cleanNotificationText(notif?.title || 'Notification');
                          const bodyText = cleanNotificationText(notif?.message || '');
                          const ageText = formatNotificationAge(notif.created_at);
                          return (
                            <button
                              key={notif.notif_id || `${notif.title}-${notif.created_at}`}
                              type="button"
                              onClick={() => onNotificationItemClick(notif)}
                              className={`w-full text-left px-4 py-3 border-b border-gray-200 transition-colors ${isUnread ? 'bg-emerald-100 border-l-4 border-l-emerald-600 hover:bg-emerald-200' : 'bg-gray-100 hover:bg-gray-200'}`}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`inline-block w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0 ${isUnread ? 'bg-emerald-600' : 'bg-gray-300'}`}
                                  title={isUnread ? 'Unread' : 'Read'}
                                ></span>
                                <img
                                  src={actorAvatar}
                                  alt={actorName}
                                  className="w-9 h-9 rounded-full object-cover border border-gray-200 bg-gray-100 flex-shrink-0"
                                  onError={(e) => {
                                    if (e.currentTarget.dataset.fallbackApplied === '1') return;
                                    e.currentTarget.dataset.fallbackApplied = '1';
                                    e.currentTarget.src = unknownImg;
                                  }}
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className={`text-sm truncate ${isUnread ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>{actorName}</div>
                                      <div className="text-[11px] text-gray-500 truncate">{titleText}</div>
                                    </div>
                                    <div className="text-[11px] text-gray-500 whitespace-nowrap">{formatNotificationTime(notif.created_at)}</div>
                                  </div>
                                  <div className={`text-xs mt-1 leading-5 ${isUnread ? 'text-gray-800' : 'text-gray-600'}`}>{bodyText}</div>
                                  {ageText ? (
                                    <div className="flex justify-start">
                                      <span className={`inline-flex items-center py-0.5 rounded-full text-[10px] leading-none font-semibold ${isUnread ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                                        {ageText}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {notifications.length > 0 ? (
                      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => clearNotifications('read')}
                          disabled={notificationActioning}
                          className="text-xs font-semibold text-gray-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Clear read
                        </button>
                        <button
                          type="button"
                          onClick={() => clearNotifications('all')}
                          disabled={notificationActioning}
                          className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Clear all
                        </button>
                      </div>
                    ) : null}

                    {notificationsError ? (
                      <div className="px-4 py-2 text-xs text-red-600 border-t border-red-100 bg-red-50">{notificationsError}</div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Avatar & Menu (preserve existing behavior) */}
              <div className="relative flex items-center gap-2">
                <img 
                  src={avatarSrc} 
                  alt="avatar" 
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/30 shadow-sm"
                  onError={(e) => {
                    if (e.currentTarget.dataset.fallbackApplied === '1') return;
                    e.currentTarget.dataset.fallbackApplied = '1';
                    e.currentTarget.src = unknownImg;
                  }}
                />
                <button 
                  onClick={() => setMenuOpen(!menuOpen)} 
                  className="w-8 h-8 rounded-full bg-white/8 hover:bg-white/12 flex flex-col items-center justify-center gap-1 transition-colors"
                >
                  <span className="w-1 h-1 bg-white rounded-full"></span>
                  <span className="w-1 h-1 bg-white rounded-full"></span>
                  <span className="w-1 h-1 bg-white rounded-full"></span>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-12 bg-white text-gray-800 border border-gray-100 rounded-lg shadow-xl w-44 py-2 z-50 animate-fade-in-down">
                    <div 
                      onClick={() => { setMenuOpen(false); openProfile(); }} 
                      className="px-4 py-2 hover:bg-gray-50 cursor-pointer font-medium text-sm transition-colors"
                    >
                      My Profile
                    </div>
                    <div className="h-px bg-gray-100 my-1"></div>
                    <div 
                      onClick={handleLogout} 
                      className="px-4 py-2 hover:bg-red-50 text-red-600 cursor-pointer font-medium text-sm transition-colors"
                    >
                      Logout
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <a href="#/login" className="text-white hover:underline font-medium">Login</a>
          )}
        </div>
      </header>

      {/* SIDEBAR */}
      <aside 
        className={`fixed top-14 left-0 w-64 bg-white border-r border-gray-200 shadow-xl z-30 transition-transform duration-300 ease-in-out h-[calc(100vh-3.5rem)] overflow-y-auto custom-scrollbar
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Main Navigation</h2>
        </div>
        
        <nav className="p-2 space-y-1" style={{ color: '#374151' }}>
          {visibleNavItems.map((item, index) => {
            // Check if active (for styling)
            const isActive = currentHash === item.path || (item.path !== '/' && currentHash.startsWith(item.path + '/'));
            const hasChildren = item.children && item.children.length > 0;
            const isExpanded = openSubmenus[item.path] || item.children?.some(c => currentHash.startsWith(c.path));

            if (hasChildren) {
              return (
                <div key={index} className="mb-1">
                  <div 
                    onClick={() => toggleSubmenu(item.path)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer transition-colors duration-200 select-none
                      ${isExpanded ? 'bg-gray-50 text-green-700 font-semibold' : 'text-gray-700 hover:bg-gray-50 hover:text-green-600'}`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <NavIcon path={item.path} />
                      <span className="text-sm truncate">{item.label}</span>
                    </span>
                    <span className={`text-[10px] transform transition-transform duration-200 ${isExpanded ? 'rotate-90' : 'rotate-0'}`}>
                      
                    </span>
                  </div>
                  
                  {/* Submenu Items */}
                  <div className={`pl-4 mt-1 space-y-1 overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
                    {item.children.map((sub, sIdx) => {
                      const isSubActive = currentHash === sub.path;
                      return (
                        <div 
                          key={sIdx} 
                          onClick={() => navTo(sub.path)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm cursor-pointer border-l-2 transition-all duration-200
                            ${isSubActive 
                              ? 'border-green-500 bg-green-50 text-green-700 font-medium' 
                              : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                        >
                          <NavIcon path={sub.path} className="w-3.5 h-3.5" />
                          <span className="truncate">{sub.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            } 
            
            // Single Link
            return (
              <div 
                key={index} 
                onClick={() => navTo(item.path)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm cursor-pointer transition-all duration-200 border-l-4 
                  ${isActive 
                    ? 'border-green-600 bg-green-50 text-green-800 font-semibold shadow-sm' 
                    : 'border-transparent text-gray-700 hover:bg-gray-50 hover:text-green-600'}`}
              >
                <NavIcon path={item.path} />
                <span className="truncate">{item.label}</span>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* OVERLAY (Backdrop for Mobile) */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-20 transition-opacity duration-300" 
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* PROFILE MODAL */}
      {profileOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-xl rounded-xl shadow-2xl overflow-hidden transform transition-all duration-300 ease-out scale-100 motion-safe:animate-fade-in-up">
            <div className="bg-green-600 px-6 py-4 flex justify-between items-center">
              <h3 className="text-white font-bold text-lg">My Profile</h3>
              <button onClick={() => { resetProfileEditor(); setProfileOpen(false); }} className="text-white/90 hover:text-white font-bold text-xl">&times;</button>
            </div>

            <div className="p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                <div className="flex-shrink-0 relative">
                  <img
                    src={(profileData && profileData.avatar) || avatarSrc}
                    alt="avatar"
                    className="w-28 h-28 rounded-full object-cover shadow-lg ring-2 ring-white transition-transform duration-200 hover:scale-105"
                    onError={(e) => {
                      if (e.currentTarget.dataset.fallbackApplied === '1') return;
                      e.currentTarget.dataset.fallbackApplied = '1';
                      e.currentTarget.src = unknownImg;
                    }}
                  />

                </div>

                <div className="flex-1 w-full">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-xl font-semibold text-gray-800">{`${profileForm.first_name || ''} ${profileForm.last_name || ''}`.trim() || 'My Profile'}</h4>
                      <div className="mt-1 text-sm text-gray-500">{profileForm.email || 'No email'}</div>
                    </div>

                    <div className="ml-4">
                      <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-700 text-sm font-semibold">
                        {profileData && profileData.role_name ? profileData.role_name : (user && user.role_name ? user.role_name : 'N/A')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 transition-shadow hover:shadow-md">
                      <div className="text-xs text-gray-500">Department</div>
                      <div className="mt-1 font-medium text-gray-800">{profileData && profileData.dept_name ? profileData.dept_name : 'None'}</div>
                    </div>

                    <div className="bg-gray-50 p-3 rounded-lg border border-gray-100 transition-shadow hover:shadow-md">
                      <div className="text-xs text-gray-500">ID Number</div>
                      <div className="mt-1 font-medium text-gray-800">{profileData && profileData.id_number ? String(profileData.id_number) : 'N/A'}</div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-700">
                    <label className="block">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">First Name</div>
                      <input
                        type="text"
                        value={profileForm.first_name}
                        readOnly
                        className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-700 shadow-sm cursor-not-allowed"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Last Name</div>
                      <input
                        type="text"
                        value={profileForm.last_name}
                        readOnly
                        className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-700 shadow-sm cursor-not-allowed"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Contact</div>
                      <input
                        type="text"
                        value={profileForm.contact_no}
                        onChange={(e) => {
                          const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 11);
                          setProfileForm((prev) => ({ ...prev, contact_no: digits }));
                        }}
                        placeholder="Optional"
                        disabled={!canEditProfileContact}
                        inputMode="numeric"
                        maxLength={11}
                        className={`w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-800 shadow-sm ${canEditProfileContact ? 'focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-100' : 'bg-gray-100 cursor-not-allowed'}`}
                      />
                    </label>

                    <label className="block">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Email</div>
                      <input
                        type="email"
                        value={profileForm.email}
                        readOnly
                        className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-gray-700 shadow-sm cursor-not-allowed"
                      />
                    </label>
                  </div>

                  <div className="mt-4 rounded-lg border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-xs text-emerald-800">
                    Only the contact number can be updated here. Name, email, avatar, department, role, and ID number stay managed by User Management.
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button onClick={() => { resetProfileEditor(); setProfileOpen(false); }} className="px-4 py-2 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50">Close</button>
                    {canEditProfileContact ? (
                      <button onClick={handleSaveProfile} disabled={uploading} className={`px-4 py-2 rounded-md text-white font-semibold ${uploading ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}>
                        {uploading ? (
                          <svg className="animate-spin h-5 w-5 mx-auto text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>
                        ) : 'Save Changes'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


