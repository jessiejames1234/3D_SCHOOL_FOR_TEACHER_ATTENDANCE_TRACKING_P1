import React from 'react';
import { apiGet, apiPost, apiPut } from '../../services/api.js'; // Fixed import path with .js
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";

function ProgramIndex(){
  // determine current user and roles
  const currentUser = React.useMemo(() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } }, []);
  const isAdmin = Number(currentUser?.role_id) === 1;

  const [programs, setPrograms] = React.useState([]);
  const [departments, setDepartments] = React.useState([]);
  const [heads, setHeads] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ program_name: '', dept_id: '', head_id: '' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) { if (err?.status === 405 || err?.status === 500) return await fallback(); throw err; }
  };

  const loadProgramData = React.useCallback(async ()=>{
    try{
      const [p, d, u] = await Promise.all([apiGet('programs'), apiGet('departments'), apiGet('users')]);
      setPrograms(Array.isArray(p)? p.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      setDepartments(Array.isArray(d)? d: []);
      const programHeads = Array.isArray(u) ? u.filter(x => Number(x.role_id) === 3 || String(x.role_name || '').toLowerCase().includes('program')) : [];
      setHeads(programHeads);
    }catch(e){ console.error(e); setError('Failed to load programs'); }
  }, []);

  React.useEffect(()=>{
    loadProgramData();
  }, [loadProgramData]);

  React.useEffect(()=>{
    let cancelled = false;
    let refreshing = false;

    const refreshViaHttps = async ()=>{
      if (cancelled || document.hidden || refreshing) return;
      refreshing = true;
      try {
        await loadProgramData();
      } catch(e) {
        console.error('Failed to refresh programs via HTTPS', e);
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
  }, [loadProgramData]);

  const openModal = (prog=null) => {
    setError('');
    if (prog) {
      setEditing(prog);
      setForm({ 
        program_name: prog.program_name || '', 
        dept_id: prog.dept_id || '', // Handles null dept_id from DB
        head_id: prog.head_id || '' 
      });
    } else {
      setEditing(null);
      // Default to '' (None) instead of the first department
      setForm({ program_name:'', dept_id: '', head_id: '' });
    }
    setShowModal(true);
  };
  
  const closeModal = ()=> setShowModal(false);
  
  const handleChange = (e) => { const { name, value } = e.target; setForm(prev=> ({ ...prev, [name]: value })); };

  const validateForm = () => {
    const name = (form.program_name||'').trim();
    if (!name) return 'Program name is required';
    
    // Check for duplicate program names (case-insensitive)
    const dup = programs.find(p => p.program_name && String(p.program_name).toLowerCase() === name.toLowerCase() && (!editing || Number(p.program_id) !== Number(editing.program_id)));
    if (dup) return 'A program with the same name already exists';
    
    return null;
  };

  const headOptions = React.useMemo(() => {
    const selectedDeptId = form.dept_id ? String(form.dept_id) : '';

    return (heads || []).filter(h => {
      if (selectedDeptId && h.dept_id && String(h.dept_id) !== selectedDeptId) return false;
      return true;
    });
  }, [heads, form.dept_id]);

  React.useEffect(() => {
    if (!form.head_id) return;
    const valid = headOptions.some(h => String(h.user_id) === String(form.head_id));
    if (!valid) setForm(prev => ({ ...prev, head_id: '' }));
  }, [headOptions, form.head_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    const v = validateForm();
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }
    
    try{
      // LOGIC FIX: If dept_id is empty string, send null to backend
      const payload = { 
          program_name: form.program_name.trim(), 
          dept_id: form.dept_id ? Number(form.dept_id) : null, 
          head_id: form.head_id ? Number(form.head_id) : null
      };

      if (editing && editing.program_id) {
        await runWithFallback(
          () => apiPut(`programs/${editing.program_id}`, payload),
          () => apiPost(`programs/${editing.program_id}/update`, payload)
        );
      } else {
        await apiPost('programs', payload);
      }
      
      await loadProgramData();
      
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Program updated' : 'Program added', timer: 1400, showConfirmButton: false }); } catch(e){}
    } catch (err) {
      console.error(err);
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save';
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: msg }); else alert(msg); } catch(e){}
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleToggle = async (prog) => {
    if (!prog || !prog.program_id) return;
    const newStatus = String(prog.status) === 'active' ? 'inactive' : 'active';
    try{
      await runWithFallback(
        () => apiPut(`programs/${prog.program_id}`, { status: newStatus }),
        () => apiPost(`programs/${prog.program_id}/update`, { status: newStatus })
      );
      await loadProgramData();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); } catch(e){} }
  };

  const handleArchive = async (prog) => {
    if (!prog || !prog.program_id) return;
    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive program?', text: 'This will remove the program from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive program?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`programs/${prog.program_id}`, { status: 'archive' }),
        () => apiPost(`programs/${prog.program_id}/update`, { status: 'archive' })
      );
      await loadProgramData();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); } catch(e){} }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r, pIdx, gIdx) => gIdx + 1 },
    { key: 'program_name', label: 'Program' },
    // Show 'None' if dept_name is missing
    { key: 'dept_name', label: 'Department', render: (r) => r.dept_name || <span className="text-gray-400 italic">None</span> },
    { key: 'head', label: 'Program Head', render: (r) => `${r.head_first || r.first_name || ''} ${r.head_last || r.last_name || ''}` },
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
      actions: (row) => ([
        { label: 'Edit', onClick: () => openModal(row) },
        { label: 'Toggle', onClick: () => handleToggle(row) },
        { label: 'Archive', variant: 'danger', onClick: () => handleArchive(row) }
      ])
    });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Program Management</h2>
        <div className="flex gap-2">
          {/* Admin-only CRUD */}
          {isAdmin && <button className="btn btn-success" onClick={()=>openModal()}>Add Program</button>}
        </div>
      </div>

      {!isAdmin && <div className="alert alert-info py-2 mb-3">View-only access: You can only view programs assigned to you.</div>}

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <Table columns={columns} data={programs} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Program' : 'Add Program'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
            {/* REMOVED 'required' and added 'None' option */}
            <select name="dept_id" value={form.dept_id} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2">
              <option value="">None</option>
              {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program Name</label>
            <input name="program_name" value={form.program_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program Head</label>
            <select name="head_id" value={form.head_id} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2">
              <option value="">No program head assigned</option>
              {headOptions.map(h => <option key={h.user_id} value={h.user_id}>{h.first_name} {h.last_name}</option>)}
            </select>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white">{loading ? 'Saving...' : (editing ? 'Update Program' : 'Save Program')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default ProgramIndex;
