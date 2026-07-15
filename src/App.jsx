import React from "react";
import { AuthContext, AuthProvider } from "./context/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import AttendancePage from "./pages/Attendance/Index.jsx";
import AttedanceManagement from "./pages/AttedanceManagement/Index.jsx";
import DashboardPage from "./pages/Dashboard/Index.jsx";
import LoginPage from "./pages/Login/Index.jsx";
import HomeIndex from "./pages/Home/Index.jsx";
import BuildingIndex from "./pages/Building/Index.jsx";
import ThreeDBuildingIndex from "./pages/ThreeDBuilding/Index.jsx";
import RoomIndex from "./pages/Room/Index.jsx";
import UserIndex from "./pages/User/Index.jsx";
import ProgramIndex from "./pages/Program/Index.jsx";
import DepartmentIndex from "./pages/Department/Index.jsx";
import FloorIndex from "./pages/Floor/Index.jsx";
import SectionIndex from "./pages/Section/Index.jsx";
import SubjectIndex from "./pages/Subject/Index.jsx";
import ClassScheduleIndex from "./pages/ClassSchedule/Index.jsx";
import SemesterIndex from "./pages/Semester/Index.jsx";
import SubjectOfferingIndex from "./pages/SubjectOffering/Index.jsx";
import SchoolIndex from "./pages/School/Index.jsx";
import FileLeave from "./pages/File_leave/index.jsx";
import LeaveApproval from "./pages/Leave_approval/index.jsx";
import Penalties from "./pages/Penalties/Index.jsx";
import Substitute from "./pages/Substitute/Index.jsx";
import MyAttendance from "./pages/Teaching_Schedule/index.jsx";
import ReportIndex from "./pages/Report/index.jsx";
import AttendanceAudit from "./pages/Attedance_Audit/index.jsx";
import SystemLogs from "./pages/System-logs/index.jsx";
import AttendanceHistory from "./pages/Attendance_History/index.jsx";
import SchoolYearIndex from "./pages/School_year/index.jsx";
import RequestEditIndex from "./pages/Request_Edit/index.jsx";
import AttendanceEditRequestPage from "./pages/Attendance_Edit_Request/index.jsx";
import ScheduleEditRequestPage from "./pages/Schedule_Edit_Request/index.jsx";
import GeneralSettingsIndex from "./pages/Settings/Index.jsx";
import MyDashboardPage from "./pages/My_Dashboard/Index.jsx";
import NotificationIndex from "./pages/Notification/Index.jsx";
import { apiPost } from "./services/api.js";
import { canAccessModule, getPermissionFromRoute } from "./utils/moduleAccess.js";

function resolveFallbackRoute(user) {
  return user ? '/home' : '/login';
}

const breadcrumbDefinitions = [
  { prefix: '/home', trail: [] },
  { prefix: '/dashboard', trail: [{ label: 'Dashboard', path: '/dashboard' }] },
  { prefix: '/faculty-dashboard', trail: [{ label: 'My Dashboard', path: '/faculty-dashboard' }] },
  { prefix: '/users', trail: [{ label: 'Users', path: '/users' }] },
  { prefix: '/attendancemgmt', trail: [{ label: 'Attendance Records', path: '/attendancemgmt' }] },
  { prefix: '/attendance-edit-requests', trail: [{ label: 'Attendance Edit Requests', path: '/attendance-edit-requests' }] },
  { prefix: '/schedule-edit-requests', trail: [{ label: 'Schedule Edit Requests', path: '/schedule-edit-requests' }] },
  { prefix: '/attendance-logs', trail: [{ label: 'Attendance Adjustment Logs', path: '/attendance-logs' }] },
  { prefix: '/logs', trail: [{ label: 'Attendance Adjustment Logs', path: '/attendance-logs' }] },
  { prefix: '/attedance_audit', trail: [{ label: 'Attendance Adjustment Logs', path: '/attendance-logs' }] },
  { prefix: '/system-logs', trail: [{ label: 'Audit Trail', path: '/system-logs' }] },
  { prefix: '/notifications', trail: [{ label: 'Notifications', path: '/notifications' }] },
  { prefix: '/3d-building', trail: [{ label: '3D Campus Map', path: '/3d-building' }] },
  { prefix: '/class-schedules', trail: [{ label: 'Class Schedules', path: '/class-schedules' }] },
  { prefix: '/departments', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Departments', path: '/departments' }] },
  { prefix: '/programs', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Programs', path: '/programs' }] },
  { prefix: '/sections', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Sections', path: '/sections' }] },
  { prefix: '/school_year', trail: [{ label: 'Academic', path: '/sections' }, { label: 'School Year', path: '/school_year' }] },
  { prefix: '/subjects', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Subjects', path: '/subjects' }] },
  { prefix: '/subject-offerings', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Subject Offerings', path: '/subject-offerings' }] },
  { prefix: '/semesters', trail: [{ label: 'Academic', path: '/sections' }, { label: 'Semesters', path: '/semesters' }] },
  { prefix: '/building', trail: [{ label: 'Facility', path: '/building' }, { label: 'Buildings', path: '/building' }] },
  { prefix: '/floors', trail: [{ label: 'Facility', path: '/building' }, { label: 'Floors', path: '/floors' }] },
  { prefix: '/rooms', trail: [{ label: 'Facility', path: '/building' }, { label: 'Rooms', path: '/rooms' }] },
  { prefix: '/settings/module-access', trail: [{ label: 'General Settings', path: '/settings/system' }, { label: 'Module Access Matrix', path: '/settings/module-access' }] },
  { prefix: '/settings', trail: [{ label: 'General Settings', path: '/settings/system' }] },
  { prefix: '/school', trail: [{ label: 'School Info', path: '/school' }] },
  { prefix: '/file_leave', trail: [{ label: 'File Leave', path: '/File_leave' }] },
  { prefix: '/leave_approval', trail: [{ label: 'Leave Approval', path: '/Leave_approval' }] },
  { prefix: '/substitutions', trail: [{ label: 'Substitutions', path: '/substitutions' }] },
  { prefix: '/substitute', trail: [{ label: 'Substitutions', path: '/substitutions' }] },
  { prefix: '/reports', trail: [{ label: 'Reports', path: '/reports' }] },
  { prefix: '/attendance-history', trail: [{ label: 'Faculty Portal', path: '/attendance' }, { label: 'Attendance History', path: '/attendance-history' }] },
  { prefix: '/my-attendance', trail: [{ label: 'Faculty Portal', path: '/attendance' }, { label: 'Teaching Schedule', path: '/my-attendance' }] },
  { prefix: '/my-requested-edits', trail: [{ label: 'Faculty Portal', path: '/attendance' }, { label: 'Request Edit', path: '/my-requested-edits' }] },
  { prefix: '/attendance', trail: [{ label: 'Faculty Portal', path: '/attendance' }, { label: 'Attendance', path: '/attendance' }] },
  { prefix: '/penalties', trail: [{ label: 'Penalties', path: '/penalties' }] },
];

function normalizeRoutePath(routePath) {
  const raw = String(routePath || '').trim().split('?')[0].split('#')[0];
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function labelFromRouteToken(token) {
  const pretty = String(token || '').replace(/[_-]+/g, ' ').trim();
  if (!pretty) return 'Page';
  return pretty
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function fallbackTrailFromRoute(routeKey) {
  const segments = String(routeKey || '').split('/').filter(Boolean);
  if (segments.length === 0) return [];
  let cumulative = '';
  return segments.map((segment) => {
    cumulative += `/${segment}`;
    return { label: labelFromRouteToken(segment), path: cumulative };
  });
}

function buildBreadcrumbItems(routePath, user) {
  const normalized = normalizeRoutePath(routePath);
  const routeKey = normalized.toLowerCase();
  if (routeKey.startsWith('/login')) return [];

  const homePath = resolveFallbackRoute(user);
  const matched = breadcrumbDefinitions.find((entry) => routeKey === entry.prefix || routeKey.startsWith(`${entry.prefix}/`));
  const trail = matched ? matched.trail : fallbackTrailFromRoute(routeKey);

  const items = [{ label: 'Home', path: homePath }];
  trail.forEach((item) => {
    if (!item || !item.label) return;
    items.push(item);
  });

  const deduped = [];
  items.forEach((item) => {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.label !== item.label || prev.path !== item.path) {
      deduped.push(item);
    }
  });
  return deduped;
}

async function promptFirstLoginPasswordChangeOnHome(user) {
  if (typeof window === 'undefined' || !window.Swal || typeof window.Swal.fire !== 'function') {
    throw new Error('Password change dialog is unavailable.');
  }

  const Swal = window.Swal;
  const safeEmail = String(user?.email || 'your account').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));

  const { value, dismiss } = await Swal.fire({
    title: '',
    html: `
      <div class="reset-password-modal first-login-required-modal">
        <div class="first-login-required-top">
          <span class="first-login-required-lock" aria-hidden="true">
            <i class="bi bi-lock"></i>
          </span>
          <h1 class="first-login-required-title">Set your new<br/>password</h1>
        </div>

        <p class="first-login-required-subtitle">
          For security, this is your first login — you must change your password.
        </p>

        <div class="first-login-required-alert">
          <span class="first-login-required-alert-icon" aria-hidden="true">
            <i class="bi bi-info-circle"></i>
          </span>
          <p class="first-login-alert-text">
            Signed in as <strong>${safeEmail}</strong>.<br/>
            The temporary password you used cannot be reused.
          </p>
        </div>

        <div class="first-login-form-section">
          <label class="reset-label" for="swal-password">
            New password
          </label>
          <div class="first-login-password-control">
            <input
              id="swal-password"
              type="password"
              class="swal2-input reset-input"
              placeholder="Create a strong password"
              autocomplete="new-password"
              aria-describedby="first-login-password-help"
            />
            <button
              type="button"
              class="first-login-password-eye"
              data-target="swal-password"
              aria-label="Show new password"
            >
              <i class="bi bi-eye"></i>
            </button>
          </div>
        </div>

        <div class="first-login-form-section">
          <label class="reset-label" for="swal-confirm">
            Confirm new password
          </label>
          <div class="first-login-password-control">
            <input
              id="swal-confirm"
              type="password"
              class="swal2-input reset-input"
              placeholder="Re-enter your new password"
              autocomplete="new-password"
            />
            <button
              type="button"
              class="first-login-password-eye"
              data-target="swal-confirm"
              aria-label="Show confirmation password"
            >
              <i class="bi bi-eye"></i>
            </button>
          </div>
        </div>

        <div
          id="first-login-password-help"
          class="reset-req-card first-login-required-reqs"
          aria-live="polite"
        >
          <div class="reset-req-title">
            Password requirements
          </div>

          <div class="reset-req-list">
            <div id="pw-req-length" class="reset-req-item is-invalid">
              <span class="reset-req-mark" aria-hidden="true">✕</span>
              <span>At least 8 characters</span>
            </div>

            <div id="pw-req-letter" class="reset-req-item is-invalid">
              <span class="reset-req-mark" aria-hidden="true">✕</span>
              <span>Contains a letter (A-Z or a-z)</span>
            </div>

            <div id="pw-req-number" class="reset-req-item is-invalid">
              <span class="reset-req-mark" aria-hidden="true">✕</span>
              <span>Contains a number (0-9)</span>
            </div>

            <div id="pw-req-special" class="reset-req-item is-invalid">
              <span class="reset-req-mark" aria-hidden="true">✕</span>
              <span>Contains a special character</span>
            </div>

            <div id="pw-req-match" class="reset-req-item is-invalid">
              <span class="reset-req-mark" aria-hidden="true">✕</span>
              <span>Password confirmation matches</span>
            </div>
          </div>
        </div>
      </div>
    `,
    confirmButtonText: 'Set password & continue',
    allowOutsideClick: false,
    allowEscapeKey: false,
    showCancelButton: false,
    focusConfirm: false,
    customClass: {
      popup: 'login-reset-modal-popup first-login-required-popup',
      title: 'login-reset-modal-title',
      confirmButton: 'login-reset-modal-confirm first-login-required-confirm',
      validationMessage: 'login-reset-modal-validation'
    },
    buttonsStyling: false,
    didOpen: () => {
      const passwordInput = document.getElementById('swal-password');
      const confirmInput = document.getElementById('swal-confirm');
      const confirmButton = Swal.getConfirmButton ? Swal.getConfirmButton() : null;
      const fields = {
        length: document.getElementById('pw-req-length'),
        letter: document.getElementById('pw-req-letter'),
        number: document.getElementById('pw-req-number'),
        special: document.getElementById('pw-req-special'),
        match: document.getElementById('pw-req-match')
      };

      const applyStatus = (el, ok) => {
        if (!el) return;
        el.classList.toggle('is-valid', !!ok);
        el.classList.toggle('is-invalid', !ok);
        const mark = el.querySelector('.reset-req-mark');
        if (mark) mark.innerHTML = ok ? '&#10003;' : '&times;';
      };

      document.querySelectorAll('.first-login-password-eye').forEach((button) => {
        button.addEventListener('click', () => {
          const target = document.getElementById(button.getAttribute('data-target') || '');
          if (!target) return;
          const showing = target.type === 'text';
          target.type = showing ? 'password' : 'text';
          button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
          button.innerHTML = showing ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
        });
      });

      const updateStatus = () => {
        const value = passwordInput?.value || '';
        const confirmation = confirmInput?.value || '';
        const checks = {
          length: value.length >= 8,
          letter: /[A-Za-z]/.test(value),
          number: /[0-9]/.test(value),
          special: /[^A-Za-z0-9]/.test(value),
          match: value.length > 0 && confirmation.length > 0 && value === confirmation
        };

        Object.keys(checks).forEach((key) => applyStatus(fields[key], checks[key]));

        if (passwordInput) {
          const passwordReady = checks.length && checks.letter && checks.number && checks.special;
          passwordInput.classList.toggle('is-valid', passwordReady);
          passwordInput.classList.toggle('is-invalid', value.length > 0 && !passwordReady);
        }
        if (confirmInput) {
          confirmInput.classList.toggle('is-valid', checks.match);
          confirmInput.classList.toggle('is-invalid', confirmation.length > 0 && !checks.match);
        }
        if (confirmButton) {
          confirmButton.disabled = !(checks.length && checks.letter && checks.number && checks.special && checks.match);
        }
      };

      passwordInput?.addEventListener('input', updateStatus);
      confirmInput?.addEventListener('input', updateStatus);
      updateStatus();
      setTimeout(() => passwordInput?.focus?.(), 80);
    },
    preConfirm: async () => {
      const newPassword = document.getElementById('swal-password')?.value || '';
      const confirmPassword = document.getElementById('swal-confirm')?.value || '';
      const okLength = newPassword.length >= 8;
      const okLetter = /[A-Za-z]/.test(newPassword);
      const okNumber = /[0-9]/.test(newPassword);
      const okSpecial = /[^A-Za-z0-9]/.test(newPassword);

      if (!(okLength && okLetter && okNumber && okSpecial)) {
        Swal.showValidationMessage('Please complete all password requirements.');
        return null;
      }
      if (newPassword !== confirmPassword) {
        Swal.showValidationMessage('Passwords do not match.');
        return null;
      }

      try {
        return await apiPost('first-login-password', {
          new_password: newPassword,
          confirm_password: confirmPassword
        });
      } catch (error) {
        Swal.showValidationMessage(error?.body?.message || error?.message || 'Failed to change password.');
        return null;
      }
    }
  });

  return value || (dismiss ? { cancelled: true } : null);
}

function AppShell() {
  const [route, setRoute] = React.useState(window.location.hash.slice(1) || '/login');
  const auth = React.useContext(AuthContext) || {};
  const user = auth.user || null;
  const firstLoginPromptOpenRef = React.useRef(false);
  const breadcrumbItems = React.useMemo(() => buildBreadcrumbItems(route, user), [route, user]);

  React.useEffect(() => {
    const onhash = () => setRoute(window.location.hash.slice(1) || '/login');
    window.addEventListener('hashchange', onhash);
    return () => window.removeEventListener('hashchange', onhash);
  }, []);

  // Auto-heal worker: when website/app opens, ensure attendance worker task is running.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.__workerBootstrapPinged) return;
    window.__workerBootstrapPinged = true;

    const pingWorkerBootstrap = async () => {
      try {
        if (typeof window.apiGet === 'function') {
          await window.apiGet('worker-bootstrap/ping');
          return;
        }

        const base = (window.API_BASE || '../server-php/index.php/api').replace(/\/+$/, '');
        await fetch(base + '/worker-bootstrap/ping', { method: 'GET', cache: 'no-store' });
      } catch (err) {
        // Non-blocking; app should continue even if worker bootstrap check fails.
        console.warn('worker-bootstrap ping failed', err);
      }
    };

    pingWorkerBootstrap();
  }, []);

  React.useEffect(() => {
    if (route.startsWith('/login')) return;
    if (!user) {
      window.location.hash = '#/login';
      return;
    }
    if (route === '/') {
      window.location.hash = '#/home';
      return;
    }
    if (Number(user?.is_first_login || 0) === 1 && !route.startsWith('/home')) {
      window.location.hash = '#/home';
      return;
    }
    if (Number(user.role_id) === 5 && route.startsWith('/dashboard')) {
      if (route !== '/faculty-dashboard') window.location.hash = '#/faculty-dashboard';
      return;
    }
    const requiredPermission = getPermissionFromRoute(route);
    if (!requiredPermission) return;
    if (canAccessModule(user, requiredPermission)) return;
    const fallback = resolveFallbackRoute(user);
    if (fallback !== route) {
      window.location.hash = '#' + fallback;
    }
  }, [route, user]);

  React.useEffect(() => {
    if (!user || !route.startsWith('/home')) return;
    if (Number(user?.is_first_login || 0) !== 1) return;
    if (firstLoginPromptOpenRef.current) return;

    firstLoginPromptOpenRef.current = true;
    promptFirstLoginPasswordChangeOnHome(user)
      .then((result) => {
        if (!result) return;
        if (result.cancelled) {
          if (typeof auth.logout === 'function') {
            auth.logout({ notice: 'Password change is required before you can continue.' });
          } else {
            window.location.hash = '#/login';
          }
          return;
        }
        const updatedUser = { ...user, is_first_login: 0 };
        if (typeof auth.updateUser === 'function') {
          auth.updateUser(updatedUser);
        } else if (typeof auth.login === 'function') {
          auth.login(updatedUser);
        }
      })
      .catch(async (error) => {
        try {
          if (window.Swal && typeof window.Swal.fire === 'function') {
            await window.Swal.fire({
              icon: 'error',
              title: 'Password Change Required',
              text: error?.message || 'Please reload the page and change your password.',
              confirmButtonColor: '#d33'
            });
          }
        } catch (e) {}
      })
      .finally(() => {
        firstLoginPromptOpenRef.current = false;
      });
  }, [route, user, auth]);

  let View = DashboardPage;
  if (route.startsWith('/attendancemgmt')) View = AttedanceManagement;
  else if (route.startsWith('/logs') || route.startsWith('/attendance-logs') || route.startsWith('/Attedance_Audit')) View = AttendanceAudit;
  else if (route.startsWith('/system-logs') || route.startsWith('/systemlogs')) View = SystemLogs;
  else if (route.startsWith('/notifications')) View = NotificationIndex;
  else if (route.startsWith('/attendance-edit-requests')) View = AttendanceEditRequestPage;
  else if (route.startsWith('/schedule-edit-requests')) View = ScheduleEditRequestPage;
  else if (route.startsWith('/my-requested-edits')) View = RequestEditIndex;
  else if (route.startsWith('/attendance-history') || route.startsWith('/Attendance_History')) View = AttendanceHistory;
  else if (route.startsWith('/faculty-dashboard')) View = MyDashboardPage;
  else if (route.startsWith('/school_year')) View = SchoolYearIndex;
  else if (route.startsWith('/attendance')) View = AttendancePage;
  else if (route.startsWith('/dashboard')) View = Number(user?.role_id) === 5 ? MyDashboardPage : DashboardPage;
  else if (route.startsWith('/login')) View = LoginPage;
  else if (route.startsWith('/home')) View = HomeIndex;
  else if (route.startsWith('/3d-building')) View = ThreeDBuildingIndex;
  else if (route.startsWith('/building')) View = BuildingIndex;
  else if (route.startsWith('/rooms')) View = RoomIndex;
  else if (route.startsWith('/users')) View = UserIndex;
  else if (route.startsWith('/programs')) View = ProgramIndex;
  else if (route.startsWith('/departments')) View = DepartmentIndex;
  else if (route.startsWith('/floors')) View = FloorIndex;
  else if (route.startsWith('/settings')) View = GeneralSettingsIndex;
  else if (route.startsWith('/school')) View = SchoolIndex;
  else if (route.startsWith('/sections')) View = SectionIndex;
  else if (route.startsWith('/class-schedules')) View = ClassScheduleIndex;
  else if (route.startsWith('/semesters')) View = SemesterIndex;
  else if (route.startsWith('/subject-offerings')) View = SubjectOfferingIndex;
  else if (route.startsWith('/subjects')) View = SubjectIndex;
  else if (route.startsWith('/File_leave')) View = FileLeave;
  else if (route.startsWith('/Leave_approval')) View = LeaveApproval;
  else if (route.startsWith('/penalties')) View = Penalties;
  else if (route.startsWith('/substitute') || route.startsWith('/substitutions')) View = Substitute;
  else if (route.startsWith('/my-attendance') || route.startsWith('/Teaching_Schedule')) View = MyAttendance;
  else if (route.startsWith('/reports')) View = ReportIndex;

  return (
    <div>
      {!route.startsWith('/login') && <Navbar />}
      <div style={{ padding: route.startsWith('/login') ? 0 : 20 }}>
        {!route.startsWith('/login') && breadcrumbItems.length > 0 && (
          <nav className="app-breadcrumb" aria-label="Breadcrumb">
            <ol className="app-breadcrumb-list">
              {breadcrumbItems.map((crumb, idx) => {
                const isLast = idx === breadcrumbItems.length - 1;
                const isClickable = !!crumb.path && !isLast;
                return (
                  <li key={`${crumb.label}-${idx}`} className="app-breadcrumb-item">
                    {isClickable ? (
                      <button
                        type="button"
                        className="app-breadcrumb-link"
                        onClick={() => { window.location.hash = `#${crumb.path}`; }}
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span className={`app-breadcrumb-current${isLast ? ' is-current' : ''}`}>{crumb.label}</span>
                    )}
                    {!isLast && <span className="app-breadcrumb-sep" aria-hidden="true">&#8250;</span>}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <View />
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
