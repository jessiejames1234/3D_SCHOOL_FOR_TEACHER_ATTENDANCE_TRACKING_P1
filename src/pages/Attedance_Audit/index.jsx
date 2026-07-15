import React, { useEffect, useMemo, useState } from 'react';
import Table from '../../components/Table.jsx';
import { apiGet } from '../../services/api.js';
import { attendanceFlagLabel } from '../../utils/attendanceFlags.js';

export default function AttendanceAuditPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [q, setQ] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    apiGet('reports?report=attendance_logs')
      .then((res) => {
        if (!mounted) return;
        // res.rows should be an array of objects with keys like 'Log ID','Teacher','Action',...;
        const raw = res && Array.isArray(res.rows) ? res.rows : [];
        const normalized = raw.map((r) => {
          // build normalized keys to avoid spaces in keys
          const norm = {};
          for (const k in r) {
            const nk = String(k).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            norm[nk] = r[k];
          }
          return {
            // map common names
            edit_session_id: norm['edit_session_id'] ?? norm['edit_sessionid'] ?? norm['editsessionid'] ?? norm['edit_session'] ?? norm['session_id'] ?? norm['sessionid'] ?? null,
            log_id: norm['log_id'] ?? norm['logid'] ?? null,
            teacher: norm['teacher'] ?? '',
            action: norm['action'] ?? '',
            field: norm['field'] ?? '',
            old_value: norm['old_value'] ?? norm['oldvalue'] ?? '',
            new_value: norm['new_value'] ?? norm['newvalue'] ?? '',
            reason: norm['reason'] ?? '',
            edited_by: norm['edited_by'] ?? norm['editedby'] ?? '',
            date: norm['date'] ?? norm['edited_at'] ?? norm['editedat'] ?? '',
            // keep original in case
            __raw: r,
          };
        });
        setRows(normalized);
      })
      .catch((err) => {
        console.error(err);
        setError(err.message || 'Failed to load');
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const isFlagField = (field) => String(field || '').toLowerCase().includes('flag');

  const formatAuditFlagValue = (field, value) => {
    if (!isFlagField(field)) return value;
    if (value === null || value === undefined || value === '') return value;
    const raw = String(value).trim();
    if (/^\d+$/.test(raw)) return attendanceFlagLabel(Number(raw));
    return attendanceFlagLabel(null, raw);
  };

  const formatAuditReason = (row) => {
    const reason = row?.reason ?? '';
    if (!isFlagField(row?.field) || !reason) return reason;
    return String(reason).replace(/\bN\/A\b|\bNA\b/g, 'Upcoming');
  };

  const actionsList = useMemo(() => {
    const s = new Set();
    rows.forEach(r => { if (r.action) s.add(String(r.action)); });
    return Array.from(s).filter(Boolean).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(r => {
      if (actionFilter && String(r.action) !== String(actionFilter)) return false;
      if (startDate) {
        const d = r.date ? new Date(r.date) : null;
        if (!d || isNaN(d)) return false;
        const sD = new Date(startDate + 'T00:00:00');
        if (d < sD) return false;
      }
      if (endDate) {
        const d = r.date ? new Date(r.date) : null;
        if (!d || isNaN(d)) return false;
        const eD = new Date(endDate + 'T23:59:59');
        if (d > eD) return false;
      }
      if (!ql) return true;
      // search across text fields
      return [
        r.edit_session_id,
        r.teacher,
        r.action,
        r.field,
        formatAuditFlagValue(r.field, r.old_value),
        formatAuditFlagValue(r.field, r.new_value),
        formatAuditReason(r),
        r.edited_by,
        r.date
      ]
        .map(v => (v || '').toString().toLowerCase())
        .some(t => t.indexOf(ql) !== -1);
    });
  }, [rows, q, actionFilter, startDate, endDate]);

  const columns = [
    { key: 'edit_session_id', label: 'Session' },
    { key: 'teacher', label: 'Teacher', render: (r) => <div style={{ whiteSpace: 'normal' }}>{r.teacher}</div> },
    { key: 'action', label: 'Action' },
    { key: 'field', label: 'Field' },
    { key: 'old_value', label: 'Old Value', render: (r) => <div style={{ whiteSpace: 'normal' }}>{formatAuditFlagValue(r.field, r.old_value)}</div> },
    { key: 'new_value', label: 'New Value', render: (r) => <div style={{ whiteSpace: 'normal' }}>{formatAuditFlagValue(r.field, r.new_value)}</div> },
    { key: 'reason', label: 'Reason', render: (r) => <div style={{ whiteSpace: 'normal' }}>{formatAuditReason(r)}</div> },
    { key: 'edited_by', label: 'Edited By' },
    { key: 'date', label: 'Date', render: (r) => <div style={{ whiteSpace: 'normal' }}>{r.date}</div> },
  ];

  return (
    <div className="p-4">
      <h2 className="mb-4">Attendance Audit</h2>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm text-gray-600">Search</label>
          <input type="search" className="form-control" placeholder="Search teacher, field, values, reason..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm text-gray-600">Action</label>
          <select className="form-control" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All</option>
            {actionsList.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-600">Start Date</label>
          <input type="date" className="form-control" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm text-gray-600">End Date</label>
          <input type="date" className="form-control" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div>
          <label className="block text-sm text-gray-600">Page Size</label>
          <select className="form-control" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
            {[10,25,50,100].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div>
          <button className="btn btn-light" onClick={() => { setQ(''); setActionFilter(''); setStartDate(''); setEndDate(''); }}>
            Clear
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4">{error}</div>}

      <Table
        columns={columns}
        data={filtered}
        pageSize={pageSize}
        loading={loading}
        emptyText={loading ? 'Loading...' : 'No records found'}
      />
    </div>
  );
}
