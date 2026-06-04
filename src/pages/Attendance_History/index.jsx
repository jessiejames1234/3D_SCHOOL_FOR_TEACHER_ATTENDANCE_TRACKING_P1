import React from 'react';
import Modal from '../../components/Modal.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AuthContext } from '../../context/AuthContext.jsx';

const getUserIdValue = (userLike) => {
  const id = userLike?.user_id ?? userLike?.id ?? userLike?.userId ?? 0;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch (e) {
    return null;
  }
};

const toDateKeyFromDate = (dateObj) => {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const normalizeDateKey = (value) => {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return toDateKeyFromDate(value);
  const raw = String(value).trim();
  const direct = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const parsed = new Date(raw.replace(' ', 'T'));
  return toDateKeyFromDate(parsed);
};

const getPayloadList = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.items)) return payload.items;
  return null;
};

const getAttendanceDateKey = (record) => normalizeDateKey(
  record?.date || record?.attendance_date || record?.checked_in_at || record?.time_in
);

const normalizeAttendanceRecord = (record) => {
  const date = getAttendanceDateKey(record);
  return {
    ...record,
    date,
    user_id: getUserIdValue(record),
    time_in: record?.time_in ?? record?.checked_in_at ?? null,
    time_check: record?.time_check ?? record?.checked_mid_at ?? null,
    time_out: record?.time_out ?? record?.checked_out_at ?? null,
    subject_code: record?.subject_code || record?.subject || record?.subject_name || 'Class',
    subject_name: record?.subject_name || record?.subject_code || 'Scheduled class'
  };
};

const dateMatches = (value, dateKey) => normalizeDateKey(value) === dateKey;

export default function AttendanceHistory() {
  const { user } = React.useContext(AuthContext);
  const storedUser = React.useMemo(() => getStoredUser(), [user]);
  const effectiveUser = React.useMemo(() => (
    getUserIdValue(user) ? user : storedUser
  ), [user, storedUser]);
  const myUserId = getUserIdValue(effectiveUser);
  const effectiveRoleId = Number(effectiveUser?.role_id || 0);
  const canRequestEdit = [2, 3, 4, 5].includes(Number(effectiveUser?.role_id));
  const [records, setRecords] = React.useState([]);
  const [penalties, setPenalties] = React.useState([]);
  const [substitutions, setSubstitutions] = React.useState([]);
  const [leaves, setLeaves] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  
  // Calendar State
  const [currentDate, setCurrentDate] = React.useState(new Date()); 
  const [selectedDayRecords, setSelectedDayRecords] = React.useState(null); 
  const [showModal, setShowModal] = React.useState(false);
  const [showAttendanceEditModal, setShowAttendanceEditModal] = React.useState(false);
  const [selectedAttendanceForEdit, setSelectedAttendanceForEdit] = React.useState(null);
  const [attendanceEditReason, setAttendanceEditReason] = React.useState('');
  const [attendanceEditSubmitting, setAttendanceEditSubmitting] = React.useState(false);
  const [attendanceEditError, setAttendanceEditError] = React.useState('');
  const [pendingAttendanceEditIds, setPendingAttendanceEditIds] = React.useState([]);
  const autoFocusedMonthRef = React.useRef(false);
  
  // Live Clock State
  const [currentTime, setCurrentTime] = React.useState(new Date());

  // UPDATED MAP BASED ON YOUR DATABASE
  const flagMap = {
    1: 'NA',
    2: 'Present',
    3: 'Absent',
    4: 'Substituted',
    5: 'Late',
    7: 'On Leave'
  };

  // Normalize flag value based on actual DB IDs
  const getFlagId = (v) => {
    if (v === undefined || v === null || v === '') return 1; // default NA
    const n = Number(v);
    if (!isNaN(n) && [1, 2, 3, 4, 5, 7].includes(n)) return n;
    const s = String(v).toLowerCase().trim();
    if (s === 'na' || s === 'n/a' || s === '1') return 1;
    if (s === 'present' || s === '2') return 2;
    if (s === 'absent' || s === '3') return 3;
    if (s === 'substituted' || s === '4') return 4;
    if (s === 'late' || s === '5') return 5;
    if (s === 'on leave' || s === '7') return 7;
    return 1; // default to NA
  };

  // --- NEW STRICT OVERALL STATUS LOGIC ---
  const getOverallStatus = (r) => {
    const fIn = getFlagId(r.flag_in_id);
    const fMid = getFlagId(r.flag_check_id);
    const fOut = getFlagId(r.flag_out_id);
    const flags = [fIn, fMid, fOut];

    // 1. If there is ANY ABSENT → Overall = ABSENT (ID 3)
    if (flags.includes(3)) return 3;

    // 2. Else if there is ANY LATE → Overall = LATE (ID 5)
    if (flags.includes(5)) return 5;

    // 3. If ALL PRESENT (ID 2)
    if (flags.every(f => f === 2)) return 2;

    // 4. If ALL NA (ID 1)
    if (flags.every(f => f === 1)) return 1;

    // 5. If ALL SUBSTITUTE (ID 4)
    if (flags.every(f => f === 4)) return 4;

    // 6. If ALL ON LEAVE (ID 7)
    if (flags.every(f => f === 7)) return 7;

    return 1; 
  };

  // 1. Fetch all data simultaneously (added 'silent' parameter for auto-refresh)
  const fetchRecords = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (myUserId) params.set('teacher_id', myUserId);

      const readOptionalList = async (path, label, shouldFetch = true) => {
        if (!shouldFetch) return [];
        try {
          const payload = await apiGet(path);
          return getPayloadList(payload) || [];
        } catch (err) {
          if (err?.status !== 403) {
            console.warn(`Could not fetch ${label}:`, err);
          }
          return [];
        }
      };

      const attData = await apiGet(`attendance${params.toString() ? '?' + params.toString() : ''}`);
      const attRows = getPayloadList(attData);
      if (attRows) setRecords(attRows.map(normalizeAttendanceRecord).filter((r) => r.date));
      else if (!silent) setRecords([]);

      const canFetchSubstitutions = [2, 4].includes(effectiveRoleId);
      const canFetchLeaves = [1, 2, 3, 4].includes(effectiveRoleId);
      const [penRows, subRows, leaveRows] = await Promise.all([
        readOptionalList('penalties', 'penalties'),
        readOptionalList('substitute', 'substitutions', canFetchSubstitutions),
        readOptionalList('leaves', 'leaves', canFetchLeaves)
      ]);

      setPenalties(penRows);
      setSubstitutions(subRows);
      setLeaves(leaveRows);
    } catch (e) {
      console.error("Error fetching attendance history:", e);
    }
    if (!silent) setLoading(false);
  };

  const fetchPendingAttendanceRequests = React.useCallback(async () => {
    if (!canRequestEdit) {
      setPendingAttendanceEditIds([]);
      return;
    }
    try {
      const data = await apiGet('request-edit/attendance?scope=my&status=pending');
      const ids = Array.isArray(data)
        ? data
          .map((row) => Number(row?.attendance_id))
          .filter((id) => Number.isFinite(id) && id > 0)
        : [];
      setPendingAttendanceEditIds(ids);
    } catch (e) {
      console.error('Failed to fetch pending attendance edit requests:', e);
    }
  }, [canRequestEdit]);

  // FETCH ON LOAD & SET 5 SECOND REFRESH INTERVAL
  React.useEffect(() => { 
    fetchRecords(false); // Initial load with spinner
    
    // Auto refresh every 5 seconds silently
    const intervalId = setInterval(() => {
        fetchRecords(true);
    }, 5000);

    return () => clearInterval(intervalId); // Cleanup on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myUserId, effectiveRoleId]);

  React.useEffect(() => {
    fetchPendingAttendanceRequests();
  }, [fetchPendingAttendanceRequests]);

  React.useEffect(() => {
    if (autoFocusedMonthRef.current || records.length === 0) return;
    autoFocusedMonthRef.current = true;

    const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    const recordDateKeys = records.map(getAttendanceDateKey).filter(Boolean).sort();
    if (recordDateKeys.some((dateKey) => dateKey.startsWith(currentMonthKey))) return;

    const latestKey = recordDateKeys[recordDateKeys.length - 1];
    if (!latestKey) return;
    const [year, month] = latestKey.split('-').map(Number);
    if (year && month) setCurrentDate(new Date(year, month - 1, 1));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  // LIVE CLOCK INTERVAL
  React.useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // --- DATE & DATA HELPERS ---
  const toYMD = (dateObj) => {
      return toDateKeyFromDate(dateObj);
  };

  const isSameMonthKey = (dateKey, d2) => {
      if (!dateKey) return false;
      return dateKey.substring(0, 7) === `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, '0')}`;
  };

  const isDateInLeaveRange = (targetDateStr, leaveFromStr, leaveToStr) => {
      if (!leaveFromStr || !leaveToStr) return false;
      const fromDateOnly = normalizeDateKey(leaveFromStr);
      const toDateOnly = normalizeDateKey(leaveToStr);
      if (!fromDateOnly || !toDateOnly) return false;
      return targetDateStr >= fromDateOnly && targetDateStr <= toDateOnly;
  };

  const myPenalties = penalties.filter(p => Number(p.user_id) === myUserId);
  const mySubs = substitutions.filter(s => Number(s.teacher_id) === myUserId || Number(s.substitute_id) === myUserId);
  const myLeaves = leaves.filter(l => {
      const isMine = Number(l.teacher_id) === myUserId;
      const status = String(l.req_status || '').toLowerCase();
      return isMine && (status === 'approved' || status === 'approve');
  });

  const currentMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
  
  const visibleRecords = records.filter(r => isSameMonthKey(getAttendanceDateKey(r), currentDate));
  const visiblePenalties = myPenalties.filter(p => normalizeDateKey(p.date).startsWith(currentMonthStr));
  const visibleSubs = mySubs.filter(s => normalizeDateKey(s.date).startsWith(currentMonthStr));
  
  const visibleLeaves = myLeaves.filter(l => {
      const startMonth = normalizeDateKey(l.date_from).substring(0, 7);
      const endMonth = normalizeDateKey(l.date_to).substring(0, 7);
      return startMonth === currentMonthStr || endMonth === currentMonthStr;
  });

  const totalClasses = visibleRecords.length;
  const presentCount = visibleRecords.filter(r => getOverallStatus(r) === 2).length;
  const lateCount = visibleRecords.filter(r => getOverallStatus(r) === 5).length;
  const absentCount = visibleRecords.filter(r => getOverallStatus(r) === 3).length;
  
  const substitutionsCount = visibleSubs.length;
  const penaltiesCount = visiblePenalties.length;
  const leavesCount = visibleLeaves.length; 

  const attendRate = totalClasses > 0 ? Math.round(((presentCount + lateCount) / totalClasses) * 100) : 0;
  
  const getBarHeight = (count) => {
    if (totalClasses === 0) return '10%';
    const pct = (count / totalClasses) * 100;
    return Math.max(15, pct) + '%';
  };

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();
  const changeMonth = (offset) => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1));
  const jumpToToday = () => setCurrentDate(new Date());

  const handleDayClick = (day) => {
    const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    const dStr = toYMD(clickedDate);
    
    const dayRecords = records.filter(r => getAttendanceDateKey(r) === dStr);
    const dayPenalties = myPenalties.filter(p => dateMatches(p.date, dStr));
    const daySubs = mySubs.filter(s => dateMatches(s.date, dStr));
    const dayLeaves = myLeaves.filter(l => isDateInLeaveRange(dStr, l.date_from, l.date_to));
    
    if (dayRecords.length > 0 || dayPenalties.length > 0 || daySubs.length > 0 || dayLeaves.length > 0) {
      dayRecords.sort((a, b) => (a.time_in || '').localeCompare(b.time_in || ''));
      setSelectedDayRecords({ 
          date: clickedDate, 
          items: dayRecords,
          penalties: dayPenalties,
          subs: daySubs,
          leaves: dayLeaves
      });
      setShowModal(true);
    }
  };

  const openAttendanceEditRequest = (record) => {
    setSelectedAttendanceForEdit(record);
    setAttendanceEditReason('');
    setAttendanceEditError('');
    setShowAttendanceEditModal(true);
  };

  const closeAttendanceEditRequest = () => {
    setShowAttendanceEditModal(false);
    setSelectedAttendanceForEdit(null);
    setAttendanceEditReason('');
    setAttendanceEditError('');
  };

  const notifyAttendanceEditRequestSuccess = async () => {
    if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
      await window.Swal.fire({
        icon: 'success',
        title: 'Attendance edit request submitted',
        timer: 1400,
        showConfirmButton: false
      });
    }
  };

  const submitAttendanceEditRequest = async () => {
    if (!selectedAttendanceForEdit?.attendance_id) return;
    const attendanceId = Number(selectedAttendanceForEdit.attendance_id);
    if (pendingAttendanceEditIds.includes(attendanceId)) {
      setAttendanceEditError('A pending request for this attendance record already exists.');
      return;
    }
    const reason = attendanceEditReason.trim();
    if (!reason) {
      setAttendanceEditError('Reason is required.');
      return;
    }
    setAttendanceEditError('');
    setAttendanceEditSubmitting(true);
    try {
      await apiPost('request-edit/attendance', {
        attendance_id: attendanceId,
        reason
      });
      setPendingAttendanceEditIds((prev) => (prev.includes(attendanceId) ? prev : [...prev, attendanceId]));
      closeAttendanceEditRequest();
      await notifyAttendanceEditRequestSuccess();
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || 'Failed to submit request';
      if (String(e?.body?.error || '').toLowerCase() === 'duplicate_pending') {
        setPendingAttendanceEditIds((prev) => (prev.includes(attendanceId) ? prev : [...prev, attendanceId]));
      }
      setAttendanceEditError(String(msg));
    } finally {
      setAttendanceEditSubmitting(false);
    }
  };

  // Auto-Update the modal view if records change in the background (via setInterval)
  React.useEffect(() => {
    if (showModal && selectedDayRecords?.date) {
        const dStr = toYMD(selectedDayRecords.date);
        const dayRecords = records.filter(r => getAttendanceDateKey(r) === dStr);
        const dayPenalties = myPenalties.filter(p => dateMatches(p.date, dStr));
        const daySubs = mySubs.filter(s => dateMatches(s.date, dStr));
        const dayLeaves = myLeaves.filter(l => isDateInLeaveRange(dStr, l.date_from, l.date_to));
        
        dayRecords.sort((a, b) => (a.time_in || '').localeCompare(b.time_in || ''));
        setSelectedDayRecords({ 
            date: selectedDayRecords.date, 
            items: dayRecords,
            penalties: dayPenalties,
            subs: daySubs,
            leaves: dayLeaves
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, penalties, substitutions, leaves]);

  // Robust Timestamp parser
  const fmtTime = (t) => {
    if(!t) return '--:--';
    const safeTime = String(t).replace(' ', 'T'); // Fix for iOS/Safari SQL Datetime parsing
    return new Date(safeTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  // Convert "08:00:00" to "8:00 AM" for schedule representation
  const fmtScheduleTime = (timeStr) => {
      if (!timeStr) return '--:--';
      const [h, m] = String(timeStr).split(':');
      const date = new Date();
      date.setHours(parseInt(h, 10), parseInt(m, 10), 0);
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const fmtFullDate = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const getStatusColor = (id) => {
      if(id === 2) return 'bg-emerald-500'; // Present
      if(id === 5) return 'bg-yellow-500';  // Late
      if(id === 3) return 'bg-red-500';     // Absent
      if(id === 4) return 'bg-blue-500';    // Substituted
      if(id === 7) return 'bg-purple-500';  // On leave
      return 'bg-gray-400';                 // NA
  };
  
  const getStatusTextColor = (id) => {
      if(id === 2) return 'text-emerald-600'; 
      if(id === 5) return 'text-yellow-600'; 
      if(id === 3) return 'text-red-600'; 
      if(id === 4) return 'text-blue-600';
      if(id === 7) return 'text-purple-600';
      return 'text-gray-500'; 
  };

  const getAttendanceFlagRows = (record) => ([
    {
      label: 'IN',
      flagId: getFlagId(record?.flag_in_id),
      time: record?.time_in || record?.checked_in_at || null
    },
    {
      label: 'CHECK',
      flagId: getFlagId(record?.flag_check_id),
      time: record?.time_check || record?.checked_mid_at || null
    },
    {
      label: 'OUT',
      flagId: getFlagId(record?.flag_out_id),
      time: record?.time_out || record?.checked_out_at || null
    }
  ]);

  const hasPendingAttendanceEdit = selectedAttendanceForEdit
    ? pendingAttendanceEditIds.includes(Number(selectedAttendanceForEdit.attendance_id))
    : false;

  const renderCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = getDaysInMonth(year, month);
    const firstDay = getFirstDayOfMonth(year, month);
    
    const days = [];
    
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="bg-gray-50/30 border border-gray-100/50 min-h-[90px] md:min-h-[110px]"></div>);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const currentDayDate = new Date(year, month, day);
      const isToday = toYMD(new Date()) === toYMD(currentDayDate);
      const dStr = toYMD(currentDayDate);
      
      const dayRecords = records.filter(r => getAttendanceDateKey(r) === dStr);
      const dayPenalties = myPenalties.filter(p => dateMatches(p.date, dStr));
      const daySubs = mySubs.filter(s => dateMatches(s.date, dStr));
      const dayLeaves = myLeaves.filter(l => isDateInLeaveRange(dStr, l.date_from, l.date_to));
      
      const hasContent = dayRecords.length > 0 || dayPenalties.length > 0 || daySubs.length > 0 || dayLeaves.length > 0;

      days.push(
        <div 
          key={day} 
          onClick={() => handleDayClick(day)}
          className={`min-h-[90px] md:min-h-[110px] border border-gray-100 p-1 md:p-2 relative transition-all duration-200 flex flex-col
            ${isToday ? 'bg-emerald-50 border-emerald-200 shadow-inner' : 'bg-white hover:bg-gray-50'} 
            ${hasContent ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''}
          `}
        >
          <div className="flex justify-between items-start mb-1">
            <span className={`text-xs md:text-sm font-bold w-6 h-6 md:w-7 md:h-7 flex items-center justify-center rounded-full 
              ${isToday ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-700'}`}>
              {day}
            </span>
            {dayRecords.length > 0 && (
                <span className="hidden md:inline text-[10px] font-bold text-gray-400 mt-1">{dayRecords.length} Class{dayRecords.length > 1 ? 'es' : ''}</span>
            )}
          </div>

          <div className="flex flex-col gap-1 mb-1">
             {dayLeaves.length > 0 && (
                 <div className="w-full bg-purple-100 text-purple-700 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-purple-200 flex items-center justify-between">
                     <span className="flex items-center gap-1">
                         <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                         Leave
                     </span>
                     {dayLeaves.length > 1 && <span>x{dayLeaves.length}</span>}
                 </div>
             )}
             {dayPenalties.length > 0 && (
                 <div className="w-full bg-red-100 text-red-700 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-red-200 flex items-center justify-between">
                     <span className="flex items-center gap-1">
                         <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                         Penalty
                     </span>
                     {dayPenalties.length > 1 && <span>x{dayPenalties.length}</span>}
                 </div>
             )}
             {daySubs.length > 0 && (
                 <div className="w-full bg-blue-100 text-blue-700 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border border-blue-200 flex items-center justify-between">
                     <span className="flex items-center gap-1">
                         <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                         Sub
                     </span>
                     {daySubs.length > 1 && <span>x{daySubs.length}</span>}
                 </div>
             )}
          </div>

          <div className="mt-auto flex flex-wrap gap-1">
             {dayRecords.map((r, idx) => {
                 const isSub = daySubs.some(s => Number(s.schedule_id) === Number(r.schedule_id));
                 const overall = getOverallStatus(r);
                 return (
                     <div key={idx} className="w-full">
                        <div className={`flex items-center gap-1.5 px-1 md:px-1.5 py-0.5 md:py-1 rounded border mb-0.5 shadow-sm
                            ${isSub ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-gray-100'}
                        `}>
                            <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full flex-shrink-0 ${getStatusColor(overall)}`}></div>
                            <div className="overflow-hidden hidden md:flex items-center gap-1 w-full">
                                <div className={`text-[10px] font-bold truncate leading-none ${isSub ? 'text-blue-800' : 'text-gray-700'}`}>{r.subject_code}</div>
                            </div>
                        </div>
                     </div>
                 );
             })}
          </div>
        </div>
      );
    }
    return days;
  };

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const boxClass = "h-22 bg-white/10 border border-white/20 rounded-xl backdrop-blur-md shadow-lg flex items-center";

  return (
    <div className="p-4 md:p-8 bg-gray-50 min-h-screen font-sans selection:bg-green-100">
      
      {/* HEADER SECTION */}
      <div className="relative mb-6 rounded-2xl overflow-hidden shadow-xl text-white bg-[#1D8551]">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white opacity-10 rounded-full translate-y-1/3 -translate-x-1/4 blur-2xl"></div>

        <div className="relative z-10 p-4 md:p-6 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          
          <div className="space-y-1 min-w-[180px]">
             <div className="flex items-center gap-2 text-white/90 text-sm font-medium tracking-wide uppercase">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                Faculty Portal
             </div>
             <h2 className="text-3xl font-extrabold tracking-tight text-white">Attendance Calendar</h2>
          </div>

          <div className="flex flex-col sm:flex-row flex-wrap gap-4 w-full xl:w-auto xl:justify-end">
             
             {/* VIZ 1: ATTENDANCE RATE */}
             <div className={`${boxClass} px-4 gap-4 flex-1 w-full sm:w-auto min-w-[160px] xl:flex-none justify-center xl:justify-start`}>
                <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
                    <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 36 36">
                        <path className="text-emerald-900/40" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
                        <path className="text-white drop-shadow-md transition-all duration-1000 ease-out" 
                            strokeDasharray={`${attendRate}, 100`}
                            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                            fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" 
                        />
                    </svg>
                    <span className="absolute text-sm font-bold">{attendRate}%</span>
                </div>
                <div>
                    <div className="text-xs text-emerald-100 uppercase font-bold tracking-wider">Attendance</div>
                    <div className="text-[10px] text-emerald-200 opacity-80 mt-0.5">This Month</div>
                </div>
             </div>

             {/* VIZ 2: STATUS BARS */}
             <div className={`${boxClass} px-5 gap-5 flex-1 w-full sm:w-auto min-w-[180px] xl:flex-none justify-center xl:justify-start`}>
                <div className="flex items-end gap-3 h-12 pb-1">
                    <div className="w-4 bg-emerald-300 rounded-t-md relative group transition-all duration-700 ease-in-out hover:bg-emerald-200" style={{ height: getBarHeight(presentCount) }}></div>
                    <div className="w-4 bg-yellow-300 rounded-t-md relative group transition-all duration-700 ease-in-out hover:bg-yellow-200" style={{ height: getBarHeight(lateCount) }}></div>
                    <div className="w-4 bg-red-300 rounded-t-md relative group transition-all duration-700 ease-in-out hover:bg-red-200" style={{ height: getBarHeight(absentCount) }}></div>
                </div>
                <div className="flex flex-col justify-center h-full pl-2 border-l border-white/10">
                    <div className="text-xl font-bold text-white leading-none">{totalClasses}</div>
                    <div className="text-[9px] text-emerald-200 uppercase tracking-wide mt-1 font-semibold">Total<br/>Classes</div>
                </div>
             </div>

             {/* RESPONSIVE STATIC MONTH SWITCHER */}
             <div className={`${boxClass} p-2 gap-2 flex-1 w-full sm:w-auto min-w-[200px] xl:flex-none justify-between`}>
                <button onClick={() => changeMonth(-1)} className="p-3 hover:bg-white/20 rounded-lg transition-colors text-white active:scale-95 h-full flex items-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <div className="text-center min-w-[120px]">
                    <div className="text-lg font-bold text-white leading-none transition-all duration-300">
                        {currentDate.toLocaleDateString('en-US', { month: 'long' })}
                    </div>
                    <div className="text-xs text-emerald-200 font-medium mt-1">
                        {currentDate.getFullYear()}
                    </div>
                </div>
                <button onClick={() => changeMonth(1)} className="p-3 hover:bg-white/20 rounded-lg transition-colors text-white active:scale-95 h-full flex items-center">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
             </div>

             {/* LIVE CLOCK */}
             <div 
                onClick={jumpToToday}
                className={`${boxClass} px-5 flex-col justify-center flex-1 w-full sm:w-auto min-w-[160px] cursor-pointer hover:bg-white/20 transition-all active:scale-95 group xl:flex-none`}
                title="Click to go to current month"
             >
                <div className="text-2xl font-bold font-mono tracking-tighter leading-none text-white tabular-nums group-hover:scale-105 transition-transform">
                    {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                </div>
                <div className="text-[10px] text-white/80 uppercase tracking-wider mt-1 truncate">
                    {currentTime.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </div>
             </div>
          </div>
        </div>
      </div>

      {/* CALENDAR & DASHBOARD */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-4 flex flex-wrap gap-6 items-center justify-between">
              <div className="text-sm font-bold text-gray-700 uppercase tracking-widest">Monthly Record Overview</div>
              
              <div className="flex flex-wrap gap-4">
                  <div className="flex items-center gap-3 bg-white border border-purple-100 shadow-sm px-4 py-2 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center text-purple-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      </div>
                      <div>
                          <div className="text-[10px] uppercase font-bold text-purple-400 leading-none mb-1">Leaves</div>
                          <div className="text-sm font-bold text-purple-800 leading-none">{leavesCount} Approved</div>
                      </div>
                  </div>

                  <div className="flex items-center gap-3 bg-white border border-blue-100 shadow-sm px-4 py-2 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                      </div>
                      <div>
                          <div className="text-[10px] uppercase font-bold text-blue-400 leading-none mb-1">Substitutions</div>
                          <div className="text-sm font-bold text-blue-800 leading-none">{substitutionsCount} Logged</div>
                      </div>
                  </div>

                  <div className="flex items-center gap-3 bg-white border border-red-100 shadow-sm px-4 py-2 rounded-xl">
                      <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-600">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                      </div>
                      <div>
                          <div className="text-[10px] uppercase font-bold text-red-400 leading-none mb-1">Penalties</div>
                          <div className="text-sm font-bold text-red-800 leading-none">{penaltiesCount} Incurred</div>
                      </div>
                  </div>
              </div>
          </div>

          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
              {weekDays.map(day => (
                  <div key={day} className="py-3 text-center text-[10px] md:text-xs font-bold text-gray-500 uppercase tracking-widest">
                      {day}
                  </div>
              ))}
          </div>
          
          <div className="grid grid-cols-7 bg-gray-100 gap-px border-b border-gray-200">
             {loading && records.length === 0 ? (
                 <div className="col-span-7 h-96 flex flex-col items-center justify-center bg-white">
                    <div className="w-10 h-10 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
                    <p className="mt-4 text-sm text-gray-500">Loading calendar...</p>
                 </div>
             ) : (
                 renderCalendar()
             )}
          </div>
      </div>
      
      {/* RESPONSIVE LEGEND FOR MOBILE */}
      <div className="mt-6 flex flex-wrap gap-3 md:gap-5 items-center justify-center text-xs md:text-sm font-medium text-gray-600 bg-white py-3 px-4 md:px-6 rounded-xl md:rounded-full border border-gray-200 shadow-sm mx-auto w-full md:max-w-fit">
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full bg-emerald-500 shadow-inner"></span> Present</div>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full bg-yellow-500 shadow-inner"></span> Late</div>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full bg-red-500 shadow-inner"></span> Absent</div>
          <div className="flex items-center gap-2"><span className="w-3.5 h-3.5 rounded-full bg-gray-400 shadow-inner"></span> Other</div>
          <div className="hidden md:block w-px h-5 bg-gray-300 mx-2"></div>
          <div className="flex items-center gap-1.5 text-purple-600 bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg> Leave
          </div>
          <div className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg> Substitute
          </div>
          <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">
             <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg> Penalty
          </div>
      </div>

      {/* DAILY DETAILS MODAL */}
      <Modal show={showModal} title="Daily Activity Log" onClose={() => setShowModal(false)} size="lg">
        {selectedDayRecords && (
          <div className="p-6 bg-gray-50 h-full max-h-[75vh] overflow-y-auto custom-scrollbar">
            
            <div className="text-center mb-6 border-b border-gray-200 pb-4">
                <h3 className="text-3xl font-extrabold text-gray-800 tracking-tight">{fmtFullDate(selectedDayRecords.date)}</h3>
                <p className="text-gray-500 font-medium mt-1">Detailed Daily View</p>
            </div>

            {/* HIGH PRIORITY ALERTS: Leaves, Penalties and Subs */}
            <div className="space-y-3 mb-6">
                {selectedDayRecords.leaves?.map((l, idx) => (
                    <div key={`lev-${idx}`} className="bg-purple-50 border border-purple-200 border-l-4 border-l-purple-500 p-4 rounded-lg shadow-sm flex items-start gap-4 animate-fade-in-up">
                         <div className="mt-0.5 text-purple-500">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                         </div>
                         <div>
                             <h4 className="text-purple-900 font-bold uppercase tracking-wider text-xs mb-1">Approved Leave: {l.name_type}</h4>
                             <p className="text-purple-700 text-sm font-medium">Duration: {l.date_from} to {l.date_to}</p>
                             {l.reason && <p className="text-purple-600 text-xs mt-1 italic">"{l.reason}"</p>}
                         </div>
                    </div>
                ))}

                {selectedDayRecords.penalties?.map((p, idx) => (
                    <div key={`pen-${idx}`} className="bg-red-50 border border-red-200 border-l-4 border-l-red-500 p-4 rounded-lg shadow-sm flex items-start gap-4 animate-fade-in-up">
                         <div className="mt-0.5 text-red-500">
                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path></svg>
                         </div>
                         <div>
                             <h4 className="text-red-900 font-bold uppercase tracking-wider text-xs mb-1">Penalty Imposed: {p.type_name}</h4>
                             <p className="text-red-700 text-sm font-medium">{p.reason || 'No specific reason detailed in record.'}</p>
                         </div>
                    </div>
                ))}

                {selectedDayRecords.subs?.map((s, idx) => {
                    const isCovering = Number(s.substitute_id) === myUserId;
                    return (
                        <div key={`sub-${idx}`} className="bg-blue-50 border border-blue-200 border-l-4 border-l-blue-500 p-4 rounded-lg shadow-sm flex items-start gap-4 animate-fade-in-up">
                             <div className="mt-0.5 text-blue-500">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path></svg>
                             </div>
                             <div>
                                 <h4 className="text-blue-900 font-bold uppercase tracking-wider text-xs mb-1">
                                     {isCovering ? 'You Covered a Class' : 'Class Substituted'}
                                 </h4>
                                 <p className="text-blue-700 text-sm font-medium">
                                     {isCovering 
                                         ? `You acted as substitute for ${s.teacher_first} ${s.teacher_last} (${s.subject_code})` 
                                         : `${s.sub_first} ${s.sub_last} substituted this class for you (${s.subject_code})`}
                                 </p>
                             </div>
                        </div>
                    );
                })}
            </div>

            {/* ATTENDANCE RECORDS */}
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Attendance Logs ({selectedDayRecords.items.length})</h4>
            {selectedDayRecords.items.length === 0 ? (
                <div className="text-center py-8 bg-white border border-gray-200 border-dashed rounded-xl text-gray-400 italic">No attendance records generated for this date.</div>
            ) : (
                <div className="space-y-4">
                    {selectedDayRecords.items.map((record, idx) => {
                        const hasAttachedSub = selectedDayRecords.subs.some(s => Number(s.schedule_id) === Number(record.schedule_id));
                        const overallStatus = getOverallStatus(record);

                        return (
                            <div key={idx} className={`bg-white rounded-xl p-4 md:p-5 shadow-sm border flex flex-col md:flex-row gap-4 items-center relative overflow-hidden group transition-shadow
                                ${hasAttachedSub ? 'border-blue-200 bg-blue-50/20' : 'border-gray-200 hover:shadow-md'}
                            `}>
                                <div className={`absolute left-0 top-0 bottom-0 w-2 ${getStatusColor(overallStatus)}`}></div>
                                
                                {/* TIMING BLOCK (IN, CHECK, OUT) */}
                                <div className="w-full md:w-auto md:min-w-[220px] flex flex-col gap-2 md:border-r border-gray-100 pl-2 pr-4">
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-gray-400 uppercase tracking-widest w-14">IN:</span>
                                        {(() => { const fid = getFlagId(record.flag_in_id); return (<>
                                          <span className={`font-bold ${getStatusTextColor(fid)} w-16 text-left`}>{flagMap[fid] || 'N/A'}</span>
                                          {/* FIX: USING record.time_in INSTEAD OF record.checked_in_at */}
                                          <span className="font-mono text-gray-700 font-semibold">{record.time_in ? fmtTime(record.time_in) : '--:--'}</span>
                                        </>); })()}
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-gray-400 uppercase tracking-widest w-14">CHECK:</span>
                                        {(() => { const fid = getFlagId(record.flag_check_id); return (<>
                                          <span className={`font-bold ${getStatusTextColor(fid)} w-16 text-left`}>{flagMap[fid] || 'N/A'}</span>
                                          {/* FIX: USING record.time_check INSTEAD OF record.checked_mid_at */}
                                          <span className="font-mono text-gray-700 font-semibold">{record.time_check ? fmtTime(record.time_check) : '--:--'}</span>
                                        </>); })()}
                                    </div>
                                    <div className="flex items-center justify-between text-xs">
                                        <span className="font-bold text-gray-400 uppercase tracking-widest w-14">OUT:</span>
                                        {(() => { const fid = getFlagId(record.flag_out_id); return (<>
                                          <span className={`font-bold ${getStatusTextColor(fid)} w-16 text-left`}>{flagMap[fid] || 'N/A'}</span>
                                          {/* FIX: USING record.time_out INSTEAD OF record.checked_out_at */}
                                          <span className="font-mono text-gray-700 font-semibold">{record.time_out ? fmtTime(record.time_out) : '--:--'}</span>
                                        </>); })()}
                                    </div>
                                </div>

                                {/* SUBJECT & ROOM BLOCK */}
                                <div className="flex-1 w-full flex flex-col justify-center text-left">
                                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-600 border border-gray-200">
                                            {record.section_name || 'No Section'}
                                        </span>
                                        <span className="text-base font-black text-emerald-800">
                                            {record.subject_code}
                                        </span>
                                    </div>
                                    <div className="text-sm text-gray-600 font-medium leading-tight mb-1">
                                        {record.subject_name}
                                    </div>
                                    
                                    {/* SCHEDULE TIME INSERTED HERE */}
                                    <div className="text-xs font-bold text-gray-500 flex items-center gap-1.5 mb-1.5">
                                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                                        {fmtScheduleTime(record.start_time)} - {fmtScheduleTime(record.end_time)}
                                    </div>

                                    <div className="flex items-center gap-1.5 text-xs text-gray-500 font-bold bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-100 max-w-fit">
                                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                                        {record.room_name || 'TBA'}
                                    </div>
                                </div>

                                {/* OVERALL STATUS PILL */}
                                <div className="w-full md:w-auto mt-2 md:mt-0 flex flex-col items-center md:items-end gap-2">
                                     <div className={`px-4 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-2 border shadow-sm ${
                                         overallStatus === 2 ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 
                                         overallStatus === 5 ? 'bg-yellow-50 text-yellow-800 border-yellow-200' : 
                                         overallStatus === 3 ? 'bg-red-50 text-red-800 border-red-200' : 
                                         overallStatus === 4 ? 'bg-blue-50 text-blue-800 border-blue-200' :
                                         overallStatus === 7 ? 'bg-purple-50 text-purple-800 border-purple-200' :
                                         'bg-gray-100 text-gray-700'
                                     }`}>
                                        <span className={`w-2 h-2 rounded-full shadow-inner ${getStatusColor(overallStatus)}`}></span>
                                        {flagMap[overallStatus] || 'N/A'}
                                     </div>
                                     {canRequestEdit ? (
                                       <button
                                          type="button"
                                          onClick={() => openAttendanceEditRequest(record)}
                                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors"
                                          title="Request edit for this attendance record"
                                       >
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M16.586 3.586a2 2 0 112.828 2.828L11 14.828l-4 1 1-4 8.586-8.242z"></path>
                                          </svg>
                                          Request Edit
                                       </button>
                                     ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <div className="flex justify-end pt-8">
                <button onClick={() => setShowModal(false)} className="px-8 py-3 bg-gray-900 hover:bg-black text-white rounded-xl text-sm font-bold shadow-lg transition-transform active:scale-95">
                    Close Daily Log
                </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        show={showAttendanceEditModal}
        title="Request Attendance Edit"
        onClose={closeAttendanceEditRequest}
        size="md"
      >
        {selectedAttendanceForEdit ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="text-sm font-bold text-gray-800">
                {selectedAttendanceForEdit.subject_code} - {selectedAttendanceForEdit.subject_name}
              </div>
              <div className="text-xs text-gray-600">
                {selectedAttendanceForEdit.section_name || 'No Section'} | {selectedAttendanceForEdit.room_name || 'TBA'}
              </div>
              <div className="text-xs text-gray-600">
                {selectedAttendanceForEdit.date} | {fmtScheduleTime(selectedAttendanceForEdit.start_time)} - {fmtScheduleTime(selectedAttendanceForEdit.end_time)}
              </div>
              <div className="text-xs text-gray-700">
                Current status: <span className="font-bold">{flagMap[getOverallStatus(selectedAttendanceForEdit)] || 'N/A'}</span>
              </div>
            </div>

            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wider">
                    <th className="px-3 py-2 text-left">Flag</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {getAttendanceFlagRows(selectedAttendanceForEdit).map((row) => (
                    <tr key={row.label}>
                      <td className="px-3 py-2 font-bold text-gray-700">{row.label}</td>
                      <td className={`px-3 py-2 font-semibold ${getStatusTextColor(row.flagId)}`}>
                        {flagMap[row.flagId] || 'N/A'}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700">
                        {row.time ? fmtTime(row.time) : '--:--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasPendingAttendanceEdit ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2 font-semibold">
                A pending request for this attendance record already exists.
              </div>
            ) : null}

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                Reason for Edit Request
              </label>
              <textarea
                value={attendanceEditReason}
                onChange={(e) => setAttendanceEditReason(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Explain what needs to be corrected..."
              />
            </div>

            {attendanceEditError ? (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {attendanceEditError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeAttendanceEditRequest}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
                disabled={attendanceEditSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAttendanceEditRequest}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                disabled={attendanceEditSubmitting || hasPendingAttendanceEdit}
              >
                {attendanceEditSubmitting ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
