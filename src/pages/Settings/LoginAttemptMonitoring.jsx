import React from 'react';
import { apiGet, apiDelete } from '../../services/api.js';

const swalFire = async (opts) => {
  try {
    if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
      return await window.Swal.fire(opts);
    }
    if (opts.title) alert(opts.title + (opts.text ? ': ' + opts.text : ''));
    return { isConfirmed: true };
  } catch (e) {
    return { isConfirmed: false };
  }
};

const formatDateTime = (val) => {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return val;
  return d.toLocaleString();
};

export default function LoginAttemptMonitoring() {
  const [loading, setLoading] = React.useState(true);
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState('');
  const [clearingId, setClearingId] = React.useState(null);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiGet('login-monitor');
      setData(res);
    } catch (err) {
      const msg = err?.body?.message || err?.message || 'Failed to load login monitoring data.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleClearRecord = async (id, email) => {
    const confirm = await swalFire({
      icon: 'question',
      title: 'Clear Lock Record?',
      text: `Remove the login lock record for ${email}? This will reset their failed attempts.`,
      showCancelButton: true,
      confirmButtonText: 'Clear',
      cancelButtonText: 'Cancel',
      confirmButtonColor: '#dc3545',
    });
    if (!confirm.isConfirmed) return;

    setClearingId(id);
    try {
      await apiDelete('login-monitor', { id });
      await swalFire({ icon: 'success', title: 'Cleared', text: 'Login lock record cleared.', timer: 1500, showConfirmButton: false });
      loadData();
    } catch (err) {
      const msg = err?.body?.message || err?.message || 'Failed to clear record.';
      await swalFire({ icon: 'error', title: 'Error', text: msg });
    } finally {
      setClearingId(null);
    }
  };

  const formatRoleName = (name) => {
    if (!name) return '-';
    return String(name)
      .replace(/_/g, ' ')
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  };

  const details = Array.isArray(data?.details) ? data.details : [];
  const history = Array.isArray(data?.history) ? data.history : [];

  return (
    <div className="container-fluid py-3">
      {error && <div className="alert alert-danger">{error}</div>}

      {/* Summary Cards */}
      <div className="row g-3 mb-4">
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle bg-danger bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style={{ width: 48, height: 48 }}>
                <i className="bi bi-lock-fill text-danger fs-5"></i>
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-semibold tracking-wide">Currently Locked</div>
                <div className="fw-bold fs-3">{loading ? '-' : (data?.total_locked ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle bg-warning bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style={{ width: 48, height: 48 }}>
                <i className="bi bi-exclamation-triangle-fill text-warning fs-5"></i>
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-semibold tracking-wide">Failed Attempts</div>
                <div className="fw-bold fs-3">{loading ? '-' : (data?.total_failed_attempts ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-12 col-md-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body d-flex align-items-center gap-3">
              <div className="rounded-circle bg-info bg-opacity-10 p-3 d-flex align-items-center justify-content-center" style={{ width: 48, height: 48 }}>
                <i className="bi bi-people-fill text-info fs-5"></i>
              </div>
              <div>
                <div className="text-muted small text-uppercase fw-semibold tracking-wide">Accounts Tracked</div>
                <div className="fw-bold fs-3">{loading ? '-' : (data?.total_accounts_with_attempts ?? 0)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Login Lock Records */}
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-header bg-white border-bottom d-flex justify-content-between align-items-center py-3">
          <div>
            <h6 className="mb-0 fw-bold">Login Attempt Records</h6>
            <small className="text-muted">Accounts with failed login attempts and lock status.</small>
          </div>
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={loadData} disabled={loading}>
            <i className="bi bi-arrow-repeat me-1"></i>
            Refresh
          </button>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-5 text-muted">Loading login monitoring data...</div>
          ) : details.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-shield-check fs-1 d-block mb-2 text-success"></i>
              No failed login attempts recorded yet.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="bg-light">
                  <tr>
                    <th className="ps-4">Email</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Failed Attempts</th>
                    <th>Lock Status</th>
                    <th>Lock Expires</th>
                    <th className="text-end pe-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((row) => (
                    <tr key={row.id}>
                      <td className="ps-4 fw-medium">{row.email}</td>
                      <td>{row.first_name || row.last_name ? `${row.first_name || ''} ${row.last_name || ''}`.trim() : '-'}</td>
                      <td><span className="badge bg-secondary bg-opacity-10 text-dark">{formatRoleName(row.role_name)}</span></td>
                      <td>
                        <span className={`fw-bold ${Number(row.failed_attempts) >= 3 ? 'text-danger' : 'text-warning'}`}>
                          {row.failed_attempts || 0}
                        </span>
                      </td>
                      <td>
                        {row.is_locked ? (
                          <span className="badge bg-danger">Locked</span>
                        ) : (
                          <span className="badge bg-success">Active</span>
                        )}
                      </td>
                      <td className="small text-muted">{row.is_locked ? formatDateTime(row.lock_until) : 'N/A'}</td>
                      <td className="text-end pe-4">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          disabled={clearingId === row.id}
                          onClick={() => handleClearRecord(row.id, row.email)}
                        >
                          {clearingId === row.id ? 'Clearing...' : 'Clear'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Login History Table */}
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-white border-bottom py-3">
          <h6 className="mb-0 fw-bold">Login History</h6>
          <small className="text-muted">Recent login attempts (successful and failed).</small>
        </div>
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-5 text-muted">Loading history...</div>
          ) : history.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-clock-history fs-1 d-block mb-2 text-muted"></i>
              No login history recorded yet.
            </div>
          ) : (
            <div className="table-responsive" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table className="table table-hover align-middle mb-0">
                <thead className="bg-light sticky-top">
                  <tr>
                    <th className="ps-4">Time</th>
                    <th>Email</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>IP Address</th>
                    <th className="pe-4">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.attempt_id}>
                      <td className="ps-4 small text-muted">{formatDateTime(row.attempt_time)}</td>
                      <td className="fw-medium">{row.email}</td>
                      <td>{row.first_name || row.last_name ? `${row.first_name || ''} ${row.last_name || ''}`.trim() : '-'}</td>
                      <td><span className="badge bg-secondary bg-opacity-10 text-dark">{formatRoleName(row.role_name)}</span></td>
                      <td>
                        {row.status === 'success' ? (
                          <span className="badge bg-success">Success</span>
                        ) : (
                          <span className="badge bg-danger">Failed</span>
                        )}
                      </td>
                      <td className="small text-muted font-monospace">{row.ip_address || '-'}</td>
                      <td className="pe-4 small text-muted">{row.details || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}