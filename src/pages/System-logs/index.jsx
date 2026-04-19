import React, { useEffect, useMemo, useState, useContext } from 'react';
import Table from '../../components/Table.jsx';
import { apiGet } from '../../services/api.js';
import { AuthContext } from '../../context/AuthContext.jsx'; // Import AuthContext to identify who is logged in

export default function SystemLogsPage() {
  // Get current user to enforce the strict Department/Role visibility
  const { user } = useContext(AuthContext) || {}; 

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [q, setQ] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pageSize, setPageSize] = useState(10);

  const toTitleWords = (value) => String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const toDetailsText = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      try { return JSON.stringify(value); } catch (e) { return String(value); }
    }
    return String(value);
  };

  const parseJsonSafe = (value) => {
    try { return JSON.parse(value); } catch (e) { return null; }
  };

  const formatReadableDetails = (value) => {
    const raw = toDetailsText(value).trim();
    if (!raw) return '-';

    const parsed = parseJsonSafe(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .map(([k, v]) => `${toTitleWords(k)}: ${Array.isArray(v) ? v.join(', ') : String(v ?? '-')}`)
        .join(', ');
    }

    const formatKeyValuePairs = (text) => {
      const pairs = text.split(',').map(s => s.trim()).filter(Boolean);
      if (!pairs.length) return null;
      const hasOnlyPairs = pairs.every(p => p.includes('='));
      if (!hasOnlyPairs) return null;
      return pairs.map((pair) => {
        const idx = pair.indexOf('=');
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        return `${toTitleWords(k)}: ${v || '-'}`;
      }).join(', ');
    };

    const colonIdx = raw.indexOf(':');
    if (colonIdx > -1) {
      const head = raw.slice(0, colonIdx).trim();
      const tail = raw.slice(colonIdx + 1).trim();
      const tailPretty = formatKeyValuePairs(tail) || toTitleWords(tail);
      return `${toTitleWords(head)}${tail ? `: ${tailPretty}` : ''}`;
    }

    return formatKeyValuePairs(raw) || toTitleWords(raw);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const currentUserId = user?.user_id || user?.id || '';

    // Fetch system logs (passing current user ID for your new strict PHP role restrictions)
    Promise.all([
      apiGet(`reports?report=system_logs&current_user_id=${currentUserId}`), 
      apiGet('users?list=1')
    ])
      .then(([resLogs, resUsers]) => {
        if (!mounted) return;
        const raw = resLogs && Array.isArray(resLogs.rows) ? resLogs.rows : [];
        const users = Array.isArray(resUsers) ? resUsers : [];
        const userMap = {};
        
        for (const u of users) {
          if (u && (u.id !== undefined)) userMap[String(u.id)] = u.label || (`User #${u.id}`);
        }

const normalized = raw.map((r, index) => {
          const norm = {};
          for (const k in r) {
            const nk = String(k).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            norm[nk] = r[k];
          }
          const uid = norm['user_id'] ?? norm['user'] ?? null;
          const uidStr = uid !== null && uid !== undefined ? String(uid) : null;
          
          return {
            id: norm['log_id'] || `log-${index}`, // <-- ADD THIS: Gives Table.jsx the unique ID it needs to switch pages
            log_id: norm['log_id'] ?? null,
            user_id: uid,
            user_display: uidStr && userMap[uidStr] ? userMap[uidStr] : (uidStr ? (`${uidStr}`) : ''),
            action: norm['action'] ?? '',
            details: formatReadableDetails(norm['details'] ?? ''),
            ip_address: norm['ip_address'] ?? norm['ipaddress'] ?? '',
            created_at: norm['created_at'] ?? norm['createdat'] ?? norm['date'] ?? '',
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
  }, [user]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter(r => {
      if (startDate) {
        const d = r.created_at ? new Date(r.created_at) : null;
        if (!d || isNaN(d)) return false;
        const sD = new Date(startDate + 'T00:00:00');
        if (d < sD) return false;
      }
      if (endDate) {
        const d = r.created_at ? new Date(r.created_at) : null;
        if (!d || isNaN(d)) return false;
        const eD = new Date(endDate + 'T23:59:59');
        if (d > eD) return false;
      }
      if (!ql) return true;
      return [r.user_display, r.action, r.details, r.ip_address, r.created_at]
        .map(v => (v || '').toString().toLowerCase())
        .some(t => t.indexOf(ql) !== -1);
    });
  }, [rows, q, startDate, endDate]);

  // FIX: Removed the `whiteSpace: normal` styles that were causing table row heights to jump.
  // Using Tailwind's `truncate` class on the Details column so long logs don't stretch the row vertically.
// STRICT nowrap added to all columns to prevent any vertical table stretching
  const columns = [
    { key: 'user_display', label: 'User', render: (r) => <div style={{ whiteSpace: 'nowrap' }}>{r.user_display}</div> },
    { key: 'action', label: 'Action', render: (r) => <div style={{ whiteSpace: 'nowrap' }}>{r.action}</div> },
    {
      key: 'details',
      label: 'Details',
      render: (r) => (
        <div style={{ maxWidth: '480px', whiteSpace: 'normal', wordBreak: 'break-word' }}>
          {r.details || '-'}
        </div>
      )
    },
    { key: 'ip_address', label: 'IP Address', render: (r) => <div style={{ whiteSpace: 'nowrap' }}>{r.ip_address}</div> },
    { key: 'created_at', label: 'Date', render: (r) => <div style={{ whiteSpace: 'nowrap' }}>{r.created_at}</div> },
  ];

  return (
    <div className="p-4">
      <h2 className="mb-4">System Logs</h2>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm text-gray-600">Search</label>
          <input type="search" className="form-control" placeholder="Search user, action, details..." value={q} onChange={(e) => setQ(e.target.value)} />
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
          <button className="btn btn-light" onClick={() => { setQ(''); setStartDate(''); setEndDate(''); }}>
            Clear
          </button>
        </div>
      </div>

      {error && <div className="alert alert-danger mb-4">{error}</div>}

      {/* Wrapped in overflow-x-auto to match your report.jsx layout structure perfectly */}
      <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-gray-200">
        <Table
          columns={columns}
          data={filtered}
          pageSize={pageSize}
          loading={loading}
          emptyText={loading ? 'Loading...' : 'No records found'}
        />
      </div>
    </div>
  );
}
