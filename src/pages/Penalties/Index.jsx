import React from 'react';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet } from '../../services/api.js';
import Table from '../../components/Table.jsx';
import UserStatusBadge from '../../components/UserStatusBadge.jsx';
import useAutoRefresh, { AUTO_REFRESH_INTERVALS } from '../../utils/useAutoRefresh.js';

const TEACHING_ROLE_LABELS = {
  2: 'Dean',
  3: 'Program Head',
  4: 'Secretary',
  5: 'Teacher',
};

const badge = (text, tone = 'gray') => {
  const tones = {
    red: 'bg-red-50 text-red-700 border-red-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    gray: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>{text}</span>;
};

export default function PenaltiesPage() {
  const { user } = React.useContext(AuthContext);
  const [rows, setRows] = React.useState([]);
  const [semesterFilter, setSemesterFilter] = React.useState('active');
  const [semesterOptions, setSemesterOptions] = React.useState([]);
  const [activeSemesterId, setActiveSemesterId] = React.useState(0);
  const [error, setError] = React.useState('');
  const requestSequence = React.useRef(0);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState('all');
  const [sourceFilter, setSourceFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [pagination, setPagination] = React.useState({ page: 1, page_size: 10, total: 0, total_pages: 1 });
  const [summary, setSummary] = React.useState({ total: 0, active: 0, automatic: 0, voided: 0 });
  const [debouncedSearch, setDebouncedSearch] = React.useState('');

  React.useEffect(() => {
    if (user && ![2, 3, 4, 6].includes(Number(user.role_id))) window.location.hash = '#/dashboard';
  }, [user]);

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, sourceFilter, statusFilter, semesterFilter]);

  const fetchRows = React.useCallback(async ({ silent = false } = {}) => {
    const requestId = ++requestSequence.current;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ paginate: '1', page: String(page), page_size: '10', semester_id: semesterFilter });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (roleFilter !== 'all') params.set('role_id', roleFilter);
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const penaltiesRes = await apiGet(`penalties?${params.toString()}`);
      if (requestId !== requestSequence.current) return;
      setError('');
      setSemesterOptions(penaltiesRes?.semester_options || []);
      setActiveSemesterId(Number(penaltiesRes?.active_semester_id || 0));
      setRows(Array.isArray(penaltiesRes?.rows) ? penaltiesRes.rows : (Array.isArray(penaltiesRes) ? penaltiesRes : []));
      if (penaltiesRes?.pagination) {
        setPagination(penaltiesRes.pagination);
        if (Number(penaltiesRes.pagination.page || 1) !== page) setPage(Number(penaltiesRes.pagination.page || 1));
      }
      if (penaltiesRes?.summary) setSummary({
        total: Number(penaltiesRes.summary.total || 0),
        active: Number(penaltiesRes.summary.active || 0),
        automatic: Number(penaltiesRes.summary.automatic || 0),
        voided: Number(penaltiesRes.summary.voided || 0),
      });
    } catch (error) {
      if (requestId === requestSequence.current) {
        setError(error?.body?.message || error?.message || 'Unable to load penalties.');
        setRows([]);
        setSummary({ total: 0, active: 0, automatic: 0, voided: 0 });
        setPagination({ page: 1, page_size: 10, total: 0, total_pages: 1 });
      }
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [page, debouncedSearch, roleFilter, sourceFilter, statusFilter, semesterFilter]);

  React.useEffect(() => {
    if (user) fetchRows();
  }, [user, fetchRows]);

  useAutoRefresh({
    refresh: () => fetchRows({ silent: true }),
    intervalMs: AUTO_REFRESH_INTERVALS.HEAVY,
    enabled: Boolean(user),
  });

  const filteredRows = rows;
  const activeSemester = semesterOptions.find((semester) => Number(semester.semester_id) === activeSemesterId);
  const activeSemesterLabel = activeSemester
    ? [activeSemester.session_name, activeSemester.term].filter(Boolean).join(' / ')
    : '';

  const columns = [
    { key: 'date', label: 'Date' },
    {
      key: 'staff', label: 'Teaching Staff', render: (row) => (
        <div>
          <div className="font-semibold text-gray-900">{`${row.last_name || ''}, ${row.first_name || ''}`.replace(/^,\s*/, '') || 'Unknown user'}</div>
          <UserStatusBadge status={row.user_status} className="mt-1" />
          <div className="mt-1 text-xs text-gray-500">{TEACHING_ROLE_LABELS[Number(row.role_id)] || 'Teaching Staff'}{row.dept_name ? ` · ${row.dept_name}` : ''}</div>
        </div>
      ),
    },
    { key: 'type_name', label: 'Penalty Type', render: (row) => <span className="font-medium text-gray-800">{row.type_name || 'Penalty'}</span> },
    { key: 'source', label: 'Source', render: (row) => String(row.source).toLowerCase() === 'automatic' ? badge('Automatic', 'blue') : badge('Manual', 'gray') },
    { key: 'status', label: 'Status', render: (row) => String(row.status).toLowerCase() === 'voided' ? badge('Voided', 'gray') : badge('Active', 'red') },
    {
      key: 'reason', label: 'Reason / Remarks', render: (row) => (
        <div className="max-w-md whitespace-normal text-sm leading-5 text-gray-600" title={row.reason || ''}>{row.reason || '—'}</div>
      ),
    },
  ];

  const filterClass = 'h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';

  return (
    <div className="min-h-full bg-gray-50/70 px-4 py-5 md:px-6">
      <div className="mx-auto max-w-[1450px] space-y-4">
        <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-lg text-emerald-700"><i className="bi bi-shield-exclamation" /></div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900">Penalties &amp; Sanctions</h1>
              <p className="mt-0.5 text-sm text-gray-500">Automatic red flags after 3 overall Late or 3 overall Absent records per semester.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Total Records', summary.total, 'bi-journal-text', 'text-gray-600', 'bg-gray-50'],
            ['Active', summary.active, 'bi-exclamation-octagon', 'text-red-600', 'bg-red-50'],
            ['Automatic', summary.automatic, 'bi-lightning-charge', 'text-blue-600', 'bg-blue-50'],
            ['Voided', summary.voided, 'bi-check-circle', 'text-gray-600', 'bg-gray-50'],
          ].map(([label, value, icon, color, iconBg]) => (
            <div key={label} className="flex min-h-[78px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${iconBg} ${color}`}><i className={`bi ${icon}`} /></div>
              <div><div className="text-xl font-bold leading-none text-gray-900">{value}</div><div className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div></div>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <i className="bi bi-info-circle-fill mt-0.5" />
          <span>Late and Absent overall results are counted separately. A red flag is voided only when an approved attendance edit reduces its semester count below 3.</span>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900">Penalty records</h2>
              <p className="text-sm text-gray-500">Showing {filteredRows.length} of {Number(pagination.total || 0)} matching records</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:flex">
              <div className="relative sm:col-span-2 xl:w-72">
                <i className="bi bi-search absolute left-3 top-2.5 text-gray-400" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search staff, type, or reason" className={`${filterClass} w-full pl-9`} />
              </div>
              <select value={semesterFilter} onChange={(event) => { setSemesterFilter(event.target.value); setPage(1); }} className={filterClass} aria-label="Filter by semester">
                <option value="active">Current active semester{activeSemesterLabel ? `: ${activeSemesterLabel}` : loading ? '' : ' (none)'}</option>
                {semesterOptions.map((semester) => <option key={semester.semester_id} value={String(semester.semester_id)}>{[semester.session_name, semester.term].filter(Boolean).join(' / ')}{Number(semester.semester_id) === activeSemesterId ? ' (Current)' : ''}</option>)}
              </select>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className={filterClass} aria-label="Filter by role">
                <option value="all">All teaching roles</option>
                {Object.entries(TEACHING_ROLE_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
              <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className={filterClass} aria-label="Filter by source">
                <option value="all">All sources</option><option value="automatic">Automatic</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={filterClass} aria-label="Filter by status">
                <option value="all">All statuses</option><option value="active">Active</option><option value="voided">Voided</option>
              </select>
            </div>
          </div>
          {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
          <Table columns={columns} data={filteredRows} pageSize={10} loading={loading} emptyText="No penalty records match the selected filters." rowKey="sanction_id" wrapCells serverPagination totalItems={Number(pagination.total || 0)} page={page} onPageChange={setPage} />
        </div>
      </div>

    </div>
  );
}
