import React from "react";
import { AuthContext, AuthProvider } from "./context/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import AttendancePage from "./pages/Attendance/Index.jsx";
import AttedanceManagement from "./pages/AttedanceManagement/Index.jsx";
import DashboardPage from "./pages/Dashboard/Index.jsx";
import LoginPage from "./pages/Login/Index.jsx";
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
import { canAccessModule, getPermissionFromRoute } from "./utils/moduleAccess.js";

const fallbackCandidates = [
  ['/dashboard', 'dashboard'],
  ['/attendance', 'attendance'],
  ['/reports', 'reports'],
];

function resolveFallbackRoute(user) {
  if (user && Number(user.role_id) === 5 && canAccessModule(user, 'faculty_dashboard')) {
    return '/faculty-dashboard';
  }
  for (const [routePath, permissionKey] of fallbackCandidates) {
    if (canAccessModule(user, permissionKey)) return routePath;
  }
  return '/login';
}

function AppShell() {
  const [route, setRoute] = React.useState(window.location.hash.slice(1) || '/login');
  const auth = React.useContext(AuthContext) || {};
  const user = auth.user || null;

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

  let View = DashboardPage;
  if (route.startsWith('/attendancemgmt')) View = AttedanceManagement;
  else if (route.startsWith('/logs') || route.startsWith('/attendance-logs') || route.startsWith('/Attedance_Audit')) View = AttendanceAudit;
  else if (route.startsWith('/system-logs') || route.startsWith('/systemlogs')) View = SystemLogs;
  else if (route.startsWith('/attendance-edit-requests')) View = AttendanceEditRequestPage;
  else if (route.startsWith('/schedule-edit-requests')) View = ScheduleEditRequestPage;
  else if (route.startsWith('/my-requested-edits')) View = RequestEditIndex;
  else if (route.startsWith('/attendance-history') || route.startsWith('/Attendance_History')) View = AttendanceHistory;
  else if (route.startsWith('/faculty-dashboard')) View = MyDashboardPage;
  else if (route.startsWith('/school_year')) View = SchoolYearIndex;
  else if (route.startsWith('/attendance')) View = AttendancePage;
  else if (route.startsWith('/dashboard')) View = Number(user?.role_id) === 5 ? MyDashboardPage : DashboardPage;
  else if (route.startsWith('/login')) View = LoginPage;
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
