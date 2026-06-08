import React from 'react';
import { AuthContext } from "../../context/AuthContext.jsx";
import Table from '../../components/Table.jsx';
import Modal from '../../components/Modal.jsx';
import { apiGet, apiPost } from '../../services/api.js';

// Avoid importing sweetalert2 directly to prevent dev-tunnel/module-loader issues.
// Use global SweetAlert2 (window.Swal) when available, otherwise fallback to alert().
const swalFire = (title, text, icon) => {
  if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
    return window.Swal.fire(title, text, icon);
  }
  // Fallback: combine title and text for basic feedback
  const msg = text ? `${title}: ${text}` : title;
  if (icon === 'error' || icon === 'warning') alert(msg); else alert(msg);
  return Promise.resolve();
};

// Helper function to get the next date for a given day of the week (Timezone Safe)
const getNextDateForDay = (dayName) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetDay = days.findIndex(d => d.toLowerCase() === dayName.toLowerCase());
  if (targetDay === -1) return '';

  const today = new Date();
  const currentDay = today.getDay();
  let daysUntil = targetDay - currentDay;

  // If the day has already passed this week, schedule it for next week
  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0) {
    // If it's today, keep it as today
    daysUntil = 0; 
  }

  const targetDate = new Date(today);
  targetDate.setDate(today.getDate() + daysUntil);
  
  // Build the YYYY-MM-DD string using local time to avoid UTC off-by-one errors
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

const sameId = (a, b) => String(a ?? '') === String(b ?? '');

const getScheduleOffering = (schedule, offerings) => {
  if (!schedule || schedule.offering_id == null) return null;
  return offerings.find(o => sameId(o.offering_id, schedule.offering_id)) || null;
};

const getScheduleTeacherId = (schedule, offerings) => {
  const directTeacherId = schedule?.teacher_id ?? schedule?.user_id ?? schedule?.original_teacher_id ?? null;
  if (directTeacherId !== null && directTeacherId !== undefined && String(directTeacherId) !== '') {
    return String(directTeacherId);
  }
  const offering = getScheduleOffering(schedule, offerings);
  return offering?.user_id !== null && offering?.user_id !== undefined ? String(offering.user_id) : '';
};

const buildScheduleLabel = (schedule, offerings) => {
  const offering = getScheduleOffering(schedule, offerings);
  const subjectCode = schedule?.subject_code || offering?.subject_code || 'Class';
  const sectionName = schedule?.section_name || offering?.section_name || '';
  const day = schedule?.day_of_week || '';
  const start = schedule?.start_time?.slice(0, 5) || '';
  const end = schedule?.end_time?.slice(0, 5) || '';
  const room = schedule?.room_name ? ` | ${schedule.room_name}` : '';
  return `${subjectCode}${sectionName ? ` - ${sectionName}` : ''} (${day} ${start}-${end})${room}`;
};

export default function SubstituteIndex() {
  const { user } = React.useContext(AuthContext); 
  const isDean = Number(user?.role_id) === 2;
  const canAddSubstitution = isDean;
  const [rows, setRows] = React.useState([]);
  
  // Data for Dropdowns
  const [teachers, setTeachers] = React.useState([]);
  const [schedules, setSchedules] = React.useState([]);
  const [offerings, setOfferings] = React.useState([]);
  
  const [loading, setLoading] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  
  // Filters
  const [filterDate, setFilterDate] = React.useState('');
  const [filterTeacher, setFilterTeacher] = React.useState('');
  const [filterClass, setFilterClass] = React.useState('');

  // Form State (Updated for batch selection)
  const [form, setForm] = React.useState({ 
    original_teacher_id: '', 
    substitute_id: '',
    selectedSchedules: [] // Array to hold multiple { schedule_id, date } objects
  });

  const classOptions = React.useMemo(() => {
    const map = {};
    schedules.forEach(s => {
      map[s.schedule_id] = buildScheduleLabel(s, offerings);
    });
    return Object.keys(map).map(k => ({ id: k, label: map[k] }));
  }, [schedules, offerings]);

  const filteredRows = React.useMemo(() => {
    let out = Array.isArray(rows) ? rows.slice() : [];
    if (filterDate) {
      out = out.filter(r => String(r.date).startsWith(filterDate));
    }
    if (filterTeacher) {
      out = out.filter(r => String(r.teacher_id) === String(filterTeacher));
    }
    if (filterClass) {
      out = out.filter(r => String(r.schedule_id) === String(filterClass) || String(r.subject_code || '').includes(filterClass));
    }
    return out;
  }, [rows, filterDate, filterTeacher, filterClass]);

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'teacher', label: 'Original Teacher', render: r => `${r.teacher_last || ''}, ${r.teacher_first || ''}` },
    { key: 'class_info', label: 'Class', render: r => `${r.subject_code || ''} (${r.start_time || ''}-${r.end_time || ''})` },
    { key: 'dept_name', label: 'Department' },
    { key: 'substitute', label: 'Substitute', render: r => `${r.sub_last || ''}, ${r.sub_first || ''}` },
    { key: 'actions', label: 'Actions', actions: (row) => [
        { label: 'View', onClick: () => openView(row) }
      ]
    }
  ];

  const fetchRows = async () => {
    setLoading(true);
    try {
      const d = await apiGet('substitute');
      setRows(Array.isArray(d) ? d : []);
    } catch(e) { console.error('Failed to load substitutions', e); }
    setLoading(false);
  };

  const loadDropdownData = async () => {
    if (!user) return;
    try {
      const [tRes, sRes, oRes, uRes] = await Promise.all([
        apiGet('teachers'), 
        apiGet('class-schedules'),
        apiGet('subject-offerings'),
        apiGet('users') 
      ]);

      let allTeachers = Array.isArray(tRes) ? tRes : [];
      let allUsers = Array.isArray(uRes) ? uRes : [];
      let myDeptId = user.dept_id;

      if (!myDeptId && allUsers.length > 0) {
        const me = allUsers.find(u => String(u.user_id) === String(user.user_id));
        if (me && me.dept_id) {
            myDeptId = me.dept_id;
        }
      }

      if (Number(user.role_id) !== 1) {
        if (myDeptId) {
            const filtered = allTeachers.filter(t => String(t.dept_id) === String(myDeptId));
            if (filtered.length > 0) {
                allTeachers = filtered;
            }
        }
      }

      setTeachers(allTeachers);
      setSchedules(Array.isArray(sRes) ? sRes : []);
      setOfferings(Array.isArray(oRes) ? oRes : []);
    } catch (e) { console.error("Failed to load options", e); }
  };

  React.useEffect(() => { 
    if(user) {
      fetchRows();
      loadDropdownData();
    }
  }, [user]);

  const availableSchedules = React.useMemo(() => {
    if (!form.original_teacher_id) return [];
    const teacherSchedules = schedules.filter(s => sameId(getScheduleTeacherId(s, offerings), form.original_teacher_id));

    return teacherSchedules.map(s => {
      return {
        schedule_id: s.schedule_id,
        day_of_week: s.day_of_week, 
        label: buildScheduleLabel(s, offerings)
      };
    });
  }, [form.original_teacher_id, offerings, schedules]);

  // Handle Select / Input changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === 'original_teacher_id') {
      // Clear selections when the original teacher changes
      setForm(prev => ({ ...prev, original_teacher_id: value, selectedSchedules: [] }));
    } else {
      setForm(prev => ({ ...prev, [name]: value }));
    }
  };

  // Handle Checkbox toggles for batch selection
  const handleScheduleToggle = (schedule_id, day_of_week) => {
    const calculatedDate = getNextDateForDay(day_of_week);
    
    setForm(prev => {
      const isAlreadySelected = prev.selectedSchedules.some(s => String(s.schedule_id) === String(schedule_id));
      
      if (isAlreadySelected) {
        // Remove from array if unchecked
        return { 
          ...prev, 
          selectedSchedules: prev.selectedSchedules.filter(s => String(s.schedule_id) !== String(schedule_id)) 
        };
      } else {
        // Add to array if checked
        return { 
          ...prev, 
          selectedSchedules: [...prev.selectedSchedules, { schedule_id, date: calculatedDate }] 
        };
      }
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canAddSubstitution) {
      return swalFire('Not allowed', 'Only dean can add substitutions.', 'warning');
    }
    if (form.selectedSchedules.length === 0 || !form.substitute_id) {
        return swalFire('Missing Details', 'Please select a substitute and at least one class schedule.', 'warning');
    }

    // FRONTEND DUPLICATE CHECK
    for (const sub of form.selectedSchedules) {
      const isDuplicate = rows.some(r => String(r.schedule_id) === String(sub.schedule_id) && r.date === sub.date);
      if (isDuplicate) {
          return swalFire('Duplicate Entry', `A substitution is already scheduled for one of the selected classes on ${sub.date}.`, 'error');
      }
    }

    try {
      // Post the array of schedules
      const response = await apiPost('substitute', {
        original_teacher_id: form.original_teacher_id,
        substitute_id: form.substitute_id,
        substitutions: form.selectedSchedules 
      });

      if (response && response.error) {
          return swalFire('Error', response.message || 'Failed to add substitutions', 'error');
      }

      await swalFire('Success!', response.message || 'Substitutions added successfully.', 'success');
      setShowModal(false);
      setForm({ original_teacher_id: '', substitute_id: '', selectedSchedules: [] });
      fetchRows(); 

    } catch (err) {
      const errorMessage = err.response?.data?.message || err.message || 'An unexpected error occurred.';
      swalFire('Error', errorMessage, 'error');
    }
  };

  const openView = (r) => { setSelected(r); setShowModal('view'); };
  const openAdd = () => { 
    if (!canAddSubstitution) return;
    setForm({ original_teacher_id: '', substitute_id: '', selectedSchedules: [] });
    setShowModal('add'); 
  };
  const closeView = () => { setSelected(null); setShowModal(false); };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Substitutions</h2>
        {canAddSubstitution ? (
          <button onClick={openAdd} className="px-4 py-2 bg-green-600 text-white rounded shadow">Add Substitution</button>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="px-3 py-2 border rounded text-sm" />
        <select value={filterTeacher} onChange={e=>setFilterTeacher(e.target.value)} className="px-3 py-2 border rounded text-sm">
          <option value="">All Teachers</option>
          {teachers.map(t => (<option key={t.user_id} value={t.user_id}>{t.last_name}, {t.first_name}</option>))}
        </select>
        <select value={filterClass} onChange={e=>setFilterClass(e.target.value)} className="px-3 py-2 border rounded text-sm">
          <option value="">All Classes</option>
          {classOptions.map(c => (<option key={c.id} value={c.id}>{c.label}</option>))}
        </select>
        <button onClick={() => { setFilterDate(''); setFilterTeacher(''); setFilterClass(''); }} className="px-3 py-2 border rounded text-sm">Clear</button>
      </div>

      <Table
        columns={columns}
        data={filteredRows}
        pageSize={10}
        loading={loading}
        emptyText={'No substitutions match your filters'}
        rowKey={(r, idx) => r.substitution_id ?? `${r.schedule_id}-${r.date}-${idx}`}
      />

      {/* VIEW MODAL */}
      <Modal show={showModal === 'view'} title={selected ? `${selected.teacher_first || ''} ${selected.teacher_last || ''} — Substitution` : 'Substitution Details'} onClose={closeView} size="md">
        <div className="rounded-lg bg-white shadow-lg p-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-lg">{selected ? (selected.teacher_first || '').charAt(0) : ''}</div>
              <div>
                <div className="text-lg font-semibold">{selected ? `${selected.teacher_first || ''} ${selected.teacher_last || ''}` : '—'}</div>
                <div className="text-sm text-gray-500">{selected?.dept_name || '—'}</div>
              </div>
            </div>
            <div className="text-right">
              {selected && (
                <div className="inline-block px-3 py-1 rounded-full text-sm font-semibold bg-green-50 text-green-800">
                  SUBSTITUTION
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Date</div><div className="font-medium">{selected?.date || '—'}</div></div>
              <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Class</div><div className="font-medium">{selected ? `${selected.subject_code || ''} ${selected.section_name ? '- ' + selected.section_name : ''}` : '—'}</div></div>
            </div>
            <div className="space-y-3">
              <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Original Teacher</div><div className="font-medium">{selected ? `${selected.teacher_first || ''} ${selected.teacher_last || ''}` : '—'}</div></div>
              <div className="bg-gray-50 p-3 rounded-lg"><div className="text-xs text-gray-500">Substitute</div><div className="font-medium">{selected ? `${selected.sub_first || ''} ${selected.sub_last || ''}` : '—'}</div></div>
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={closeView} className="px-4 py-2 rounded border">Close</button>
          </div>
        </div>
      </Modal>

      {/* ADD MODAL */}
      <Modal show={canAddSubstitution && showModal === 'add'} title="Add New Substitution" onClose={closeView} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* 1. Original Teacher */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Original Teacher</label>
            <select name="original_teacher_id" value={form.original_teacher_id} onChange={handleChange} className="w-full border rounded px-3 py-2">
              <option value="">
                {teachers.length === 0 ? 'No teachers found' : '-- Select Teacher --'}
              </option>
              {teachers.map(t => (
                <option key={t.user_id} value={t.user_id}>{t.last_name}, {t.first_name}</option>
              ))}
            </select>
          </div>

          {/* 2. Schedule Checklist (Batch Selection) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Select Classes to Substitute</label>
            
            {!form.original_teacher_id ? (
              <div className="p-3 bg-gray-50 border rounded text-sm text-gray-500 text-center">
                Select an original teacher to view their classes.
              </div>
            ) : availableSchedules.length === 0 ? (
              <div className="p-3 bg-gray-50 border rounded text-sm text-gray-500 text-center">
                No classes found for this teacher.
              </div>
            ) : (
              <div className="border rounded max-h-48 overflow-y-auto bg-gray-50 p-2 space-y-2">
                {availableSchedules.map(s => {
                  const isChecked = form.selectedSchedules.some(sel => String(sel.schedule_id) === String(s.schedule_id));
                  const autoDate = getNextDateForDay(s.day_of_week);
                  
                  return (
                    <label key={s.schedule_id} className={`flex items-start gap-3 p-2 border rounded cursor-pointer transition-colors ${isChecked ? 'bg-green-50 border-green-300' : 'bg-white hover:bg-gray-100'}`}>
                      <input 
                        type="checkbox" 
                        className="mt-1 w-4 h-4 text-green-600 rounded focus:ring-green-500"
                        checked={isChecked}
                        onChange={() => handleScheduleToggle(s.schedule_id, s.day_of_week)}
                      />
                      <div className="flex-1">
                        <div className="font-medium text-sm text-gray-800">{s.label}</div>
                        <div className="text-xs text-green-700 mt-0.5 font-semibold">
                          Will be scheduled for: {autoDate}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3. Substitute Teacher */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Substitute Teacher</label>
            <select name="substitute_id" value={form.substitute_id} onChange={handleChange} className="w-full border rounded px-3 py-2" required>
              <option value="">-- Select Substitute --</option>
              {teachers
                .filter(t => String(t.user_id) !== String(form.original_teacher_id)) 
                .map(t => (
                  <option key={t.user_id} value={t.user_id}>{t.last_name}, {t.first_name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end pt-3">
            <button type="button" onClick={closeView} className="px-4 py-2 border rounded mr-2">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-green-600 text-white rounded">Save Substitutions</button>
          </div>

        </form>
      </Modal>
    </div>
  );
}
