import React from 'react';
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

// Leaves File (Secretary) - can create, edit or cancel while pending
export default function LeavesFiles(){
  const { user } = React.useContext(AuthContext);
  const [showDetailModal, setShowDetailModal] = React.useState(false);
  const [detailItem, setDetailItem] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ date_from:'', date_to:'', leave_type_id:'', teacher_id:'', reason:'' });
  const [leaveTypes, setLeaveTypes] = React.useState([]);
  const [teachers, setTeachers] = React.useState([]);
  const [teacherSearch, setTeacherSearch] = React.useState('');

  React.useEffect(()=>{
    // Restrict page: only dean (role_id === 2) or program_head (role_id === 3) may access approvals; others redirect
    if (!user) return;
    const rid = Number(user.role_id);
    if (![2,3].includes(rid)) { window.location.hash = '#/dashboard'; }
  }, [user]);

  const fetch = async ()=>{
    setLoading(true);
    try{
      const [d, types, tlist] = await Promise.all([
        apiGet('leaves'),
        apiGet('leaves/types').catch(()=>[]),
        apiGet('teachers').catch(async ()=>{
          // fallback to users endpoint
          try { const u = await apiGet('users'); return Array.isArray(u) ? u.filter(x=>Number(x.role_id)===5) : []; } catch(e){ return []; }
        })
      ]);
      const list = Array.isArray(d) ? d : [];
      setLeaveTypes(Array.isArray(types) ? types : []);
      // restrict teachers to same department for non-admin users
      const allTeachers = Array.isArray(tlist) ? tlist : [];
      const filteredTeachers = (user && 'dept_id' in user) ? allTeachers.filter(t => String(t.dept_id) === String(user.dept_id)) : allTeachers;
      setTeachers(filteredTeachers);
      // show only same department (if user available)
      const deptFiltered = user && 'dept_id' in user ? list.filter(l => String(l.dept_id) === String(user.dept_id)) : list;
      setRows(deptFiltered.map(r => ({ ...r, _status: String(r.req_status || '').toLowerCase() })));
    }catch(e){ console.error(e); }
    setLoading(false);
  };

  React.useEffect(()=>{ fetch(); }, []);

  // filter rows by teacher search
  const displayedRows = React.useMemo(()=>{
    if (!teacherSearch) return rows;
    const q = teacherSearch.trim().toLowerCase();
    return rows.filter(r => (`${r.first_name || ''} ${r.last_name || ''}`).toLowerCase().includes(q));
  }, [rows, teacherSearch]);

  const openModal = (row=null)=>{
    setEditing(row);
    if (row){ setForm({ date_from: row.date_from, date_to: row.date_to, leave_type_id: row.leave_type_id || '', teacher_id: row.teacher_id || '', reason: row.reason || '' }); }
    else setForm({ date_from:'', date_to:'', leave_type_id:'', teacher_id: '', reason:'' });
    setShowModal(true);
  };

  const openDetail = (r) => { setDetailItem(r); setShowDetailModal(true); };

  const handleSubmit = async (e)=>{
    e.preventDefault();
    try{
      // teacher_id: if user is secretary and selected teacher exists use it, else if teacher user use current user id
      const payloadTeacher = (Number(user.role_id) === 4) ? (Number(form.teacher_id) || null) : (user.user_id || null);
      if (!payloadTeacher) throw new Error('Teacher is required');
      // validate teacher dept matches current user dept (if current user has dept)
      if (user && 'dept_id' in user){
        const t = teachers.find(x => Number(x.user_id) === Number(payloadTeacher));
        if (!t || String(t.dept_id) !== String(user.dept_id)) throw new Error('Selected teacher is not in your department');
      }
      const payload = { teacher_id: payloadTeacher, leave_type_id: Number(form.leave_type_id)||1, date_from: form.date_from, date_to: form.date_to, reason: form.reason };
      if (editing && editing.leave_id){
        // edit only if still pending
        if (String(editing.req_status) !== 'pending') throw new Error('Cannot edit non-pending leave');
        await apiPut(`leaves/${editing.leave_id}`, payload);
        window.Swal && window.Swal.fire('Saved','Leave updated','success');
      } else {
        // create default pending
        await apiPost('leaves', payload);
        window.Swal && window.Swal.fire('Saved','Leave request created','success');
      }
      setShowModal(false);
      fetch();
    }catch(err){
      console.error(err);
      window.Swal && window.Swal.fire('Error', err?.message || 'Failed', 'error');
    }
  };

  const handleCancel = async (r)=>{
    if (!r || !r.leave_id) return;
    if (!confirm('Cancel this leave request?')) return;
    try{
      await apiPut(`leaves/${r.leave_id}`, { req_status: 'canceled' });
      window.Swal && window.Swal.fire('Canceled','Leave request canceled','success');
      fetch();
    }catch(e){ console.error(e); window.Swal && window.Swal.fire('Error','Failed to cancel','error'); }
  };

  // align action behavior with Leave_approval page
  const handleDecision = async (r, decision)=>{
    if (!r || !r.leave_id) return;
    try{
      await apiPut(`leaves/${r.leave_id}`, { req_status: decision });
      window.Swal && window.Swal.fire('Saved', `Leave ${decision}`, 'success');
      fetch();
    }catch(e){ console.error(e); window.Swal && window.Swal.fire('Error','Failed','error'); }
  };

  const openAddSub = async (r)=>{
    if (!r) return;
    // Simple prompt-based substitution flow to match Leave_approval behavior without adding a modal here
    try{
      const schedule_id = window.prompt('Enter schedule ID for substitution (or cancel):');
      if (!schedule_id) return;
      const substitute_user_id = window.prompt('Enter substitute user ID (or cancel):');
      if (!substitute_user_id) return;
      const date = window.prompt('Enter date (YYYY-MM-DD):', r.date_from || '');
      if (!date) return;
      await apiPost('substitutions', { schedule_id: Number(schedule_id), substitute_user_id: Number(substitute_user_id), date });
      window.Swal && window.Swal.fire('Saved','Substitution added','success');
      fetch();
    }catch(e){ console.error(e); window.Swal && window.Swal.fire('Error','Failed to add substitution','error'); }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r,pIdx,gIdx)=> gIdx+1 },
    { key: 'teacher', label: 'Teacher', render: (r)=> `${r.first_name || ''} ${r.last_name || ''}` },
    { key: 'date', label: 'From - To', render: (r)=> `${r.date_from} → ${r.date_to}` },
    { key: 'type', label: 'Type', render: (r)=> r.name_type || r.leave_type || 'N/A' },
    { key: 'status', label: 'Status', render: (r)=> (
        <span className={`badge ${r.req_status==='pending' ? 'bg-yellow-300 text-black' : (r.req_status==='approve' ? 'bg-green-600 text-white' : 'bg-red-500 text-white')}`}>{String(r.req_status).toUpperCase()}</span>
      ) },
    { key: 'actions', label: 'Actions', actions: (row)=> {
      const actions = [];
      // resolve role robustly
      let role = (user && (user.role_name || user.role)) || '';
      if (!role && user && user.role_id) {
        const rid = Number(user.role_id);
        if (rid === 4) role = 'secretary';
        else if (rid === 5) role = 'teacher';
        else if (rid === 2) role = 'dean';
        else if (rid === 3) role = 'program_head';
      }

      if (['dean','program_head'].includes(String(role).toLowerCase())){
        if (row.req_status === 'pending'){
          actions.push({ label: 'Approve', onClick: ()=> handleDecision(row, 'approve') });
          actions.push({ label: 'Reject', variant: 'danger', onClick: ()=> handleDecision(row, 'rejected') });
        }
        // Do NOT add 'Add Sub' here for File_leave
      } else if (String(role).toLowerCase() === 'secretary'){
        actions.push({ label: 'View', onClick: ()=> openDetail(row) });
        // Do NOT add 'Add Sub' here for File_leave
      }
      return actions;
    } }
  ];

  // modern details modal design
  const renderDetailModal = () => (
    <Modal show={showDetailModal} title={detailItem ? `${detailItem.first_name || ''} ${detailItem.last_name || ''} — Leave` : 'Leave Details'} onClose={()=>setShowDetailModal(false)} size="md">
      <div className="rounded-lg bg-white shadow-lg p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">{detailItem ? (detailItem.first_name||'').charAt(0) : ''}</div>
            <div>
              <div className="text-lg font-semibold">{detailItem ? `${detailItem.first_name || ''} ${detailItem.last_name || ''}` : '—'}</div>
              <div className="text-sm text-gray-500">{detailItem && (detailItem.dept_name || detailItem.department || '')}</div>
            </div>
          </div>
          <div className="text-right">{detailItem && <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${detailItem.req_status==='pending' ? 'bg-yellow-50 text-yellow-800' : (detailItem.req_status==='approve' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800')}`}>{String(detailItem.req_status || '').toUpperCase()}</div>}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Leave ID</div><div className="font-medium">{detailItem?.leave_id ?? '—'}</div></div>
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Date Range</div><div className="font-medium">{detailItem ? `${detailItem.date_from} → ${detailItem.date_to}` : '—'}</div></div>
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Type</div><div className="font-medium">{detailItem?.name_type || detailItem?.leave_type || '—'}</div></div>
          </div>
          <div className="space-y-3">
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Approved by</div><div className="font-medium">{ (detailItem?.approver_first || detailItem?.approver_last) ? `${detailItem.approver_first || ''} ${detailItem.approver_last || ''}`.trim() : (detailItem?.created_at ?? '—') }</div></div>
            <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Requested by</div><div className="font-medium">{ (detailItem?.requester_first || detailItem?.requester_last) ? `${detailItem.requester_first || ''} ${detailItem.requester_last || ''}`.trim() : (detailItem?.requested_by ?? '—') }</div></div>
          </div>
        </div>

        <div className="mt-4 bg-white">
          <div className="text-sm font-medium mb-2">Reason</div>
          <div className="p-4 bg-gray-50 rounded-lg text-sm whitespace-pre-wrap">{detailItem?.reason || '—'}</div>
        </div>

        {detailItem?.notes && (<div className="mt-3"><div className="text-sm font-medium mb-2">Approver Notes</div><div className="p-3 bg-gray-50 rounded text-sm">{detailItem.notes}</div></div>)}

        {detailItem?.attachments && detailItem.attachments.length > 0 && (<div className="mt-3"><div className="text-sm font-medium mb-2">Attachments</div><div className="flex flex-col gap-2">{detailItem.attachments.map((a, i) => (<a key={i} href={a.url || '#'} className="text-sm text-blue-600 hover:underline" target="_blank" rel="noreferrer">{a.name || a.filename || `Attachment ${i+1}`}</a>))}</div></div>)}

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={()=>setShowDetailModal(false)} className="px-4 py-2 rounded border">Close</button>
          { detailItem && (['dean','program_head'].includes((user && user.role_name)||'') && detailItem.req_status === 'pending') && (<><button onClick={() => { handleDecision(detailItem, 'rejected'); setShowDetailModal(false); }} className="px-4 py-2 rounded bg-red-600 text-white">Reject</button><button onClick={() => { handleDecision(detailItem, 'approve'); setShowDetailModal(false); }} className="px-4 py-2 rounded bg-green-600 text-white">Approve</button></>)}
        </div>
      </div>
    </Modal>
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Leaves (File)</h2>
        <div className="flex items-center gap-3">
          <input
            placeholder="Search teacher..."
            value={teacherSearch}
            onChange={e=>setTeacherSearch(e.target.value)}
            className="px-2 py-1 border rounded-md text-sm"
            style={{ width: 180 }}
          />
          <button className="px-3 py-2 bg-green-600 text-white rounded-md text-sm" onClick={()=>openModal()}>File Leave</button>
        </div>
      </div>

      <Table columns={columns} data={displayedRows} pageSize={10} loading={loading} />

      <Modal show={showModal} title={editing ? 'Edit Leave' : 'File Leave'} onClose={()=>setShowModal(false)} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm">From</label>
            <input type="date" required name="date_from" value={form.date_from} onChange={(e)=>setForm(s=>({...s, date_from:e.target.value}))} className="form-control" />
          </div>
          <div>
            <label className="block text-sm">To</label>
            <input type="date" required name="date_to" value={form.date_to} onChange={(e)=>setForm(s=>({...s, date_to:e.target.value}))} className="form-control" />
          </div>
          <div>
            <label className="block text-sm">Leave Type</label>
            <select required value={form.leave_type_id} onChange={(e)=>setForm(s=>({...s, leave_type_id:e.target.value}))} className="form-select">
              <option value="">Select Leave Type</option>
              {leaveTypes.map((type)=>(<option key={type.leave_type_id ?? type.id} value={type.leave_type_id ?? type.id}>{type.name_type ?? type.name}</option>))}
            </select>
          </div>

          {Number(user.role_id) === 4 && (
            <div>
              <label className="block text-sm">Teacher</label>
              {/* show names only; remove inline search input */}
              <select required value={form.teacher_id} onChange={(e)=>setForm(s=>({...s, teacher_id:e.target.value}))} className="form-select">
                <option value="">Select Teacher</option>
                {teachers.map((teacher)=>(<option key={teacher.user_id} value={teacher.user_id}>{teacher.first_name} {teacher.last_name}</option>))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm">Reason</label>
            <textarea required value={form.reason} onChange={(e)=>setForm(s=>({...s, reason:e.target.value}))} className="form-control" />
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={()=>setShowModal(false)} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded bg-green-600 text-white">{editing ? 'Update' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      {renderDetailModal()}
    </div>
  );
}

// use shared api helpers from src/services/api.js (apiGet/apiPost/apiPut are globally exposed)
