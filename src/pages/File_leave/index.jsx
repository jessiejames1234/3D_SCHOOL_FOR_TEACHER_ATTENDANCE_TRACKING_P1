import React from 'react';
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet, apiPost, apiPut } from '../../services/api.js'; 

export default function LeavesFiles() {
  const { user } = React.useContext(AuthContext);
  const currentRoleId = Number(user?.role_id || 0);
  const canManageLeaves = currentRoleId === 2;
  
  // -- State --
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  
  // File/Edit Leave Modal State
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ date_from:'', date_to:'', leave_type_id:'', teacher_id:'', reason:'', req_status: 'approve' });
  
  // Detail Modal State
  const [showDetailModal, setShowDetailModal] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState(null);

  // Data Lists
  const [leaveTypes, setLeaveTypes] = React.useState([]);
  const [teachers, setTeachers] = React.useState([]);
  const [teacherSearch, setTeacherSearch] = React.useState('');
  const [teacherFilter, setTeacherFilter] = React.useState('');
  const [formTeacherFilter, setFormTeacherFilter] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState(''); 
  const [resolvedDeptId, setResolvedDeptId] = React.useState('');

  React.useEffect(() => {
    if (!user) return;
    const rid = Number(user.role_id);
    if (![1, 2, 4].includes(rid)) { window.location.hash = '#/dashboard'; }
  }, [user]);

  const fetch = async () => {
    setLoading(true);
    try {
      const [d, types, usersList, teacherList] = await Promise.all([
        apiGet('leaves'),
        apiGet('leaves/types').catch(() => []),
        apiGet('users').catch(() => []),
        apiGet('teachers').catch(() => [])
      ]);
      const list = Array.isArray(d) ? d : [];
      setLeaveTypes(Array.isArray(types) ? types : []);

      // Use users endpoint for role-aware filtering; fallback to teachers endpoint if needed.
      const mergedUsers = (Array.isArray(usersList) && usersList.length)
        ? usersList
        : (Array.isArray(teacherList) ? teacherList.map(t => ({ ...t, role_id: 5, status: t.status ?? 'active' })) : []);

      const activeRoleUsers = mergedUsers
        .map(u => ({
          ...u,
          user_id: Number(u.user_id || 0),
          role_id: Number(u.role_id || 0),
          dept_id: u.dept_id ?? null,
          status: String(u.status ?? 'active').toLowerCase(),
        }))
        .filter(u => u.user_id > 0)
        .filter(u => [5, 2, 3, 4].includes(Number(u.role_id)))
        .filter(u => u.status === '' || u.status === 'active' || u.status === '1' || u.status === 'true');

      setTeachers(activeRoleUsers);

      const isAdmin = Number(user?.role_id) === 1;
      const userDept = (user && user.dept_id != null && String(user.dept_id) !== '')
        ? String(user.dept_id)
        : '';
      const fallbackDept = userDept
        || String(activeRoleUsers.find(u => Number(u.user_id) === Number(user?.user_id))?.dept_id || '');

      setResolvedDeptId(fallbackDept);

      const deptFiltered = (!isAdmin && fallbackDept)
        ? list.filter(l => String(l.dept_id) === fallbackDept)
        : (!isAdmin && !fallbackDept)
          ? []
        : list;

      setRows(deptFiltered.map(r => ({ ...r, _status: String(r.req_status || '').toLowerCase() })));
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  React.useEffect(() => {
    if (!user) return;
    fetch();
  }, [user]);

  const displayedRows = React.useMemo(() => {
    let filtered = rows;
    if (teacherSearch) {
      const q = teacherSearch.trim().toLowerCase();
      filtered = filtered.filter(r => (`${r.first_name || ''} ${r.last_name || ''}`).toLowerCase().includes(q));
    }
    if (teacherFilter) {
      filtered = filtered.filter(r => String(r.teacher_id || '') === String(teacherFilter));
    }
    if (statusFilter) {
      filtered = filtered.filter(r => r._status === statusFilter.toLowerCase());
    }
    return filtered;
  }, [rows, teacherSearch, teacherFilter, statusFilter]);

  const availableTeachersForForm = React.useMemo(() => {
    if (!user || !teachers) return [];
    // include teachers (5), deans (2), program heads (3), and secretaries (4)
    const allowedRoles = new Set([5, 2, 3, 4]);
    const roleOrder = { 5: 1, 2: 2, 3: 3, 4: 4 };
    const source = Number(user.role_id) === 1
      ? teachers
      : teachers.filter(t => resolvedDeptId && String(t.dept_id) === String(resolvedDeptId));

    return source
      .filter(t => allowedRoles.has(Number(t.role_id)))
      .slice()
      .sort((a, b) => {
        const ra = roleOrder[Number(a.role_id)] || 99;
        const rb = roleOrder[Number(b.role_id)] || 99;
        if (ra !== rb) return ra - rb;
        const aName = `${a.last_name || ''} ${a.first_name || ''}`.trim().toLowerCase();
        const bName = `${b.last_name || ''} ${b.first_name || ''}`.trim().toLowerCase();
        return aName.localeCompare(bName);
      });
  }, [teachers, user, resolvedDeptId]);

  const roleLabel = React.useCallback((roleId) => {
    const r = Number(roleId);
    if (r === 5) return 'Teacher';
    if (r === 2) return 'Dean';
    if (r === 3) return 'Program Head';
    if (r === 4) return 'Secretary';
    return 'User';
  }, []);

  const availableTeachersForFilter = React.useMemo(() => {
    const map = new Map();
    availableTeachersForForm.forEach((t) => {
      const id = String(t.user_id);
      if (!id) return;
      if (!map.has(id)) map.set(id, t);
    });
    return Array.from(map.values());
  }, [availableTeachersForForm]);

  const filteredAvailableTeachersForForm = React.useMemo(() => {
    const q = formTeacherFilter.trim().toLowerCase();
    if (!q) return availableTeachersForForm;
    return availableTeachersForForm.filter((t) => {
      const name = `${t.first_name || ''} ${t.last_name || ''}`.trim().toLowerCase();
      const role = roleLabel(t.role_id).toLowerCase();
      return name.includes(q) || role.includes(q) || String(t.user_id).includes(q);
    });
  }, [availableTeachersForForm, formTeacherFilter, roleLabel]);

  const openModal = (row = null) => {
    setEditing(row);
    setFormTeacherFilter('');
    if (row) { 
        setForm({ 
            date_from: row.date_from, 
            date_to: row.date_to, 
            leave_type_id: row.leave_type_id || '', 
            teacher_id: row.teacher_id || '', 
            reason: row.reason || '',
            req_status: row.req_status || 'approve'
        }); 
    } else { 
        setForm({ date_from: '', date_to: '', leave_type_id: '', teacher_id: '', reason: '', req_status: 'approve' }); 
    }
    setShowModal(true);
  };

  const openDetail = (r) => { setDetailItem(r); setShowDetailModal(true); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (!canManageLeaves) throw new Error('Only dean can file or edit leave records.');
      const payloadTeacher = Number(form.teacher_id) || null;
      if (!payloadTeacher) throw new Error('Teacher is required');
      
      if (currentRoleId === 2) {
        const t = teachers.find(x => Number(x.user_id) === Number(payloadTeacher));
        if (!resolvedDeptId) throw new Error('Your department is not set on your account');
        if (!t || String(t.dept_id) !== String(resolvedDeptId)) throw new Error('Selected teacher is not in your department');
      }

      const payload = { 
          teacher_id: payloadTeacher, 
          leave_type_id: Number(form.leave_type_id) || 1, 
          date_from: form.date_from, 
          date_to: form.date_to, 
          reason: form.reason 
      };
      
      if (editing && editing.leave_id) {
        payload.req_status = form.req_status;
        await apiPut(`leaves/${editing.leave_id}`, payload);
        window.Swal && window.Swal.fire('Update Successful', 'The leave record has been securely updated.', 'success');
      } else {
        await apiPost('leaves', payload);
        window.Swal && window.Swal.fire('Leave Filed & Approved', 'The leave request has been successfully recorded and approved automatically.', 'success');
      }
      setShowModal(false);
      fetch();
    } catch (err) {
      console.error(err);
      
      const errorString = String(err?.response?.data?.message || err?.message || err).toLowerCase();

      if (errorString.includes('duplicate_leave') || errorString.includes('overlap') || err?.response?.status === 409) {
          window.Swal && window.Swal.fire(
              'Date Overlap Detected', 
              'The selected dates overlap with an already existing active leave for this teacher. Please adjust the dates.', 
              'warning'
          );
      } else {
          let cleanMsg = err?.response?.data?.message || err?.message || 'An unknown error occurred.';
          if (cleanMsg.includes('Network request failed') || cleanMsg.includes('http')) {
              cleanMsg = 'Failed to process the request. Please verify your data or check your connection.';
          }
          window.Swal && window.Swal.fire('Action Failed', cleanMsg, 'error');
      }
    }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r, pIdx, gIdx) => gIdx + 1 },
    { key: 'teacher', label: 'Teacher', render: (r) => `${r.first_name || ''} ${r.last_name || ''}` },
    { key: 'date', label: 'From - To', render: (r) => `${r.date_from} → ${r.date_to}` },
    { key: 'type', label: 'Type', render: (r) => r.name_type || r.leave_type || 'N/A' },
    { key: 'status', label: 'Status', render: (r) => (
        <span className={`badge ${r.req_status === 'approve' ? 'bg-green-600 text-white' : 'bg-red-500 text-white'}`}>
          {String(r.req_status).toUpperCase()}
        </span>
      ) },
    { key: 'actions', label: 'Actions', actions: (row) => {
        const actions = [];
        const isDean = currentRoleId === 2;

        actions.push({ label: 'View', onClick: () => openDetail(row) });

        if (isDean) {
          actions.push({ label: 'Edit', onClick: () => openModal(row), variant: 'primary' });
        }
        
        return actions;
      } 
    }
  ];

  const renderDetailModal = () => (
    <Modal show={showDetailModal} title={detailItem ? `${detailItem.first_name || ''} ${detailItem.last_name || ''} — Leave` : 'Leave Details'} onClose={() => setShowDetailModal(false)} size="md">
      <div className="rounded-lg bg-white shadow-lg p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">{detailItem ? (detailItem.first_name || '').charAt(0) : ''}</div>
            <div>
              <div className="text-lg font-semibold">{detailItem ? `${detailItem.first_name || ''} ${detailItem.last_name || ''}` : '—'}</div>
              <div className="text-sm text-gray-500">{detailItem && (detailItem.dept_name || detailItem.department || '')}</div>
            </div>
          </div>
          <div className="text-right">
            {detailItem && (
              <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${detailItem.req_status === 'approve' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                {String(detailItem.req_status || '').toUpperCase()}
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Date Range</div><div className="font-medium">{detailItem ? `${detailItem.date_from} → ${detailItem.date_to}` : '—'}</div></div>
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Type</div><div className="font-medium">{detailItem?.name_type || detailItem?.leave_type || '—'}</div></div>
          </div>
          <div className="space-y-3">
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Reason</div><div className="font-medium">{detailItem?.reason || '—'}</div></div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={() => setShowDetailModal(false)} className="px-4 py-2 rounded border">Close</button>
        </div>
      </div>
    </Modal>
  );

  return (
    <div className="p-6">
      
      {/* Top Header Section */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Leaves (File)</h2>
        { canManageLeaves && (
          <button 
            className="px-4 py-2 bg-green-600 text-white rounded-md text-base font-medium shadow hover:bg-green-700" 
            onClick={() => openModal()}
          >
            File Leave
          </button>
        )}
      </div>

      {/* Aligned & Enlarged Filter Section */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <label className="text-base font-medium text-gray-700">Filter Status:</label>
          <select 
            value={statusFilter} 
            onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-base bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none min-w-[140px]"
          >
            <option value="">All Status</option>
            <option value="approve">Approved</option>
            <option value="void">Void</option>
          </select>
        </div>

        <input
          placeholder="Search teacher..."
          value={teacherSearch}
          onChange={e => setTeacherSearch(e.target.value)}
          className="px-3 py-2 border rounded-md text-base bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none w-64 lg:w-80"
        />

        <div className="flex items-center gap-2">
          <label className="text-base font-medium text-gray-700">Teacher Filter:</label>
          <select
            value={teacherFilter}
            onChange={e => setTeacherFilter(e.target.value)}
            className="px-3 py-2 border rounded-md text-base bg-white shadow-sm focus:ring-2 focus:ring-indigo-400 focus:outline-none min-w-[220px]"
          >
            <option value="">All People</option>
            {availableTeachersForFilter.map((t) => (
              <option key={t.user_id} value={t.user_id}>
                {t.first_name} {t.last_name} ({roleLabel(t.role_id)})
              </option>
            ))}
          </select>
        </div>
      </div>

      <Table columns={columns} data={displayedRows} pageSize={10} loading={loading} />

      {/* File/Edit Leave Modal */}
      <Modal show={showModal} title={editing ? 'Edit Leave' : 'File Leave'} onClose={() => setShowModal(false)} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="block text-sm font-medium">From</label><input type="date" required name="date_from" value={form.date_from} onChange={(e) => setForm(s => ({ ...s, date_from: e.target.value }))} className="form-control" /></div>
          <div><label className="block text-sm font-medium">To</label><input type="date" required name="date_to" value={form.date_to} onChange={(e) => setForm(s => ({ ...s, date_to: e.target.value }))} className="form-control" /></div>
          <div>
            <label className="block text-sm font-medium">Leave Type</label>
            <select required value={form.leave_type_id} onChange={(e) => setForm(s => ({ ...s, leave_type_id: e.target.value }))} className="form-select">
              <option value="">Select Leave Type</option>
              {leaveTypes.map((type) => (<option key={type.leave_type_id ?? type.id} value={type.leave_type_id ?? type.id}>{type.name_type ?? type.name}</option>))}
            </select>
          </div>
          {canManageLeaves && (
            <div>
              <label className="block text-sm font-medium">Teacher</label>
              <input
                type="text"
                value={formTeacherFilter}
                onChange={(e) => setFormTeacherFilter(e.target.value)}
                placeholder="Filter teacher / dean / program head / secretary..."
                className="form-control mb-2"
              />
              <select required value={form.teacher_id} onChange={(e) => setForm(s => ({ ...s, teacher_id: e.target.value }))} className="form-select">
                <option value="">Select Teacher</option>
                {filteredAvailableTeachersForForm.map((teacher) => (
                  <option key={teacher.user_id} value={teacher.user_id}>
                    {teacher.first_name} {teacher.last_name} ({roleLabel(teacher.role_id)})
                  </option>
                ))}
              </select>
              {!filteredAvailableTeachersForForm.length && (
                <div className="text-xs text-gray-500 mt-1">No matching users in your department.</div>
              )}
            </div>
          )}
          
          {editing && (
            <div>
              <label className="block text-sm font-medium">Status</label>
              <select required value={form.req_status} onChange={(e) => setForm(s => ({ ...s, req_status: e.target.value }))} className="form-select">
                <option value="approve">Approved</option>
                <option value="void">Void</option>
              </select>
            </div>
          )}

          <div><label className="block text-sm font-medium">Reason</label><textarea required value={form.reason} onChange={(e) => setForm(s => ({ ...s, reason: e.target.value }))} className="form-control" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 text-white font-medium shadow">{editing ? 'Update Record' : 'File & Auto-Approve'}</button>
          </div>
        </form>
      </Modal>

      {renderDetailModal()}
    </div>
  );
}
