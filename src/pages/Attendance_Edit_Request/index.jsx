import React from 'react';
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';
import { apiGet, apiPut } from '../../services/api.js';

export default function AttendanceEditRequestPage() {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('pending');
  const [actioningId, setActioningId] = React.useState(null);
  const [viewRow, setViewRow] = React.useState(null);
  const [showViewModal, setShowViewModal] = React.useState(false);
  const [targetRequestId, setTargetRequestId] = React.useState(null);
  const [approvalForm, setApprovalForm] = React.useState({
    flag_in_id: 1,
    flag_check_id: 1,
    flag_out_id: 1,
    remarks: '',
  });
  const triedAllForTargetRef = React.useRef(false);

  const FLAG_OPTIONS = [
    { id: 1, name: 'NA' },
    { id: 2, name: 'Present' },
    { id: 3, name: 'Absent' },
    { id: 4, name: 'Excused' },
    { id: 5, name: 'Late' },
  ];

  const toFlagId = (value, fallback = 1) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };

  const notifyDecisionSuccess = async (decision) => {
    const title = decision === 'approved'
      ? 'Attendance request approved'
      : 'Attendance request rejected';
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
      const data = await apiGet(`request-edit/attendance${q}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || 'Failed to load attendance edit requests';
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

  const decide = async (requestId, decision, changes = null) => {
    setActioningId(requestId);
    setError('');
    try {
      const payload = { decision };
      if (decision === 'approved' && changes && Object.keys(changes).length > 0) {
        payload.changes = changes;
      }
      await apiPut(`request-edit/attendance/${requestId}`, payload);
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
    setApprovalForm({
      flag_in_id: toFlagId(row.flag_in_id, 1),
      flag_check_id: toFlagId(row.flag_check_id, 1),
      flag_out_id: toFlagId(row.flag_out_id, 1),
      remarks: row.attendance_remarks || '',
    });
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

  const getFlagLabel = (flagId, flagName) => {
    if (flagName) return flagName;
    const id = Number(flagId);
    if (id === 1) return 'NA';
    if (id === 2) return 'Present';
    if (id === 3) return 'Absent';
    if (id === 4) return 'Excused';
    if (id === 5) return 'Late';
    return flagId || '-';
  };

  const flagBubbleClass = (flagId, flagName) => {
    const label = String(getFlagLabel(flagId, flagName)).toLowerCase();
    if (label === 'present') return 'bg-[#e8f5ee] text-[#1D8551] border-[#b7e0c9]';
    if (label === 'absent') return 'bg-rose-100 text-rose-800 border-rose-300';
    if (label === 'late') return 'bg-amber-100 text-amber-800 border-amber-300';
    if (label === 'excused') return 'bg-blue-100 text-blue-800 border-blue-300';
    return 'bg-slate-100 text-slate-700 border-slate-300';
  };

  const FlagBubble = ({ flagId, flagName, prefix = '' }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${flagBubbleClass(flagId, flagName)}`}>
      {prefix ? <span className="opacity-80">{prefix}</span> : null}
      <span>{getFlagLabel(flagId, flagName)}</span>
    </span>
  );

  const pendingInView = String(viewRow?.status || '').toLowerCase() === 'pending';

  const buildApprovalChanges = () => {
    if (!viewRow) return {};
    const changes = {};
    const nextIn = toFlagId(approvalForm.flag_in_id, toFlagId(viewRow.flag_in_id, 1));
    const nextMid = toFlagId(approvalForm.flag_check_id, toFlagId(viewRow.flag_check_id, 1));
    const nextOut = toFlagId(approvalForm.flag_out_id, toFlagId(viewRow.flag_out_id, 1));
    if (nextIn !== toFlagId(viewRow.flag_in_id, 1)) changes.flag_in_id = nextIn;
    if (nextMid !== toFlagId(viewRow.flag_check_id, 1)) changes.flag_check_id = nextMid;
    if (nextOut !== toFlagId(viewRow.flag_out_id, 1)) changes.flag_out_id = nextOut;
    const nextRemarks = String(approvalForm.remarks || '').trim();
    const prevRemarks = String(viewRow.attendance_remarks || '').trim();
    if (nextRemarks !== prevRemarks) changes.remarks = nextRemarks;
    return changes;
  };

  const columns = [
    { key: 'teacher', label: 'Teacher', render: (row) => row.teacher_name || '-' },
    { key: 'date', label: 'Date', render: (row) => row.attendance_date || '-' },
    { key: 'subject', label: 'Subject', render: (row) => <span className="font-semibold">{row.subject_code || '-'}</span> },
    { key: 'schedule', label: 'Schedule', render: (row) => `${formatTimeAmPm(row.schedule_start_time)} - ${formatTimeAmPm(row.schedule_end_time)}` },
    {
      key: 'current_status',
      label: 'Current Status',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <FlagBubble flagId={row.flag_in_id} flagName={row.flag_in_name} prefix="IN" />
          <FlagBubble flagId={row.flag_check_id} flagName={row.flag_check_name} prefix="MID" />
          <FlagBubble flagId={row.flag_out_id} flagName={row.flag_out_name} prefix="OUT" />
        </div>
      )
    },
    { key: 'reason', label: 'Reason', render: (row) => row.reason || '-' },
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
          <h2 className="text-2xl font-bold text-gray-800">Attendance Edit Requests</h2>
          <p className="text-sm text-gray-500">Dean review queue filtered by your department.</p>
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
        emptyText={loading ? 'Loading...' : 'No attendance edit requests found.'}
        pageSize={10}
      />

      <Modal
        show={showViewModal}
        title="Attendance Edit Request Details"
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
            {pendingInView ? (
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
                  onClick={() => decide(viewRow.request_id, 'approved', buildApprovalChanges())}
                  className="px-4 py-2 rounded-lg bg-[#1D8551] text-white text-sm font-semibold hover:bg-[#176b41] disabled:opacity-60"
                  disabled={actioningId === viewRow.request_id}
                >
                  {actioningId === viewRow.request_id ? 'Approving...' : 'Approve & Update Attendance'}
                </button>
              </>
            ) : null}
          </>
        )}
      >
        {!viewRow ? (
          <div className="text-sm text-gray-600">No request selected.</div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#b7e0c9] bg-gradient-to-r from-[#e8f5ee] to-teal-50 px-5 py-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[#1D8551] font-bold">Attendance Edit Request</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{viewRow.teacher_name || '-'}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {viewRow.subject_code || '-'}{viewRow.subject_name ? ` - ${viewRow.subject_name}` : ''} | {viewRow.section_name || '-'} | {viewRow.attendance_date || '-'}
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
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Decided By</span><span className="font-medium text-gray-900 text-right">{viewRow.decided_by_name || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Room</span><span className="font-medium text-gray-900 text-right">{viewRow.room_name || '-'}</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Schedule</span><span className="font-medium text-gray-900 text-right">{formatTimeAmPm(viewRow.schedule_start_time)} - {formatTimeAmPm(viewRow.schedule_end_time)}</span></div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Current Flags</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
                    <div className="text-[11px] uppercase text-gray-500 font-bold">IN</div>
                    <div className="mt-1">
                      <FlagBubble flagId={viewRow.flag_in_id} flagName={viewRow.flag_in_name} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
                    <div className="text-[11px] uppercase text-gray-500 font-bold">MID</div>
                    <div className="mt-1">
                      <FlagBubble flagId={viewRow.flag_check_id} flagName={viewRow.flag_check_name} />
                    </div>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-center">
                    <div className="text-[11px] uppercase text-gray-500 font-bold">OUT</div>
                    <div className="mt-1">
                      <FlagBubble flagId={viewRow.flag_out_id} flagName={viewRow.flag_out_name} />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {pendingInView ? (
              <div className="rounded-xl border border-[#b7e0c9] bg-[#e8f5ee]/60 p-4">
                <div className="text-xs uppercase tracking-wide text-[#1D8551] font-semibold mb-3">Edit Flags Before Approve</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">IN Status</label>
                    <select
                      value={approvalForm.flag_in_id}
                      onChange={(e) => setApprovalForm((prev) => ({ ...prev, flag_in_id: toFlagId(e.target.value, 1) }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D8551]/35"
                    >
                      {FLAG_OPTIONS.map((opt) => (
                        <option key={`flag-in-${opt.id}`} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                    <div className="mt-2"><FlagBubble flagId={approvalForm.flag_in_id} /></div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">MID Status</label>
                    <select
                      value={approvalForm.flag_check_id}
                      onChange={(e) => setApprovalForm((prev) => ({ ...prev, flag_check_id: toFlagId(e.target.value, 1) }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D8551]/35"
                    >
                      {FLAG_OPTIONS.map((opt) => (
                        <option key={`flag-mid-${opt.id}`} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                    <div className="mt-2"><FlagBubble flagId={approvalForm.flag_check_id} /></div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">OUT Status</label>
                    <select
                      value={approvalForm.flag_out_id}
                      onChange={(e) => setApprovalForm((prev) => ({ ...prev, flag_out_id: toFlagId(e.target.value, 1) }))}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D8551]/35"
                    >
                      {FLAG_OPTIONS.map((opt) => (
                        <option key={`flag-out-${opt.id}`} value={opt.id}>{opt.name}</option>
                      ))}
                    </select>
                    <div className="mt-2"><FlagBubble flagId={approvalForm.flag_out_id} /></div>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Attendance Remarks (optional)</label>
                  <textarea
                    value={approvalForm.remarks}
                    onChange={(e) => setApprovalForm((prev) => ({ ...prev, remarks: e.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1D8551]/35"
                    placeholder="Add final remarks for attendance record"
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">Reason</div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{viewRow.reason || '-'}</div>
            </div>

            {viewRow.attendance_remarks ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-700 font-semibold mb-2">Attendance Remarks</div>
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{viewRow.attendance_remarks}</div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    </div>
  );
}
