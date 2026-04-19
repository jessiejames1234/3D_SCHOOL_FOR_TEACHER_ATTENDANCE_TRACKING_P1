import React from 'react';
import { apiGet } from '../../services/api.js';

export default function RequestEditIndex() {
  const [activeTab, setActiveTab] = React.useState('attendance');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attendanceRequests, setAttendanceRequests] = React.useState([]);
  const [scheduleRequests, setScheduleRequests] = React.useState([]);

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
            <th className="px-3 py-2 text-left">Reason</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Decided By</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {attendanceRequests.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-gray-500" colSpan={8}>No attendance edit requests yet.</td>
            </tr>
          ) : attendanceRequests.map((row) => (
            <tr key={`attendance-${row.request_id}`} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-gray-700">{fmt(row.created_at)}</td>
              <td className="px-3 py-2 text-gray-700">{row.attendance_date || '-'}</td>
              <td className="px-3 py-2 text-gray-700 font-semibold">{row.subject_code || '-'}</td>
              <td className="px-3 py-2 text-gray-700">{row.section_name || '-'}</td>
              <td className="px-3 py-2 text-gray-700">{row.room_name || '-'}</td>
              <td className="px-3 py-2 text-gray-700">{row.reason || '-'}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-1 rounded-full border text-xs font-bold ${statusClass(row.status)}`}>
                  {row.status || 'pending'}
                </span>
              </td>
              <td className="px-3 py-2 text-gray-700">{row.decided_by_name || '-'}</td>
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
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {scheduleRequests.length === 0 ? (
            <tr>
              <td className="px-3 py-6 text-center text-gray-500" colSpan={8}>No schedule edit requests yet.</td>
            </tr>
          ) : scheduleRequests.map((row) => {
            const originalText = `${row.original_day_of_week || '-'} ${row.original_start_time || '--:--'}-${row.original_end_time || '--:--'} | ${row.original_room_name || '-'}`;
            const changeParts = [];
            if (row.new_day_of_week) changeParts.push(`Day: ${row.new_day_of_week}`);
            if (row.new_start_time) changeParts.push(`Start: ${row.new_start_time}`);
            if (row.new_end_time) changeParts.push(`End: ${row.new_end_time}`);
            if (row.new_room_name) changeParts.push(`Room: ${row.new_room_name}`);
            if (!row.new_room_name && row.new_room_id) changeParts.push(`Room ID: ${row.new_room_id}`);
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
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

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
    </div>
  );
}
