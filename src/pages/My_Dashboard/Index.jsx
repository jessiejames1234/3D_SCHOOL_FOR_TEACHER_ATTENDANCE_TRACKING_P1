import React from 'react';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet } from '../../services/api.js';
import { attendanceFlagKey, attendanceFlagLabel } from '../../utils/attendanceFlags.js';

function formatRoleName(raw) {
  const role = String(raw || '').trim();
  if (!role) return '';
  return role
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ');
}

function toLocalYmd(value) {
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const d = new Date(`${value}T00:00:00`);
  if (!d || Number.isNaN(d.getTime())) return value || '-';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function getStatusClass(raw) {
  const val = attendanceFlagKey(null, raw);
  if (val === 'present') return 'bg-emerald-100 text-emerald-700';
  if (val === 'late') return 'bg-amber-100 text-amber-700';
  if (val === 'absent') return 'bg-rose-100 text-rose-700';
  if (val === 'on_leave') return 'bg-sky-100 text-sky-700';
  if (val === 'substituted') return 'bg-indigo-100 text-indigo-700';
  if (val === 'pending') return 'bg-orange-100 text-orange-700';
  if (val === 'upcoming') return 'bg-slate-100 text-slate-700';
  return 'bg-slate-100 text-slate-700';
}

function MyDashboardPage() {
  const { user } = React.useContext(AuthContext) || {};
  const rootRef = React.useRef(null);

  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [viewMode, setViewMode] = React.useState('table');
  const [refreshing, setRefreshing] = React.useState(false);
  const [httpsPollingActive, setHttpsPollingActive] = React.useState(false);

  const roleLabel = formatRoleName(
    user?.role_name ||
    (Number(user?.role_id) === 2
      ? 'dean'
      : Number(user?.role_id) === 6
        ? 'department_admin'
        : Number(user?.role_id) === 3
          ? 'program_head'
          : Number(user?.role_id) === 4
            ? 'secretary'
            : Number(user?.role_id) === 5
              ? 'teacher'
              : '')
  );
  const fullName = `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || 'Faculty User';

  const loadData = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await apiGet('dashboard/full?scope=self');
      setData(res || null);
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Failed to load your dashboard.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    setHttpsPollingActive(true);
    const pollTimer = setInterval(() => {
      loadData({ silent: true });
    }, 15000);

    return () => {
      clearInterval(pollTimer);
    };
  }, [loadData]);

  const attendanceToday = data?.summary?.attendance_today || {};
  const snapshotDate = String(attendanceToday.date || '').trim() || toLocalYmd(new Date());
  const recentRows = Array.isArray(data?.recent_attendance) ? data.recent_attendance : [];
  const myRecentRows = recentRows.slice(0, 50);
  const weekly = Array.isArray(data?.viz?.weekly_7d) ? data.viz.weekly_7d : [];

  const weeklyTotals = weekly.reduce(
    (acc, row) => {
      acc.total += Number(row?.total || 0);
      acc.present += Number(row?.present || 0);
      acc.absent += Number(row?.absent || 0);
      acc.late += Number(row?.late || 0);
      return acc;
    },
    { total: 0, present: 0, absent: 0, late: 0 }
  );

  const maxWeeklyTotal = Math.max(1, ...weekly.map((w) => Number(w?.total || 0)), 1);

  const jumpTo = (path) => {
    if (typeof window === 'undefined') return;
    window.location.hash = '#' + path;
  };

  const normalizedQuery = query.trim().toLowerCase();
  const countRecentByStatus = (key) => myRecentRows.filter((row) => attendanceFlagKey(null, row.final_flag_name) === key).length;
  const filteredRows = myRecentRows.filter((row) => {
    const status = attendanceFlagKey(null, row.final_flag_name);
    if (statusFilter !== 'all' && status !== statusFilter) return false;
    if (!normalizedQuery) return true;
    const haystack = `${row.date || ''} ${row.subject_code || ''} ${row.subject_name || ''} ${row.section_name || ''} ${attendanceFlagLabel(null, row.final_flag_name)}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const statusButtons = [
    { key: 'all', label: 'All', value: filteredRows.length, icon: 'bi bi-grid-3x3-gap' },
    { key: 'present', label: 'Present', value: Number(attendanceToday.present || 0), icon: 'bi bi-check-circle-fill' },
    { key: 'late', label: 'Late', value: Number(attendanceToday.late || 0), icon: 'bi bi-clock-fill' },
    { key: 'absent', label: 'Absent', value: Number(attendanceToday.absent || 0), icon: 'bi bi-x-circle-fill' },
    { key: 'pending', label: 'Pending', value: Number(attendanceToday.pending || countRecentByStatus('pending')), icon: 'bi bi-hourglass-split' },
    { key: 'upcoming', label: 'Upcoming', value: Number(attendanceToday.upcoming || countRecentByStatus('upcoming')), icon: 'bi bi-calendar-event' },
  ];

  const isFallbackSnapshot = Boolean(attendanceToday.is_fallback);

  const Panel = ({ title, subtitle, action, children, className = '' }) => (
    <div className={`overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-6">
        <div>
          <h3 className="text-base font-bold text-slate-800 md:text-lg">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500 md:text-sm">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-5 py-5 md:px-6">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_0%,rgba(16,185,129,0.12),transparent_38%),radial-gradient(circle_at_88%_0%,rgba(14,165,233,0.10),transparent_34%)]"></div>
        <div className="relative mx-auto max-w-[1440px] rounded-[28px] border border-emerald-100/70 bg-gradient-to-b from-emerald-50/60 via-slate-50 to-slate-100/70 p-4 shadow-sm md:p-6 lg:p-8">
          <div className="flex flex-col items-center justify-center min-h-[45vh] animate-pulse">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <div className="text-slate-500 font-medium">Loading My Dashboard...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative" style={{ padding: 20 }}>
        <div style={{ maxWidth: 720, margin: '60px auto', background: '#fff', padding: 20, borderRadius: 8, boxShadow: '0 10px 30px rgba(2,6,23,0.08)' }}>
          <h3 style={{ marginTop: 0 }}>My Dashboard Error</h3>
          <p style={{ color: '#b91c1c', fontWeight: 600 }}>{String(error)}</p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={() => loadData()}>Retry</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => window.location.reload()}>Reload Page</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="pointer-events-none absolute inset-0 "></div>
      <div className="relative mx-auto max-w-[1440px] rounded-[28px] border border-emerald-100/70 bg-gradient-to-b from-emerald-50/60 via-slate-50 to-slate-100/70 p-4 shadow-sm md:p-6 lg:p-8">
        <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white px-5 py-5 shadow-sm md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Faculty Analytics</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-4xl">My Dashboard</h1>
              <p className="mt-2 text-sm text-slate-500">{fullName}{roleLabel ? ` (${roleLabel})` : ''}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${httpsPollingActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  <span className={`h-2 w-2 rounded-full ${httpsPollingActive ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                  {httpsPollingActive ? 'HTTPS polling active' : 'Starting HTTPS polling'}
                </span>
                <span className="text-xs font-medium text-slate-500">Snapshot date: {formatDateLabel(snapshotDate)}</span>
              </div>
              {isFallbackSnapshot ? (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  No records found for today. Showing latest available attendance date.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={async () => {
                  if (refreshing) return;
                  const root = rootRef.current;
                  if (root) root.classList.add('opacity-80', 'pointer-events-none');
                  try {
                    await loadData({ silent: true });
                  } finally {
                    if (root) setTimeout(() => root.classList.remove('opacity-80', 'pointer-events-none'), 220);
                  }
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm"
              >
                <i className="bi bi-arrow-repeat"></i>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button onClick={() => jumpTo('/my-attendance')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm">
                <i className="bi bi-calendar-week"></i>
                My Schedule
              </button>
              <button onClick={() => jumpTo('/attendance-history')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm">
                <i className="bi bi-clock-history"></i>
                Attendance History
              </button>
              <button onClick={() => jumpTo('/my-requested-edits')} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm">
                <i className="bi bi-pencil-square"></i>
                Edit Requests
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Today's Records</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.total_records || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked In</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_in || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked Mid</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_mid || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked Out</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_out || 0)}</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statusButtons.map((item) => {
            const isActive = statusFilter === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatusFilter(item.key)}
                className={`group relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition-all duration-300 ${
                  isActive
                    ? 'border-emerald-300 bg-emerald-50/70 shadow-md'
                    : 'border-slate-200/70 bg-white hover:-translate-y-0.5 hover:shadow-lg'
                }`}
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-slate-100/80"></div>
                <div className="relative flex items-center gap-4">
                  <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl text-lg text-white shadow-sm ${
                    item.key === 'present' ? 'bg-emerald-600' :
                    item.key === 'late' ? 'bg-amber-500' :
                    item.key === 'absent' ? 'bg-rose-600' :
                    item.key === 'pending' ? 'bg-orange-500' :
                    item.key === 'upcoming' ? 'bg-slate-500' : 'bg-slate-800'
                  }`}>
                    <i className={item.icon}></i>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</div>
                    <div className="text-2xl font-extrabold tracking-tight text-slate-800">{item.value}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-6 2xl:grid-cols-12">
          <Panel
            title="Weekly Activity"
            subtitle="Your attendance totals over the last 7 days."
            className="2xl:col-span-4"
          >
            <div className="space-y-3">
              {weekly.length === 0 ? (
                <div className="text-sm text-slate-500">No weekly data available yet.</div>
              ) : weekly.map((item, idx) => {
                const total = Number(item?.total || 0);
                const present = Number(item?.present || 0);
                const late = Number(item?.late || 0);
                const absent = Number(item?.absent || 0);
                const pct = Math.max(4, Math.round((total / maxWeeklyTotal) * 100));
                return (
                  <div key={`${item?.d || ''}-${idx}`} className="rounded-xl border border-slate-100 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{formatDateLabel(item?.d || '-')}</span>
                      <span className="text-sm font-bold text-slate-700">{total}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      P: <span className="font-semibold text-emerald-700">{present}</span> | L: <span className="font-semibold text-amber-700">{late}</span> | A: <span className="font-semibold text-rose-700">{absent}</span>
                    </div>
                  </div>
                );
              })}
              <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 text-xs text-slate-600">
                Total 7-day records: <span className="font-bold text-slate-800">{weeklyTotals.total}</span>
              </div>
            </div>
          </Panel>

          <Panel
            title="My Attendance Records"
            subtitle="Search and filter your latest records."
            className="2xl:col-span-8"
            action={
              <div className="inline-flex rounded-xl border border-slate-200 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${viewMode === 'table' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('cards')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${viewMode === 'cards' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  Cards
                </button>
              </div>
            }
          >
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <input
                  type="text"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Search subject, section, or status"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Status</span>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(String(e.target.value || 'all'))}
                >
                  <option value="all">All</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="on_leave">On Leave</option>
                  <option value="substituted">Substituted</option>
                  <option value="pending">Pending</option>
                  <option value="upcoming">Upcoming</option>
                </select>
              </div>
            </div>

            {viewMode === 'table' ? (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Section</th>
                      <th className="px-4 py-3">Final Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No matching records.</td>
                      </tr>
                    ) : filteredRows.map((row) => (
                      <tr key={row.attendance_id} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-medium text-slate-700">{formatDateLabel(row.date || '-')}</td>
                        <td className="px-4 py-3 text-slate-700">{row.subject_code || row.subject_name || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{row.section_name || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(row.final_flag_name)}`}>
                            {attendanceFlagLabel(null, row.final_flag_name)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filteredRows.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-slate-100 py-10 text-center text-slate-500">No matching records.</div>
                ) : filteredRows.map((row) => (
                  <div key={row.attendance_id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-slate-800">{row.subject_code || row.subject_name || '-'}</h4>
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusClass(row.final_flag_name)}`}>
                        {attendanceFlagLabel(null, row.final_flag_name)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{row.section_name || '-'}</p>
                    <p className="mt-2 text-xs font-medium text-slate-600">{formatDateLabel(row.date || '-')}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 text-xs text-slate-500">
              Showing {filteredRows.length} of {myRecentRows.length} records
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default MyDashboardPage;
