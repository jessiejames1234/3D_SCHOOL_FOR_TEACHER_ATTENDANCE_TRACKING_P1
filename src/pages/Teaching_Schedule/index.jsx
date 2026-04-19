import React from 'react';
import Modal from '../../components/Modal.jsx';
import { apiGet, apiPost } from '../../services/api.js';
import { AuthContext } from '../../context/AuthContext.jsx';

export default function MyAttendance(){
  const { user } = React.useContext(AuthContext);
  const canRequestEdit = [2, 3, 4, 5].includes(Number(user?.role_id));
  const [schedules, setSchedules] = React.useState([]);
  const [rooms, setRooms] = React.useState([]);
  const [schools, setSchools] = React.useState([]);
  const [buildings, setBuildings] = React.useState([]);
  const [floors, setFloors] = React.useState([]);
  const [pendingScheduleEditIds, setPendingScheduleEditIds] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [showModal, setShowModal] = React.useState(false);
  const [selected, setSelected] = React.useState(null);
  
  // NEW: State for Live Clock & Countdown
  const [currentTime, setCurrentTime] = React.useState(new Date());
  const [countdownStr, setCountdownStr] = React.useState('--:--:--');
  const [nextSubject, setNextSubject] = React.useState(null);
  const [showEditRequestModal, setShowEditRequestModal] = React.useState(false);
  const [selectedScheduleForEdit, setSelectedScheduleForEdit] = React.useState(null);
  const [editRequestForm, setEditRequestForm] = React.useState({
    new_room_id: '',
    new_day_of_week: '',
    new_start_time: '',
    new_end_time: '',
    reason: ''
  });
  const [editRequestConflict, setEditRequestConflict] = React.useState('');
  const [editRequestError, setEditRequestError] = React.useState('');
  const [editRequestSubmitting, setEditRequestSubmitting] = React.useState(false);
  const [editCampusId, setEditCampusId] = React.useState('');
  const [editBuildingId, setEditBuildingId] = React.useState('');
  const [editFloorId, setEditFloorId] = React.useState('');

  const fetch = async ()=>{
    setLoading(true);
    try{
      const pendingPromise = canRequestEdit
        ? apiGet('request-edit/schedule?scope=my&status=pending').catch(() => [])
        : Promise.resolve([]);
      const schoolPromise = apiGet('school').catch(() => []);
      const buildingPromise = apiGet('buildings').catch(() => []);
      const floorPromise = apiGet('floors').catch(() => []);
      const [data, roomData, schoolData, buildingData, floorData, pendingData] = await Promise.all([
        apiGet('my-schedule'),
        apiGet('rooms'),
        schoolPromise,
        buildingPromise,
        floorPromise,
        pendingPromise
      ]);
      setSchedules(Array.isArray(data)? data : []);
      setRooms(Array.isArray(roomData) ? roomData : []);
      setSchools(Array.isArray(schoolData) ? schoolData : []);
      setBuildings(Array.isArray(buildingData) ? buildingData : []);
      setFloors(Array.isArray(floorData) ? floorData : []);
      const pendingIds = Array.isArray(pendingData)
        ? pendingData
          .map((row) => Number(row?.schedule_id))
          .filter((id) => Number.isFinite(id) && id > 0)
        : [];
      setPendingScheduleEditIds(pendingIds);
    }catch(e){ console.error(e); }
    setLoading(false);
  };

  React.useEffect(()=>{ fetch(); }, []);

  // LOGIC: Find the nearest upcoming schedule
  const getNextSchedule = (currentDate, scheduleList) => {
    if (!scheduleList || scheduleList.length === 0) return null;

    const daysMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    let closestDiff = Infinity;
    let upcomingClass = null;

    scheduleList.forEach(sched => {
      if(!sched.day_of_week || !sched.start_time) return;
      
      const schedDayIndex = daysMap[sched.day_of_week.toLowerCase()];
      const currentDayIndex = currentDate.getDay();
      
      // Calculate date of this schedule relative to today
      let targetDate = new Date(currentDate);
      let dayDiff = schedDayIndex - currentDayIndex;
      
      // If day is earlier in week, move to next week
      if (dayDiff < 0) {
        dayDiff += 7;
      }
      
      targetDate.setDate(currentDate.getDate() + dayDiff);
      
      // Set time
      const [h, m] = sched.start_time.split(':');
      targetDate.setHours(parseInt(h), parseInt(m), 0, 0);

      // If the time has already passed today, move to next week
      if (targetDate <= currentDate) {
        targetDate.setDate(targetDate.getDate() + 7);
      }

      const diff = targetDate - currentDate;
      
      if (diff < closestDiff) {
        closestDiff = diff;
        upcomingClass = { ...sched, targetDate, diff };
      }
    });

    return upcomingClass;
  };

  // NEW: Effect for Live Clock ticking AND Countdown
  React.useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(now);

      // Calculate Countdown
      if (schedules.length > 0) {
        const next = getNextSchedule(now, schedules);
        
        if (next) {
          setNextSubject(next);
          const diff = next.diff;
          
          // Format duration
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
          const minutes = Math.floor((diff / (1000 * 60)) % 60);
          const seconds = Math.floor((diff / 1000) % 60);

          // Pad with zeros
          const h = hours < 10 ? `0${hours}` : hours;
          const m = minutes < 10 ? `0${minutes}` : minutes;
          const s = seconds < 10 ? `0${seconds}` : seconds;

          if (days > 0) {
            setCountdownStr(`${days}d ${h}:${m}:${s}`);
          } else {
            setCountdownStr(`${h}:${m}:${s}`);
          }
        } else {
            setNextSubject(null);
            setCountdownStr('--:--:--');
        }
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [schedules]);

  const openView = (row)=>{ setSelected(row); setShowModal(true); };
  const closeView = ()=>{ setSelected(null); setShowModal(false); };

  // Helper to format time (08:00:00 -> 8:00 AM)
  const formatTime = (t) => {
    if(!t) return '';
    const [h, m] = t.split(':');
    const hour = parseInt(h,10);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const fmtHour = hour % 12 || 12;
    return `${fmtHour}:${m} ${suffix}`;
  };

  const toHms = (t) => {
    if (!t) return '';
    const raw = String(t).trim();
    if (/^\d{2}:\d{2}:\d{2}$/.test(raw)) return raw;
    if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
    return '';
  };

  const toHm = (t) => {
    const hms = toHms(t);
    return hms ? hms.slice(0, 5) : '';
  };

  const dayNormalize = (value) => {
    const v = String(value || '').toLowerCase().trim();
    const map = {
      mon: 'monday', monday: 'monday',
      tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday',
      wed: 'wednesday', wednesday: 'wednesday',
      thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday',
      fri: 'friday', friday: 'friday',
      sat: 'saturday', saturday: 'saturday',
      sun: 'sunday', sunday: 'sunday'
    };
    return map[v] || '';
  };

  const toMinutes = (timeValue) => {
    const hms = toHms(timeValue);
    if (!hms) return null;
    const parts = hms.split(':');
    if (parts.length < 2) return null;
    return Number(parts[0]) * 60 + Number(parts[1]);
  };

  const resolveRoomId = (sched) => {
    if (!sched) return null;
    if (sched.room_id !== undefined && sched.room_id !== null && String(sched.room_id) !== '') return Number(sched.room_id);
    if (sched.room_name) {
      const found = rooms.find(r => String(r.room_name || '').trim().toLowerCase() === String(sched.room_name).trim().toLowerCase());
      if (found?.room_id !== undefined && found?.room_id !== null) return Number(found.room_id);
    }
    return null;
  };

  const roomNameFromId = (roomId) => {
    if (!roomId) return 'TBA';
    const found = rooms.find(r => Number(r.room_id) === Number(roomId));
    return found?.room_name || `Room #${roomId}`;
  };

  const isArchived = (row) => String(row?.status || '').toLowerCase() === 'archive';

  const schoolNameFromId = (schoolId) => {
    if (!schoolId) return 'N/A';
    const found = schools.find((s) => Number(s.school_id) === Number(schoolId));
    return found?.school_name || `Campus #${schoolId}`;
  };

  const buildingNameFromId = (buildingId) => {
    if (!buildingId) return 'N/A';
    const found = buildings.find((b) => Number(b.building_id) === Number(buildingId));
    return found?.building_name || `Building #${buildingId}`;
  };

  const floorNameFromId = (floorId) => {
    if (!floorId) return 'N/A';
    const found = floors.find((f) => Number(f.floor_id) === Number(floorId));
    return found?.floor_name || `Floor #${floorId}`;
  };

  const getOriginalLocationForSchedule = (sched) => {
    if (!sched) return { roomId: null, floorId: null, buildingId: null, schoolId: null };
    const roomId = resolveRoomId(sched);
    const roomObj = roomId ? rooms.find((r) => Number(r.room_id) === Number(roomId)) : null;
    const floorId = roomObj?.floor_id ?? sched.floor_id ?? null;
    const buildingId = roomObj?.building_id ?? sched.building_id ?? null;
    const buildingObj = buildingId ? buildings.find((b) => Number(b.building_id) === Number(buildingId)) : null;
    const schoolId = buildingObj?.school_id ?? null;
    return {
      roomId: roomId ? Number(roomId) : null,
      floorId: floorId ? Number(floorId) : null,
      buildingId: buildingId ? Number(buildingId) : null,
      schoolId: schoolId ? Number(schoolId) : null
    };
  };

  const selectedScheduleOriginalLocation = selectedScheduleForEdit
    ? getOriginalLocationForSchedule(selectedScheduleForEdit)
    : { roomId: null, floorId: null, buildingId: null, schoolId: null };

  const editCampusOptions = schools.filter((s) => !isArchived(s));
  const editBuildingOptions = editCampusId
    ? buildings.filter((b) => !isArchived(b) && String(b.school_id || '') === String(editCampusId))
    : [];
  const editFloorOptions = editBuildingId
    ? floors.filter((f) => !isArchived(f) && String(f.building_id || '') === String(editBuildingId))
    : [];
  const editRoomOptions = editFloorId
    ? rooms.filter((r) => !isArchived(r) && String(r.floor_id || '') === String(editFloorId))
    : [];

  const hasPendingScheduleEdit = selectedScheduleForEdit
    ? pendingScheduleEditIds.includes(Number(selectedScheduleForEdit.schedule_id))
    : false;

  const getEffectiveEditValues = () => {
    if (!selectedScheduleForEdit) return null;
    const originalRoomId = resolveRoomId(selectedScheduleForEdit);
    const finalRoomId = editRequestForm.new_room_id ? Number(editRequestForm.new_room_id) : originalRoomId;
    const finalDay = dayNormalize(editRequestForm.new_day_of_week || selectedScheduleForEdit.day_of_week);
    const finalStart = toHms(editRequestForm.new_start_time || selectedScheduleForEdit.start_time);
    const finalEnd = toHms(editRequestForm.new_end_time || selectedScheduleForEdit.end_time);
    return {
      originalRoomId,
      finalRoomId,
      finalDay,
      finalStart,
      finalEnd
    };
  };

  const detectScheduleConflict = () => {
    if (!selectedScheduleForEdit) return '';
    const effective = getEffectiveEditValues();
    if (!effective || !effective.finalRoomId || !effective.finalDay || !effective.finalStart || !effective.finalEnd) return '';

    const finalStartMinutes = toMinutes(effective.finalStart);
    const finalEndMinutes = toMinutes(effective.finalEnd);
    if (finalStartMinutes === null || finalEndMinutes === null || finalStartMinutes >= finalEndMinutes) {
      return 'Invalid time range. Start time must be before end time.';
    }

    for (const sched of schedules) {
      if (Number(sched.schedule_id) === Number(selectedScheduleForEdit.schedule_id)) continue;
      if (dayNormalize(sched.day_of_week) !== effective.finalDay) continue;

      const otherStart = toMinutes(sched.start_time);
      const otherEnd = toMinutes(sched.end_time);
      if (otherStart === null || otherEnd === null) continue;

      const overlaps = !(otherEnd <= finalStartMinutes || otherStart >= finalEndMinutes);
      if (!overlaps) continue;

      const otherRoomId = resolveRoomId(sched);
      if (otherRoomId && Number(otherRoomId) === Number(effective.finalRoomId)) {
        return `Room conflict with ${sched.subject_code} (${formatTime(sched.start_time)}-${formatTime(sched.end_time)}).`;
      }
      return `Teacher time conflict with ${sched.subject_code} (${formatTime(sched.start_time)}-${formatTime(sched.end_time)}).`;
    }

    return '';
  };

  const openScheduleEditRequest = (sched) => {
    setSelectedScheduleForEdit(sched);
    setEditRequestForm({
      new_room_id: '',
      new_day_of_week: '',
      new_start_time: '',
      new_end_time: '',
      reason: ''
    });
    setEditCampusId('');
    setEditBuildingId('');
    setEditFloorId('');
    setEditRequestConflict('');
    setEditRequestError('');
    setShowEditRequestModal(true);
  };

  const closeScheduleEditRequest = () => {
    setShowEditRequestModal(false);
    setSelectedScheduleForEdit(null);
    setEditCampusId('');
    setEditBuildingId('');
    setEditFloorId('');
    setEditRequestConflict('');
    setEditRequestError('');
    setEditRequestForm({
      new_room_id: '',
      new_day_of_week: '',
      new_start_time: '',
      new_end_time: '',
      reason: ''
    });
  };

  const notifyScheduleEditRequestSuccess = async () => {
    if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
      await window.Swal.fire({
        icon: 'success',
        title: 'Schedule edit request submitted',
        timer: 1400,
        showConfirmButton: false
      });
    }
  };

  const submitScheduleEditRequest = async () => {
    if (!selectedScheduleForEdit?.schedule_id) return;
    const scheduleId = Number(selectedScheduleForEdit.schedule_id);
    if (pendingScheduleEditIds.includes(scheduleId)) {
      setEditRequestError('There is already a pending request for this schedule.');
      return;
    }
    if ((editCampusId || editBuildingId || editFloorId) && !editRequestForm.new_room_id) {
      setEditRequestError('Select a room after choosing campus/building/floor.');
      return;
    }
    const reason = editRequestForm.reason.trim();
    if (!reason) {
      setEditRequestError('Reason is required.');
      return;
    }

    const effective = getEffectiveEditValues();
    if (!effective || !effective.finalRoomId || !effective.finalDay || !effective.finalStart || !effective.finalEnd) {
      setEditRequestError('Please provide valid schedule values.');
      return;
    }
    if (toMinutes(effective.finalStart) >= toMinutes(effective.finalEnd)) {
      setEditRequestError('Start time must be before end time.');
      return;
    }

    const conflict = detectScheduleConflict();
    setEditRequestConflict(conflict);
    if (conflict) {
      setEditRequestError('Resolve conflict before submitting.');
      return;
    }

    const originalRoomId = resolveRoomId(selectedScheduleForEdit);
    const originalDay = dayNormalize(selectedScheduleForEdit.day_of_week);
    const originalStart = toHms(selectedScheduleForEdit.start_time);
    const originalEnd = toHms(selectedScheduleForEdit.end_time);

    const payload = {
      schedule_id: scheduleId,
      reason
    };
    if (effective.finalRoomId && Number(effective.finalRoomId) !== Number(originalRoomId)) payload.new_room_id = Number(effective.finalRoomId);
    if (effective.finalDay && effective.finalDay !== originalDay) payload.new_day_of_week = effective.finalDay;
    if (effective.finalStart && effective.finalStart !== originalStart) payload.new_start_time = effective.finalStart;
    if (effective.finalEnd && effective.finalEnd !== originalEnd) payload.new_end_time = effective.finalEnd;

    if (!payload.new_room_id && !payload.new_day_of_week && !payload.new_start_time && !payload.new_end_time) {
      setEditRequestError('No changes detected. Edit at least one field.');
      return;
    }

    setEditRequestError('');
    setEditRequestSubmitting(true);
    try {
      await apiPost('request-edit/schedule', payload);
      setPendingScheduleEditIds((prev) => (prev.includes(scheduleId) ? prev : [...prev, scheduleId]));
      closeScheduleEditRequest();
      await notifyScheduleEditRequestSuccess();
    } catch (e) {
      const msg = e?.body?.message || e?.body?.error || e?.message || 'Failed to submit schedule edit request';
      if (String(e?.body?.error || '').toLowerCase() === 'duplicate_pending') {
        setPendingScheduleEditIds((prev) => (prev.includes(scheduleId) ? prev : [...prev, scheduleId]));
      }
      setEditRequestError(String(msg));
    } finally {
      setEditRequestSubmitting(false);
    }
  };

  React.useEffect(() => {
    if (!showEditRequestModal) return;
    setEditRequestConflict(detectScheduleConflict());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequestForm, selectedScheduleForEdit, schedules, showEditRequestModal]);

  // Days to display
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayOptions = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

  return (
    <div className="p-4 md:p-8 bg-gray-50 min-h-screen font-sans selection:bg-green-100">
      {/* INLINE STYLES FOR ANIMATION */}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in-up {
          animation: fadeInUp 0.5s ease-out forwards;
        }
        .delay-100 { animation-delay: 100ms; }
        .delay-200 { animation-delay: 200ms; }
        .delay-300 { animation-delay: 300ms; }
      `}</style>

      {/* HEADER SECTION */}
      <div className="relative mb-10 rounded-2xl overflow-hidden shadow-xl text-white bg-[#1D8551]">
        {/* Decorative Background Elements */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-white opacity-5 rounded-full -translate-y-1/2 translate-x-1/4 blur-3xl"></div>
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white opacity-10 rounded-full translate-y-1/3 -translate-x-1/4 blur-2xl"></div>

        <div className="relative z-10 p-6 md:p-8 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2 text-white/90 text-sm font-medium tracking-wide uppercase">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
              Faculty Portal
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white">My Weekly Schedule</h2>
            <p className="text-white/90 text-sm md:text-base max-w-md">
              View your teaching load, assigned rooms, and class timings.
            </p>
          </div>

          <div className="flex flex-col md:flex-row gap-4 w-full xl:w-auto">
            
            {/* NEW: COUNTDOWN WIDGET */}
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 min-w-[180px] text-center shadow-lg transform transition-transform hover:scale-105 duration-300 text-white flex flex-col justify-center">
                <div className="text-xs text-emerald-200 uppercase tracking-widest font-semibold mb-1 truncate max-w-[160px] mx-auto">
                    {nextSubject ? 'Next: ' + nextSubject.subject_code : 'Next Schedule'}
                </div>
                <div className="text-3xl font-bold font-mono tracking-tighter leading-none text-white tabular-nums">
                    {countdownStr}
                </div>
                <div className="text-xs text-white/80 mt-1 truncate max-w-[160px] mx-auto">
                    {nextSubject ? nextSubject.subject_name : 'No classes found'}
                </div>
            </div>

            {/* LIVE CLOCK WIDGET */}
            <div className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 min-w-[180px] text-center shadow-lg transform transition-transform hover:scale-105 duration-300 text-white">
                <div className="text-xs text-white/80 uppercase tracking-widest font-semibold mb-1">
                {currentTime.toLocaleDateString('en-US', { weekday: 'long' })}
                </div>
                <div className="text-3xl font-bold font-mono tracking-tighter leading-none text-white tabular-nums">
                {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).split(' ')[0]}
                <span className="text-base ml-1 align-top text-white/80">
                    {currentTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).split(' ')[1]}
                </span>
                </div>
                <div className="text-xs text-white/80 mt-1">
                {currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
            </div>

          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin"></div>
          <p className="mt-4 text-emerald-800 font-medium animate-pulse">Syncing schedule...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
          {days.map((day, dayIndex) => {
            // Filter schedules for this specific day
            const daySchedules = schedules.filter(s => (s.day_of_week || '').toLowerCase() === day);

            // Stagger animation based on index
            const animationDelay = `delay-${(dayIndex * 100) % 500}`; 

            return (
              <div 
                key={day} 
                className={`flex flex-col bg-white rounded-xl shadow-sm hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-hidden h-full animate-fade-in-up`}
                style={{ animationDelay: `${dayIndex * 100}ms` }}
              >
                {/* Day Header */}
                <div className={`p-3 text-center font-bold uppercase tracking-wider text-sm border-b 
                  ${day.toLowerCase() === currentTime.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase() 
                    ? 'bg-[#1D8551] text-white' 
                    : 'bg-gray-100 text-gray-600'}`}>
                  {day}
                </div>
                
                {/* Schedule Cards Container */}
                <div className="p-3 flex-1 space-y-3 bg-gray-50/30">
                  {daySchedules.length > 0 ? (
                    daySchedules.map((sched, idx) => (
                      <div 
                        key={idx} 
                        onClick={() => openView(sched)}
                        className="group bg-white p-3 rounded-lg border border-gray-100 relative overflow-hidden cursor-pointer 
                                   hover:border-emerald-400 hover:shadow-md transition-all duration-300 transform hover:-translate-y-1"
                      >
                        {/* Left Color Bar */}
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-[#1D8551] to-emerald-600 group-hover:w-1.5 transition-all"></div>

                        <div className="flex justify-between items-start mb-2 pl-2">
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
                                {formatTime(sched.start_time)} - {formatTime(sched.end_time)}
                            </span>
                            {canRequestEdit ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openScheduleEditRequest(sched); }}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px] font-bold hover:bg-emerald-100 transition-colors"
                                title="Request schedule edit"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M16.586 3.586a2 2 0 112.828 2.828L11 14.828l-4 1 1-4 8.586-8.242z"></path>
                                </svg>
                                Edit
                              </button>
                            ) : null}
                        </div>
                        
                        <div className="pl-2">
                            <h4 className="font-bold text-gray-800 text-sm leading-tight mb-0.5 group-hover:text-emerald-700 transition-colors">
                                {sched.subject_code}
                            </h4>
                            <div className="text-xs text-gray-500 line-clamp-1" title={sched.subject_name}>
                                {sched.subject_name}
                            </div>
                        </div>
                        
                        <div className="mt-3 pt-2 border-t border-gray-50 flex justify-between items-center text-xs text-gray-500 pl-2">
                            <div className="flex items-center gap-1.5">
                                <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-emerald-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                <span className="font-medium">{sched.room_name || sched.room_id}</span>
                            </div>
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600 font-medium text-[10px]">
                                {sched.section_name}
                            </span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-300 py-10 gap-2">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 12H4"></path></svg>
                      </div>
                      <span className="text-xs italic">Rest Day</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <Modal show={showModal} title="Class Details" onClose={closeView} size="md">
        {selected ? (
          <div className="space-y-6 p-4">
            <div className="text-center pb-6 border-b border-gray-100 relative">
                <div className="w-16 h-1 bg-emerald-500 rounded-full mx-auto mb-4"></div>
                <div className="text-3xl font-extrabold text-gray-800 tracking-tight">{selected.subject_code}</div>
                <div className="text-emerald-600 font-medium text-sm mt-1">{selected.subject_name}</div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 hover:border-emerald-200 transition-colors">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Time Schedule</div>
                    <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                       <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                       {formatTime(selected.start_time)}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">To {formatTime(selected.end_time)}</div>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 hover:border-emerald-200 transition-colors">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Day of Week</div>
                    <div className="font-bold text-gray-800 text-lg capitalize flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                      {selected.day_of_week}
                    </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 hover:border-emerald-200 transition-colors">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Assigned Room</div>
                    <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                      {selected.room_name}
                    </div>
                </div>
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 hover:border-emerald-200 transition-colors">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Section Code</div>
                    <div className="font-bold text-gray-800 text-lg flex items-center gap-2">
                       <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                       {selected.section_name}
                    </div>
                </div>
            </div>
            
            <div className="flex justify-end pt-4">
                <button onClick={closeView} className="px-6 py-2.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-sm font-bold shadow-lg shadow-gray-200 transition-all transform hover:-translate-y-0.5">
                    Close Details
                </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal show={showEditRequestModal && canRequestEdit} title="Request Schedule Edit" onClose={closeScheduleEditRequest} size="lg">
        {selectedScheduleForEdit ? (
          <div className="space-y-4">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-bold text-gray-800">
                {selectedScheduleForEdit.subject_code} - {selectedScheduleForEdit.subject_name}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                {selectedScheduleForEdit.section_name} | {selectedScheduleForEdit.day_of_week} | {formatTime(selectedScheduleForEdit.start_time)} - {formatTime(selectedScheduleForEdit.end_time)}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200 rounded-xl overflow-hidden text-sm">
                <thead>
                  <tr className="bg-gray-100 text-gray-600 uppercase text-[11px] tracking-wider">
                    <th className="px-3 py-2 text-left">Field</th>
                    <th className="px-3 py-2 text-left">Original Data</th>
                    <th className="px-3 py-2 text-left">New Data (Leave Blank = Keep Original)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Campus</td>
                    <td className="px-3 py-2 text-gray-700">{schoolNameFromId(selectedScheduleOriginalLocation.schoolId)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editCampusId}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditCampusId(value);
                          setEditBuildingId('');
                          setEditFloorId('');
                          setEditRequestForm(prev => ({ ...prev, new_room_id: '' }));
                        }}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Keep original</option>
                        {editCampusOptions.map((c) => (
                          <option key={c.school_id} value={c.school_id}>{c.school_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Building</td>
                    <td className="px-3 py-2 text-gray-700">{buildingNameFromId(selectedScheduleOriginalLocation.buildingId)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editBuildingId}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditBuildingId(value);
                          setEditFloorId('');
                          setEditRequestForm(prev => ({ ...prev, new_room_id: '' }));
                        }}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        disabled={!editCampusId}
                      >
                        <option value="">{editCampusId ? 'Keep original' : 'Select campus first'}</option>
                        {editBuildingOptions.map((b) => (
                          <option key={b.building_id} value={b.building_id}>{b.building_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Floor</td>
                    <td className="px-3 py-2 text-gray-700">{floorNameFromId(selectedScheduleOriginalLocation.floorId)}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editFloorId}
                        onChange={(e) => {
                          const value = e.target.value;
                          setEditFloorId(value);
                          setEditRequestForm(prev => ({ ...prev, new_room_id: '' }));
                        }}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        disabled={!editBuildingId}
                      >
                        <option value="">{editBuildingId ? 'Keep original' : 'Select building first'}</option>
                        {editFloorOptions.map((f) => (
                          <option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Room</td>
                    <td className="px-3 py-2 text-gray-700">{roomNameFromId(resolveRoomId(selectedScheduleForEdit))}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editRequestForm.new_room_id}
                        onChange={(e) => setEditRequestForm(prev => ({ ...prev, new_room_id: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-500"
                        disabled={!editFloorId}
                      >
                        <option value="">{editFloorId ? 'Keep original' : 'Select floor first'}</option>
                        {editRoomOptions.map((r) => (
                          <option key={r.room_id} value={r.room_id}>{r.room_name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Day</td>
                    <td className="px-3 py-2 text-gray-700 capitalize">{selectedScheduleForEdit.day_of_week}</td>
                    <td className="px-3 py-2">
                      <select
                        value={editRequestForm.new_day_of_week}
                        onChange={(e) => setEditRequestForm(prev => ({ ...prev, new_day_of_week: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">Keep original</option>
                        {dayOptions.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">Start Time</td>
                    <td className="px-3 py-2 text-gray-700">{toHm(selectedScheduleForEdit.start_time)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={editRequestForm.new_start_time}
                        onChange={(e) => setEditRequestForm(prev => ({ ...prev, new_start_time: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold text-gray-700">End Time</td>
                    <td className="px-3 py-2 text-gray-700">{toHm(selectedScheduleForEdit.end_time)}</td>
                    <td className="px-3 py-2">
                      <input
                        type="time"
                        value={editRequestForm.new_end_time}
                        onChange={(e) => setEditRequestForm(prev => ({ ...prev, new_end_time: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Reason for Edit</label>
              <textarea
                value={editRequestForm.reason}
                onChange={(e) => setEditRequestForm(prev => ({ ...prev, reason: e.target.value }))}
                rows={4}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Explain why you are requesting this schedule edit..."
              />
            </div>

            {hasPendingScheduleEdit ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2 font-semibold">
                There is already a pending request for this schedule.
              </div>
            ) : null}

            {editRequestConflict ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2 font-semibold">
                Conflict detected: {editRequestConflict}
              </div>
            ) : null}

            {editRequestError ? (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {editRequestError}
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeScheduleEditRequest}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50"
                disabled={editRequestSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitScheduleEditRequest}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
                disabled={editRequestSubmitting || Boolean(editRequestConflict) || hasPendingScheduleEdit}
              >
                {editRequestSubmitting ? 'Submitting...' : 'Submit Edit Request'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
