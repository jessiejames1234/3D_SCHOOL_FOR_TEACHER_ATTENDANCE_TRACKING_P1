import React from 'react';
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet, apiPut } from '../../services/api.js';

export default function ScheduleEditRequestPage() {
  const { user } = React.useContext(AuthContext) || {};
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('pending');
  const [actioningId, setActioningId] = React.useState(null);
  const [viewRow, setViewRow] = React.useState(null);
  const [showViewModal, setShowViewModal] = React.useState(false);
  const [targetRequestId, setTargetRequestId] = React.useState(null);
  const triedAllForTargetRef = React.useRef(false);
  const canDecide = Number(user?.role_id || 0) === 4;

  const notifyDecisionSuccess = async (decision) => {
    const title = decision === 'approved'
      ? 'Schedule request approved'
      : 'Schedule request rejected';
    if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
      await window.Swal.fire({ icon: 'success', title, timer: 1400, showConfirmButton: false });
      return;
    }
    alert(title);
  };

  const getTargetRequestIdFromHash = () => {
    if (typeof window === 'undefined') return null;
    const hash = String(window.location.hash || '');
    const qPos = hash.indexOf('?');
    if (qPos < 0) return null;
    const params = new URLSearchParams(hash.slice(qPos + 1));
    const idRaw = params.get('request_id') || params.get('requestId');
    const id = Number(idRaw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const clearTargetRequestIdFromHash = () => {
    if (typeof window === 'undefined') return;
    const rawHash = String(window.location.hash || '');
    const hash = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    const qPos = hash.indexOf('?');
    if (qPos < 0) return;
    const path = hash.slice(0, qPos);
    const params = new URLSearchParams(hash.slice(qPos + 1));
    const hadRequest = params.has('request_id') || params.has('requestId');
    if (!hadRequest) return;
    params.delete('request_id');
    params.delete('requestId');
    const nextQuery = params.toString();
    const nextHash = '#' + path + (nextQuery ? `?${nextQuery}` : '');
    window.history.replaceState(null, '', nextHash);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const q = statusFilter === 'all' ? '' : `?status=${statusFilter}`;
      const data = await apiGet(`request-edit/schedule${q}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || 'Failed to load schedule edit requests';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, [statusFilter]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncTargetFromHash = () => {
      setTargetRequestId(getTargetRequestIdFromHash());
      triedAllForTargetRef.current = false;
    };
    syncTargetFromHash();
    window.addEventListener('hashchange', syncTargetFromHash);
    return () => window.removeEventListener('hashchange', syncTargetFromHash);
  }, []);

  const decide = async (requestId, decision) => {
    setActioningId(requestId);
    setError('');
    try {
      await apiPut(`request-edit/schedule/${requestId}`, { decision });
      await load();
      await notifyDecisionSuccess(decision);
      closeView();
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || `Failed to ${decision} request`;
      setError(String(msg));
    } finally {
      setActioningId(null);
    }
  };

  const statusClass = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 'bg-[#e8f5ee] text-[#1D8551] border-[#b7e0c9]';
    if (s === 'rejected') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const openView = (row) => {
    setViewRow(row);
    setShowViewModal(true);
  };

  const closeView = () => {
    setShowViewModal(false);
    setViewRow(null);
  };

  React.useEffect(() => {
    if (!targetRequestId || loading) return;
    const matchedRow = rows.find((row) => Number(row?.request_id) === Number(targetRequestId));
    if (matchedRow) {
      openView(matchedRow);
      clearTargetRequestIdFromHash();
      setTargetRequestId(null);
      triedAllForTargetRef.current = false;
      return;
    }
    if (statusFilter !== 'all' && !triedAllForTargetRef.current) {
      triedAllForTargetRef.current = true;
      setStatusFilter('all');
      return;
    }
    if (statusFilter === 'all') {
      setTargetRequestId(null);
      triedAllForTargetRef.current = false;
    }
  }, [targetRequestId, loading, rows, statusFilter]);

  const formatTimeAmPm = (value) => {
    if (value === null || value === undefined || value === '') return '--:--';
    const raw = String(value).trim();
    const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (m) {
      let hour = Number(m[1]);
      const minute = m[2];
      if (!Number.isFinite(hour) || hour < 0 || hour > 23) return raw;
      const suffix = hour >= 12 ? 'PM' : 'AM';
      hour = hour % 12 || 12;
      return `${hour}:${minute} ${suffix}`;
    }
    const dt = new Date(raw.includes('T') ? raw : `1970-01-01T${raw}`);
    if (Number.isNaN(dt.getTime())) return raw;
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const columns = [
    { key: 'teacher', label: 'Teacher', render: (row) => row.teacher_name || '-' },
    { key: 'subject', label: 'Subject', render: (row) => <span className="font-semibold">{row.subject_code || '-'}</span> },
    { key: 'section', label: 'Section', render: (row) => row.section_name || '-' },
    {
      key: 'original',
      label: 'Original Schedule',
      render: (row) => (
        <div className="whitespace-normal leading-snug">
          {row.original_day_of_week || '-'} {formatTimeAmPm(row.original_start_time)}-{formatTimeAmPm(row.original_end_time)} | {row.original_room_name || '-'}
        </div>
      )
    },
    {
      key: 'change',
      label: 'Requested Change',
      render: (row) => {
        const changes = [];
        if (row.new_day_of_week) changes.push(`Day: ${row.new_day_of_week}`);
        if (row.new_start_time) changes.push(`Start: ${formatTimeAmPm(row.new_start_time)}`);
        if (row.new_end_time) changes.push(`End: ${formatTimeAmPm(row.new_end_time)}`);
        if (row.new_room_name) changes.push(`Room: ${row.new_room_name}`);
        if (!row.new_room_name && row.new_room_id) changes.push(`Room ID: ${row.new_room_id}`);
        return <div className="whitespace-normal leading-snug">{changes.length ? changes.join(' | ') : 'No changes'}</div>;
      }
    },
    { key: 'reason', label: 'Reason', render: (row) => <div className="whitespace-normal leading-snug">{row.reason || '-'}</div> },
    { key: 'requester', label: 'Requester', render: (row) => row.requested_by_name || '-' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span className={`px-2 py-1 rounded-full border text-xs font-bold ${statusClass(row.status)}`}>
          {row.status || 'pending'}
        </span>
      )
    },
    {
      key: 'actions',
      label: 'Actions',
      actions: (row) => [{ label: 'View', onClick: () => openView(row) }]
    }
  ];

  return (
    <div className="p-4 md:p-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">Schedule Edit Requests</h2>
          <p className="text-sm text-gray-500">Department schedule edit request queue.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 rounded-lg bg-[#1D8551] text-white text-sm font-semibold hover:bg-[#176b41] w-full md:w-auto"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {['pending', 'approved', 'rejected', 'all'].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 rounded-lg border text-sm font-bold ${statusFilter === f ? 'bg-[#1D8551] text-white border-[#1D8551]' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {error ? (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      ) : null}

      <Table
        columns={columns}
        data={rows}
        rowKey="request_id"
        loading={loading}
        emptyText={loading ? 'Loading...' : 'No schedule edit requests found.'}
        pageSize={10}
        small
        wrapCells
        horizontalScroll={false}
      />

      <Modal
        show={showViewModal}
        title="Schedule Edit Request Details"
        onClose={closeView}
        size="xl"
        footer={!viewRow ? null : (
          <>
            <button
              type="button"
              onClick={closeView}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-100"
              disabled={actioningId === viewRow.request_id}
            >
              Close
            </button>
            {canDecide && String(viewRow.status || '').toLowerCase() === 'pending' ? (
              <>
                <button
                  type="button"
                  onClick={() => decide(viewRow.request_id, 'rejected')}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
                  disabled={actioningId === viewRow.request_id}
                >
                  {actioningId === viewRow.request_id ? 'Rejecting...' : 'Reject'}
                </button>
                <button
                  type="button"
                  onClick={() => decide(viewRow.request_id, 'approved')}
                  className="px-4 py-2 rounded-lg bg-[#1D8551] text-white text-sm font-semibold hover:bg-[#176b41] disabled:opacity-60"
                  disabled={actioningId === viewRow.request_id}
                >
                  {actioningId === viewRow.request_id ? 'Approving...' : 'Approve'}
                </button>
              </>
            ) : null}
          </>
        )}
      >
        {!viewRow ? (
          <div className="text-sm text-gray-600">No request selected.</div>
        ) : (
          <div className="space-y-5 rounded-2xl border border-[#d4eadc] bg-[#eef8f2] p-4">
            <div className="rounded-2xl border border-[#b7e0c9] bg-gradient-to-r from-[#e8f5ee] to-[#f3fbf6] px-5 py-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#1D8551] font-bold">Schedule Edit Request</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{viewRow.teacher_name || '-'}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {viewRow.subject_code || '-'}{viewRow.subject_name ? ` - ${viewRow.subject_name}` : ''} | {viewRow.section_name || '-'}
                  </div>
                </div>
                <div className="md:text-right">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Request Status</div>
                  <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-bold ${statusClass(viewRow.status)}`}>
                    {String(viewRow.status || 'pending').toUpperCase()}
                  </span>
                  <div className="text-xs text-gray-500 mt-2">Request #{viewRow.request_id || '-'}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Request Context</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Requester</span><span className="font-medium text-gray-900 text-right">{viewRow.requested_by_name || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Decided By</span><span className="font-medium text-gray-900 text-right">{viewRow.approved_by_name || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Subject</span><span className="font-medium text-gray-900 text-right">{viewRow.subject_code || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Section</span><span className="font-medium text-gray-900 text-right">{viewRow.section_name || '-'}</span></div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Original Schedule</div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Day</span><span className="font-medium text-gray-900 text-right">{viewRow.original_day_of_week || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Time</span><span className="font-medium text-gray-900 text-right">{formatTimeAmPm(viewRow.original_start_time)} - {formatTimeAmPm(viewRow.original_end_time)}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Room</span><span className="font-medium text-gray-900 text-right">{viewRow.original_room_name || '-'}</span></div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
              <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold mb-2">Requested Change</div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">Day</div>
                  <div className="font-semibold text-gray-900 mt-1">{viewRow.new_day_of_week || '-'}</div>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">Start</div>
                  <div className="font-semibold text-gray-900 mt-1">{viewRow.new_start_time ? formatTimeAmPm(viewRow.new_start_time) : '-'}</div>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">End</div>
                  <div className="font-semibold text-gray-900 mt-1">{viewRow.new_end_time ? formatTimeAmPm(viewRow.new_end_time) : '-'}</div>
                </div>
                <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">Room</div>
                  <div className="font-semibold text-gray-900 mt-1">{viewRow.new_room_name || (viewRow.new_room_id ? `Room ID ${viewRow.new_room_id}` : '-')}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">Reason</div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{viewRow.reason || '-'}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
