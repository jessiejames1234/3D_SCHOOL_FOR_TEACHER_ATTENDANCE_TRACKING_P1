import React from 'react';
import { AuthContext } from "../../context/AuthContext.jsx";
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import { apiGet, apiPost, apiPut } from "../../services/api.js";
import { connectLiveUpdates } from "../../utils/liveUpdates.js";

// --- CUSTOM COMPONENT: Searchable Dropdown (No external tools) ---
const SearchableSelect = ({ options, value, onChange, placeholder, className, disabled }) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [searchTerm, setSearchTerm] = React.useState('');
  const wrapperRef = React.useRef(null);

  // Close when clicking outside
  React.useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  // Filter options based on search
  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Find selected label
  const selectedOption = options.find(o => String(o.value) === String(value));
  const displayLabel = selectedOption ? selectedOption.label : (placeholder || "Select...");

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <div 
        onClick={() => !disabled && setIsOpen(!isOpen)} 
        className={`border border-gray-200 rounded px-3 py-2 w-full bg-white flex justify-between items-center cursor-pointer ${disabled ? 'bg-gray-100 cursor-not-allowed' : ''}`}
      >
        <span className={`truncate ${!selectedOption ? 'text-gray-500' : 'text-gray-900'}`}>
          {displayLabel}
        </span>
        <span className="text-gray-400 text-xs ml-2">▼</span>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input 
              type="text" 
              autoFocus
              placeholder="Search..." 
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:border-green-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()} 
            />
          </div>
          <div className="overflow-y-auto flex-1">
            <div 
                className="px-4 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-500 italic"
                onClick={() => { onChange(''); setIsOpen(false); setSearchTerm(''); }}
            >
                -- None / All --
            </div>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <div 
                  key={opt.value} 
                  className={`px-4 py-2 hover:bg-green-50 cursor-pointer text-sm ${String(value) === String(opt.value) ? 'bg-green-50 text-green-700 font-medium' : 'text-gray-700'}`}
                  onClick={() => { onChange(opt.value); setIsOpen(false); setSearchTerm(''); }}
                >
                  {opt.label}
                </div>
              ))
            ) : (
              <div className="px-4 py-3 text-sm text-gray-400 text-center">No results found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
// ------------------------------------------------------------------

const normalizeAttendanceRows = (data) => (
  Array.isArray(data)
    ? data.map((rec, i) => ({ ...rec, key: rec.attendance_id ? `${rec.attendance_id}-${i}` : `rec-${i}` }))
    : []
);

function AttedanceManagement(){
  const { user } = React.useContext(AuthContext);
  const [records, setRecords] = React.useState([]);
  const [teachersAll, setTeachersAll] = React.useState([]);
  const [schedules, setSchedules] = React.useState([]);
  const [rooms, setRooms] = React.useState([]);
  const [departments, setDepartments] = React.useState([]);
  const [semesters, setSemesters] = React.useState([]);
  
  const [resolvedDeptId, setResolvedDeptId] = React.useState(''); 

  const [selectedDeptFilter, setSelectedDeptFilter] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [filterDate, setFilterDate] = React.useState('');
  const [filterStatus, setFilterStatus] = React.useState('');
  const [filterTeacher, setFilterTeacher] = React.useState('');
  const [showModal, setShowModal] = React.useState(false);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [showEditModal, setShowEditModal] = React.useState(false);
  const [selectedRecord, setSelectedRecord] = React.useState(null);
  const [roomInfo, setRoomInfo] = React.useState(null);
  
  const [showHistoricalModal, setShowHistoricalModal] = React.useState(false);
  const [historicalFilterSemester, setHistoricalFilterSemester] = React.useState('');
  const [historicalFilterDate, setHistoricalFilterDate] = React.useState('');
  const [historicalFilterStatus, setHistoricalFilterStatus] = React.useState('');
  const [historicalFilterTeacher, setHistoricalFilterTeacher] = React.useState('');
  
  const [editForm, setEditForm] = React.useState({ attendance_id:'', user_id: '', schedule_id: '', date: '', flag_in_id: 1, flag_check_id: 1, flag_out_id: 1, remarks: '' });
  const [addForm, setAddForm] = React.useState({ date: '', user_id: '', schedule_id: '', room_id: '', flag_in_id: 1, flag_check_id: 1, flag_out_id: 1, remarks: '' });
  const [schedulesForTeacher, setSchedulesForTeacher] = React.useState([]);
  const [addSelectedDept, setAddSelectedDept] = React.useState('');
  const recordsFetchInFlightRef = React.useRef(false);
  const recordsFetchSeqRef = React.useRef(0);
  const activeFiltersRef = React.useRef({ date: '', status: '', teacherId: '' });

  // Active semester detection
  const activeSemester = React.useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isActiveStatus = (s) => String(s?.status || '').toLowerCase() === 'active';
    const isInDateRange = (s) => {
      if (!s?.start_date || !s?.end_date) return false;
      const start = new Date(`${s.start_date}T00:00:00`);
      const end = new Date(`${s.end_date}T23:59:59`);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
      return today >= start && today <= end;
    };
    return (Array.isArray(semesters) ? semesters : []).find(s => isActiveStatus(s) && isInDateRange(s))
      || (Array.isArray(semesters) ? semesters : []).find(s => isInDateRange(s))
      || (Array.isArray(semesters) ? semesters : []).find(s => isActiveStatus(s))
      || null;
  }, [semesters]);
  const activeSemesterId = activeSemester?.semester_id ? Number(activeSemester.semester_id) : null;
  const activeSemesterLabel = React.useMemo(() => {
    if (!activeSemester) return '';
    const schoolYear = activeSemester.session_name || activeSemester.school_year || activeSemester.school_year_name || '';
    const term = activeSemester.term || activeSemester.semester_name || activeSemester.semester || '';
    const title = [schoolYear, term].filter(Boolean).join(' - ');
    const range = activeSemester.start_date && activeSemester.end_date ? `${activeSemester.start_date} to ${activeSemester.end_date}` : '';
    return [title, range].filter(Boolean).join(' | ') || 'Current active semester';
  }, [activeSemester]);

  const getUserId = (u) => {
    if (!u) return '';
    return (u.user_id || u.id || u.userId || u.uid || '') ;
  };
  const getDeptId = (u) => {
    if (!u) return '';
    return (u.dept_id || u.department_id || u.deptId || (u.dept && (u.dept.dept_id || u.dept.id)) || u.department || '');
  };

  const roleNames = {1: 'admin', 2: 'dean', 3: 'program_head', 4: 'secretary', 5: 'teacher', 6: 'department_admin'};

  React.useEffect(()=>{
    if (!user) { window.location.hash = '#/login'; return; }
    if (Number(user.role_id) === 5) { window.location.hash = '#/dashboard'; return; }
    
    const ctxDept = getDeptId(user);
    if(ctxDept) setResolvedDeptId(String(ctxDept));

    loadInitial();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadInitial = async ()=>{
    setLoading(true); setError('');
    try{
      const promises = [apiGet('attendance'), apiGet('class-schedules'), apiGet('rooms'), apiGet('subject-offerings'), apiGet('departments'), apiGet('semesters')];
      let teachersRes = [];
      try { teachersRes = await apiGet('teachers'); } 
      catch (e) { try { const usersRes = await apiGet('users'); teachersRes = Array.isArray(usersRes) ? usersRes.filter(u => Number(u.role_id) === 5) : []; } catch (e2) { teachersRes = []; } }
      const [rres, sres, roomsRes, offeringsRes, deptsRes, semsRes] = await Promise.all(promises);

      const teacherList = Array.isArray(teachersRes) ? teachersRes : [];
      const normalizedTeachers = teacherList.map(t => {
        const user_id = t.user_id ?? t.id ?? t.userId ?? t.uid ?? null;
        const dept_id = t.dept_id ?? t.department_id ?? t.deptId ?? (t.dept && (t.dept.dept_id ?? t.dept.id)) ?? t.department ?? null;
        return { ...t, user_id: user_id, dept_id: dept_id };
      });
      setTeachersAll(normalizedTeachers);
      setDepartments(Array.isArray(deptsRes) ? deptsRes : []);

      let foundDeptId = getDeptId(user);
      if (!foundDeptId && user && normalizedTeachers.length > 0) {
        const me = normalizedTeachers.find(t => String(t.user_id) === String(user.user_id));
        if (me) foundDeptId = getDeptId(me);
      }
      const rows = normalizeAttendanceRows(rres);
      if (!foundDeptId && rows.length > 0) foundDeptId = getDeptId(rows[0]); 

      if (foundDeptId) {
        setResolvedDeptId(String(foundDeptId));
        if (user && [2,3,4,5,6].includes(Number(user.role_id))) {
          setSelectedDeptFilter(String(foundDeptId));
          setAddSelectedDept(String(foundDeptId));
        }
      }

      const offeringsMap = Array.isArray(offeringsRes) ? offeringsRes.reduce((acc,it)=> { acc[String(it.offering_id)] = it; return acc; }, {}) : {};
      const schedulesAug = Array.isArray(sres) ? sres.map(s => ({
        ...s,
        teacher_id: s.teacher_id || s.user_id || (s.offering_id ? (offeringsMap[String(s.offering_id)] ? offeringsMap[String(s.offering_id)].user_id : null) : null)
      })) : [];
      setSemesters(Array.isArray(semsRes) ? semsRes : []);
      setSchedules(schedulesAug);
      setRooms(Array.isArray(roomsRes) ? roomsRes : []);
      setRecords(rows);
    }catch(err){ console.error(err); setError(err?.message || 'Failed to load'); }
    finally{ setLoading(false); }
  };

  const teachersVisible = React.useMemo(()=>{
    const all = Array.isArray(teachersAll) ? teachersAll : [];
    if (user && Number(user.role_id) === 1) {
      if (!selectedDeptFilter) return all;
      return all.filter(t => String(getDeptId(t)) === String(selectedDeptFilter));
    }
    if (user && [2,3,4,5,6].includes(Number(user.role_id))) {
      if (resolvedDeptId) return all.filter(t => String(getDeptId(t)) === String(resolvedDeptId));
      return all;
    }
    return all;
  }, [teachersAll, selectedDeptFilter, user, resolvedDeptId]);

  const teacherFilterOptions = React.useMemo(() => {
    return teachersVisible.map(t => ({
      value: getUserId(t),
      label: `${t.last_name || ''}, ${t.first_name || ''} ${t.role_name ? `(${t.role_name})` : ''}`
    }));
  }, [teachersVisible]);

  const addTeachers = React.useMemo(()=>{
    const all = Array.isArray(teachersAll) ? teachersAll : [];
    if (user && Number(user.role_id) === 1) {
      if (!addSelectedDept) return all;
      return all.filter(t => String(getDeptId(t)) === String(addSelectedDept));
    }
    if (user && [2,3,4,5,6].includes(Number(user.role_id))) {
      if (resolvedDeptId) return all.filter(t => String(getDeptId(t)) === String(resolvedDeptId));
      return all; 
    }
    return all;
  }, [teachersAll, addSelectedDept, user, resolvedDeptId]);

  const addTeacherOptions = React.useMemo(() => {
    return addTeachers.map(t => ({
      value: getUserId(t),
      label: `${t.last_name || ''}, ${t.first_name || ''}`
    }));
  }, [addTeachers]);

  const buildUrl = React.useCallback((date, status, teacherId)=>{
    let url = 'attendance';
    const params = [];
    if (date) params.push(`date=${date}`);
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (teacherId) params.push(`teacher_id=${teacherId}`);
    return params.length ? url + '?' + params.join('&') : url;
  }, []);

  const fetchRecords = React.useCallback(async (date, status, teacherId, options = {})=>{
    const silent = Boolean(options.silent);
    const force = Boolean(options.force);
    if (recordsFetchInFlightRef.current && !force) return;
    recordsFetchInFlightRef.current = true;
    const requestId = recordsFetchSeqRef.current + 1;
    recordsFetchSeqRef.current = requestId;
    if (!silent) setLoading(true);
    try{
      const url = buildUrl(date, status, teacherId);
      const data = await apiGet(url);
      if (requestId === recordsFetchSeqRef.current) {
        setRecords(normalizeAttendanceRows(data));
        if (!silent) setError('');
      }
    }catch(err){
      console.error(err);
      if (!silent) setError(err?.message || 'Failed to load');
    }
    finally{
      if (requestId === recordsFetchSeqRef.current) {
        recordsFetchInFlightRef.current = false;
        if (!silent) setLoading(false);
      }
    }
  }, [buildUrl]);

  const refreshCurrentRecords = React.useCallback((options = {}) => {
    const current = activeFiltersRef.current || {};
    return fetchRecords(current.date, current.status, current.teacherId, options);
  }, [fetchRecords]);

  React.useEffect(()=>{
    if (!user || Number(user.role_id) === 5) return;
    let cancelled = false;
    let refreshing = false;

    const refreshViaHttps = async ()=>{
      if (cancelled || document.hidden || refreshing || !localStorage.getItem('token') || showAddModal || showEditModal) return;
      refreshing = true;
      try {
        await refreshCurrentRecords({ silent: true });
      } catch(e) {
        console.error('Failed to refresh attendance records via HTTPS', e);
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
  }, [user, refreshCurrentRecords, showAddModal, showEditModal]);

  React.useEffect(()=>{
    if (!user || Number(user.role_id) === 5) return;
    let cancelled = false;
    let socket = null;
    const attendanceEntities = new Set(['attendance', 'attendance_records', 'attendance-records']);

    const refreshFromLiveUpdate = (payload) => {
      if (cancelled) return;
      const entity = String(payload?.entity || '').toLowerCase();
      if (entity && !attendanceEntities.has(entity)) return;
      refreshCurrentRecords({ silent: true });
    };

    try {
      socket = connectLiveUpdates({
        onRefresh: refreshFromLiveUpdate,
        onEntityUpdate: refreshFromLiveUpdate,
        onError: (err) => console.debug('Attendance records live socket unavailable; HTTPS polling remains active.', err?.message || err)
      });
    } catch (err) {
      console.debug('Attendance records live socket unavailable; HTTPS polling remains active.', err?.message || err);
    }

    return ()=>{
      cancelled = true;
      if (socket && typeof socket.disconnect === 'function') socket.disconnect();
    };
  }, [user, refreshCurrentRecords]);

  const handleApplyFilter = ()=>{
    activeFiltersRef.current = { date: filterDate, status: filterStatus, teacherId: filterTeacher };
    fetchRecords(filterDate, filterStatus, filterTeacher, { force: true });
  };
  const handleClearFilter = ()=>{
    activeFiltersRef.current = { date: '', status: '', teacherId: '' };
    setFilterDate('');
    setFilterStatus('');
    setFilterTeacher('');
    fetchRecords('', '', '', { force: true });
  };

  // Historical modal handlers
  const openHistoricalModal = () => {
    setHistoricalFilterSemester(activeSemesterId ? String(activeSemesterId) : '');
    setHistoricalFilterDate('');
    setHistoricalFilterStatus('');
    setHistoricalFilterTeacher('');
    setShowHistoricalModal(true);
  };
  const closeHistoricalModal = () => {
    setShowHistoricalModal(false);
    setHistoricalFilterSemester('');
    setHistoricalFilterDate('');
    setHistoricalFilterStatus('');
    setHistoricalFilterTeacher('');
  };

  // Historical filtered records - all records filtered by semester, date, status, teacher
  const historicalFilteredRecords = React.useMemo(() => {
    let list = Array.isArray(records) ? records : [];
    if (historicalFilterSemester) {
      list = list.filter(r => Number(r.semester_id) === Number(historicalFilterSemester));
    }
    if (historicalFilterDate) {
      list = list.filter(r => r.date === historicalFilterDate);
    }
    if (historicalFilterStatus) {
      list = list.filter(r => getRecordStatusKey(r) === historicalFilterStatus.toLowerCase());
    }
    if (historicalFilterTeacher) {
      list = list.filter(r => String(r.user_id) === String(historicalFilterTeacher));
    }
    return normalizeAttendanceRows(list);
  }, [records, historicalFilterSemester, historicalFilterDate, historicalFilterStatus, historicalFilterTeacher]);

  const historicalSemesterOptions = React.useMemo(() => {
    return (Array.isArray(semesters) ? semesters : []).map(s => ({ 
      id: String(s.semester_id), 
      label: `${s.session_name || s.school_year || ''} ${s.term || s.semester_name || ''}`.trim() || `Semester ${s.semester_id}` 
    }));
  }, [semesters]);

  const openViewModal = async (r)=>{
    setSelectedRecord(r);
    setRoomInfo(null);
    setShowModal(true);
    try{ if (r && r.room_id) { const room = await apiGet(`rooms/${r.room_id}`); setRoomInfo(room); } }catch(e){ console.warn('room fetch', e); }
  };
  const closeViewModal = ()=>{ setSelectedRecord(null); setRoomInfo(null); setShowModal(false); };

  const timeToMinutes = (t) => {
    if (!t) return null;
    const m = t.split(':').map(x=>parseInt(x,10));
    if (m.length >= 2 && !isNaN(m[0]) && !isNaN(m[1])) return m[0]*60 + m[1];
    return null;
  };

  const computeFlagForIn = (checkMin, sMin) => {
    if (checkMin === null || sMin === null) return 1; 
    if (checkMin === null) return 3;
    if (checkMin <= (sMin + 15)) return 2;
    return 5;
  };

  const computeFlagForMid = (checkMin, sMin, eMin) => {
    if (checkMin === null || sMin === null || eMin === null) return 1;
    const mid = Math.round((sMin + eMin) / 2);
    if (checkMin === null) return 3;
    if (Math.abs(checkMin - mid) <= 20) return 2;
    return 5;
  };

  const computeFlagForOut = (checkMin, eMin) => {
    if (checkMin === null || eMin === null) return 1;
    if (checkMin === null) return 3;
    if (checkMin >= (eMin - 15)) return 2;
    return 5;
  };

  const openEditModal = (r) => {
    setEditForm({
      attendance_id: r.attendance_id,
      user_id: r.user_id,
      schedule_id: r.schedule_id,
      date: r.date,
      flag_in_id: r.flag_in_id || 1,
      flag_check_id: r.flag_check_id || 1,
      flag_out_id: r.flag_out_id || 1,
      remarks: r.remarks || ''
    });
    setShowEditModal(true);
  };

  const handleEditSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault();
    setLoading(true); setError('');
    try{
      const id = editForm.attendance_id;

      // Only sending flags and remarks directly, no time computation during edit
      const payload = {
        flag_in_id: Number(editForm.flag_in_id),
        flag_check_id: Number(editForm.flag_check_id),
        flag_out_id: Number(editForm.flag_out_id),
      };
      
      if (typeof editForm.remarks !== 'undefined') payload.remarks = editForm.remarks;

      await apiPut(`attendance/${id}`, payload);
      await refreshCurrentRecords({ force: true });
      setShowEditModal(false);
    }catch(err){ console.error(err); setError(err?.message || 'Failed to update'); }
    finally{ setLoading(false); }
  };

  const handleAddSubmit = async (e) => {
    e && e.preventDefault && e.preventDefault();
    setLoading(true); setError('');
    try{
      if (!addForm.user_id || !addForm.schedule_id || !addForm.date) { setError('Please fill required fields'); setLoading(false); return; }
      const exists = records.some(r => Number(r.user_id) === Number(addForm.user_id) && r.date === addForm.date && Number(r.schedule_id) === Number(addForm.schedule_id));
      if (exists) { setError('Attendance for this teacher / schedule / date already exists'); setLoading(false); return; }

      const sched = schedules.find(s=> String(s.schedule_id) === String(addForm.schedule_id));
      let checked_in_at = null, checked_out_at = null;
      if (sched) {
        checked_in_at = `${addForm.date} ${sched.start_time}`;
        checked_out_at = `${addForm.date} ${sched.end_time}`;
      }

      const payload = {
        user_id: Number(addForm.user_id),
        schedule_id: Number(addForm.schedule_id),
        room_id: Number(addForm.room_id) || null,
        date: addForm.date,
        flag_in_id: sched ? computeFlagForIn(timeToMinutes(sched.start_time), timeToMinutes(sched.start_time)) : 1,
        flag_check_id: sched ? computeFlagForMid(Math.round((timeToMinutes(sched.start_time)+timeToMinutes(sched.end_time))/2), timeToMinutes(sched.start_time), timeToMinutes(sched.end_time)) : 1,
        flag_out_id: sched ? computeFlagForOut(timeToMinutes(sched.end_time), timeToMinutes(sched.end_time)) : 1,
        remarks: addForm.remarks || null
      };
      if (checked_in_at) payload.checked_in_at = checked_in_at;
      if (checked_out_at) payload.checked_out_at = checked_out_at;
      await apiPost('attendance', payload);
      await refreshCurrentRecords({ force: true });
      setShowAddModal(false);
    }catch(err){ console.error(err); setError(err?.message || 'Failed to create'); }
    finally{ setLoading(false); }
  };

  const restrictionNote = (
    <div className="text-xs text-gray-500 p-2 bg-yellow-50 border-l-4 border-yellow-200 rounded mb-3">
      Notes: You can now directly edit the flags (IN, MID, OUT) for the attendance record. 
      Please ensure you select the appropriate status manually based on the teacher's situation.
    </div>
  );

  React.useEffect(()=>{
    if (!addForm.user_id) { setSchedulesForTeacher([]); return; }
    const uid = Number(addForm.user_id);
    const list = Array.isArray(schedules) ? schedules.filter(s => Number(s.teacher_id) === uid || Number(s.user_id) === uid || Number(s.offering_user_id || 0) === uid) : [];
    
    const filtered = list.filter(s => {
      const t = teachersAll.find(x => Number(x.user_id) === Number(s.teacher_id || s.user_id));
      if (!t) return true;
      if (user && [2,3,4,6].includes(Number(user.role_id))) {
         if (resolvedDeptId && String(t.dept_id) !== String(resolvedDeptId)) return false;
      }
      return true;
    });
    setSchedulesForTeacher(filtered);
    if (filtered.length === 1) setAddForm(prev => ({ ...prev, schedule_id: filtered[0].schedule_id, room_id: filtered[0].room_id }));
  }, [addForm.user_id, addSelectedDept, schedules, teachersAll, user, resolvedDeptId]);

  const renderBadge = (flagId) => {
    const fid = flagId == null ? null : Number(flagId);
    const map = {
      1: ['UPCOMING','bg-slate-100 text-slate-700'],
      2: ['PRESENT','bg-green-100 text-green-800'],
      3: ['ABSENT','bg-red-100 text-red-800'],
      4: ['SUBSTITUTED','bg-purple-100 text-purple-800'],
      5: ['LATE','bg-yellow-100 text-yellow-800'],
      7: ['ON LEAVE','bg-sky-100 text-sky-800'],
      8: ['PENDING','bg-orange-100 text-orange-800']
    };
    const val = map[fid] || ['','bg-gray-100 text-gray-700'];
    return React.createElement('span', { className: `inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded-full ${val[1]}` }, val[0]);
  };

  const renderTimeWithFlag = (time, flag) => {
    const raw = time || '';
    let formatted = '';
    if (raw) {
      try {
        let dt = null;
        if (/^\d{4}-\d{2}-\d{2}[ T]/.test(raw)) dt = new Date(raw.replace(' ', 'T'));
        else if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) dt = new Date(`1970-01-01T${raw}`);
        else dt = new Date(raw);
        if (dt && !isNaN(dt.getTime())) formatted = dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      } catch (e) { formatted = ''; }
    }
    return React.createElement('div', { className: 'flex items-center gap-2' }, renderBadge(flag), formatted ? React.createElement('span', { className: 'text-sm text-gray-700' }, formatted) : null);
  };

  const formatTime12 = (value) => {
    if (!value) return '';
    try {
      let dt = null;
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) dt = new Date(`1970-01-01T${value}`);
      else if (/^\d{4}-\d{2}-\d{2}[ T]/.test(value)) dt = new Date(value.replace(' ', 'T'));
      else dt = new Date(value);
      if (dt && !isNaN(dt.getTime())) return dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) {}
    return value;
  };

  const formatDayLabel = (day, date) => {
    const raw = String(day || '').trim();
    if (raw) return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    if (!date) return '';
    const dt = new Date(`${date}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString('en-US', { weekday: 'long' });
  };

  // Secretary can view only. Add/Edit attendance is admin-only.
  const canEdit = user && Number(user.role_id) === 1;

  const attendanceStatusMeta = {
    present: { label: 'Present', color: 'bg-green-500', soft: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
    late: { label: 'Late', color: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    absent: { label: 'Absent', color: 'bg-red-500', soft: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
    on_leave: { label: 'On Leave', color: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200' },
    substituted: { label: 'Substituted', color: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200' },
    pending: { label: 'Pending', color: 'bg-orange-500', soft: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    upcoming: { label: 'Upcoming', color: 'bg-slate-400', soft: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-200' }
  };
  const statusOrder = ['present', 'late', 'absent', 'on_leave', 'substituted', 'pending', 'upcoming'];
  const checkpointFields = [
    { key: 'in', label: 'Check In', field: 'flag_in_id' },
    { key: 'mid', label: 'Middle Check', field: 'flag_check_id' },
    { key: 'out', label: 'Check Out', field: 'flag_out_id' }
  ];

  // Filter main table to only show active semester records
  const displayRecords = React.useMemo(() => {
    if (!Array.isArray(records)) return [];
    if (!activeSemesterId) return records;
    return records.filter(r => Number(r.semester_id) === Number(activeSemesterId));
  }, [records, activeSemesterId]);

  const getFlagGroup = (flagId) => {
    const fid = Number(flagId || 1);
    if (fid === 2) return 'present';
    if (fid === 5) return 'late';
    if (fid === 3) return 'absent';
    if (fid === 7) return 'on_leave';
    if (fid === 4) return 'substituted';
    if (fid === 8) return 'pending';
    return 'upcoming';
  };

  const getRecordStatusKey = (record) => {
    const flags = [record?.flag_in_id, record?.flag_check_id, record?.flag_out_id].map((flag) => Number(flag || 1));
    if (flags.includes(3)) return 'absent';
    if (flags.includes(7)) return 'on_leave';
    if (flags.includes(4)) return 'substituted';
    if (flags.includes(5)) return 'late';
    if (flags.every((flag) => flag === 2)) return 'present';
    if (flags.includes(8)) return 'pending';
    return 'upcoming';
  };

  const attendanceStats = React.useMemo(() => {
    const rows = Array.isArray(displayRecords) ? displayRecords : [];
    const counts = statusOrder.reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
    const teachers = new Set();
    let completedCheckpoints = 0;
    let totalCheckpoints = 0;

    const checkpointRows = checkpointFields.map((cp) => ({
      ...cp,
      counts: statusOrder.reduce((acc, key) => ({ ...acc, [key]: 0 }), {}),
      total: 0
    }));

    rows.forEach((record) => {
      const statusKey = getRecordStatusKey(record);
      counts[statusKey] = (counts[statusKey] || 0) + 1;

      const teacherKey = record?.user_id || `${record?.first_name || ''}-${record?.last_name || ''}`;
      if (String(teacherKey || '').trim()) teachers.add(String(teacherKey));

      checkpointRows.forEach((cp) => {
        const group = getFlagGroup(record?.[cp.field]);
        cp.counts[group] = (cp.counts[group] || 0) + 1;
        cp.total += 1;
        totalCheckpoints += 1;
        if (group !== 'upcoming' && group !== 'pending') completedCheckpoints += 1;
      });
    });

    const totalRecords = rows.length;
    const statusRows = statusOrder.map((key) => ({
      key,
      count: counts[key] || 0,
      percent: totalRecords ? Math.round(((counts[key] || 0) / totalRecords) * 100) : 0
    }));
    const topStatus = statusRows.reduce((best, item) => item.count > best.count ? item : best, statusRows[0] || { key: 'upcoming', count: 0 });
    const completionRate = totalCheckpoints ? Math.round((completedCheckpoints / totalCheckpoints) * 100) : 0;

    return {
      totalRecords,
      teacherCount: teachers.size,
      completionRate,
      topStatus,
      statusRows,
      checkpointRows
    };
  }, [displayRecords]);

  const topStatusMeta = attendanceStatusMeta[attendanceStats.topStatus?.key] || attendanceStatusMeta.upcoming;
  const attendanceMetricCards = [
    { label: 'Total Records', value: attendanceStats.totalRecords, helper: 'Filtered rows', meta: attendanceStatusMeta.present },
    { label: 'Teachers', value: attendanceStats.teacherCount, helper: 'With records shown', meta: attendanceStatusMeta.upcoming },
    { label: 'Checkpoint Completion', value: `${attendanceStats.completionRate}%`, helper: 'In, middle, out', meta: attendanceStatusMeta.on_leave },
    { label: 'Top Status', value: topStatusMeta.label, helper: `${attendanceStats.topStatus?.count || 0} record(s)`, meta: topStatusMeta }
  ];

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'day', label: 'Day', render: (r)=> formatDayLabel(r.day_of_week, r.date) },
    { key: 'teacher', label: 'Teacher', render: (r)=> `${r.last_name || ''}, ${r.first_name || ''}` },
    { key: 'subject', label: 'Subject / Section', render: (r)=> `${r.subject_code || ''} - ${r.section_name || ''}` },
    { key: 'building', label: 'Building', render: (r)=> r.building_name || r.room_building_name || '-' },
    { key: 'room', label: 'Room', render: (r)=> r.room_name || '-' },
    { key: 'class_time', label: 'Class Time', render: (r)=> `${formatTime12(r.start_time)||''} - ${formatTime12(r.end_time)||''}` },
    { key: 'time_in', label: 'Checked In', render: (r)=> renderTimeWithFlag(r.time_in, r.flag_in_id) },
    { key: 'time_check', label: 'Checked Mid', render: (r)=> renderTimeWithFlag(r.time_check, r.flag_check_id) },
    { key: 'time_out', label: 'Checked Out', render: (r)=> renderTimeWithFlag(r.time_out, r.flag_out_id) },
    { key: 'actions', label: 'Action', actions: (r) => [
      { label: 'View', onClick: (row) => openViewModal(row) },
      ...(canEdit ? [{ label: 'Edit', onClick: (row) => openEditModal(row) }] : [])
    ] }
  ];

  return (
    <div className="p-6 class-schedule-page class-schedule-dashboard">
      <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1.6fr_1fr] lg:p-7">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Teacher Attendance Records</h2>
            <div className="mt-3">
              <div className={`inline-flex rounded-xl border px-3 py-2 text-xs font-medium ${
                activeSemesterId ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}>
                {activeSemesterId
                  ? `Active semester: ${activeSemesterLabel || 'Current term'}`
                  : 'No active semester found for today.'}
              </div>
            </div>
            {error && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div>}

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {attendanceMetricCards.map((card) => (
                <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</div>
                  <div className="mt-1 text-xs text-slate-500">{card.helper}</div>
                </div>
              ))}
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checkpoint Flow</div>
                  <div className="mt-1 text-xs text-slate-500">Check-in, middle, and check-out progress</div>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">{attendanceStats.completionRate}% complete</span>
              </div>
              <div className="mt-4 space-y-4">
                {attendanceStats.checkpointRows.map((cp) => {
                  const waitingCount = (cp.counts.upcoming || 0) + (cp.counts.pending || 0);
                  const done = Math.max(0, cp.total - waitingCount);
                  return (
                    <div key={cp.key}>
                      <div className="mb-1 grid grid-cols-[96px_1fr_auto] items-center gap-3 text-xs">
                        <span className="font-semibold text-slate-600">{cp.label}</span>
                        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                          {statusOrder.map((key) => {
                            const count = cp.counts[key] || 0;
                            if (!count || !cp.total) return null;
                            const meta = attendanceStatusMeta[key] || attendanceStatusMeta.upcoming;
                            return (
                              <div
                                key={`${cp.key}-${key}`}
                                className={`${meta.color} h-full`}
                                style={{ width: `${(count / cp.total) * 100}%` }}
                                title={`${meta.label}: ${count}`}
                              ></div>
                            );
                          })}
                          {!cp.total && <div className="h-full w-full bg-slate-100"></div>}
                        </div>
                        <span className="font-medium text-slate-500">{done}/{cp.total || 0}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Status Distribution</div>
            <div className="mt-4 space-y-3">
              {attendanceStats.statusRows.map((row) => {
                const meta = attendanceStatusMeta[row.key] || attendanceStatusMeta.upcoming;
                return (
                  <div key={row.key} className="grid grid-cols-[88px_1fr_auto] items-center gap-3">
                    <span className="text-xs font-semibold text-slate-600">{meta.label}</span>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${meta.color}`} style={{ width: `${row.percent}%` }}></div>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{row.count}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
              {attendanceStats.totalRecords} total record(s) in view
            </div>
          </div>
        </div>
      </div>

      {restrictionNote}

      <div className="flex flex-wrap gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} className="border border-gray-200 rounded px-3 py-2" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} className="border border-gray-200 rounded px-3 py-2">
            <option value="">All</option>
            <option value="upcoming">upcoming</option>
            <option value="pending">pending</option>
            <option value="present">present</option>
            <option value="absent">absent</option>
            <option value="substituted">substituted</option>
            <option value="late">late</option>
            <option value="on leave">on leave</option>
          </select>
        </div>

        {user && Number(user.role_id) === 1 && (
          <div className="min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">Department</label>
            <select value={selectedDeptFilter} onChange={e=>setSelectedDeptFilter(e.target.value)} className="border border-gray-200 rounded px-3 py-2 w-full">
              <option value="">All</option>
              {departments.map(d=> <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
            </select>
          </div>
        )}

        <div className="min-w-[220px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Teacher</label>
          <SearchableSelect 
            options={teacherFilterOptions}
            value={filterTeacher}
            onChange={(val) => setFilterTeacher(val)}
            placeholder="Search Teacher..."
          />
        </div>

        <div className="flex items-end gap-2">
          <button onClick={handleApplyFilter} className="px-3 py-2 bg-green-600 text-white rounded">Apply</button>
          <button onClick={handleClearFilter} className="px-3 py-2 border rounded">Clear</button>
          <button onClick={openHistoricalModal} className="px-3 py-2 border rounded bg-white text-slate-700 hover:bg-slate-100">View Historical Attendance</button>
        </div>
      </div>

      <Table columns={columns} data={displayRecords} pageSize={10} loading={loading} emptyText={'No attendance records found for the active semester'} rowKey={(r,i)=> r.attendance_id || r.key || i} />

      <Modal show={showModal} title={'Attendance Details'} onClose={closeViewModal} size="lg">
        {selectedRecord ? (
          <div className="space-y-6">
            <div className="bg-gradient-to-r from-white to-gray-50 p-6 rounded-2xl border shadow-sm transform transition-all duration-300">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-gray-500">Teacher</div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">{`${selectedRecord.last_name || ''}, ${selectedRecord.first_name || ''}`}</div>
                  <div className="mt-2 text-sm text-gray-600">{`${selectedRecord.subject_code || ''} — ${selectedRecord.subject_name || ''}`}</div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-gray-500">Date</div>
                  <div className="mt-1 text-sm font-medium text-gray-800">{selectedRecord.date}</div>
                  <div className="mt-3 text-xs text-gray-500">Class Time</div>
                  <div className="text-sm font-medium text-gray-700">{`${formatTime12(selectedRecord.start_time) || ''} — ${formatTime12(selectedRecord.end_time) || ''}`}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-3">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v4a1 1 0 001 1h3m10-6h3a1 1 0 011 1v4m-6 4v6m-4-6v6"></path></svg>
                  <span>{roomInfo?.building_name || selectedRecord.building_name || selectedRecord.room_building_name || 'N/A'}</span>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a1 1 0 001-1V7a1 1 0 00-1-1H5a1 1 0 00-1 1v13a1 1 0 001 1z"></path></svg>
                  <span>{roomInfo?.room_name || selectedRecord.room_name || 'N/A'}</span>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm">
                  <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3-1.343-3-3S10.343 2 12 2s3 1.343 3 3-1.343 3-3 3zM6 20c0-3.314 2.686-6 6-6s6 2.686 6 6"></path></svg>
                  <span>{roomInfo?.floor_name || selectedRecord.attendance_floor_name || selectedRecord.floor_name || 'N/A'}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="p-4 bg-white border rounded-xl shadow-sm transform transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Checked In</div>
                    <div className="mt-2 flex items-center gap-3">
                      {renderTimeWithFlag(selectedRecord.time_in, selectedRecord.flag_in_id)}
                    </div>
                  </div>
                  {(selectedRecord.checked_in_at || selectedRecord.time_in) ? <div className="text-xs text-gray-400">{selectedRecord.checked_in_at || selectedRecord.time_in}</div> : null}
                </div>
                <div className="mt-3 text-xs text-gray-600">Location</div>
                <div className="mt-1 font-mono text-sm bg-gray-50 p-3 rounded text-gray-800">{`${selectedRecord.latitude_in || 'N/A'}, ${selectedRecord.longitude_in || 'N/A'}${selectedRecord.altitude_in ? ` • alt ${selectedRecord.altitude_in}m` : ''}`}</div>
              </div>

              <div className="p-4 bg-white border rounded-xl shadow-sm transform transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Checked Mid</div>
                    <div className="mt-2 flex items-center gap-3">
                      {renderTimeWithFlag(selectedRecord.time_check, selectedRecord.flag_check_id)}
                    </div>
                  </div>
                  {(selectedRecord.checked_mid_at || selectedRecord.time_check) ? <div className="text-xs text-gray-400">{selectedRecord.checked_mid_at || selectedRecord.time_check}</div> : null}
                </div>
                <div className="mt-3 text-xs text-gray-600">Location</div>
                <div className="mt-1 font-mono text-sm bg-gray-50 p-3 rounded text-gray-800">{`${selectedRecord.latitude_check || 'N/A'}, ${selectedRecord.longitude_check || 'N/A'}${selectedRecord.altitude_check ? ` • alt ${selectedRecord.altitude_check}m` : ''}`}</div>
              </div>

              <div className="p-4 bg-white border rounded-xl shadow-sm transform transition-transform duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transform-none">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs text-gray-500">Checked Out</div>
                    <div className="mt-2 flex items-center gap-3">
                      {renderTimeWithFlag(selectedRecord.time_out, selectedRecord.flag_out_id)}
                    </div>
                  </div>
                  {(selectedRecord.checked_out_at || selectedRecord.time_out) ? <div className="text-xs text-gray-400">{selectedRecord.checked_out_at || selectedRecord.time_out}</div> : null}
                </div>
                <div className="mt-3 text-xs text-gray-600">Location</div>
                <div className="mt-1 font-mono text-sm bg-gray-50 p-3 rounded text-gray-800">{`${selectedRecord.latitude_out || 'N/A'}, ${selectedRecord.longitude_out || 'N/A'}${selectedRecord.altitude_out ? ` • alt ${selectedRecord.altitude_out}m` : ''}`}</div>
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={closeViewModal} className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50">Close</button>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Add Modal */}
      <Modal show={showAddModal} title={'Add New Attendance'} onClose={()=>setShowAddModal(false)} size="md">
        <form onSubmit={handleAddSubmit}>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <input type="date" max={new Date().toISOString().slice(0,10)} value={addForm.date} onChange={e=> setAddForm(prev=> ({...prev, date: e.target.value}))} className="border rounded px-3 py-2 w-full" required />
          </div>

          {user && Number(user.role_id) === 1 ? (
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">Department</label>
              <select value={addSelectedDept} onChange={e=>{ setAddSelectedDept(e.target.value); setAddForm(prev=> ({...prev, user_id: ''})); }} className="border rounded px-3 py-2 w-full">
                <option value="">All</option>
                {departments.map(d=> <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
              </select>
            </div>
          ) : null}

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Teacher (Type to Search)</label>
            <SearchableSelect 
              options={addTeacherOptions}
              value={addForm.user_id}
              onChange={(val) => setAddForm(prev=> ({...prev, user_id: val}))}
              placeholder="Select Teacher..."
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Schedule</label>
            <select value={addForm.schedule_id} onChange={e=>{
              const sid = e.target.value; const sched = schedulesForTeacher.find(s=> String(s.schedule_id) === String(sid));
              setAddForm(prev=> ({...prev, schedule_id: sid, room_id: sched ? sched.room_id : prev.room_id}));
            }} className="border rounded px-3 py-2 w-full" required>
              <option value="">Select schedule</option>
              {schedulesForTeacher.map(s=> <option key={s.schedule_id} value={s.schedule_id}>{`${s.subject_code || ''} ${s.day_of_week || ''} ${s.start_time || ''} - ${s.end_time || ''} (room ${s.room_id})`}</option>)}
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Actual Room</label>
            <select value={addForm.room_id || ''} onChange={e=> setAddForm(prev=> ({...prev, room_id: e.target.value}))} className="border rounded px-3 py-2 w-full">
              <option value="">Select room</option>
              {rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.room_name || `Room ${r.room_id}`}</option>)}
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Remarks</label>
            <textarea value={addForm.remarks} onChange={e=> setAddForm(prev=> ({...prev, remarks: e.target.value}))} className="border rounded px-3 py-2 w-full" rows="3"></textarea>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={()=>setShowAddModal(false)} className="px-3 py-2 border rounded">Cancel</button>
            <button type="submit" className="px-3 py-2 bg-green-600 text-white rounded">Create</button>
          </div>
        </form>
      </Modal>

      {/* Historical Attendance Modal */}
      <Modal show={showHistoricalModal} title="Historical Attendance Records" onClose={()=>setShowHistoricalModal(false)} size="xxl">
        <div className="space-y-4">
          <div className={`rounded-xl border p-4 ${activeSemesterId ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1">Semester Context</div>
            <div className="text-sm font-semibold">
              {activeSemesterId
                ? `Currently active: ${activeSemesterLabel}`
                : 'No active semester set for today.'}
            </div>
            <div className="text-xs mt-1">Select a semester below to browse historical attendance records from past academic terms.</div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-3">Filter Historical Attendance</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Semester</label>
                <select value={historicalFilterSemester} onChange={e => setHistoricalFilterSemester(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                  <option value="">All Semesters</option>
                  {historicalSemesterOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
                <input type="date" value={historicalFilterDate} onChange={e => setHistoricalFilterDate(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select value={historicalFilterStatus} onChange={e => setHistoricalFilterStatus(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                  <option value="">All Statuses</option>
                  <option value="present">Present</option>
                  <option value="late">Late</option>
                  <option value="absent">Absent</option>
                  <option value="on_leave">On Leave</option>
                  <option value="substituted">Substituted</option>
                  <option value="pending">Pending</option>
                  <option value="upcoming">Upcoming</option>
                </select>
              </div>
              <div className="min-w-[200px]">
                <label className="block text-xs font-medium text-gray-700 mb-1">Teacher</label>
                <SearchableSelect 
                  options={teacherFilterOptions}
                  value={historicalFilterTeacher}
                  onChange={(val) => setHistoricalFilterTeacher(val)}
                  placeholder="Search Teacher..."
                  className="w-full"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => {
                    setHistoricalFilterSemester(activeSemesterId ? String(activeSemesterId) : '');
                    setHistoricalFilterDate('');
                    setHistoricalFilterStatus('');
                    setHistoricalFilterTeacher('');
                  }}
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
                >
                  Reset Filters
                </button>
              </div>
            </div>
          </div>

          {/* Historical Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {(() => {
              const hRows = historicalFilteredRecords;
              const hTeachers = new Set();
              let hCompleted = 0;
              let hTotal = 0;
              hRows.forEach(r => {
                const tKey = r?.user_id || `${r?.first_name || ''}-${r?.last_name || ''}`;
                if (String(tKey || '').trim()) hTeachers.add(String(tKey));
              });
              checkpointFields.forEach(cp => {
                hRows.forEach(r => {
                  hTotal += 1;
                  const g = getFlagGroup(r?.[cp.field]);
                  if (g !== 'upcoming' && g !== 'pending') hCompleted += 1;
                });
              });
              const hPresent = hRows.filter(r => getRecordStatusKey(r) === 'present').length;
              const hAbsent = hRows.filter(r => getRecordStatusKey(r) === 'absent').length;
              const hLate = hRows.filter(r => getRecordStatusKey(r) === 'late').length;
              const compRate = hTotal ? Math.round((hCompleted / hTotal) * 100) : 0;
              return [
                { label: 'Total Records', value: hRows.length, helper: 'Filtered rows' },
                { label: 'Teachers', value: hTeachers.size, helper: 'With records' },
                { label: 'Present', value: hPresent, helper: `${hLate} late` },
                { label: 'Absent', value: hAbsent, helper: `${compRate}% checkpoint completion` },
              ].map((card, idx) => (
                <div key={idx} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.label}</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{card.value}</div>
                  <div className="mt-1 text-xs text-slate-500">{card.helper}</div>
                </div>
              ));
            })()}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-gray-800">Historical Attendance Records</div>
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                {historicalFilteredRecords.length} record(s)
              </div>
            </div>
            <div className="p-3 sm:p-4">
              {historicalFilteredRecords.length === 0 ? (
                <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl">
                  <div className="text-slate-400 mb-2 text-lg font-medium">📋 No historical attendance records found</div>
                  <p className="text-sm text-slate-500 max-w-md mx-auto">
                    No attendance records match the selected filter criteria. Try adjusting your filters or selecting a different semester.
                  </p>
                </div>
              ) : (
                <Table
                  columns={[
                    { key: 'date', label: 'Date' },
                    { key: 'day', label: 'Day', render: (r)=> formatDayLabel(r.day_of_week, r.date) },
                    { key: 'teacher', label: 'Teacher', render: (r)=> `${r.last_name || ''}, ${r.first_name || ''}` },
                    { key: 'subject', label: 'Subject / Section', render: (r)=> `${r.subject_code || ''} - ${r.section_name || ''}` },
                    { key: 'building', label: 'Building', render: (r) => <span className="text-xs">{r.building_name || r.room_building_name || 'N/A'}</span> },
                    { key: 'room', label: 'Room', render: (r) => <span className="text-xs">{r.room_name || 'N/A'}</span> },
                    { key: 'class_time', label: 'Class Time', render: (r)=> `${formatTime12(r.start_time)||''} - ${formatTime12(r.end_time)||''}` },
                    {
                      key: 'semester_label',
                      label: 'Semester',
                      render: (r) => {
                        const sem = semesters.find(sem => Number(sem.semester_id) === Number(r.semester_id));
                        return <span className="text-xs">{sem ? `${sem.session_name || sem.school_year || ''} ${sem.term || sem.semester_name || ''}`.trim() || `Semester ${sem.semester_id}` : '-'}</span>;
                      }
                    },
                    { key: 'time_in', label: 'Checked In', render: (r)=> renderTimeWithFlag(r.time_in, r.flag_in_id) },
                    { key: 'time_check', label: 'Checked Mid', render: (r)=> renderTimeWithFlag(r.time_check, r.flag_check_id) },
                    { key: 'time_out', label: 'Checked Out', render: (r)=> renderTimeWithFlag(r.time_out, r.flag_out_id) },
                    { key: 'actions', label: 'Action', actions: (r) => [{ label: 'View', onClick: (row) => openViewModal(row) }] }
                  ]}
                  data={historicalFilteredRecords}
                  pageSize={10}
                  loading={false}
                  horizontalScroll={true}
                  wrapCells
                  className="class-schedule-table responsive-table"
                />
              )}
            </div>
          </div>

          <div className="flex justify-end items-center gap-2 border-t border-gray-200 pt-4">
            <button type="button" onClick={()=>setShowHistoricalModal(false)} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 text-sm">Close</button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal (UPDATED) */}
      <Modal show={showEditModal} title={'Edit Attendance Flags'} onClose={()=>setShowEditModal(false)} size="md">
        <form onSubmit={handleEditSubmit}>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">IN Flag</label>
            <select value={editForm.flag_in_id} onChange={e=> setEditForm(prev=> ({...prev, flag_in_id: e.target.value}))} className="border rounded px-3 py-2 w-full">
              <option value="1">Upcoming</option>
              <option value="2">Present</option>
              <option value="3">Absent</option>
              <option value="4">Substituted</option>
              <option value="5">Late</option>
              <option value="7">On Leave</option>
              <option value="8">Pending</option>
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">MID Check Flag</label>
            <select value={editForm.flag_check_id} onChange={e=> setEditForm(prev=> ({...prev, flag_check_id: e.target.value}))} className="border rounded px-3 py-2 w-full">
              <option value="1">Upcoming</option>
              <option value="2">Present</option>
              <option value="3">Absent</option>
              <option value="4">Substituted</option>
              <option value="5">Late</option>
              <option value="7">On Leave</option>
              <option value="8">Pending</option>
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">OUT Flag</label>
            <select value={editForm.flag_out_id} onChange={e=> setEditForm(prev=> ({...prev, flag_out_id: e.target.value}))} className="border rounded px-3 py-2 w-full">
              <option value="1">Upcoming</option>
              <option value="2">Present</option>
              <option value="3">Absent</option>
              <option value="4">Substituted</option>
              <option value="5">Late</option>
              <option value="7">On Leave</option>
              <option value="8">Pending</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">Remarks</label>
            <textarea value={editForm.remarks} onChange={e=> setEditForm(prev=> ({...prev, remarks: e.target.value}))} className="border rounded px-3 py-2 w-full" rows="3"></textarea>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={()=>setShowEditModal(false)} className="px-4 py-2 border rounded text-gray-700">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700">
              {loading ? 'Saving...' : 'Save Flags'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

try{ if (typeof window !== 'undefined') window.AttedanceManagement = AttedanceManagement; }catch(e){}

export default AttedanceManagement;
