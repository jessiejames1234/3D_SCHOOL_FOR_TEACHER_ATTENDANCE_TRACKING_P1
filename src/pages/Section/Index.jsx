import React, { useState, useEffect, useMemo } from "react";
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import { apiGet, apiPost, apiPut } from '../../services/api.js';

function SectionIndex() {
  const [sections, setSections] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [yearLevels, setYearLevels] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ section_name: '', program_id: '', year_id: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // States for Table UI Filters
  const [filterProgram, setFilterProgram] = useState('');
  const [filterYearLevel, setFilterYearLevel] = useState('');

  // Authentication & Role Check logic
  const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
  const isAdmin = Number(user?.role_id) === 1;
  const isDean = Number(user?.role_id) === 2;
  const isProgramHead = Number(user?.role_id) === 3;
  const isSecretary = Number(user?.role_id) === 4;
  
  // Program heads can edit assigned rows, but only admin can add new records.
  const canEdit = isAdmin || isProgramHead;
  const canAdd = isAdmin;

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) { if (err?.status === 405 || err?.status === 500) return await fallback(); throw err; }
  };

  useEffect(() => { 
    (async () => { 
      try { 
        const [s,p,y] = await Promise.all([apiGet('sections'), apiGet('programs'), apiGet('year-levels')]); 
        setSections(Array.isArray(s) ? s.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []); 
        setPrograms(Array.isArray(p) ? p : []); 
        setYearLevels(Array.isArray(y) ? y : []); 
      } catch(e) { 
        console.error(e); setError('Failed to load sections, programs, or year levels'); 
      } 
    })(); 
  }, []);

  // --- ROLE-BASED VISIBILITY & FILTERING ---
  const visibleSections = useMemo(() => {
    return sections.filter(sec => {
      if (isAdmin) return true;
      // Program head strictly sees ONLY their assigned program's sections
      if (isProgramHead) {
        return Number(sec.head_id) === Number(user?.user_id);
      }
      // Dean and secretary see the whole department
      if (isDean || isSecretary) {
        return Number(sec.dept_id) === Number(user?.dept_id);
      }
      return false;
    });
  }, [sections, isAdmin, isProgramHead, isDean, isSecretary, user]);

  const displayedAndFiltered = useMemo(() => {
    return visibleSections.filter(sec => {
      if (filterProgram && String(sec.program_id) !== String(filterProgram)) return false;
      if (filterYearLevel && String(sec.year_id) !== String(filterYearLevel)) return false;
      return true;
    });
  }, [visibleSections, filterProgram, filterYearLevel]);

  const displayData = useMemo(() => {
    return displayedAndFiltered.map((sec, i) => ({
      ...sec,
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
    }
    return list;
  }, [programs, isProgramHead, user]);


  const checkProgramHeadPermission = (rowProgramHeadId) => {
    if (isAdmin) return true;
    if (isProgramHead && Number(rowProgramHeadId) !== Number(user?.user_id)) {
      try { if (window.Swal) window.Swal.fire('Unauthorized', 'You can only modify sections assigned to your specific program.', 'error'); else alert('Unauthorized'); } catch(e){}
      return false;
    }
    return true;
  };


  const openModal = (sec=null) => { 
    setError(''); 
    if (sec) { 
      if (!checkProgramHeadPermission(sec.head_id)) return;
      setEditing(sec); 
      setForm({ section_name: sec.section_name||'', program_id: sec.program_id||'', year_id: sec.year_id||'' }); 
    } else { 
      if (!canAdd) return;
      setEditing(null); 
      setForm({ section_name:'', program_id: addEditPrograms[0]?.program_id || '', year_id: yearLevels[0]?.year_id || '' }); 
    } 
    setShowModal(true); 
  };
  
  const closeModal = () => setShowModal(false);
  const handleChange = (e) => setForm(p => ({...p, [e.target.name]: e.target.value}));

  const validateForm = () => {
    const name = (form.section_name||'').trim();
    if (!name) return 'Section name is required';
    if (!form.program_id) return 'Program is required';
    if (!form.year_id) return 'Year level is required';
    const conflict = sections.find(s => s.section_name && String(s.section_name).toLowerCase() === name.toLowerCase() && Number(s.program_id) === Number(form.program_id) && Number(s.year_id) === Number(form.year_id) && (!editing || Number(s.section_id) !== Number(editing.section_id)));
    if (conflict) return 'A section with the same name already exists for the selected program and year level';
    return null;
  };

  const handleSubmit = async (e) => { 
    e.preventDefault(); 
    setLoading(true); setError(''); 
    const v = validateForm(); 
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }
    try {
      const payload = { section_name: form.section_name.trim(), program_id: Number(form.program_id), year_id: Number(form.year_id) };
      if (editing && editing.section_id) {
        await runWithFallback(
          () => apiPut(`sections/${editing.section_id}`, payload),
          () => apiPost(`sections/${editing.section_id}/update`, payload)
        );
      } else {
        if (!canAdd) {
          const msg = 'Only admin can add sections.';
          try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Unauthorized', text: msg }); else alert(msg); } catch(e){}
          setLoading(false);
          return;
        }
        await apiPost('sections', payload);
      }
      const data = await apiGet('sections');
      setSections(Array.isArray(data) ? data.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Section updated' : 'Section added', timer:1400, showConfirmButton:false }); } catch(e){}
    } catch(err) { 
      console.error(err); 
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save'; 
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: msg }); else alert(msg); } catch(e){} 
      setError(msg); 
    } finally { setLoading(false); } 
  };

  const handleToggle = async (sec) => {
    if (!sec || !sec.section_id) return;
    if (!checkProgramHeadPermission(sec.head_id)) return;

    const newStatus = String(sec.status) === 'active' ? 'inactive' : 'active';
    try {
      await runWithFallback(
        () => apiPut(`sections/${sec.section_id}`, { status: newStatus }),
        () => apiPost(`sections/${sec.section_id}/update`, { status: newStatus })
      );
      const data = await apiGet('sections'); setSections(Array.isArray(data)? data.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); } catch(e){} }
  };

  const handleArchive = async (sec) => {
    if (!sec || !sec.section_id) return;
    if (!checkProgramHeadPermission(sec.head_id)) return;

    try {
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive section?', text: 'This will remove the section from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive section?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`sections/${sec.section_id}`, { status: 'archive' }),
        () => apiPost(`sections/${sec.section_id}/update`, { status: 'archive' })
      );
      const data = await apiGet('sections'); setSections(Array.isArray(data)? data.filter(x => String(x.status||'').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); } catch(e){} }
  };

  const columns = [
    { key: 'display_index', label: '#' },
    { key: 'section_name', label: 'Section Name' },
    { key: 'program_name', label: 'Program' },
    { key: 'year_level', label: 'Year Level', render: (r) => r.level || r.year_level || '' },
    { key: 'status', label: 'Status', render: (r) => {
      const s = (r.status || '').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status || 'N/A'));
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
        <h2 className="text-2xl font-semibold m-0">Sections</h2>
        
        {canAdd && (
          <button 
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-green-600 text-white text-sm hover:bg-green-700 border-0" 
            onClick={() => openModal()}
          >
            Add Section
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
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1 font-semibold uppercase">Filter by Year Level</label>
          <select className="w-full border border-gray-300 rounded p-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500 bg-white" value={filterYearLevel} onChange={e=>setFilterYearLevel(e.target.value)}>
            <option value="">All Year Levels</option>
            {yearLevels.map(y => <option key={y.year_id} value={y.year_id}>{y.level}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <Table columns={columns} data={displayData} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Section' : 'Add Section'} onClose={closeModal}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
            <select name="program_id" value={form.program_id||''} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">Select program</option>
              {addEditPrograms.map(p => React.createElement('option', { key: p.program_id, value: p.program_id }, p.program_name))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year Level</label>
            <select name="year_id" value={form.year_id||''} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">Select year level</option>
              {yearLevels.map(y => React.createElement('option', { key: y.year_id, value: y.year_id }, y.level))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
            <input name="section_name" value={form.section_name||''} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500" />
          </div>
          
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border bg-white text-sm">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700">{loading ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default SectionIndex;
