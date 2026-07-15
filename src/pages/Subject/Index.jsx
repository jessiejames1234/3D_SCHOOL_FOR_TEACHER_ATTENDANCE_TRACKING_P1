import React, { useState, useEffect, useMemo } from "react";
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import { apiGet, apiPost, apiPut } from '../../services/api.js';

function SubjectIndex() {
  const [subjects, setSubjects] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ program_id:'', subject_code:'', subject_name:'' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // States for Table UI Filters
  const [filterProgram, setFilterProgram] = useState('');

  // Authentication & Role Check logic
  const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
  const isAdmin = Number(user?.role_id) === 1;
  const isDean = [2, 6].includes(Number(user?.role_id));
  const isProgramHead = Number(user?.role_id) === 3;
  const isSecretary = Number(user?.role_id) === 4;
  
  // Only admin and dean can manage subjects.
  const canEdit = isAdmin || isDean;
  const canAdd = isAdmin || isDean;

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) { if (err?.status === 405 || err?.status === 500) return await fallback(); throw err; }
  };

  useEffect(() => { 
    (async () => { 
      try { 
        const [s,p] = await Promise.all([apiGet('subjects'), apiGet('programs')]); 
        const list = Array.isArray(s) ? s.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []; 
        setSubjects(list); 
        setPrograms(Array.isArray(p)?p:[]); 
      } catch(e) { 
        console.error(e); setError('Failed to load subjects or programs'); 
      } 
    })(); 
  }, []);

  // --- ROLE-BASED VISIBILITY & FILTERING ---
  const visibleSubjects = useMemo(() => {
    return subjects.filter(sub => {
      if (isAdmin) return true;
      // Program head strictly sees ONLY their assigned program's subjects
      if (isProgramHead) {
        return Number(sub.head_id) === Number(user?.user_id);
      }
      // Dean and secretary see the whole department
      if (isDean || isSecretary) {
        return Number(sub.dept_id) === Number(user?.dept_id);
      }
      return false;
    });
  }, [subjects, isAdmin, isProgramHead, isDean, isSecretary, user]);

  const displayedAndFiltered = useMemo(() => {
    return visibleSubjects.filter(sub => {
      if (filterProgram && String(sub.program_id) !== String(filterProgram)) return false;
      return true;
    });
  }, [visibleSubjects, filterProgram]);

  const displayData = useMemo(() => {
    return displayedAndFiltered.map((sub, i) => ({
      ...sub,
      display_index: i + 1
    }));
  }, [displayedAndFiltered]);

  // Dropdown list for Filtering view
  const availablePrograms = useMemo(() => {
    let list = programs;
    if (isProgramHead) {
      list = list.filter(p => Number(p.head_id) === Number(user?.user_id));
    } else if (isDean || isSecretary) {
      list = list.filter(p => Number(p.dept_id) === Number(user?.dept_id));
    }
    return list;
  }, [programs, isProgramHead, isDean, isSecretary, user]);

  // Dropdown strictly for Add/Edit Modal (Program Head can only see their exact program here)
  const addEditPrograms = useMemo(() => {
    let list = programs;
    if (isProgramHead) {
      list = list.filter(p => Number(p.head_id) === Number(user?.user_id));
    } else if (isDean) {
      list = list.filter(p => Number(p.dept_id) === Number(user?.dept_id));
    }
    return list;
  }, [programs, isProgramHead, isDean, user]);


  const checkManagePermission = (row) => {
    if (isAdmin) return true;
    if (isDean && Number(row?.dept_id) !== Number(user?.dept_id)) {
      try { if (window.Swal) window.Swal.fire('Unauthorized', 'You can only modify subjects inside your assigned department.', 'error'); else alert('Unauthorized'); } catch(e){}
      return false;
    }
    return isDean;
  };

  const openModal = (it=null) => {
    setError('');
    if (it) {
      if (!checkManagePermission(it)) return;
      setEditing(it);
      setForm({ program_id: it.program_id || '', subject_code: it.subject_code || '', subject_name: it.subject_name || '' });
    } else {
      if (!canAdd) return;
      setEditing(null);
      setForm({ program_id: addEditPrograms[0]?.program_id || '', subject_code:'', subject_name:'' });
    }
    setShowModal(true);
  };
  
  const closeModal = () => setShowModal(false);
  const handleChange = (e) => setForm(p=>({...p, [e.target.name]: e.target.value}));

  const validateForm = () => {
    if (!form.program_id) return 'Program is required';
    if (!form.subject_code || !form.subject_code.trim()) return 'Subject code is required';
    if (!form.subject_name || !form.subject_name.trim()) return 'Subject name is required';
    const code = String(form.subject_code).trim().toLowerCase();
    const name = String(form.subject_name).trim().toLowerCase();
    const dup = subjects.find(s => Number(s.program_id) === Number(form.program_id) && (!editing || Number(s.subject_id) !== Number(editing.subject_id)) && (String(s.subject_code||'').trim().toLowerCase() === code || String(s.subject_name||'').trim().toLowerCase() === name));
    if (dup) return 'A subject with the same code or name already exists for the selected program';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    const v = validateForm();
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }

    try{
      const payload = { program_id: Number(form.program_id), subject_code: form.subject_code.trim(), subject_name: form.subject_name.trim() };
      if (editing && editing.subject_id) {
        await runWithFallback(
          () => apiPut(`subjects/${editing.subject_id}`, payload),
          () => apiPost(`subjects/${editing.subject_id}/update`, payload)
        );
      } else {
        if (!canAdd) {
          const msg = 'Only admin and dean can add subjects.';
          try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Unauthorized', text: msg }); else alert(msg); } catch(e){}
          setLoading(false);
          return;
        }
        await apiPost('subjects', payload);
      }
      const s = await apiGet('subjects');
      setSubjects(Array.isArray(s)? s.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Subject updated' : 'Subject added', timer:1400, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save';
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: msg }); else alert(msg); } catch(e){}
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleToggle = async (row) => {
    if (!row || !row.subject_id) return;
    if (!checkManagePermission(row)) return;

    const newStatus = String(row.status) === 'active' ? 'inactive' : 'active';
    try {
      await runWithFallback(
        () => apiPut(`subjects/${row.subject_id}`, { status: newStatus }),
        () => apiPost(`subjects/${row.subject_id}/update`, { status: newStatus })
      );
      const s = await apiGet('subjects'); setSubjects(Array.isArray(s)? s.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); } catch(e){} }
  };

  const handleArchive = async (row) => {
    if (!row || !row.subject_id) return;
    if (!checkManagePermission(row)) return;

    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive subject?', text: 'This will remove the subject from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive subject?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`subjects/${row.subject_id}`, { status: 'archive' }),
        () => apiPost(`subjects/${row.subject_id}/update`, { status: 'archive' })
      );
      const s = await apiGet('subjects'); setSubjects(Array.isArray(s)? s.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); } catch(e){} }
  };

  const columns = [
    { key: 'display_index', label: '#' },
    { key: 'subject_code', label: 'Code' },
    { key: 'subject_name', label: 'Name' },
    { key: 'program_name', label: 'Program' },
    { key: 'status', label: 'Status', render: (r) => {
      const s = (r.status||'').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status||'N/A'));
      return (<span className={`badge ${cls}`}>{text}</span>);
    }}
  ];

  if (canEdit) {
    columns.push({ 
      key: 'actions', 
      label: 'Actions', 
      actions: [
        { label: 'Edit', onClick: (row) => openModal(row) },
        { label: 'Toggle', onClick: (row) => handleToggle(row) },
        { label: 'Archive', variant: 'danger', onClick: (row) => handleArchive(row) }
      ] 
    });
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-3">
        <h2 className="text-2xl font-semibold m-0">Subject Management</h2>
        
        {canAdd && (
          <button 
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-green-600 text-white text-sm hover:bg-green-700 border-0" 
            onClick={()=>openModal()}
          >
            Add Subject
          </button>
        )}
      </div>

      {/* UI Filter */}
      <div className="bg-gray-50 p-4 rounded mb-4 flex flex-col sm:flex-row gap-4 border border-gray-200">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 font-semibold uppercase">Filter by Program</label>
          <select className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 bg-white" value={filterProgram} onChange={e=>setFilterProgram(e.target.value)}>
            <option value="">All Programs</option>
            {availablePrograms.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <Table columns={columns} data={displayData} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Subject' : 'Add Subject'} onClose={closeModal}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
            <select name="program_id" value={form.program_id} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">{addEditPrograms.length ? 'Select program...' : 'No programs available'}</option>
              {addEditPrograms.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
            </select>
            {isDean && (
              <div className="mt-1 text-xs text-gray-500">
                Programs are limited to your assigned department.
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Code</label>
            <input name="subject_code" value={form.subject_code} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject Name</label>
            <input name="subject_name" value={form.subject_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border bg-white text-sm">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700">{loading ? 'Saving...' : (editing ? 'Update Subject' : 'Save Subject')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default SubjectIndex;
