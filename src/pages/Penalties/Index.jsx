import React from 'react';
import { AuthContext } from "../../context/AuthContext.jsx";
import { apiGet, apiPost, apiPut } from '../../services/api.js'; 
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';

export default function PenaltiesPage() {
  const { user } = React.useContext(AuthContext);
  const [rows, setRows] = React.useState([]);
  
  // Dropdown Options
  const [teachers, setTeachers] = React.useState([]);
  const [penaltyTypes, setPenaltyTypes] = React.useState([]);
  
  const [loading, setLoading] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  
  const [form, setForm] = React.useState({ 
    user_id: '', 
    penal_type_id: '', 
    date: new Date().toISOString().slice(0,10), 
    reason: '' 
  });

  // Access Control: Only Admins(1), Deans(2), Program Heads(3) should see this
  React.useEffect(() => {
    if (user && ![1, 2, 3].includes(Number(user.role_id))) {
       window.location.hash = '#/dashboard'; 
    }
  }, [user]);

  // Load Data
  const fetchData = async () => {
    setLoading(true);
    try {
      // NOTE: 'penalty-types' endpoint now matches backend structure
      const [pRes, tRes, ptRes, uRes] = await Promise.all([
        apiGet('penalties').catch(()=>[]),
        apiGet('teachers').catch(()=>[]),
        apiGet('penalty-types').catch(()=>[]),
        apiGet('users').catch(()=>[]) 
      ]);

      setRows(Array.isArray(pRes) ? pRes : []);

      let allTeachers = Array.isArray(tRes) ? tRes : [];
      let myDeptId = user?.dept_id;

      // Self-Correction for Department ID
      if (!myDeptId && Array.isArray(uRes)) {
        const me = uRes.find(u => String(u.user_id) === String(user.user_id));
        if (me && me.dept_id) myDeptId = me.dept_id;
      }

      // Department Filtering
      if (user && Number(user.role_id) !== 1) {
        if (myDeptId) {
            allTeachers = allTeachers.filter(t => String(t.dept_id) === String(myDeptId));
        } else {
            console.warn("Department unknown, showing no teachers for safety.");
            allTeachers = []; 
        }
      }

      setTeachers(allTeachers);
      setPenaltyTypes(Array.isArray(ptRes) ? ptRes : []);

    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  React.useEffect(() => { 
    if(user) fetchData(); 
  }, [user]);

  const openModal = (row = null) => {
    setEditing(row);
    if (row) {
      setForm({ 
        user_id: row.user_id, 
        penal_type_id: row.penal_type_id, 
        date: row.date, 
        reason: row.reason || '' 
      });
    } else {
      setForm({ 
        user_id: '', 
        penal_type_id: '', 
        date: new Date().toISOString().slice(0,10), 
        reason: '' 
      });
    }
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.user_id || !form.penal_type_id || !form.date) {
        return alert('Please fill in Teacher, Type, and Date.');
    }

    try {
      const payload = { 
        user_id: Number(form.user_id), 
        penal_type_id: Number(form.penal_type_id), 
        date: form.date, 
        reason: form.reason 
      };

      if (editing && editing.sanction_id) {
        await apiPut(`penalties/${editing.sanction_id}`, payload);
      } else {
        await apiPost('penalties', payload);
      }
      
      closeModal();
      fetchData(); 
      if(window.Swal) window.Swal.fire('Success', 'Saved successfully', 'success');
    } catch (err) {
      console.error(err);
      if(window.Swal) window.Swal.fire('Error', err?.message || 'Failed to save', 'error');
    }
  };

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'user', label: 'Teacher', render: (r) => `${r.last_name || ''}, ${r.first_name || ''}` },
    { key: 'type_name', label: 'Offense Type' },
    { key: 'reason', label: 'Reason/Remarks', render: r => r.reason || '—' },
    { key: 'actions', label: 'Actions', render: (r) => (
        <button onClick={() => openModal(r)} className="text-blue-600 hover:underline">Edit</button>
    )}
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Penalties & Sanctions</h2>
        <button className="px-4 py-2 bg-red-600 text-white rounded shadow hover:bg-red-700" onClick={() => openModal()}>
          Add Penalty
        </button>
      </div>

      <Table columns={columns} data={rows} pageSize={10} loading={loading} emptyText={'No penalties recorded.'} />

      <Modal show={showModal} title={editing ? 'Edit Penalty' : 'Add Penalty'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Teacher Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teacher</label>
            <select required value={form.user_id} onChange={(e)=>setForm(s=>({...s, user_id:e.target.value}))} className="w-full border rounded px-3 py-2 bg-white">
              <option value="">
                 {teachers.length === 0 ? 'No teachers found in your department' : '-- Select Teacher --'}
              </option>
              {teachers.map(t => (
                <option key={t.user_id} value={t.user_id}>{t.last_name}, {t.first_name}</option>
              ))}
            </select>
          </div>

          {/* Penalty Type Dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Penalty Type</label>
            <select required value={form.penal_type_id} onChange={(e)=>setForm(s=>({...s, penal_type_id:e.target.value}))} className="w-full border rounded px-3 py-2 bg-white">
              <option value="">-- Select Type --</option>
              {penaltyTypes.map(pt => (
                <option key={pt.penal_type_id} value={pt.penal_type_id}>{pt.type_name}</option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" required value={form.date} onChange={(e)=>setForm(s=>({...s, date:e.target.value}))} className="w-full border rounded px-3 py-2" />
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Remarks</label>
            <textarea rows="3" value={form.reason} onChange={(e)=>setForm(s=>({...s, reason:e.target.value}))} className="w-full border rounded px-3 py-2" placeholder="Optional details..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">Save</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}