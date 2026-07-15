import React from 'react';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet } from '../../services/api.js';
import { canAccessModule, resolveRoleName } from '../../utils/moduleAccess.js';

const DEFAULT_HOME_TITLE = 'Welcome to COC Attendance WEB';
const DEFAULT_HOME_TITLE_COLOR = '#c69500';

const moduleShortcuts = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    permission: 'dashboard',
    icon: 'bi bi-speedometer2',
    accent: 'emerald',
    eyebrow: 'Operations',
    description: 'See campus-wide attendance movement, room activity, and the daily operational pulse in one executive view.'
  },
  {
    label: 'My Dashboard',
    path: '/faculty-dashboard',
    permission: 'faculty_dashboard',
    icon: 'bi bi-person-badge',
    accent: 'sky',
    eyebrow: 'Faculty',
    description: 'A personal command center for teaching load, attendance status, substitutions, and recent account activity.'
  },
  {
    label: 'Attendance',
    path: '/attendance',
    permission: 'attendance',
    icon: 'bi bi-geo-alt',
    accent: 'emerald',
    eyebrow: 'Live Check',
    description: 'Record class attendance with GPS, room radius checks, altitude signals, and floor QR confirmation.'
  },
  {
    label: 'Attendance History',
    path: '/attendance-history',
    permission: 'attendance',
    icon: 'bi bi-calendar-week',
    accent: 'amber',
    eyebrow: 'Calendar',
    description: 'Review past class sessions by date, scan status patterns, and request corrections when records need attention.'
  },
  {
    label: 'Teaching Schedule',
    path: '/my-attendance',
    permission: 'attendance',
    icon: 'bi bi-journal-bookmark',
    accent: 'indigo',
    eyebrow: 'Load',
    description: 'Check assigned rooms, subjects, sections, and schedule details before the next class starts.'
  },
  {
    label: 'Attendance Records',
    path: '/attendancemgmt',
    permission: 'attendancemgmt',
    icon: 'bi bi-clipboard-data',
    accent: 'rose',
    eyebrow: 'Review',
    description: 'Manage generated attendance rows, verify exceptions, and keep official records clean for reporting.'
  },
  {
    label: 'Class Schedules',
    path: '/class-schedules',
    permission: 'class_schedules',
    icon: 'bi bi-calendar3',
    accent: 'cyan',
    eyebrow: 'Planning',
    description: 'Maintain room assignments, class timing, teacher loads, and conflict-aware schedule details.'
  },
  {
    label: '3D Campus Map',
    path: '/3d-building',
    permission: '3d_building',
    icon: 'bi bi-box',
    accent: 'violet',
    eyebrow: 'Campus',
    description: 'Inspect building models and locate rooms, classes, and facility context with a visual campus view.'
  },
  {
    label: 'Facility',
    path: '/building',
    permission: 'locations',
    icon: 'bi bi-building',
    accent: 'slate',
    eyebrow: 'Location',
    description: 'Maintain buildings, floors, rooms, GPS points, altitude baselines, and room radius settings.'
  },
  {
    label: 'Reports',
    path: '/reports',
    permission: 'reports',
    icon: 'bi bi-file-earmark-bar-graph',
    accent: 'teal',
    eyebrow: 'Insights',
    description: 'Turn attendance activity into summaries for faculty, rooms, schedules, and administrative review.'
  },
  {
    label: 'Settings',
    path: '/settings/system',
    permission: 'settings',
    icon: 'bi bi-gear',
    accent: 'gray',
    eyebrow: 'Control',
    description: 'Tune module access, system behavior, and account-level permissions with admin oversight.'
  }
];

const roleProfiles = {
  admin: {
    title: 'System command center',
    intro: 'Keep the entire attendance ecosystem coordinated: users, facilities, schedules, module access, records, and reports all start from here.',
    primaryLabel: 'Open Dashboard',
    primaryPath: '/dashboard',
    secondaryLabel: 'Manage Facilities',
    secondaryPath: '/building',
    focus: [
      ['Access governance', 'Review who can enter each module and keep sensitive workflows limited to the right roles.'],
      ['Location accuracy', 'Maintain campus buildings, room coordinates, floor altitude, and QR-ready spaces.'],
      ['Operational confidence', 'Use reports and logs to keep attendance records auditable and ready for review.']
    ]
  },
  dean: {
    title: 'Department oversight hub',
    intro: 'Track department attendance, review faculty activity, monitor schedule changes, and keep academic operations moving without losing the details.',
    primaryLabel: 'Review Records',
    primaryPath: '/attendancemgmt',
    secondaryLabel: 'Open Reports',
    secondaryPath: '/reports',
    focus: [
      ['Department visibility', 'Watch attendance activity across faculty under your scope.'],
      ['Request decisions', 'Review attendance edit requests and leave-related activity with context.'],
      ['Quality control', 'Spot late, absent, substituted, and leave records before they become reporting problems.']
    ]
  },
  department_admin: {
    title: 'Department admin hub',
    intro: 'Manage department users, track attendance, review faculty activity, monitor schedule changes, and keep department operations moving clearly.',
    primaryLabel: 'Manage Users',
    primaryPath: '/users',
    secondaryLabel: 'Review Records',
    secondaryPath: '/attendancemgmt',
    focus: [
      ['Department users', 'Add and maintain users only inside your assigned department.'],
      ['Department visibility', 'Watch attendance activity across faculty under your scope.'],
      ['Quality control', 'Review requests, schedules, substitutions, reports, and logs with department context.']
    ]
  },
  program_head: {
    title: 'Program coordination desk',
    intro: 'Stay close to faculty schedules, class assignments, attendance patterns, and the program-level records that need quick decisions.',
    primaryLabel: 'View Schedules',
    primaryPath: '/class-schedules',
    secondaryLabel: 'Open Reports',
    secondaryPath: '/reports',
    focus: [
      ['Schedule awareness', 'Check assigned subjects, sections, and rooms connected to your program.'],
      ['Faculty support', 'Find records that need attention before they affect program reporting.'],
      ['Daily rhythm', 'Move between dashboards, attendance, and requests without digging through the sidebar.']
    ]
  },
  secretary: {
    title: 'Frontline operations board',
    intro: 'Handle schedules, records, leaves, substitutions, and day-to-day attendance cleanups from a single practical starting point.',
    primaryLabel: 'Attendance Records',
    primaryPath: '/attendancemgmt',
    secondaryLabel: 'Class Schedules',
    secondaryPath: '/class-schedules',
    focus: [
      ['Record upkeep', 'Keep attendance entries aligned with real class activity and approved changes.'],
      ['Schedule support', 'Move quickly between class schedules, substitutions, and request queues.'],
      ['Faculty service', 'Help teachers resolve attendance gaps with clear supporting context.']
    ]
  },
  teacher: {
    title: 'Faculty home base',
    intro: 'Your teaching day begins here: see the attendance tools, schedule views, and history you need before, during, and after class.',
    primaryLabel: 'Start Attendance',
    primaryPath: '/attendance',
    secondaryLabel: 'View History',
    secondaryPath: '/attendance-history',
    focus: [
      ['Before class', 'Check your assigned room, subject, section, and schedule timing before the session starts.'],
      ['During class', 'Use GPS, QR, and floor signals to confirm attendance from the right location.'],
      ['After class', 'Review your calendar history and request edits for records that need correction.']
    ]
  },
  default: {
    title: 'Attendance workspace',
    intro: 'A focused starting point for attendance, schedules, campus locations, reports, and the work connected to your account.',
    primaryLabel: 'Open First Module',
    primaryPath: '',
    secondaryLabel: 'View Reports',
    secondaryPath: '/reports',
    focus: [
      ['Daily context', 'Start with the tools available to your role.'],
      ['Accurate records', 'Keep attendance and schedule information connected.'],
      ['Campus awareness', 'Use location-aware tools when your role includes them.']
    ]
  }
};

const accentClasses = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  sky: 'bg-sky-50 text-sky-700 border-sky-100',
  amber: 'bg-amber-50 text-amber-700 border-amber-100',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  rose: 'bg-rose-50 text-rose-700 border-rose-100',
  cyan: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  violet: 'bg-violet-50 text-violet-700 border-violet-100',
  slate: 'bg-slate-50 text-slate-700 border-slate-100',
  teal: 'bg-teal-50 text-teal-700 border-teal-100',
  gray: 'bg-gray-50 text-gray-700 border-gray-100'
};

const workflowSteps = [
  {
    label: 'Prepare',
    icon: 'bi bi-journal-check',
    title: 'Know the class before it starts',
    description: 'Open your schedule, confirm the assigned room, and check the subject, section, and time before moving to attendance.'
  },
  {
    label: 'Verify',
    icon: 'bi bi-geo-alt-fill',
    title: 'Confirm the right place',
    description: 'GPS, room radius, floor details, and QR signals work together so attendance belongs to the correct campus location.'
  },
  {
    label: 'Record',
    icon: 'bi bi-clipboard2-check',
    title: 'Keep the official trail clean',
    description: 'Attendance records, edit requests, substitutions, and reports stay connected for review and department decisions.'
  }
];

const campusSignals = [
  ['GPS Radius', 'Room and building coordinates help confirm that attendance is recorded from the expected area.'],
  ['Floor Altitude', 'Floor-level details support location checks when rooms are stacked inside the same building.'],
  ['QR Confirmation', 'Room QR codes add a second confirmation point for live class attendance.'],
  ['Role Access', 'Each account starts from the modules that match the work they are allowed to do.']
];

function displayName(user) {
  const parts = [user?.first_name, user?.last_name].map((p) => String(p || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' ');
  return user?.email || 'User';
}

function titleCase(value) {
  return String(value || 'signed in')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function canOpen(user, item) {
  return !item.permission || canAccessModule(user, item.permission);
}

function firstAccessiblePath(user, preferredPath, visibleShortcuts) {
  if (preferredPath) {
    const preferred = moduleShortcuts.find((item) => item.path === preferredPath);
    if (!preferred || canOpen(user, preferred)) return preferredPath;
  }
  return visibleShortcuts[0]?.path || '';
}

function getHomeHeadlineStyle(title, color = DEFAULT_HOME_TITLE_COLOR) {
  const text = String(title || '').trim();
  const length = text.length;
  const longestWord = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  const weight = Math.max(length, longestWord * 1.4);

  let fontSize = 'clamp(1.45rem, 2.4vw, 2.2rem)';
  if (weight <= 14) {
    fontSize = 'clamp(2.35rem, 5vw, 4.25rem)';
  } else if (weight <= 24) {
    fontSize = 'clamp(2.1rem, 4.4vw, 3.75rem)';
  } else if (weight <= 38) {
    fontSize = 'clamp(1.85rem, 3.6vw, 3rem)';
  } else if (weight <= 56) {
    fontSize = 'clamp(1.6rem, 2.9vw, 2.45rem)';
  }

  return {
    color,
    display: 'block',
    maxWidth: '100%',
    margin: 0,
    fontSize,
    fontWeight: 900,
    lineHeight: 0.96,
    letterSpacing: 0,
    overflowWrap: 'anywhere',
  };
}

function HomeIndex() {
  const { user } = React.useContext(AuthContext) || {};
  const [homeTitle, setHomeTitle] = React.useState(DEFAULT_HOME_TITLE);
  const [homeTitleColor, setHomeTitleColor] = React.useState(DEFAULT_HOME_TITLE_COLOR);
  const roleName = resolveRoleName(user) || 'default';
  const profile = roleProfiles[roleName] || roleProfiles.default;
  const visibleShortcuts = moduleShortcuts.filter((item) => canOpen(user, item));
  const primaryPath = firstAccessiblePath(user, profile.primaryPath, visibleShortcuts);
  const secondaryPath = firstAccessiblePath(user, profile.secondaryPath, visibleShortcuts.slice(1));
  const homeTitleStyle = React.useMemo(() => getHomeHeadlineStyle(homeTitle, homeTitleColor), [homeTitle, homeTitleColor]);
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  const goTo = (path) => {
    if (!path) return;
    window.location.hash = `#${path}`;
  };

  const loadHomeSettings = React.useCallback(async () => {
    try {
      const deptId = user?.dept_id;
      const query = deptId ? `?dept_id=${deptId}` : '';
      const data = await apiGet(`app-settings/home${query}`);
      const title = String(data?.home_title || '').trim();
      const color = String(data?.home_title_color || '').trim();
      setHomeTitle(title || DEFAULT_HOME_TITLE);
      setHomeTitleColor(/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_HOME_TITLE_COLOR);
    } catch (err) {
      console.warn('Failed to load home settings', err);
      setHomeTitle(DEFAULT_HOME_TITLE);
      setHomeTitleColor(DEFAULT_HOME_TITLE_COLOR);
    }
  }, [user?.dept_id]);

  React.useEffect(() => {
    loadHomeSettings();
    const onSettingsUpdated = (event) => {
      if (event?.detail?.group === 'home') loadHomeSettings();
    };
    window.addEventListener('app-settings-updated', onSettingsUpdated);
    return () => window.removeEventListener('app-settings-updated', onSettingsUpdated);
  }, [loadHomeSettings]);

  return (
    <div className="min-h-screen bg-[#f4f7f2]">
      <div className="mx-auto max-w-[1600px] px-4 py-5 md:px-6 md:py-6">
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-end">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black uppercase tracking-normal text-amber-800">
              <i className="bi bi-hourglass-split" aria-hidden="true"></i>
              CDOC Attendance Home
            </div>
            <h1 style={{ ...homeTitleStyle, marginTop: '0.35rem' }} title={homeTitle}>
              {homeTitle}
            </h1>
            <p className="mt-3 max-w-4xl text-base leading-7 text-gray-700 md:text-lg">
              Every minute in class matters. This home page keeps attendance, schedules, rooms, GPS checks, reports, and role-based work close enough to move fast without losing accuracy.
            </p>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <img src="cdoc-logo.png" alt="CDOC logo" className="h-14 w-14 shrink-0 rounded bg-gray-50 object-contain p-1" />
              <div className="min-w-0">
                <div className="text-xs font-black uppercase tracking-normal text-emerald-700">Signed In</div>
                <div className="truncate text-lg font-black text-gray-900">{displayName(user)}</div>
                <div className="text-sm font-semibold text-gray-500">{titleCase(roleName)}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded border border-emerald-100 bg-emerald-50 p-3">
                <div className="text-xs font-black uppercase tracking-normal text-emerald-700">Today</div>
                <div className="mt-1 text-sm font-bold leading-5 text-gray-900">{todayLabel}</div>
              </div>
              <div className="rounded border border-amber-100 bg-amber-50 p-3">
                <div className="text-xs font-black uppercase tracking-normal text-amber-700">Modules</div>
                <div className="mt-1 text-3xl font-black leading-none text-gray-900">{visibleShortcuts.length}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
          <section className="min-h-0 block overflow-hidden rounded-lg bg-[#0f5132] text-white shadow-xl">
            <div className="grid gap-5 p-5 md:p-7 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-stretch">
              <div>
                <div className="mb-4 inline-flex items-center gap-2 rounded border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-normal text-emerald-50">
                  <i className="bi bi-house-door" aria-hidden="true"></i>
                  Home / {titleCase(roleName)}
                </div>
                <h2 className="mb-3 max-w-4xl text-3xl font-black leading-tight tracking-normal md:text-5xl">
                  {profile.title}
                </h2>
                <p className="max-w-3xl text-sm leading-6 text-emerald-50 md:text-base">
                  {profile.intro}
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {primaryPath ? (
                    <button
                      type="button"
                      onClick={() => goTo(primaryPath)}
                      className="inline-flex items-center gap-2 rounded bg-white px-4 py-2 text-sm font-bold text-emerald-800 shadow-sm hover:bg-emerald-50"
                    >
                      <i className="bi bi-arrow-right-circle" aria-hidden="true"></i>
                      {profile.primaryLabel}
                    </button>
                  ) : null}
                  {secondaryPath && secondaryPath !== primaryPath ? (
                    <button
                      type="button"
                      onClick={() => goTo(secondaryPath)}
                      className="inline-flex items-center gap-2 rounded border border-white/30 bg-white/10 px-4 py-2 text-sm font-bold text-white hover:bg-white/15"
                    >
                      <i className="bi bi-compass" aria-hidden="true"></i>
                      {profile.secondaryLabel}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid content-stretch gap-3">
                <div className="rounded-lg border border-white/20 bg-white/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-normal text-emerald-100">Main Goal</div>
                  <div className="mt-2 text-xl font-black leading-6 text-white">Start clean. Record right. Review faster.</div>
                </div>
                <div className="rounded-lg border border-white/20 bg-white/10 p-4">
                  <div className="text-xs font-bold uppercase tracking-normal text-emerald-100">Best First Move</div>
                  <div className="mt-2 text-sm font-semibold leading-6 text-white">
                    Use the primary button when your class or review work needs attention now.
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="min-h-0 block">
            <div className="mb-3">
              <div className="text-xs font-bold uppercase tracking-normal text-emerald-700">Daily Focus</div>
              <h2 className="text-xl font-black text-gray-900">What matters for your role</h2>
            </div>

            <div className="grid gap-3">
              {profile.focus.map(([title, detail], idx) => (
                <div key={title} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-emerald-50 text-sm font-black text-emerald-700">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="font-black text-gray-900">{title}</div>
                      <p className="mt-1 text-sm leading-6 text-gray-600">{detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-5 min-h-0 block">
          <div className="mb-3">
            <div className="text-xs font-bold uppercase tracking-normal text-amber-700">Attendance Flow</div>
            <h2 className="text-xl font-black text-gray-900">From schedule to trusted record</h2>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            {workflowSteps.map((step) => (
              <div key={step.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="rounded border border-amber-100 bg-amber-50 px-2 py-1 text-xs font-black uppercase tracking-normal text-amber-700">
                    {step.label}
                  </span>
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-emerald-50 text-lg text-emerald-700">
                    <i className={step.icon} aria-hidden="true"></i>
                  </span>
                </div>
                <h3 className="text-base font-black text-gray-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{step.description}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
          <section className="min-h-0 block">
            <div className="mb-3">
              <div className="text-xs font-bold uppercase tracking-normal text-emerald-700">Quick Launch</div>
              <h2 className="text-xl font-black text-gray-900">Move into the work</h2>
            </div>

            {visibleShortcuts.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {visibleShortcuts.map((item) => (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => goTo(item.path)}
                    className="group flex min-h-[170px] rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                  >
                    <span className="flex w-full flex-col">
                      <span className="mb-3 flex items-start gap-3">
                        <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border text-lg ${accentClasses[item.accent] || accentClasses.gray}`}>
                          <i className={item.icon} aria-hidden="true"></i>
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[10px] font-bold uppercase tracking-normal text-gray-400">{item.eyebrow}</span>
                          <span className="mt-0.5 block font-black text-gray-900 group-hover:text-emerald-700">{item.label}</span>
                        </span>
                      </span>
                      <span className="block text-sm leading-6 text-gray-600">{item.description}</span>
                      <span className="mt-auto pt-3 text-xs font-black uppercase tracking-normal text-emerald-700">
                        Open Module
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-200 bg-white p-4 text-gray-600 shadow-sm">
                No modules are available for this account.
              </div>
            )}
          </section>

          <section className="min-h-0 block">
            <div className="mb-3">
              <div className="text-xs font-bold uppercase tracking-normal text-emerald-700">Campus Signals</div>
              <h2 className="text-xl font-black text-gray-900">Why the system checks location</h2>
            </div>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="space-y-3">
                {campusSignals.map(([title, detail]) => (
                  <div key={title} className="border-b border-gray-100 pb-3 last:border-b-0 last:pb-0">
                    <div className="font-black text-gray-900">{title}</div>
                    <p className="mt-1 text-sm leading-6 text-gray-600">{detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-black text-gray-900">
              <i className="bi bi-broadcast-pin text-emerald-600" aria-hidden="true"></i>
              Location-Aware Attendance
            </div>
            <p className="text-sm leading-6 text-gray-600">
              The system connects room GPS radius, building location, floor altitude, and QR validation so attendance is tied to the actual teaching space.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-black text-gray-900">
              <i className="bi bi-calendar-check text-sky-600" aria-hidden="true"></i>
              Schedule-First Records
            </div>
            <p className="text-sm leading-6 text-gray-600">
              Attendance follows class schedules, rooms, subjects, and sections, keeping each record connected to the class it belongs to.
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2 text-sm font-black text-gray-900">
              <i className="bi bi-shield-check text-amber-600" aria-hidden="true"></i>
              Reviewable Workflow
            </div>
            <p className="text-sm leading-6 text-gray-600">
              Edit requests, substitutions, leave activity, reports, and logs help preserve a cleaner record trail for every department.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomeIndex;
