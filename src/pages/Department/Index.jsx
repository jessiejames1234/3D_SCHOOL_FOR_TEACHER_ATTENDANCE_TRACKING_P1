import React from 'react';
import { apiGet, apiPost, apiPut } from '../../services/api.js';
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";

function DepartmentIndex(){
  const currentUser = React.useMemo(() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } }, []);
  const isAdmin = Number(currentUser?.role_id) === 1;

  const [departments, setDepartments] = React.useState([]);
  const [deans, setDeans] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ dept_name: '', dean_id: '' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showArchived, setShowArchived] = React.useState(false);
  // cache full departments list for instant client-side filtering
  const [allDepartments, setAllDepartments] = React.useState(null);

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) {
      if (err?.status === 405 || err?.status === 500) return await fallback();
      throw err;
    }
  };

  const loadDepartments = React.useCallback(async ()=>{
    try{
      const [d, ds] = await Promise.all([apiGet('departments'), apiGet('deans')]);
      const normalized = Array.isArray(d) ? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      setDepartments(showArchived ? normalized.filter(x => x._status === 'archive') : normalized.filter(x => x._status !== 'archive'));
      setDeans(Array.isArray(ds)?ds:[]);
    }catch(e){ console.error(e); setError('Failed to load departments or deans'); }
  }, [showArchived]);

  React.useEffect(()=>{
    loadDepartments();
  }, [loadDepartments]);

  React.useEffect(()=>{
    let cancelled = false;
    let refreshing = false;

    const refreshViaHttps = async ()=>{
      if (cancelled || document.hidden || refreshing) return;
      refreshing = true;
      try {
        await loadDepartments();
      } catch(e) {
        console.error('Failed to refresh departments via HTTPS', e);
      } finally {
        refreshing = false;
      }
    };

    const intervalId = window.setInterval(refreshViaHttps, 3000);
    const handleFocusRefresh = ()=> refreshViaHttps();
    window.addEventListener('focus', handleFocusRefresh);
    document.addEventListener('visibilitychange', handleFocusRefresh);

    return ()=>{
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocusRefresh);
      document.removeEventListener('visibilitychange', handleFocusRefresh);
    };
  }, [loadDepartments]);

  const handleToggleShowArchived = async ()=>{
    const next = !showArchived;
    setShowArchived(next);

    if (Array.isArray(allDepartments)){
      const filtered = next ? allDepartments.filter(u => u._status === 'archive') : allDepartments.filter(u => u._status !== 'archive');
      setDepartments(filtered);
      // background revalidation
      (async ()=>{
        try{
          const d = await apiGet('departments');
          const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
          setAllDepartments(normalized);
          setDepartments(next ? normalized.filter(u=>u._status==='archive') : normalized.filter(u=>u._status!=='archive'));
        }catch(err){ console.error('Background revalidation failed', err); }
      })();
      return;
    }

    try{
      const d = await apiGet('departments');
      const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      setDepartments(next ? normalized.filter(u=>u._status==='archive') : normalized.filter(u=>u._status!=='archive'));
    }catch(e){ console.error('Failed to fetch departments', e); setError('Failed to load departments'); }
  };

  const handleUnarchive = async (dept) => {
    if (!dept || !dept.dept_id) return;
    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Unarchive department?', text: 'This will restore the department and set status to inactive.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Unarchive department?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`departments/${dept.dept_id}`, { status: 'inactive' }),
        () => apiPost(`departments/${dept.dept_id}/update`, { status: 'inactive' })
      );
      // refresh cache + view
      const d = await apiGet('departments');
      const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      setDepartments(normalized.filter(x => x._status === 'archive'));
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Unarchived', timer:1200, showConfirmButton:false }); } catch(e){}
    }catch(err){ console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to unarchive' }); } catch(e){} }
  };

  const openModal = (dept=null) => {
    setError('');
    if (dept) {
      setEditing(dept);
      setForm({ dept_name: dept.dept_name || '', dean_id: dept.dean_id || '' });
    } else {
      setEditing(null);
      setForm({ dept_name:'', dean_id: '' });
    }
    setShowModal(true);
  };
  const closeModal = ()=> setShowModal(false);

  const handleChange = (e)=> setForm(p=>({...p, [e.target.name]: e.target.value}));

  const deanOptions = React.useMemo(() => {
    return Array.isArray(deans) ? deans : [];
  }, [deans]);

  const validateForm = () => {
    const name = (form.dept_name||'').trim();
    if (!name) return 'Department name is required';
    // duplicate name check (case-insensitive), exclude editing dept
    const sourceDepartments = Array.isArray(allDepartments) ? allDepartments : departments;
    const conflictName = sourceDepartments.find(d => d.dept_name && String(d.dept_name).toLowerCase() === name.toLowerCase() && (!editing || Number(d.dept_id) !== Number(editing.dept_id)));
    if (conflictName) return 'A department with the same name already exists';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    const v = validateForm();
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }

    try{
      const payload = {
        dept_name: form.dept_name.trim(),
        dean_id: form.dean_id === '' ? null : Number(form.dean_id),
      };
      if (editing && editing.dept_id) {
        await runWithFallback(
          () => apiPut(`departments/${editing.dept_id}`, payload),
          () => apiPost(`departments/${editing.dept_id}/update`, payload)
        );
      } else {
        await apiPost('departments', payload);
      }

      const d = await apiGet('departments');
      const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      const list = normalized.filter(x => x._status !== 'archive');
      setDepartments(list);
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Department updated' : 'Department added', timer: 1400, showConfirmButton: false }); } catch(e){}
    } catch (err) {
      console.error(err);
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save';
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title: 'Error', text: msg }); else alert(msg); } catch(e){}
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleToggle = async (dept) => {
    if (!dept || !dept.dept_id) return;
    const newStatus = String(dept.status) === 'active' ? 'inactive' : 'active';
    try{
      await runWithFallback(
        () => apiPut(`departments/${dept.dept_id}`, { status: newStatus }),
        () => apiPost(`departments/${dept.dept_id}/update`, { status: newStatus })
      );
      const d = await apiGet('departments');
      const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      setDepartments(normalized.filter(x => x._status !== 'archive'));
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); else alert(err.body?.error || err.message || 'Failed to update status'); } catch(e){}
    }
  };

  const handleArchive = async (dept) => {
    if (!dept || !dept.dept_id) return;
    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive department?', text: 'This will remove the department from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive department?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`departments/${dept.dept_id}`, { status: 'archive' }),
        () => apiPost(`departments/${dept.dept_id}/update`, { status: 'archive' })
      );
      const d = await apiGet('departments');
      const normalized = Array.isArray(d)? d.map(x => ({ ...x, _status: String(x.status || '').toLowerCase().trim() })) : [];
      setAllDepartments(normalized);
      setDepartments(normalized.filter(x => x._status !== 'archive'));
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); else alert(err.body?.error || err.message || 'Failed to archive'); } catch(e){}
    }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r, pIdx, gIdx) => gIdx + 1 },
    { key: 'dept_name', label: 'Department' },
    { key: 'dean', label: 'Dean', render: (r) => `${r.dean_first || r.first_name || ''} ${r.dean_last || r.last_name || ''}` },
    { key: 'status', label: 'Status', render: (r) => {
      const s = (r.status || '').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status || 'N/A'));
      return (<span className={`badge ${cls}`}>{text}</span>);
    }}
  ];
  if (isAdmin) {
    columns.push({
      key: 'actions',
      label: 'Actions',
      actions: (row) => {
        if (showArchived) return [
          { label: 'Edit', onClick: (r) => openModal(r) },
          { label: 'Unarchive', onClick: (r) => handleUnarchive(r) }
        ];
        return [
          { label: 'Edit', onClick: (r) => openModal(r) },
          { label: 'Toggle', onClick: (r) => handleToggle(r) },
          { label: 'Archive', variant: 'danger', onClick: (r) => handleArchive(r) }
        ];
      }
    });
  }

  return (
    <div className="p-6 department-page">
      <div className="flex items-center justify-between mb-4 department-header">
        <h2 className="text-2xl font-semibold">Departments</h2>
        {isAdmin && (
          <div className="flex gap-2 department-actions">
            <button className="btn btn-outline-secondary" onClick={handleToggleShowArchived}>{showArchived ? 'Active/Inactive (Departments)' : 'Archived (Departments)'}</button>
            <button className="btn btn-success" onClick={()=>openModal()}>Add Department</button>
          </div>
        )}
      </div>

      {!isAdmin && <div className="alert alert-info py-2 mb-3">View-only access: You can only view departments.</div>}

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <Table columns={columns} data={departments} pageSize={10} horizontalScroll={true} wrapCells className="department-table responsive-table" />

      <Modal show={showModal} title={editing ? 'Edit Department' : 'Add Department'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department Name</label>
            <input name="dept_name" value={form.dept_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dean</label>
            <select name="dean_id" value={form.dean_id} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2">
              <option value="">No dean assigned</option>
              {deanOptions.map(dn => <option key={dn.user_id} value={dn.user_id}>{dn.first_name} {dn.last_name}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white">{loading ? 'Saving...' : (editing ? 'Update Department' : 'Save Department')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default DepartmentIndex;
