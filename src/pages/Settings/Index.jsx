import React from 'react';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet, apiPut } from '../../services/api.js';
import { MODULE_LABELS } from '../../utils/moduleAccess.js';

const ALLOWED_TARGET_ROLES_FOR_DEAN = new Set([3, 4, 5]);

function formatRoleName(roleName) {
  const raw = String(roleName || '').trim();
  if (!raw) return 'Unknown';
  return raw
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ');
}

function sortUnique(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean))).sort();
}

export default function GeneralSettingsIndex() {
  const { user } = React.useContext(AuthContext) || {};
  const roleId = Number(user?.role_id || 0);
  const isAdmin = roleId === 1;
  const isDean = roleId === 2;
  const canManage = isAdmin || isDean;

  const [managedUsers, setManagedUsers] = React.useState([]);
  const [loadingUsers, setLoadingUsers] = React.useState(false);
  const [selectedUserId, setSelectedUserId] = React.useState('');
  const [loadingAccess, setLoadingAccess] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [schemaReady, setSchemaReady] = React.useState(true);

  const [targetInfo, setTargetInfo] = React.useState(null);
  const [roleDefaultModules, setRoleDefaultModules] = React.useState([]);
  const [manageableModules, setManageableModules] = React.useState([]);
  const [checkedModules, setCheckedModules] = React.useState([]);

  const filteredManagedUsers = React.useMemo(() => {
    let list = Array.isArray(managedUsers) ? managedUsers.slice() : [];
    if (isAdmin) {
      list = list.filter((u) => Number(u?.role_id || 0) !== 1);
    }
    if (isDean) {
      list = list.filter((u) => ALLOWED_TARGET_ROLES_FOR_DEAN.has(Number(u?.role_id || 0)));
    }
    list.sort((a, b) => {
      const aName = `${a?.last_name || ''} ${a?.first_name || ''}`.trim().toLowerCase();
      const bName = `${b?.last_name || ''} ${b?.first_name || ''}`.trim().toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return Number(a?.user_id || 0) - Number(b?.user_id || 0);
    });
    return list;
  }, [managedUsers, isAdmin, isDean]);

  React.useEffect(() => {
    if (!canManage) return;
    let mounted = true;
    (async () => {
      setLoadingUsers(true);
      setError('');
      try {
        const data = await apiGet('users');
        if (!mounted) return;
        setManagedUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!mounted) return;
        const message = err?.body?.message || err?.message || 'Failed to load users.';
        setError(message);
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [canManage]);

  React.useEffect(() => {
    if (!selectedUserId) return;
    let mounted = true;
    (async () => {
      setLoadingAccess(true);
      setError('');
      setSuccess('');
      try {
        const data = await apiGet(`users/${selectedUserId}/module-access`);
        if (!mounted) return;
        const manageable = sortUnique(data?.manageable_modules);
        const effective = sortUnique(data?.effective_modules).filter((key) => manageable.includes(key));
        const defaults = sortUnique(data?.role_default_modules).filter((key) => manageable.includes(key));
        setTargetInfo({
          user_id: Number(data?.user_id || selectedUserId),
          first_name: String(data?.first_name || ''),
          last_name: String(data?.last_name || ''),
          role_name: String(data?.role_name || ''),
          role_id: Number(data?.role_id || 0),
        });
        setSchemaReady(Boolean(data?.schema_ready ?? true));
        setRoleDefaultModules(defaults);
        setManageableModules(manageable);
        setCheckedModules(effective);
      } catch (err) {
        if (!mounted) return;
        const message = err?.body?.message || err?.message || 'Failed to load module access.';
        setError(message);
      } finally {
        if (mounted) setLoadingAccess(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedUserId]);

  const roleDefaultSet = React.useMemo(() => new Set(roleDefaultModules), [roleDefaultModules]);
  const checkedSet = React.useMemo(() => new Set(checkedModules), [checkedModules]);
  const draftMode = React.useMemo(() => {
    if (checkedModules.length !== roleDefaultModules.length) return 'custom';
    for (const key of checkedModules) {
      if (!roleDefaultSet.has(key)) return 'custom';
    }
    return 'default';
  }, [checkedModules, roleDefaultModules, roleDefaultSet]);

  const handleToggleModule = (moduleKey) => {
    setCheckedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return Array.from(next).sort();
    });
  };

  const resetToDefault = () => {
    setCheckedModules(sortUnique(roleDefaultModules));
    setSuccess('');
  };

  const selectAllManageable = () => {
    setCheckedModules(sortUnique(manageableModules));
    setSuccess('');
  };

  const saveAccess = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = { selected_modules: checkedModules };
      const data = await apiPut(`users/${selectedUserId}/module-access`, payload);
      const manageable = sortUnique(data?.manageable_modules);
      const effective = sortUnique(data?.effective_modules).filter((key) => manageable.includes(key));
      const defaults = sortUnique(data?.role_default_modules).filter((key) => manageable.includes(key));
      setRoleDefaultModules(defaults);
      setManageableModules(manageable);
      setCheckedModules(effective);
      setSuccess('Module access updated successfully.');
      try {
        if (window?.Swal) {
          await window.Swal.fire({ icon: 'success', title: 'Saved', text: 'User module access was updated.' });
        }
      } catch (swErr) {
        console.warn('Swal success notification failed', swErr);
      }
    } catch (err) {
      const message = err?.body?.message || err?.message || 'Failed to save module access.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="container-fluid py-3">
        <div className="alert alert-danger mb-0">Only Admin and Dean can access General Settings module permissions.</div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">General Settings</h4>
      </div>

      {error ? <div className="alert alert-danger">{error}</div> : null}
      {success ? <div className="alert alert-success">{success}</div> : null}

      <div className="card mb-3">
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-12 col-md-8">
              <label className="form-label fw-semibold">Select User</label>
              <select
                className="form-select"
                value={selectedUserId}
                disabled={loadingUsers || loadingAccess || saving}
                onChange={(e) => setSelectedUserId(String(e.target.value || ''))}
              >
                <option value="">Select user</option>
                {filteredManagedUsers.map((item) => {
                  const fullName = `${item?.last_name || ''}, ${item?.first_name || ''}`.replace(/^,\s*/, '').trim();
                  const labelName = fullName || item?.email || `User #${item?.user_id}`;
                  const roleName = formatRoleName(item?.role_name || '');
                  return (
                    <option key={item.user_id} value={item.user_id}>
                      {labelName} {roleName ? `(${roleName})` : ''}
                    </option>
                  );
                })}
              </select>
              {loadingUsers ? <div className="form-text">Loading users...</div> : null}
            </div>
            <div className="col-12 col-md-4 text-md-end">
              <button
                type="button"
                className="btn btn-outline-secondary"
                disabled={!selectedUserId || loadingAccess || saving}
                onClick={resetToDefault}
              >
                Reset To Role Default
              </button>
            </div>
          </div>
        </div>
      </div>

      {selectedUserId ? (
        <div className="card">
          <div className="card-body">
            {loadingAccess ? (
              <div>Loading module access...</div>
            ) : (
              <>
                <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                  <div>
                    <div className="fw-semibold">
                      {targetInfo ? `${targetInfo.first_name || ''} ${targetInfo.last_name || ''}`.trim() : 'Selected User'}
                    </div>
                    <div className="text-muted small">
                      Role: {formatRoleName(targetInfo?.role_name || '')} | Mode: {draftMode === 'custom' ? 'Custom Override' : 'Default'}
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      disabled={saving || manageableModules.length === 0}
                      onClick={selectAllManageable}
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={saving || !schemaReady || !selectedUserId}
                      onClick={saveAccess}
                    >
                      {saving ? 'Saving...' : 'Save Access'}
                    </button>
                  </div>
                </div>

                {!schemaReady ? (
                  <div className="alert alert-warning mb-0">
                    Missing database columns for module access. Please run migration:
                    <code className="ms-1">server-php/migrations/2026-04-16-add-user-module-permissions.sql</code>
                  </div>
                ) : manageableModules.length === 0 ? (
                  <div className="text-muted">No manageable modules available for this user.</div>
                ) : (
                  <div className="row g-2">
                    {manageableModules.map((moduleKey) => {
                      const checked = checkedSet.has(moduleKey);
                      const inherited = roleDefaultSet.has(moduleKey);
                      const label = MODULE_LABELS[moduleKey] || moduleKey.replace(/_/g, ' ');
                      return (
                        <div key={moduleKey} className="col-12 col-md-6 col-lg-4">
                          <label className="form-check border rounded px-3 py-2 h-100 d-flex gap-2 align-items-start">
                            <input
                              type="checkbox"
                              className="form-check-input mt-1"
                              checked={checked}
                              onChange={() => handleToggleModule(moduleKey)}
                              disabled={saving}
                            />
                            <span>
                              <span className="fw-semibold d-block">{label}</span>
                              <span className="small text-muted d-block">
                                {moduleKey}
                                {inherited ? ' | Role default' : ' | Override-only'}
                              </span>
                            </span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
