import React from 'react';
import Modal from '../../components/Modal.jsx';
import { apiGet } from '../../services/api.js';
import { attendanceFlagKey, attendanceFlagLabel } from '../../utils/attendanceFlags.js';

export default function RequestEditIndex() {
  const [activeTab, setActiveTab] = React.useState('attendance');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attendanceRequests, setAttendanceRequests] = React.useState([]);
  const [scheduleRequests, setScheduleRequests] = React.useState([]);
  const [viewAttendanceRow, setViewAttendanceRow] = React.useState(null);
  const [viewScheduleRow, setViewScheduleRow] = React.useState(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [attendanceData, scheduleData] = await Promise.all([
        apiGet('request-edit/attendance?scope=my'),
        apiGet('request-edit/schedule?scope=my')
      ]);
      setAttendanceRequests(Array.isArray(attendanceData) ? attendanceData : []);
      setScheduleRequests(Array.isArray(scheduleData) ? scheduleData : []);
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || 'Failed to load requested edits';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    load();
  }, []);

  const fmt = (dt) => {
    if (!dt) return '-';
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return String(dt);
    return d.toLocaleString();
  };

  const statusClass = (status) => {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (s === 'rejected') return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-amber-50 text-amber-700 border-amber-200';
  };

  const deanMessage = (row) => {
    const status = String(row?.status || '').toLowerCase();
    const explicitNote = String(
      row?.dean_message ||
      row?.decision_note ||
      row?.reviewer_note ||
      row?.approval_note ||
      row?.rejection_note ||
      ''
    ).trim();
    if (explicitNote) return explicitNote;
    if (status !== 'approved') return '-';
    const message = String(row?.attendance_remarks || '').trim();
    return message || '-';
  };

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
    return attendanceFlagLabel(flagId, flagName);
  };

  const flagBubbleClass = (flagId, flagName) => {
    const key = attendanceFlagKey(flagId, flagName);
    if (key === 'present') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (key === 'absent') return 'bg-rose-50 text-rose-700 border-rose-200';
    if (key === 'late') return 'bg-amber-50 text-amber-700 border-amber-200';
    if (key === 'substituted') return 'bg-blue-50 text-blue-700 border-blue-200';
    if (key === 'on_leave') return 'bg-sky-50 text-sky-700 border-sky-200';
    if (key === 'pending') return 'bg-orange-50 text-orange-700 border-orange-200';
    if (key === 'upcoming') return 'bg-slate-50 text-slate-700 border-slate-200';
    return 'bg-slate-50 text-slate-700 border-slate-200';
  };

  const FlagBubble = ({ flagId, flagName, prefix = '' }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${flagBubbleClass(flagId, flagName)}`}>
      {prefix ? <span className="opacity-80">{prefix}</span> : null}
      <span>{getFlagLabel(flagId, flagName)}</span>
    </span>
  );

  const DetailRow = ({ label, value }) => (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right">{value || '-'}</span>
    </div>
  );

  const buildScheduleChangeParts = (row, useFormattedTime = false) => {
    const changeParts = [];
    if (row?.new_day_of_week) changeParts.push(`Day: ${row.new_day_of_week}`);
    if (row?.new_start_time) changeParts.push(`Start: ${useFormattedTime ? formatTimeAmPm(row.new_start_time) : row.new_start_time}`);
    if (row?.new_end_time) changeParts.push(`End: ${useFormattedTime ? formatTimeAmPm(row.new_end_time) : row.new_end_time}`);
    if (row?.new_room_name) changeParts.push(`Room: ${row.new_room_name}`);
    if (!row?.new_room_name && row?.new_room_id) changeParts.push(`Room ID: ${row.new_room_id}`);
    return changeParts;
  };

  const closeAttendanceView = () => setViewAttendanceRow(null);
  const closeScheduleView = () => setViewScheduleRow(null);

  const renderAttendanceTable = () => (
    <div className="overflow-auto border border-gray-200 rounded-xl bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Requested On</th>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Subject</th>
            <th className="px-3 py-2 text-left">Section</th>
            <th className="px-3 py-2 text-left">Room</th>
            <th className="px-3 py-2 text-left">My Reason</th>
            <th className="px-3 py-2 text-left">Reviewer Message</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Decided By</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {attendanceRequests.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-gray-500" colSpan={10}>No attendance edit requests yet.</td>
            </tr>
          ) : attendanceRequests.map((row) => (
            <tr key={`attendance-${row.request_id}`} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-gray-700">{fmt(row.created_at)}</td>
              <td className="px-3 py-2 text-gray-700">{row.attendance_date || '-'}</td>
              <td className="px-3 py-2 text-gray-700 font-semibold">{row.subject_code || '-'}</td>
              <td className="px-3 py-2 text-gray-700">{row.section_name || '-'}</td>
              <td className="px-3 py-2 text-gray-700">{row.room_name || '-'}</td>
              <td className="px-3 py-2 text-gray-700">
                <div className="max-w-xs whitespace-pre-wrap leading-snug">{row.reason || '-'}</div>
              </td>
              <td className="px-3 py-2 text-gray-700">
                <div className="max-w-xs whitespace-pre-wrap leading-snug">{deanMessage(row)}</div>
              </td>
              <td className="px-3 py-2">
                <span className={`px-2 py-1 rounded-full border text-xs font-bold ${statusClass(row.status)}`}>
                  {row.status || 'pending'}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-700">{row.decided_by_name || '-'}</td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => setViewAttendanceRow(row)}
                  className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                >
                  View
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderScheduleTable = () => (
    <div className="overflow-auto border border-gray-200 rounded-xl bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wider">
          <tr>
            <th className="px-3 py-2 text-left">Requested On</th>
            <th className="px-3 py-2 text-left">Subject</th>
            <th className="px-3 py-2 text-left">Section</th>
            <th className="px-3 py-2 text-left">Original</th>
            <th className="px-3 py-2 text-left">Requested Change</th>
            <th className="px-3 py-2 text-left">Reason</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Decided By</th>
            <th className="px-3 py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {scheduleRequests.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-gray-500" colSpan={9}>No schedule edit requests yet.</td>
            </tr>
          ) : scheduleRequests.map((row) => {
            const originalText = `${row.original_day_of_week || '-'} ${formatTimeAmPm(row.original_start_time)}-${formatTimeAmPm(row.original_end_time)} | ${row.original_room_name || '-'}`;
            const changeParts = buildScheduleChangeParts(row, true);
            const changeText = changeParts.length ? changeParts.join(' | ') : 'No changes';
            return (
              <tr key={`schedule-${row.request_id}`} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-gray-700">{fmt(row.requested_at)}</td>
                <td className="px-3 py-2 text-gray-700 font-semibold">{row.subject_code || '-'}</td>
                <td className="px-3 py-2 text-gray-700">{row.section_name || '-'}</td>
                <td className="px-3 py-2 text-gray-700">{originalText}</td>
                <td className="px-3 py-2 text-gray-700">{changeText}</td>
                <td className="px-3 py-2 text-gray-700">{row.reason || '-'}</td>
                <td className="px-3 py-2">
                  <span className={`px-2 py-1 rounded-full border text-xs font-bold ${statusClass(row.status)}`}>
                    {row.status || 'pending'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-700">{row.approved_by_name || '-'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setViewScheduleRow(row)}
                    className="px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                  >
                    View
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderAttendanceModal = () => {
    const message = deanMessage(viewAttendanceRow);
    return (
      <Modal
        show={!!viewAttendanceRow}
        title="Attendance Request Details"
        onClose={closeAttendanceView}
        size="xl"
        footer={(
          <button
            type="button"
            onClick={closeAttendanceView}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-100"
          >
            Close
          </button>
        )}
      >
        {!viewAttendanceRow ? null : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-emerald-700 font-bold">Attendance Edit Request</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{viewAttendanceRow.teacher_name || viewAttendanceRow.requested_by_name || '-'}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {viewAttendanceRow.subject_code || '-'}{viewAttendanceRow.subject_name ? ` - ${viewAttendanceRow.subject_name}` : ''} | {viewAttendanceRow.section_name || '-'} | {viewAttendanceRow.attendance_date || '-'}
                  </div>
                </div>
                <div className="md:text-right">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Status</div>
                  <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-bold ${statusClass(viewAttendanceRow.status)}`}>
                    {String(viewAttendanceRow.status || 'pending').toUpperCase()}
                  </span>
                  <div className="text-xs text-gray-500 mt-2">Request #{viewAttendanceRow.request_id || '-'}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Request Context</div>
                <div className="space-y-2">
                  <DetailRow label="Requested On" value={fmt(viewAttendanceRow.created_at)} />
                  <DetailRow label="Requester" value={viewAttendanceRow.requested_by_name} />
                  <DetailRow label="Decided By" value={viewAttendanceRow.decided_by_name} />
                  <DetailRow label="Attendance ID" value={viewAttendanceRow.attendance_id} />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Class Details</div>
                <div className="space-y-2">
                  <DetailRow label="Date" value={viewAttendanceRow.attendance_date} />
                  <DetailRow label="Schedule" value={`${formatTimeAmPm(viewAttendanceRow.schedule_start_time)} - ${formatTimeAmPm(viewAttendanceRow.schedule_end_time)}`} />
                  <DetailRow label="Room" value={viewAttendanceRow.room_name} />
                  <DetailRow label="Subject" value={viewAttendanceRow.subject_code || viewAttendanceRow.subject_name} />
                  <DetailRow label="Section" value={viewAttendanceRow.section_name} />
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Attendance Status</div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">IN</div>
                  <div className="mt-2"><FlagBubble flagId={viewAttendanceRow.flag_in_id} flagName={viewAttendanceRow.flag_in_name} /></div>
                  <div className="text-xs text-gray-500 mt-2">{formatTimeAmPm(viewAttendanceRow.checked_in_at)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">MID</div>
                  <div className="mt-2"><FlagBubble flagId={viewAttendanceRow.flag_check_id} flagName={viewAttendanceRow.flag_check_name} /></div>
                  <div className="text-xs text-gray-500 mt-2">{formatTimeAmPm(viewAttendanceRow.checked_mid_at)}</div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <div className="text-[11px] uppercase text-gray-500 font-bold">OUT</div>
                  <div className="mt-2"><FlagBubble flagId={viewAttendanceRow.flag_out_id} flagName={viewAttendanceRow.flag_out_name} /></div>
                  <div className="text-xs text-gray-500 mt-2">{formatTimeAmPm(viewAttendanceRow.checked_out_at)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">My Reason</div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{viewAttendanceRow.reason || '-'}</div>
            </div>

            {message !== '-' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-700 font-semibold mb-2">Reviewer Message</div>
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{message}</div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    );
  };

  const renderScheduleModal = () => {
    const message = deanMessage(viewScheduleRow);
    const changes = buildScheduleChangeParts(viewScheduleRow, true);
    return (
      <Modal
        show={!!viewScheduleRow}
        title="Schedule Request Details"
        onClose={closeScheduleView}
        size="xl"
        footer={(
          <button
            type="button"
            onClick={closeScheduleView}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-100"
          >
            Close
          </button>
        )}
      >
        {!viewScheduleRow ? null : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-emerald-700 font-bold">Schedule Edit Request</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">{viewScheduleRow.teacher_name || viewScheduleRow.requested_by_name || '-'}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {viewScheduleRow.subject_code || '-'}{viewScheduleRow.subject_name ? ` - ${viewScheduleRow.subject_name}` : ''} | {viewScheduleRow.section_name || '-'}
                  </div>
                </div>
                <div className="md:text-right">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Status</div>
                  <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-bold ${statusClass(viewScheduleRow.status)}`}>
                    {String(viewScheduleRow.status || 'pending').toUpperCase()}
                  </span>
                  <div className="text-xs text-gray-500 mt-2">Request #{viewScheduleRow.request_id || '-'}</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Request Context</div>
                <div className="space-y-2">
                  <DetailRow label="Requested On" value={fmt(viewScheduleRow.requested_at)} />
                  <DetailRow label="Requester" value={viewScheduleRow.requested_by_name} />
                  <DetailRow label="Decided By" value={viewScheduleRow.approved_by_name} />
                  <DetailRow label="Schedule ID" value={viewScheduleRow.schedule_id} />
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Class Details</div>
                <div className="space-y-2">
                  <DetailRow label="Teacher" value={viewScheduleRow.teacher_name} />
                  <DetailRow label="Subject" value={viewScheduleRow.subject_code || viewScheduleRow.subject_name} />
                  <DetailRow label="Section" value={viewScheduleRow.section_name} />
                  <DetailRow label="Semester ID" value={viewScheduleRow.semester_id} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-3">Original Schedule</div>
                <div className="space-y-2">
                  <DetailRow label="Day" value={viewScheduleRow.original_day_of_week} />
                  <DetailRow label="Time" value={`${formatTimeAmPm(viewScheduleRow.original_start_time)} - ${formatTimeAmPm(viewScheduleRow.original_end_time)}`} />
                  <DetailRow label="Room" value={viewScheduleRow.original_room_name || (viewScheduleRow.original_room_id ? `Room ID ${viewScheduleRow.original_room_id}` : '-')} />
                </div>
              </div>

              <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                <div className="text-xs uppercase tracking-wide text-indigo-700 font-semibold mb-3">Requested Change</div>
                <div className="space-y-2">
                  <DetailRow label="Day" value={viewScheduleRow.new_day_of_week || 'No change'} />
                  <DetailRow label="Start" value={viewScheduleRow.new_start_time ? formatTimeAmPm(viewScheduleRow.new_start_time) : 'No change'} />
                  <DetailRow label="End" value={viewScheduleRow.new_end_time ? formatTimeAmPm(viewScheduleRow.new_end_time) : 'No change'} />
                  <DetailRow label="Room" value={viewScheduleRow.new_room_name || (viewScheduleRow.new_room_id ? `Room ID ${viewScheduleRow.new_room_id}` : 'No change')} />
                </div>
                <div className="mt-3 text-xs text-gray-500">{changes.length ? changes.join(' | ') : 'No changes listed'}</div>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <div className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-2">My Reason</div>
              <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{viewScheduleRow.reason || '-'}</div>
            </div>

            {message !== '-' ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-700 font-semibold mb-2">Reviewer Message</div>
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{message}</div>
              </div>
            ) : null}
          </div>
        )}
      </Modal>
    );
  };

  return (
    <div className="p-4 md:p-8 bg-gray-50 min-h-screen">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">My Requested Edits</h2>
          <p className="text-sm text-gray-500">Track your attendance and schedule edit requests.</p>
        </div>
        <button
          type="button"
          onClick={load}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 w-full md:w-auto"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setActiveTab('attendance')}
          className={`px-4 py-2 rounded-lg text-sm font-bold border ${activeTab === 'attendance' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-300'}`}
        >
          Attendance Requests
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('schedule')}
          className={`px-4 py-2 rounded-lg text-sm font-bold border ${activeTab === 'schedule' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-700 border-gray-300'}`}
        >
          Schedule Requests
        </button>
      </div>

      {error ? (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      ) : null}

      {activeTab === 'attendance' ? renderAttendanceTable() : renderScheduleTable()}
      {renderAttendanceModal()}
      {renderScheduleModal()}
    </div>
  );
}
