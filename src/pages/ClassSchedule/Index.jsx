import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import { apiGet, apiPost, apiPut } from "../../services/api.js";

// Use global SweetAlert (window.Swal) when available, otherwise fallback to alert()
const swalFire = async (optsOrTitle, text, icon) => {
  try {
    if (typeof window !== 'undefined' && window.Swal && typeof window.Swal.fire === 'function') {
      if (typeof optsOrTitle === 'object') return await window.Swal.fire(optsOrTitle);
      return await window.Swal.fire({ title: optsOrTitle, text: text || '', icon: icon || undefined });
    }
    // fallback to alert for environments without Swal
    if (typeof optsOrTitle === 'object') {
      const t = optsOrTitle.title ? optsOrTitle.title + (optsOrTitle.text ? ': ' + optsOrTitle.text : '') : (optsOrTitle.text || '');
      alert(t || JSON.stringify(optsOrTitle));
    } else {
      alert(text ? `${optsOrTitle}: ${text}` : optsOrTitle);
    }
    return Promise.resolve({ isConfirmed: true });
  } catch (e) { return Promise.resolve({ isConfirmed: false }); }
};

const DAY_OPTIONS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

function ClassScheduleIndex(){
  const [schedules,setSchedules] = useState([]);
  const [rooms,setRooms] = useState([]);
  const [teachers,setTeachers] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [showModal,setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [viewingSchedule, setViewingSchedule] = useState(null);
  const [showHistoricalModal, setShowHistoricalModal] = useState(false);
  const [historicalSchedules, setHistoricalSchedules] = useState([]);
  const [historicalFilterSemester, setHistoricalFilterSemester] = useState('');
  const [historicalFilterDept, setHistoricalFilterDept] = useState('');
  const [historicalFilterProgram, setHistoricalFilterProgram] = useState('');
  const [historicalFilterTeacher, setHistoricalFilterTeacher] = useState('');
  const [historicalFilterDay, setHistoricalFilterDay] = useState('');
  const [historicalFilterSubject, setHistoricalFilterSubject] = useState('');
  const [historicalFilterSection, setHistoricalFilterSection] = useState('');
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [form,setForm] = useState({ room_id:'', subject_id:'', section_id:'', user_id:'', semester_id:'', day_of_week:'monday', start_time:'', end_time:'' });
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  
  // States for Table UI Filters
  const [filterRoom, setFilterRoom] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [filterCampus, setFilterCampus] = useState('');
  const [filterBuilding, setFilterBuilding] = useState('');
  const [filterFloor, setFilterFloor] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [filterProgram, setFilterProgram] = useState('');
  const [filterSubject, setFilterSubject] = useState('');
  const [filterSection, setFilterSection] = useState('');
  
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);
  const [importErrors, setImportErrors] = useState([]);
  const [showImportReviewModal, setShowImportReviewModal] = useState(false);
  const [importPreviewRows, setImportPreviewRows] = useState([]);
  const [importPreviewResult, setImportPreviewResult] = useState(null);
  const [importPreviewErrors, setImportPreviewErrors] = useState([]);
  const [submittingReviewedImport, setSubmittingReviewedImport] = useState(false);
  const [livePreviewing, setLivePreviewing] = useState(false);
  const livePreviewRequestRef = useRef(0);
  const fileInputRef = useRef(null);
  const batchDefaultsInitializedRef = useRef(false);

  // Batch modal states
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchForm, setBatchForm] = useState({ isParallel: false, room_id:'', subject_id:'', section_id:'', user_id:'', day_of_week:'monday', start_time:'', end_time:'' });
  const [batchRows, setBatchRows] = useState([]);
  const [editingBatchIndex, setEditingBatchIndex] = useState(null);
  const BATCH_PAGE_SIZE = 10;
  const [batchPage, setBatchPage] = useState(1);

  // Additional lookup lists for filters
  const [departments, setDepartments] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [floors, setFloors] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [sections, setSections] = useState([]);

  // Header filters (fixed at top of batch modal)
  const [headerDept, setHeaderDept] = useState('');
  const [headerProgram, setHeaderProgram] = useState('');
  const [headerBuilding, setHeaderBuilding] = useState('');
  const [headerFloor, setHeaderFloor] = useState('');

  // Edit modal context filters
  const [modalDept, setModalDept] = useState('');
  const [modalProgram, setModalProgram] = useState('');
  const [modalBuilding, setModalBuilding] = useState('');
  const [modalFloor, setModalFloor] = useState('');

  // Authentication & Role Check logic
  const user = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch(e) { return null; } })();
  const isAdmin = Number(user?.role_id) === 1;
  const isDean = [2, 6].includes(Number(user?.role_id));
  const isProgramHead = Number(user?.role_id) === 3;
  const isSecretary = Number(user?.role_id) === 4;
  const canManageSchedules = isAdmin || isDean || isProgramHead;
  const canEdit = canManageSchedules;
  const canUseBulkScheduleTools = isAdmin || isDean;
  const bulkToolsDisabledMessage = 'Batch add and spreadsheet import are temporarily disabled for Program Head accounts.';

  const ensureBulkToolsAllowed = useCallback((showNotice = false) => {
    if (canUseBulkScheduleTools) return true;
    if (showNotice && isProgramHead) {
      swalFire({ icon: 'info', title: 'Temporarily Disabled', text: bulkToolsDisabledMessage });
    }
    return false;
  }, [canUseBulkScheduleTools, isProgramHead]);

  const normalizeStatusValue = (value) => String(value ?? '').trim().toLowerCase();
  const isStatusActive = (value) => {
    const s = normalizeStatusValue(value);
    if (!s) return true;
    return s === 'active' || s === '1' || s === 'true';
  };
  const isEntityActive = (entity) => isStatusActive(entity?.status);

  // Program-head scope for Batch Add: force own department/program context.
  const programHeadProgram = useMemo(() => {
    if (!isProgramHead) return null;
    if (user?.program_id) {
      const byUserProgram = programs.find(p => String(p.program_id) === String(user.program_id));
      if (byUserProgram) return byUserProgram;
    }
    if (user?.user_id) {
      const byHead = programs.find(p => String(p.head_id) === String(user.user_id));
      if (byHead) return byHead;
    }
    return null;
  }, [isProgramHead, programs, user]);

  const programHeadDeptId = useMemo(() => {
    if (!isProgramHead) return '';
    if (user?.dept_id) return String(user.dept_id);
    if (programHeadProgram?.dept_id) return String(programHeadProgram.dept_id);
    return '';
  }, [isProgramHead, user, programHeadProgram]);

  const programHeadProgramId = useMemo(() => {
    if (!isProgramHead) return '';
    if (user?.program_id) return String(user.program_id);
    if (programHeadProgram?.program_id) return String(programHeadProgram.program_id);
    return '';
  }, [isProgramHead, user, programHeadProgram]);

  const deanDeptId = useMemo(() => {
    if (!isDean) return '';
    return user?.dept_id ? String(user.dept_id) : '';
  }, [isDean, user]);

  const fixedScheduleDeptId = useMemo(() => {
    if (isProgramHead) return String(programHeadDeptId || '');
    if (isDean) return String(deanDeptId || '');
    return '';
  }, [isProgramHead, programHeadDeptId, isDean, deanDeptId]);

  const effectiveHeaderDept = (isProgramHead || isDean) ? String(fixedScheduleDeptId || '') : String(headerDept || '');
  const effectiveHeaderProgram = isProgramHead ? String(programHeadProgramId || '') : String(headerProgram || '');

  // helper: format 24h time to 12h AM/PM
  const formatToAmPm = (t) => {
    if (!t) return '';
    const s = String(t).trim();
    const parts = s.split(':');
    if (parts.length < 2) return s;
    let hh = Number(parts[0]);
    const mm = parts[1];
    const ampm = hh >= 12 ? 'PM' : 'AM';
    hh = hh % 12; if (hh === 0) hh = 12;
    return `${hh}:${mm} ${ampm}`;
  };
  const toMinutes = (t) => {
    if (!t) return null;
    const parts = String(t).slice(0,5).split(':');
    if (parts.length < 2) return null;
    return Number(parts[0]) * 60 + Number(parts[1]);
  };
  const overlap = (aStart, aEnd, bStart, bEnd) => !(aEnd <= bStart || aStart >= bEnd);
  const sameTimeRange = (aStart, aEnd, bStart, bEnd) => (
    String(aStart || '').slice(0,5) === String(bStart || '').slice(0,5)
    && String(aEnd || '').slice(0,5) === String(bEnd || '').slice(0,5)
  );
  const parallelSubjectTimeMessage = 'This subject already has an overlapping schedule on the selected day. Parallel classes for the same subject must use the exact same start and end time.';

  // Error message mapping for backend validation errors (professionalized)
  const scheduleErrorMessages = {
    'duplicate_schedule': { title: 'Duplicate Entry', text: 'This exact schedule combination already exists in the system.', icon: 'warning' },
    'time_conflict': { title: 'Room Occupied', text: 'The selected room is already booked for another class during this timeframe.', icon: 'error' },
    'section_conflict': { title: 'Section Schedule Conflict', text: 'This section is already assigned to another class during this timeframe. A section cannot be in two places at once.', icon: 'error' },
    'teacher_conflict': { title: 'Teacher Availability Conflict', text: 'The instructor is already scheduled to teach a different subject during this timeframe.', icon: 'error' },
    'parallel_time_mismatch': { title: 'Parallel Class Time Mismatch', text: 'For parallel classes (same subject, same teacher), start and end times must match the existing session exactly.', icon: 'error' },
    'parallel_subject_time_conflict': { title: 'Parallel Subject Conflict', text: parallelSubjectTimeMessage, icon: 'error' },
    'duplicate_section_subject': { title: 'Duplicate Section-Subject', text: 'This section is already enrolled in this subject today. Each section can only have one session per subject daily.', icon: 'warning' },
    'no_active_semester': { title: 'No Active Semester', text: 'No active semester is available for today. Please activate a semester first.', icon: 'error' },
    'missing_fields': { title: 'Incomplete Form', text: 'All required fields must be filled in before saving.', icon: 'warning' },
    'validation': { title: 'Validation Error', text: 'Please review your input and correct any issues before resubmitting.', icon: 'warning' },
    'forbidden': { title: 'Access Restricted', text: 'You do not have permission to perform this action. Contact your administrator.', icon: 'error' },
    'schedule_not_found': { title: 'Schedule Not Found', text: 'The requested schedule could not be located. It may have been deleted.', icon: 'error' },
    'schedule_in_use': { title: 'Schedule In Use', text: 'This schedule has attendance records or substitutions linked to it. Remove those first before deleting.', icon: 'error' },
  };

  const handleApiError = async (err, customMessage) => {
    const data = err?.response?.data || err?.data || {};
    const errorType = data?.error || '';
    const message = data?.message || customMessage || 'An unexpected error occurred. Please try again.';
    
    const mapped = scheduleErrorMessages[errorType];
    if (mapped) {
      return await swalFire({ icon: mapped.icon, title: mapped.title, text: mapped.text || message });
    }
    return await swalFire({ icon: 'error', title: 'Error', text: message });
  };

  const activeSemester = useMemo(() => {
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

    return semesters.find(s => isActiveStatus(s) && isInDateRange(s))
      || semesters.find(s => isInDateRange(s))
      || semesters.find(s => isActiveStatus(s))
      || null;
  }, [semesters]);
  const activeSemesterId = activeSemester?.semester_id ? Number(activeSemester.semester_id) : null;
  const activeSemesterLabel = useMemo(() => {
    if (!activeSemester) return '';
    const schoolYear = activeSemester.session_name || activeSemester.school_year || activeSemester.school_year_name || '';
    const term = activeSemester.term || activeSemester.semester_name || activeSemester.semester || '';
    const range = activeSemester.start_date && activeSemester.end_date
      ? `${activeSemester.start_date} to ${activeSemester.end_date}`
      : '';
    const title = [schoolYear, term].filter(Boolean).join(' - ');
    return [title, range].filter(Boolean).join(' | ') || 'Current active semester';
  }, [activeSemester]);

  const loadData = useCallback(async () => {
    try { 
      const [s,r,u,sem, deps, progs, blds, fls, subs, secs] = await Promise.all([
        apiGet('class-schedules'),
        apiGet('rooms'),
        apiGet('users'),
        apiGet('semesters'),
        apiGet('departments'),
        apiGet('programs'),
        apiGet('buildings'),
        apiGet('floors'),
        apiGet('subjects'),
        apiGet('sections')
      ]);
      setSchedules(Array.isArray(s)?s:[]);
      setRooms(Array.isArray(r)?r:[]);
      setSemesters(Array.isArray(sem)?sem:[]);
      setDepartments(Array.isArray(deps)?deps:[]);
      setPrograms(Array.isArray(progs)?progs:[]);
      setBuildings(Array.isArray(blds)?blds:[]);
      setFloors(Array.isArray(fls)?fls:[]);
      setSubjects(Array.isArray(subs)?subs:[]);
      setSections(Array.isArray(secs)?secs:[]);
      // All non-admin accounts can be scheduled (teacher, dean, program head, secretary).
      const teachersList = Array.isArray(u) ? u.filter(t => Number(t.role_id) !== 1) : [];
      setTeachers(teachersList);

      // Debug: log fetched lists so we can verify API responses
      console.debug('API load: schedules', Array.isArray(s)?s.length:0, 'rooms', Array.isArray(r)?r.length:0, 'users', Array.isArray(u)?u.length:0);
      console.debug('Lookups: departments', Array.isArray(deps)?deps.length:0, 'programs', Array.isArray(progs)?progs.length:0, 'buildings', Array.isArray(blds)?blds.length:0, 'floors', Array.isArray(fls)?fls.length:0, 'subjects', Array.isArray(subs)?subs.length:0, 'sections', Array.isArray(secs)?secs.length:0);

      const pickFirstActiveId = (list, idKey) => {
        if (!Array.isArray(list)) return '';
        const active = list.find((item) => {
          const s = String(item?.status ?? '').trim().toLowerCase();
          return s === '' || s === 'active' || s === '1' || s === 'true';
        });
        if (active && active[idKey] !== undefined && active[idKey] !== null) return active[idKey];
        return list[0]?.[idKey] ?? '';
      };

      // Initialize batch defaults only once.
      // This prevents "All" selections from being reset on every data refresh.
      if (!batchDefaultsInitializedRef.current) {
        setHeaderDept(h => h || pickFirstActiveId(deps, 'dept_id'));
        setHeaderProgram(h => h || pickFirstActiveId(progs, 'program_id'));
        setHeaderBuilding(h => h || pickFirstActiveId(blds, 'building_id'));
        setHeaderFloor(h => h || pickFirstActiveId(fls, 'floor_id'));
        setBatchForm(prev => ({ ...prev, room_id: prev.room_id || pickFirstActiveId(r, 'room_id') }));
        batchDefaultsInitializedRef.current = true;
      }
    } catch(e) { 
      console.error(e); setError('Failed to load schedules'); 
    } 
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let timer = null;
    let stopped = false;

    const pollSchedules = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      await loadData();
    };

    // HTTPS polling interval (30s) for schedule updates
    timer = setInterval(pollSchedules, 2000);

    const onVisibility = () => { if (!stopped) pollSchedules(); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  }, [loadData]);

  useEffect(() => {
    if (!isProgramHead) return;
    if (programHeadDeptId) setHeaderDept(String(programHeadDeptId));
    if (programHeadProgramId) setHeaderProgram(String(programHeadProgramId));
  }, [isProgramHead, programHeadDeptId, programHeadProgramId]);

  useEffect(() => {
    if (!isDean || !deanDeptId) return;
    setHeaderDept(String(deanDeptId));
  }, [isDean, deanDeptId]);

  // Compute available teachers early so batchTeachers can use it
  const availableTeachers = useMemo(() => {
    let list = teachers;
    if (!isAdmin && user?.dept_id) {
      list = list.filter(t => t.dept_id && String(t.dept_id) === String(user.dept_id));
    }
    return list;
  }, [teachers, isAdmin, user]);

  const activeDepartments = useMemo(
    () => departments.filter(isEntityActive),
    [departments]
  );
  const activePrograms = useMemo(
    () => programs.filter(isEntityActive),
    [programs]
  );
  const activeBuildings = useMemo(
    () => buildings.filter(isEntityActive),
    [buildings]
  );
  const activeFloors = useMemo(
    () => floors.filter(isEntityActive),
    [floors]
  );
  const activeSubjects = useMemo(
    () => subjects.filter(isEntityActive),
    [subjects]
  );
  const activeSections = useMemo(
    () => sections.filter(isEntityActive),
    [sections]
  );
  const activeRooms = useMemo(
    () => rooms.filter(isEntityActive),
    [rooms]
  );
  const activeTeachers = useMemo(
    () => teachers.filter(t => Number(t?.role_id) !== 1 && isEntityActive(t)),
    [teachers]
  );
  const availableActiveTeachers = useMemo(() => {
    let list = activeTeachers;
    if (!isAdmin && user?.dept_id) {
      list = list.filter(t => t.dept_id && String(t.dept_id) === String(user.dept_id));
    }
    return list;
  }, [activeTeachers, isAdmin, user]);

  // Derived lists for header-dependent selects (ensure these exist before JSX uses them)
  const filteredPrograms = useMemo(() => {
    if (isProgramHead) {
      if (!effectiveHeaderProgram) return [];
      return activePrograms.filter(p => String(p.program_id) === String(effectiveHeaderProgram));
    }
    if (!effectiveHeaderDept) return activePrograms;
    return activePrograms.filter(p => String(p.dept_id) === String(effectiveHeaderDept));
  }, [activePrograms, isProgramHead, effectiveHeaderDept, effectiveHeaderProgram]);

  useEffect(() => {
    if (!isDean || isProgramHead) return;
    if (!headerProgram) {
      const firstProgramId = filteredPrograms[0]?.program_id ? String(filteredPrograms[0].program_id) : '';
      if (firstProgramId) setHeaderProgram(firstProgramId);
      return;
    }
    const valid = filteredPrograms.some(p => String(p.program_id) === String(headerProgram));
    if (!valid) {
      setHeaderProgram(filteredPrograms[0]?.program_id ? String(filteredPrograms[0].program_id) : '');
    }
  }, [isDean, isProgramHead, filteredPrograms, headerProgram]);

  const filteredSubjects = useMemo(() => {
    if (isProgramHead && !effectiveHeaderProgram) return [];
    if (!effectiveHeaderProgram) return activeSubjects;
    return activeSubjects.filter(s => String(s.program_id) === String(effectiveHeaderProgram));
  }, [activeSubjects, isProgramHead, effectiveHeaderProgram]);

  const filteredSections = useMemo(() => {
    if (isProgramHead && !effectiveHeaderProgram) return [];
    if (!effectiveHeaderProgram) return activeSections;
    return activeSections.filter(s => String(s.program_id) === String(effectiveHeaderProgram));
  }, [activeSections, isProgramHead, effectiveHeaderProgram]);

  const filteredFloors = useMemo(() => {
    if (!headerBuilding) return activeFloors;
    return activeFloors.filter(f => String(f.building_id) === String(headerBuilding));
  }, [activeFloors, headerBuilding]);

  const filteredRooms = useMemo(() => {
    if (headerFloor) return activeRooms.filter(r => String(r.floor_id) === String(headerFloor));
    if (headerBuilding) return activeRooms.filter(r => String(r.building_id) === String(headerBuilding));
    return activeRooms;
  }, [activeRooms, headerBuilding, headerFloor]);

  const teacherProgramIdsByUser = useMemo(() => {
    const map = new Map();
    schedules.forEach(sch => {
      const teacherId = sch?.teacher_id ?? sch?.user_id;
      const programId = sch?.program_id;
      if (!teacherId || !programId) return;
      const key = String(teacherId);
      const value = String(programId);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    });
    return map;
  }, [schedules]);

  const programDeptIdByProgramId = useMemo(() => {
    const map = new Map();
    programs.forEach((program) => {
      if (program?.program_id === undefined || program?.program_id === null) return;
      if (program?.dept_id === undefined || program?.dept_id === null) return;
      map.set(String(program.program_id), String(program.dept_id));
    });
    return map;
  }, [programs]);

  const activeProgramIdsByDeptId = useMemo(() => {
    const map = new Map();
    activePrograms.forEach((program) => {
      if (program?.program_id === undefined || program?.program_id === null) return;
      if (program?.dept_id === undefined || program?.dept_id === null) return;
      const deptKey = String(program.dept_id);
      if (!map.has(deptKey)) map.set(deptKey, []);
      map.get(deptKey).push(String(program.program_id));
    });
    return map;
  }, [activePrograms]);

  const resolveTeacherProgramId = useCallback((teacher) => {
    if (!teacher) return '';
    const assignedProgramId = teacher.assigned_program_head_id !== undefined && teacher.assigned_program_head_id !== null
      ? String(teacher.assigned_program_head_id)
      : (teacher.assigned_program_id !== undefined && teacher.assigned_program_id !== null ? String(teacher.assigned_program_id) : '');
    if (assignedProgramId) return assignedProgramId;

    const teacherProgramId = teacher.program_id !== undefined && teacher.program_id !== null && String(teacher.program_id) !== ''
      ? String(teacher.program_id)
      : '';
    if (teacherProgramId) return teacherProgramId;

    const roleId = Number(teacher.role_id || 0);
    if (roleId === 3) {
      const headedProgram = activePrograms.find(p => String(p.head_id || '') === String(teacher.user_id || ''));
      if (headedProgram?.program_id !== undefined && headedProgram?.program_id !== null) {
        return String(headedProgram.program_id);
      }
    }

    const deptPrograms = activeProgramIdsByDeptId.get(String(teacher.dept_id || '')) || [];
    if (deptPrograms.length === 1) return String(deptPrograms[0]);

    const knownPrograms = teacherProgramIdsByUser.get(String(teacher.user_id));
    if (knownPrograms && knownPrograms.size > 0) {
      return String(Array.from(knownPrograms)[0] || '');
    }
    return '';
  }, [activePrograms, activeProgramIdsByDeptId, teacherProgramIdsByUser]);

  const teacherMatchesProgram = useCallback((teacher, programId) => {
    if (!programId) return true;
    if (!teacher) return false;
    const roleId = Number(teacher.role_id || 0);
    if (roleId === 1) return false;
    const teacherProgramId = resolveTeacherProgramId(teacher);
    return teacherProgramId !== '' && String(teacherProgramId) === String(programId);
  }, [resolveTeacherProgramId]);

  const getScheduleDeptId = useCallback((schedule) => {
    const directDept = schedule?.dept_id ?? schedule?.teacher_dept_id ?? schedule?.program_dept_id;
    if (directDept !== undefined && directDept !== null && String(directDept) !== '') {
      return String(directDept);
    }
    const programId = schedule?.program_id;
    if (programId !== undefined && programId !== null && String(programId) !== '') {
      return String(programDeptIdByProgramId.get(String(programId)) || '');
    }
    return '';
  }, [programDeptIdByProgramId]);

  // Batch-specific teacher list filtered by department header
  const batchTeachers = useMemo(() => {
    if (isProgramHead) {
      const allowedRoles = new Set([2, 3, 4, 5]); // dean, program head, secretary, teacher
      return availableActiveTeachers.filter(t => {
        const roleId = Number(t.role_id || 0);
        const isSelf = String(t.user_id) === String(user?.user_id || '');
        if (!isSelf && !allowedRoles.has(roleId)) return false;
        if (effectiveHeaderDept && String(t.dept_id || '') !== String(effectiveHeaderDept)) return false;

        // Keep teacher entries aligned to the current program when a program id is available.
        if (roleId === 5 && effectiveHeaderProgram) {
          const assignedProgramId = t.assigned_program_head_id !== undefined && t.assigned_program_head_id !== null
            ? String(t.assigned_program_head_id)
            : (t.assigned_program_id !== undefined && t.assigned_program_id !== null ? String(t.assigned_program_id) : '');
          if (assignedProgramId) return assignedProgramId === String(effectiveHeaderProgram);

          const teacherProgramId = t.program_id !== undefined && t.program_id !== null && String(t.program_id) !== ''
            ? String(t.program_id)
            : '';
          if (teacherProgramId) return teacherProgramId === String(effectiveHeaderProgram);

          const knownPrograms = teacherProgramIdsByUser.get(String(t.user_id));
          if (knownPrograms && knownPrograms.size > 0) {
            return knownPrograms.has(String(effectiveHeaderProgram));
          }
        }
        return true;
      });
    }
    let list = availableActiveTeachers;
    if (headerDept) {
      list = list.filter(t => String(t.dept_id) === String(headerDept));
    }
    if (effectiveHeaderProgram) {
      list = list.filter(t => teacherMatchesProgram(t, effectiveHeaderProgram));
    }
    return list;
  }, [availableActiveTeachers, headerDept, isProgramHead, user, effectiveHeaderDept, effectiveHeaderProgram, teacherProgramIdsByUser, teacherMatchesProgram]);

  // --- STRICT ROLE-BASED VISIBILITY & FILTERING ---
  const roleScopedDeptId = useMemo(() => {
    if (isProgramHead) return String(programHeadDeptId || '');
    if (isDean || isSecretary) return String(user?.dept_id || '');
    return '';
  }, [isProgramHead, programHeadDeptId, isDean, isSecretary, user]);

  const visibleSchedules = useMemo(() => {
    const scopedProgramId = programHeadProgramId ? String(programHeadProgramId) : '';
    return schedules.filter(sch => {
      if (isAdmin) return true;

      if (isProgramHead) {
        if (!scopedProgramId) return false;
        const schProgramId = sch?.program_id ? String(sch.program_id) : '';
        if (!schProgramId || schProgramId !== scopedProgramId) return false;
        return true;
      }

      if (isDean || isSecretary) {
        const schDeptId = getScheduleDeptId(sch);
        if (!roleScopedDeptId) return false;
        if (schDeptId === String(roleScopedDeptId)) return true;
      }

      return false;
    });
  }, [schedules, isAdmin, isProgramHead, isDean, isSecretary, programHeadProgramId, roleScopedDeptId, getScheduleDeptId]);

  const departmentFilterOptions = useMemo(() => {
    if (isAdmin && Array.isArray(departments) && departments.length) {
      return departments
        .filter(d => d?.dept_id !== undefined && d?.dept_id !== null)
        .map(d => ({ id: String(d.dept_id), label: d.dept_name || `Department ${d.dept_id}` }));
    }

    if (roleScopedDeptId) {
      const matchedDept = departments.find(d => String(d.dept_id) === String(roleScopedDeptId));
      if (matchedDept) {
        return [{ id: String(matchedDept.dept_id), label: matchedDept.dept_name || `Department ${matchedDept.dept_id}` }];
      }
      const fallbackLabel = visibleSchedules.find(s => getScheduleDeptId(s) === String(roleScopedDeptId))?.dept_name || `Department ${roleScopedDeptId}`;
      return [{ id: String(roleScopedDeptId), label: fallbackLabel }];
    }

    if (Array.isArray(departments) && departments.length) {
      return departments
        .filter(d => d?.dept_id !== undefined && d?.dept_id !== null)
        .map(d => ({ id: String(d.dept_id), label: d.dept_name || `Department ${d.dept_id}` }));
    }

    const map = new Map();
    visibleSchedules.forEach(s => {
      const id = getScheduleDeptId(s);
      const label = s.dept_name || '';
      if (id) map.set(id, label || `Department ${id}`);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [isAdmin, departments, roleScopedDeptId, visibleSchedules, getScheduleDeptId]);

  const campusFilterOptions = useMemo(() => {
    const map = new Map();
    visibleSchedules.forEach(s => {
      const id = s.campus_id ?? s.school_id ?? s.campus_name;
      const label = s.campus_name;
      if (id !== undefined && id !== null && label) map.set(String(id), label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [visibleSchedules]);

  const buildingFilterOptions = useMemo(() => {
    if (Array.isArray(buildings) && buildings.length) {
      return buildings
        .filter(b => b?.building_id !== undefined && b?.building_id !== null)
        .map(b => ({ id: String(b.building_id), label: b.building_name || `Building ${b.building_id}` }));
    }
    const map = new Map();
    visibleSchedules.forEach(s => {
      const id = s.building_id ?? s.building_name;
      const label = s.building_name;
      if (id !== undefined && id !== null && label) map.set(String(id), label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [buildings, visibleSchedules]);

  const floorFilterOptions = useMemo(() => {
    let list = floors;
    if (filterBuilding) {
      list = list.filter(f => String(f.building_id) === String(filterBuilding));
    }
    if (Array.isArray(list) && list.length) {
      return list
        .filter(f => f?.floor_id !== undefined && f?.floor_id !== null)
        .map(f => ({ id: String(f.floor_id), label: f.floor_name || `Floor ${f.floor_id}` }));
    }
    const map = new Map();
    visibleSchedules.forEach(s => {
      const id = s.floor_id ?? s.floor_name;
      const label = s.floor_name;
      if (id !== undefined && id !== null && label) map.set(String(id), label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [floors, filterBuilding, visibleSchedules]);

  const roomFilterOptions = useMemo(() => {
    let list = rooms;
    if (filterFloor) {
      list = list.filter(r => String(r.floor_id) === String(filterFloor));
    } else if (filterBuilding) {
      list = list.filter(r => String(r.building_id) === String(filterBuilding));
    }
    if (Array.isArray(list) && list.length) {
      return list
        .filter(r => r?.room_id !== undefined && r?.room_id !== null)
        .map(r => ({ id: String(r.room_id), label: r.room_name || `Room ${r.room_id}` }));
    }
    const map = new Map();
    visibleSchedules.forEach(s => {
      const id = s.room_id ?? s.room_name;
      const label = s.room_name;
      if (id !== undefined && id !== null && label) map.set(String(id), label);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [rooms, filterFloor, filterBuilding, visibleSchedules]);

  const programFilterOptions = useMemo(() => {
    let list = programs;

    if (isProgramHead) {
      if (!programHeadProgramId) return [];
      list = list.filter(p => String(p.program_id) === String(programHeadProgramId));
    } else {
      const scopedDept = filterDept || roleScopedDeptId;
      if (scopedDept) {
        list = list.filter(p => String(p.dept_id) === String(scopedDept));
      }
    }

    if (Array.isArray(list) && list.length) {
      return list
        .filter(p => p?.program_id !== undefined && p?.program_id !== null)
        .map(p => ({ id: String(p.program_id), label: p.program_name || `Program ${p.program_id}` }));
    }

    const map = new Map();
    visibleSchedules.forEach(s => {
      if (s.program_id && s.program_name) map.set(String(s.program_id), s.program_name);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [programs, isProgramHead, programHeadProgramId, filterDept, roleScopedDeptId, visibleSchedules]);

  const subjectFilterOptions = useMemo(() => {
    let list = subjects;

    if (isProgramHead) {
      if (!programHeadProgramId) return [];
      list = list.filter(s => String(s.program_id) === String(programHeadProgramId));
    } else if (filterProgram) {
      list = list.filter(s => String(s.program_id) === String(filterProgram));
    } else {
      const scopedDept = filterDept || roleScopedDeptId;
      if (scopedDept) {
        const deptProgramIds = new Set(
          programs
            .filter(p => String(p.dept_id) === String(scopedDept))
            .map(p => String(p.program_id))
        );
        list = list.filter(s => deptProgramIds.has(String(s.program_id)));
      }
    }

    if (Array.isArray(list) && list.length) {
      return list
        .filter(s => s?.subject_id !== undefined && s?.subject_id !== null)
        .map(s => ({
          id: String(s.subject_id),
          label: `${s.subject_code || 'SUBJ'}${s.subject_name ? ` - ${s.subject_name}` : ''}`
        }));
    }

    const map = new Map();
    visibleSchedules.forEach(s => {
      if (s.subject_id && s.subject_code) map.set(String(s.subject_id), `${s.subject_code}${s.subject_name ? ` - ${s.subject_name}` : ''}`);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [subjects, programs, isProgramHead, programHeadProgramId, filterProgram, filterDept, roleScopedDeptId, visibleSchedules]);

  const sectionFilterOptions = useMemo(() => {
    let list = sections;

    if (isProgramHead) {
      if (!programHeadProgramId) return [];
      list = list.filter(s => String(s.program_id) === String(programHeadProgramId));
    } else if (filterProgram) {
      list = list.filter(s => String(s.program_id) === String(filterProgram));
    } else {
      const scopedDept = filterDept || roleScopedDeptId;
      if (scopedDept) {
        const deptProgramIds = new Set(
          programs
            .filter(p => String(p.dept_id) === String(scopedDept))
            .map(p => String(p.program_id))
        );
        list = list.filter(s => deptProgramIds.has(String(s.program_id)));
      }
    }

    if (Array.isArray(list) && list.length) {
      return list
        .filter(s => s?.section_id !== undefined && s?.section_id !== null)
        .map(s => ({ id: String(s.section_id), label: s.section_name || `Section ${s.section_id}` }));
    }

    const map = new Map();
    visibleSchedules.forEach(s => {
      if (s.section_id && s.section_name) map.set(String(s.section_id), s.section_name);
    });
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [sections, programs, isProgramHead, programHeadProgramId, filterProgram, filterDept, roleScopedDeptId, visibleSchedules]);

  useEffect(() => {
    if (!filterDept) return;
    const valid = departmentFilterOptions.some(d => String(d.id) === String(filterDept));
    if (!valid) setFilterDept('');
  }, [filterDept, departmentFilterOptions]);

  useEffect(() => {
    if (!filterProgram) return;
    const valid = programFilterOptions.some(p => String(p.id) === String(filterProgram));
    if (!valid) setFilterProgram('');
  }, [filterProgram, programFilterOptions]);

  useEffect(() => {
    if (!filterSubject) return;
    const valid = subjectFilterOptions.some(s => String(s.id) === String(filterSubject));
    if (!valid) setFilterSubject('');
  }, [filterSubject, subjectFilterOptions]);

  useEffect(() => {
    if (!filterSection) return;
    const valid = sectionFilterOptions.some(s => String(s.id) === String(filterSection));
    if (!valid) setFilterSection('');
  }, [filterSection, sectionFilterOptions]);

  useEffect(() => {
    if (!isProgramHead) return;
    const fixedDept = String(roleScopedDeptId || '');
    const fixedProgram = String(programHeadProgramId || '');
    if (String(filterDept || '') !== fixedDept) {
      setFilterDept(fixedDept);
    }
    if (String(filterProgram || '') !== fixedProgram) {
      setFilterProgram(fixedProgram);
    }
  }, [isProgramHead, roleScopedDeptId, programHeadProgramId, filterDept, filterProgram]);

  const modalPrograms = useMemo(() => {
    if (isProgramHead) {
      if (!programHeadProgramId) return [];
      return programs.filter(p => String(p.program_id) === String(programHeadProgramId));
    }
    if (!modalDept) return programs;
    return programs.filter(p => String(p.dept_id) === String(modalDept));
  }, [programs, modalDept, isProgramHead, programHeadProgramId]);

  const modalSubjects = useMemo(() => {
    const scopedProgram = isProgramHead ? (programHeadProgramId || modalProgram) : modalProgram;
    if (!scopedProgram) return isProgramHead ? [] : subjects;
    return subjects.filter(s => String(s.program_id) === String(scopedProgram));
  }, [subjects, modalProgram, isProgramHead, programHeadProgramId]);

  const modalSections = useMemo(() => {
    const scopedProgram = isProgramHead ? (programHeadProgramId || modalProgram) : modalProgram;
    if (!scopedProgram) return isProgramHead ? [] : sections;
    return sections.filter(s => String(s.program_id) === String(scopedProgram));
  }, [sections, modalProgram, isProgramHead, programHeadProgramId]);

  const modalTeachers = useMemo(() => {
    let list = availableTeachers;
    if (modalDept) {
      list = list.filter(t => String(t.dept_id) === String(modalDept));
    }
    const scopedProgram = isProgramHead ? (programHeadProgramId || modalProgram) : modalProgram;
    if (scopedProgram) {
      list = list.filter(t => teacherMatchesProgram(t, scopedProgram));
    }
    if (isProgramHead) {
      if (!scopedProgram) return [];
      const allowedRoles = new Set([2, 3, 4, 5]);
      list = list.filter(t => {
        const roleId = Number(t.role_id || 0);
        const isSelf = String(t.user_id) === String(user?.user_id || '');
        return isSelf || allowedRoles.has(roleId);
      });
    }
    return list;
  }, [availableTeachers, modalDept, isProgramHead, programHeadProgramId, modalProgram, teacherMatchesProgram, user]);

  const modalProgramTeacherCountText = useMemo(() => {
    if (!modalProgram) return '';
    const program = programs.find(p => String(p.program_id) === String(modalProgram));
    const programName = program?.program_name || 'selected program';
    return modalTeachers.length
      ? `${modalTeachers.length} instructor(s) available for ${programName}.`
      : `No active instructors assigned to ${programName}.`;
  }, [modalProgram, modalTeachers.length, programs]);

  const batchProgramTeacherCountText = useMemo(() => {
    if (!effectiveHeaderProgram) return '';
    const program = programs.find(p => String(p.program_id) === String(effectiveHeaderProgram));
    const programName = program?.program_name || 'selected program';
    return batchTeachers.length
      ? `${batchTeachers.length} instructor(s) available for ${programName}.`
      : `No active instructors assigned to ${programName}.`;
  }, [effectiveHeaderProgram, batchTeachers.length, programs]);

  const modalFloors = useMemo(() => {
    if (!modalBuilding) return floors;
    return floors.filter(f => String(f.building_id) === String(modalBuilding));
  }, [floors, modalBuilding]);

  const modalRooms = useMemo(() => {
    if (modalFloor) return rooms.filter(r => String(r.floor_id) === String(modalFloor));
    if (modalBuilding) return rooms.filter(r => String(r.building_id) === String(modalBuilding));
    return rooms;
  }, [rooms, modalBuilding, modalFloor]);

  useEffect(() => {
    const valid = modalPrograms.some(p => String(p.program_id) === String(modalProgram));
    if (valid) return;
    setModalProgram(modalPrograms[0]?.program_id ? String(modalPrograms[0].program_id) : '');
  }, [modalPrograms, modalProgram]);

  useEffect(() => {
    setForm(prev => {
      if (!prev.subject_id) {
        const first = modalSubjects[0]?.subject_id ? String(modalSubjects[0].subject_id) : '';
        return first ? { ...prev, subject_id: first } : prev;
      }
      const valid = modalSubjects.some(s => String(s.subject_id) === String(prev.subject_id));
      if (valid) return prev;
      return { ...prev, subject_id: modalSubjects[0]?.subject_id ? String(modalSubjects[0].subject_id) : '' };
    });
  }, [modalSubjects]);

  useEffect(() => {
    setForm(prev => {
      if (!prev.section_id) {
        const first = modalSections[0]?.section_id ? String(modalSections[0].section_id) : '';
        return first ? { ...prev, section_id: first } : prev;
      }
      const valid = modalSections.some(s => String(s.section_id) === String(prev.section_id));
      if (valid) return prev;
      return { ...prev, section_id: modalSections[0]?.section_id ? String(modalSections[0].section_id) : '' };
    });
  }, [modalSections]);

  useEffect(() => {
    setForm(prev => {
      if (!prev.user_id) {
        const first = modalTeachers[0]?.user_id ? String(modalTeachers[0].user_id) : '';
        return first ? { ...prev, user_id: first } : prev;
      }
      const valid = modalTeachers.some(t => String(t.user_id) === String(prev.user_id));
      if (valid) return prev;
      return { ...prev, user_id: modalTeachers[0]?.user_id ? String(modalTeachers[0].user_id) : '' };
    });
  }, [modalTeachers]);

  useEffect(() => {
    const valid = modalFloors.some(f => String(f.floor_id) === String(modalFloor));
    if (valid) return;
    setModalFloor(modalFloors[0]?.floor_id ? String(modalFloors[0].floor_id) : '');
  }, [modalFloors, modalFloor]);

  useEffect(() => {
    setForm(prev => {
      if (!prev.room_id) {
        const first = modalRooms[0]?.room_id ? String(modalRooms[0].room_id) : '';
        return first ? { ...prev, room_id: first } : prev;
      }
      const valid = modalRooms.some(r => String(r.room_id) === String(prev.room_id));
      if (valid) return prev;
      return { ...prev, room_id: modalRooms[0]?.room_id ? String(modalRooms[0].room_id) : '' };
    });
  }, [modalRooms]);

  const displayedAndFiltered = useMemo(() => {
    return visibleSchedules.filter(sch => {
      // Filter by active semester — only current semester schedules shown in main table
      if (activeSemesterId && Number(sch.semester_id) !== Number(activeSemesterId)) return false;
      if (filterDept) {
        const deptVal = getScheduleDeptId(sch);
        if (String(deptVal) !== String(filterDept)) return false;
      }
      if (filterCampus) {
        const campusVal = sch.campus_id ?? sch.school_id ?? sch.campus_name;
        if (String(campusVal) !== String(filterCampus)) return false;
      }
      if (filterBuilding) {
        const buildingVal = sch.building_id ?? sch.building_name;
        if (String(buildingVal) !== String(filterBuilding)) return false;
      }
      if (filterFloor) {
        const floorVal = sch.floor_id ?? sch.floor_name;
        if (String(floorVal) !== String(filterFloor)) return false;
      }
      if (filterProgram && String(sch.program_id) !== String(filterProgram)) return false;
      if (filterSubject && String(sch.subject_id) !== String(filterSubject)) return false;
      if (filterSection && String(sch.section_id) !== String(filterSection)) return false;
      if (filterRoom && String(sch.room_id) !== String(filterRoom)) return false;
      const schTeacherId = sch.teacher_id ?? sch.user_id;
      if (filterTeacher && String(schTeacherId) !== String(filterTeacher)) return false;
      if (filterDay && String(sch.day_of_week || '').toLowerCase() !== String(filterDay).toLowerCase()) return false;
      return true;
    });
  }, [visibleSchedules, activeSemesterId, filterDept, getScheduleDeptId, filterCampus, filterBuilding, filterFloor, filterProgram, filterSubject, filterSection, filterRoom, filterTeacher, filterDay]);
  const displayData = useMemo(() => {
    return displayedAndFiltered.map((sch, i) => ({
      ...sch,
      id: sch.schedule_id || `sch-${i}`, 
      display_index: i + 1
    }));
  }, [displayedAndFiltered]);

  const checkProgramHeadPermission = (schedule) => {
    if (isAdmin) return true;
    if (isProgramHead) {
      const scopedProgramId = programHeadProgramId ? String(programHeadProgramId) : '';
      if (!scopedProgramId) {
        swalFire('Unauthorized', 'Your account has no assigned program. Please contact the administrator.', 'error');
        return false;
      }
      const schProgramId = schedule?.program_id ? String(schedule.program_id) : '';
      if (!schProgramId || schProgramId !== scopedProgramId) {
        swalFire('Unauthorized', 'You can only modify schedules assigned to your specific program.', 'error');
        return false;
      }
    }
    return true;
  };

  const openModal = async (schedule=null) => {
    setError('');
    
    if (schedule) {
      if (!checkProgramHeadPermission(schedule)) return;
      const matchedSubject = subjects.find(s => String(s.subject_id) === String(schedule.subject_id));
      const programId = isProgramHead
        ? (programHeadProgramId || schedule.program_id || matchedSubject?.program_id || '')
        : (schedule.program_id || matchedSubject?.program_id || '');
      const matchedProgram = programs.find(p => String(p.program_id) === String(programId));
      const deptId = isProgramHead
        ? (programHeadDeptId || schedule.dept_id || matchedProgram?.dept_id || schedule.teacher_dept_id || '')
        : (schedule.dept_id || matchedProgram?.dept_id || schedule.teacher_dept_id || '');
      const matchedRoom = rooms.find(r => String(r.room_id) === String(schedule.room_id));
      const buildingId = schedule.building_id || matchedRoom?.building_id || '';
      const floorId = schedule.floor_id || matchedRoom?.floor_id || '';
      
      setEditingSchedule(schedule);
      setModalDept(deptId ? String(deptId) : '');
      setModalProgram(programId ? String(programId) : '');
      setModalBuilding(buildingId ? String(buildingId) : '');
      setModalFloor(floorId ? String(floorId) : '');
      setForm({
        room_id: schedule.room_id ? String(schedule.room_id) : '',
        subject_id: schedule.subject_id ? String(schedule.subject_id) : '',
        section_id: schedule.section_id ? String(schedule.section_id) : '',
        user_id: (schedule.teacher_id || schedule.user_id) ? String(schedule.teacher_id || schedule.user_id) : '',
        semester_id: schedule.semester_id || activeSemesterId || '',
        day_of_week: schedule.day_of_week || 'monday',
        start_time: schedule.start_time ? String(schedule.start_time).slice(0,5) : '',
        end_time: schedule.end_time ? String(schedule.end_time).slice(0,5) : ''
      });
    } else {
      if (isProgramHead && !programHeadProgramId) {
        swalFire('Unauthorized', 'Your account has no assigned program. Please contact the administrator.', 'error');
        return;
      }
      const defaultDept = isProgramHead
        ? (programHeadDeptId || user?.dept_id || departments[0]?.dept_id || '')
        : (user?.dept_id || departments[0]?.dept_id || '');
      const deptPrograms = programs.filter(p => !defaultDept || String(p.dept_id) === String(defaultDept));
      const defaultProgram = isProgramHead
        ? (programHeadProgramId || deptPrograms[0]?.program_id || '')
        : (deptPrograms[0]?.program_id || programs[0]?.program_id || '');
      const programSubjects = subjects.filter(s => !defaultProgram || String(s.program_id) === String(defaultProgram));
      const programSections = sections.filter(s => !defaultProgram || String(s.program_id) === String(defaultProgram));
      const deptTeachers = availableTeachers.filter(t => !defaultDept || String(t.dept_id) === String(defaultDept));
      const defaultBuilding = buildings[0]?.building_id || '';
      const buildingFloors = floors.filter(f => !defaultBuilding || String(f.building_id) === String(defaultBuilding));
      const defaultFloor = buildingFloors[0]?.floor_id || floors[0]?.floor_id || '';
      const scopedRooms = rooms.filter(r => !defaultFloor || String(r.floor_id) === String(defaultFloor));

      setEditingSchedule(null);
      setModalDept(defaultDept ? String(defaultDept) : '');
      setModalProgram(defaultProgram ? String(defaultProgram) : '');
      setModalBuilding(defaultBuilding ? String(defaultBuilding) : '');
      setModalFloor(defaultFloor ? String(defaultFloor) : '');
      setForm({
        room_id: scopedRooms[0]?.room_id ? String(scopedRooms[0].room_id) : (rooms[0]?.room_id ? String(rooms[0].room_id) : ''),
        subject_id: programSubjects[0]?.subject_id ? String(programSubjects[0].subject_id) : (subjects[0]?.subject_id ? String(subjects[0].subject_id) : ''),
        section_id: programSections[0]?.section_id ? String(programSections[0].section_id) : (sections[0]?.section_id ? String(sections[0].section_id) : ''),
        user_id: deptTeachers[0]?.user_id ? String(deptTeachers[0].user_id) : (availableTeachers[0]?.user_id ? String(availableTeachers[0].user_id) : ''),
        semester_id: activeSemesterId || '',
        day_of_week:'monday',
        start_time:'',
        end_time:''
      });
    }
    setShowModal(true);
  };
  
  const closeModal=()=>{ setShowModal(false); setEditingSchedule(null); };
  const openViewModal = (schedule) => { setViewingSchedule(schedule || null); setShowViewModal(true); };
  const closeViewModal = () => { setShowViewModal(false); setViewingSchedule(null); };

  // Historical schedules modal
  const openHistoricalModal = async () => {
    setHistoricalLoading(true);
    setHistoricalSchedules([]);
    // Default to active semester filter
    setHistoricalFilterSemester(activeSemesterId ? String(activeSemesterId) : '');
    setHistoricalFilterDept(isProgramHead ? String(programHeadDeptId || '') : (isDean ? String(deanDeptId || '') : ''));
    setHistoricalFilterProgram(isProgramHead ? String(programHeadProgramId || '') : '');
    setHistoricalFilterTeacher('');
    setHistoricalFilterDay('');
    setHistoricalFilterSubject('');
    setHistoricalFilterSection('');
    setShowHistoricalModal(true);
    setHistoricalLoading(false);
  };
  const closeHistoricalModal = () => {
    setShowHistoricalModal(false);
    setHistoricalSchedules([]);
  };

  // Derived historical schedules - all schedules from all semesters (for role-scoped visibility)
  const historicalProgramOptions = useMemo(() => {
    if (isProgramHead) {
      return programs.filter(p => String(p.program_id) === String(programHeadProgramId));
    }
    return programs;
  }, [programs, isProgramHead, programHeadProgramId]);
  const historicalSemesterOptions = useMemo(() => {
    return semesters.map(s => ({ id: String(s.semester_id), label: `${s.session_name || s.school_year || ''} ${s.term || s.semester_name || ''}`.trim() || `Semester ${s.semester_id}` }));
  }, [semesters]);

  // Visible schedules including historical ones (all semesters, filtered by role scope)
  const allVisibleSchedules = useMemo(() => {
    return visibleSchedules; // Already includes schedules from all semesters via role-scoped visibility
  }, [visibleSchedules]);

  // Apply historical filter to get filtered historical schedules
  const historicalFilteredSchedules = useMemo(() => {
    let list = allVisibleSchedules;
    if (historicalFilterSemester) {
      list = list.filter(sch => Number(sch.semester_id) === Number(historicalFilterSemester));
    }
    if (historicalFilterDept) {
      list = list.filter(sch => {
        const deptVal = getScheduleDeptId(sch);
        return String(deptVal) === String(historicalFilterDept);
      });
    }
    if (historicalFilterProgram) {
      list = list.filter(sch => String(sch.program_id) === String(historicalFilterProgram));
    }
    if (historicalFilterTeacher) {
      list = list.filter(sch => {
        const tId = sch.teacher_id ?? sch.user_id;
        return String(tId) === String(historicalFilterTeacher);
      });
    }
    if (historicalFilterDay) {
      list = list.filter(sch => String(sch.day_of_week || '').toLowerCase() === String(historicalFilterDay).toLowerCase());
    }
    if (historicalFilterSubject) {
      list = list.filter(sch => String(sch.subject_id) === String(historicalFilterSubject));
    }
    if (historicalFilterSection) {
      list = list.filter(sch => String(sch.section_id) === String(historicalFilterSection));
    }
    return list.map((sch, i) => ({
      ...sch,
      id: sch.schedule_id || `hsch-${i}`,
      display_index: i + 1
    }));
  }, [allVisibleSchedules, historicalFilterSemester, historicalFilterDept, historicalFilterProgram, historicalFilterTeacher, historicalFilterDay, historicalFilterSubject, historicalFilterSection, getScheduleDeptId]);

  const handleChange=(e)=> {
    const { name, value } = e.target;
    setForm(p=> ({ ...p, [name]: value }));
  };
  const handleModalDeptChange = (e) => setModalDept(e.target.value);
  const handleModalProgramChange = (e) => setModalProgram(e.target.value);
  const handleModalBuildingChange = (e) => setModalBuilding(e.target.value);
  const handleModalFloorChange = (e) => setModalFloor(e.target.value);

  const runWithFallback = async (primary, fallback) => {
    try {
      return await primary();
    } catch (err) {
      if (err?.status === 405 || err?.status === 500) {
        return await fallback();
      }
      throw err;
    }
  };

  const handleSubmit=async(e)=>{
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const resolvedSemesterId = editingSchedule
      ? Number(form.semester_id || activeSemesterId)
      : Number(activeSemesterId);

    if (!resolvedSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'No active semester is available for the current date.' });
      setLoading(false);
      return;
    }

    const payload = {
      room_id: Number(form.room_id),
      subject_id: Number(form.subject_id),
      section_id: Number(form.section_id),
      user_id: Number(form.user_id),
      semester_id: resolvedSemesterId,
      day_of_week: form.day_of_week.toLowerCase(),
      start_time: form.start_time,
      end_time: form.end_time
    };

    // Extract extra details for deeper conflict validation
    const selectedSectionId = payload.section_id || null;
    const selectedSubjectId = payload.subject_id || null;

    if (!payload.room_id || !payload.subject_id || !payload.section_id || !payload.user_id || !payload.day_of_week || !payload.start_time || !payload.end_time) {
      swalFire({ icon:'warning', title:'Validation Error', text:'Please fill all required fields.' });
      setLoading(false); return;
    }
    if (String(payload.start_time) >= String(payload.end_time)) {
      swalFire({ icon:'warning', title:'Validation Error', text:'Start time must be before end time.' });
      setLoading(false); return;
    }
    const programScopeIssues = getProgramScopeIssues(payload);
    if (programScopeIssues.length > 0) {
      swalFire({ icon:'warning', title:'Program Scope Validation', text: programScopeIssues.join(' ') });
      setLoading(false); return;
    }

    const sStart = toMinutes(payload.start_time);
    const sEnd = toMinutes(payload.end_time);

    // Deep Client-Side Validation against existing schedules
    for (const sch of schedules) {
      if (!sch) continue;
      // Skip comparing against itself when editing
      if (editingSchedule && Number(sch.schedule_id) === Number(editingSchedule.schedule_id)) continue; 
      const schSemesterId = Number(sch.semester_id || 0);
      if (payload.semester_id && schSemesterId && schSemesterId !== Number(payload.semester_id)) continue;
      // Only compare schedules on the same day
      if (String(sch.day_of_week).toLowerCase() !== String(payload.day_of_week)) continue;
      
      const schStart = toMinutes(String(sch.start_time).slice(0,5));
      const schEnd = toMinutes(String(sch.end_time).slice(0,5));
      if (schStart === null || schEnd === null) continue;

      // Exact match check
      if (Number(sch.room_id) === payload.room_id
          && Number(sch.subject_id) === payload.subject_id
          && Number(sch.section_id) === payload.section_id
          && Number(sch.teacher_id ?? sch.user_id) === payload.user_id
          && Number(sch.semester_id) === payload.semester_id
          && String(sch.start_time).slice(0,5) === payload.start_time && String(sch.end_time).slice(0,5) === payload.end_time) {
        swalFire({ icon:'warning', title:'Duplicate', text:'This exact schedule already exists.' });
        setLoading(false); return;
      }

      // Block duplicate section+subject assignments on the same day.
      const sameSectionSameSubject = selectedSectionId
        && selectedSubjectId
        && Number(sch.section_id) === selectedSectionId
        && Number(sch.subject_id) === selectedSubjectId;
      if (sameSectionSameSubject) {
        swalFire({ icon:'error', title:'Scheduling Conflict', text:'This section is already enrolled in this subject today. Each section can only have one session per subject daily.' });
        setLoading(false); return;
      }

      // Time Overlap Check
      if (overlap(sStart, sEnd, schStart, schEnd)) {
        const sameSubject = selectedSubjectId && Number(sch.subject_id) === selectedSubjectId;
        const exactParallelTime = sameTimeRange(sch.start_time, sch.end_time, payload.start_time, payload.end_time);
        if (sameSubject && !exactParallelTime) {
          swalFire({ icon:'warning', title:'Parallel Class Mismatch', text:'For parallel classes (same subject, same teacher), start and end times must be identical to the original session.' });
          setLoading(false); return;
        }

        // 1. Room Conflict: block for any overlap on the same room
        if (Number(sch.room_id) === payload.room_id) {
          swalFire({ icon:'error', title:'Room Conflict', text:`Room ${sch.room_name} already has a class during this time.` });
          setLoading(false); return;
        }
      }
    }

    try{
      if (editingSchedule) {
        await runWithFallback(
          () => apiPut(`class-schedules/${editingSchedule.schedule_id}`, payload),
          () => apiPost(`class-schedules/${editingSchedule.schedule_id}/update`, payload)
        );
      } else {
        await apiPost('class-schedules', payload);
      }
      const s = await apiGet('class-schedules');
      setSchedules(Array.isArray(s)?s:[]);
      closeModal();
      swalFire({ icon:'success', title: editingSchedule ? 'Schedule updated' : 'Schedule created', timer: 1500, showConfirmButton: false });
    }catch(err){
      console.error(err);
      await handleApiError(err, 'Failed to save schedule.');
    } finally{ setLoading(false); }
  };

  const getFileArrayBuffer = (file) => {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  const parseSpreadsheet = async (file) => {
    if (!window.XLSX) throw new Error('Spreadsheet parser is not available. Please reload the page.');
    const buffer = await getFileArrayBuffer(file);
    const workbook = window.XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) return [];
    const worksheet = workbook.Sheets[sheetName];
    const rows = window.XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
    return Array.isArray(rows) ? rows : [];
  };

  const normalizeImportHeader = (key) => {
    const normalized = String(key ?? '').trim().toLowerCase();
    return normalized.replace(/[^a-z0-9]+/g, '_');
  };

  const normalizeImportRow = (row) => {
    const normalized = {};
    if (!row || typeof row !== 'object') return normalized;
    Object.entries(row).forEach(([key, value]) => {
      const normalizedKey = normalizeImportHeader(key);
      if (!normalizedKey) return;
      normalized[normalizedKey] = value;
    });
    return normalized;
  };

  const getImportCell = (normalizedRow, keys) => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(normalizedRow, key)) continue;
      const value = normalizedRow[key];
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text !== '') return text;
    }
    return '';
  };

  const mapImportRowsToDraft = (rows) => (
    (rows || []).map((row, idx) => {
      const normalized = normalizeImportRow(row);
      return {
        _row: idx + 1,
        room: getImportCell(normalized, ['room_name', 'room', 'room_no', 'room_number', 'room_id', 'roomid']),
        subject: getImportCell(normalized, ['subject_code', 'subject', 'subject_name', 'subject_id', 'subjectid']),
        section: getImportCell(normalized, ['section_name', 'section', 'sectionname', 'section_id', 'sectionid']),
        teacher: getImportCell(normalized, ['teacher', 'teacher_email', 'teacher_id', 'user_id']),
        teacher_name: getImportCell(normalized, ['teacher_name', 'teachername', 'name']),
        day_of_week: getImportCell(normalized, ['day_of_week', 'day', 'weekday', 'dow']).toLowerCase(),
        start_time: getImportCell(normalized, ['start_time', 'start', 'time_start', 'from']),
        end_time: getImportCell(normalized, ['end_time', 'end', 'time_end', 'to']),
      };
    })
  );

  const buildScheduleImportPayloadRows = (rows) => (
    (rows || []).map((row) => ({
      room: String(row?.room || '').trim(),
      subject: String(row?.subject || '').trim(),
      section: String(row?.section || '').trim(),
      teacher: String(row?.teacher || '').trim(),
      teacher_name: String(row?.teacher_name || '').trim(),
      day_of_week: String(row?.day_of_week || '').trim().toLowerCase(),
      start_time: String(row?.start_time || '').trim(),
      end_time: String(row?.end_time || '').trim(),
    }))
  );

  const runScheduleImportPreview = async (draftRows) => {
    const payloadRows = buildScheduleImportPayloadRows(draftRows);
    const preview = await apiPost('class-schedules', { rows: payloadRows, preview: true });
    const errs = Array.isArray(preview?.errors) ? preview.errors : [];
    setImportPreviewResult({
      inserted: Number(preview?.inserted || 0),
      skipped: Number(preview?.skipped || 0),
      total: payloadRows.length,
    });
    setImportPreviewErrors(errs);
    return { preview, errors: errs, payloadRows };
  };

  const handleImportDraftCellChange = (rowIndex, field, value) => {
    setImportPreviewRows((prev) => prev.map((row, idx) => {
      if (idx !== rowIndex) return row;
      const nextValue = field === 'day_of_week' ? String(value || '').toLowerCase() : value;
      return { ...row, [field]: nextValue };
    }));
  };

  const inferImportIssueFields = (issues) => {
    const fields = new Set();
    (issues || []).forEach((issueRaw) => {
      const issue = String(issueRaw || '').toLowerCase();
      if (!issue) return;
      if (issue.includes('room')) fields.add('room');
      if (issue.includes('subject')) fields.add('subject');
      if (issue.includes('section')) fields.add('section');
      if (issue.includes('teacher') || issue.includes('instructor')) {
        fields.add('teacher');
        fields.add('teacher_name');
      }
      if (issue.includes('day_of_week') || issue.includes('day') || issue.includes('weekday')) fields.add('day_of_week');
      if (issue.includes('start_time') || issue.includes('start time')) fields.add('start_time');
      if (issue.includes('end_time') || issue.includes('end time')) fields.add('end_time');
      if (issue.includes('required')) {
        if (issue.includes('day_of_week, start_time, and end_time')) {
          fields.add('day_of_week');
          fields.add('start_time');
          fields.add('end_time');
        }
      }
      if (issue.includes('start_time must be before end_time')) {
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('subject-time conflict')) {
        fields.add('subject');
        fields.add('teacher');
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('parallel classes for the same subject') || issue.includes('parallel time conflict')) {
        fields.add('subject');
        fields.add('day_of_week');
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('duplicate schedule already exists')) {
        fields.add('room');
        fields.add('subject');
        fields.add('section');
        fields.add('teacher');
        fields.add('day_of_week');
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('program mismatch')) {
        fields.add('subject');
        fields.add('section');
        fields.add('teacher');
      }
      if (issue.includes('must belong to the same program')) {
        fields.add('subject');
        fields.add('section');
        fields.add('teacher');
      }
      if (issue.includes('another teacher already uses this room during this time') || issue.includes('room already has a class during this time')) {
        fields.add('room');
        fields.add('day_of_week');
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('section has another class at this time') || issue.includes('section already has a class at this time')) {
        fields.add('section');
        fields.add('day_of_week');
        fields.add('start_time');
        fields.add('end_time');
      }
      if (issue.includes('duplicate not allowed: this section already has this subject on the selected day')) {
        fields.add('section');
        fields.add('subject');
        fields.add('day_of_week');
      }
    });
    return fields;
  };

  // Client-side import validation: check required fields, name format, and teacher existence
  const localImportErrors = useMemo(() => {
    const errors = {};
    importPreviewRows.forEach((row, idx) => {
      const rowNumber = row._row || (idx + 1);
      const rowErrors = [];

      // TEACHER NAME IS ALWAYS REQUIRED.
      // Even if a Gmail/email is provided, the full name must be filled in.
      const hasTeacherName = (row.teacher_name || '').trim() !== '';
      const hasTeacherEmail = (row.teacher || '').trim() !== '';

      // Teacher name is mandatory — no exceptions
      if (!hasTeacherName) {
        rowErrors.push('Teacher Name is required. Enter the full name (first and last name).');
      }

      // Validate teacher name if provided
      if (hasTeacherName) {
        const teacherName = (row.teacher_name || '').trim();
        const nameParts = teacherName.split(/\s+/);
        
        // Must have at least first + last name (minimum 2 parts)
        if (nameParts.length < 2) {
          rowErrors.push('Teacher name must include both first and last name (e.g. "Jessie James Parajes")');
        }

        // Check if teacher exists in database by matching first_name + last_name (case-insensitive)
        // Normalize: lowercase, collapse multiple spaces, trim
        const nameLower = teacherName.toLowerCase().replace(/\s+/g, ' ').trim();
        const foundTeacher = teachers.some(t => {
          const dbName = ((t.first_name || '') + ' ' + (t.last_name || '')).toLowerCase().replace(/\s+/g, ' ').trim();
          return dbName === nameLower;
        });

        if (!foundTeacher) {
          rowErrors.push('Teacher name does not match any registered instructor. Check spelling and ensure first + last name format (e.g. "Jessie James Parajes")');
        }
      }

      // Email validation is secondary/helper — it does NOT replace the need for a name
      if (hasTeacherEmail) {
        const teacherEmail = (row.teacher || '').trim();
        const emailLower = teacherEmail.toLowerCase().trim();
        const foundByEmail = teachers.some(t => 
          (t.email || '').toLowerCase().trim() === emailLower
        );
        if (!foundByEmail && !hasTeacherName) {
          rowErrors.push('Teacher email does not match any registered instructor');
        }
        if (!foundByEmail && hasTeacherName) {
          rowErrors.push('Warning: Teacher email not found in system. The system will use the name for lookup instead.');
        }
      }

      // If only email was provided but no name, we already flagged the missing name above
      // so no additional block needed here — the email can serve as supplementary lookup

      if (rowErrors.length > 0) {
        errors[rowNumber] = (errors[rowNumber] || []).concat(rowErrors);
      }
    });
    return errors;
  }, [importPreviewRows, teachers]);

  const previewErrorsByRow = useMemo(() => {
    const result = {};
    // Start with local validation errors
    Object.keys(localImportErrors).forEach(rowNum => {
      result[rowNum] = [...localImportErrors[rowNum]];
    });
    // Merge with backend validation errors
    importPreviewErrors.forEach((err, idx) => {
      const rowNumber = Number(err?.row || 0);
      if (!rowNumber) return;
      const message = err?.message || err?.error || `Invalid row #${idx + 1}`;
      if (!result[rowNumber]) result[rowNumber] = [];
      if (!result[rowNumber].includes(message)) {
        result[rowNumber].push(message);
      }
    });
    return result;
  }, [importPreviewErrors, localImportErrors]);

  const handleValidateImportDraft = async () => {
    if (!ensureBulkToolsAllowed(true)) return;
    if (!importPreviewRows.length) return;
    if (hasSchedulingDependencyBlockers) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Import validation is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
      });
      return;
    }
    if (!activeSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'Cannot validate because there is no active semester for today.' });
      return;
    }
    setSubmittingReviewedImport(true);
    try {
      await runScheduleImportPreview(importPreviewRows);
    } catch (err) {
      console.error(err);
      swalFire({ icon:'error', title:'Validation Failed', text: err.body?.error || err.message || 'Failed to validate reviewed rows' });
    } finally {
      setSubmittingReviewedImport(false);
    }
  };

  useEffect(() => {
    if (!showImportReviewModal || !activeSemesterId || !importPreviewRows.length) return;
    if (submittingReviewedImport) return;

    const timer = setTimeout(async () => {
      const requestId = livePreviewRequestRef.current + 1;
      livePreviewRequestRef.current = requestId;
      setLivePreviewing(true);
      try {
        const payloadRows = buildScheduleImportPayloadRows(importPreviewRows);
        const preview = await apiPost('class-schedules', { rows: payloadRows, preview: true });
        if (requestId !== livePreviewRequestRef.current) return;
        setImportPreviewResult({
          inserted: Number(preview?.inserted || 0),
          skipped: Number(preview?.skipped || 0),
          total: payloadRows.length,
        });
        setImportPreviewErrors(Array.isArray(preview?.errors) ? preview.errors : []);
      } catch (err) {
        if (requestId !== livePreviewRequestRef.current) return;
        console.error('Live preview validation failed', err);
      } finally {
        if (requestId === livePreviewRequestRef.current) {
          setLivePreviewing(false);
        }
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [showImportReviewModal, activeSemesterId, importPreviewRows, submittingReviewedImport]);

  const handleImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ensureBulkToolsAllowed(true)) {
      if (e.target) e.target.value = '';
      return;
    }
    if (hasSchedulingDependencyBlockers) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Import is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
      });
      if (e.target) e.target.value = '';
      return;
    }
    if (isProgramHead && !programHeadProgramId) {
      swalFire({ icon:'error', title:'Unauthorized', text:'Your account has no assigned program. Please contact the administrator.' });
      if (e.target) e.target.value = '';
      return;
    }
    if (!activeSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'Cannot import because there is no active semester for today.' });
      if (e.target) e.target.value = '';
      return;
    }
    setImporting(true);
    setImportSummary(null);
    setImportErrors([]);
    setImportPreviewRows([]);
    setImportPreviewResult(null);
    setImportPreviewErrors([]);
    setError('');
    try {
      const rows = await parseSpreadsheet(file);
      const cleaned = rows.filter(r => Object.values(r || {}).some(v => String(v ?? '').trim() !== ''));
      if (!cleaned.length) {
        swalFire({ icon:'warning', title:'Empty File', text: 'No data rows found in the spreadsheet.' });
        return;
      }
      const draftRows = mapImportRowsToDraft(cleaned);
      setImportPreviewRows(draftRows);
      await runScheduleImportPreview(draftRows);
      setShowImportReviewModal(true);
    } catch (err) {
      console.error(err);
      swalFire({ icon:'error', title:'Import Failed', text: err.body?.error || err.message || 'Failed to import spreadsheet' });
    } finally {
      setImporting(false);
      if (e.target) e.target.value = '';
    }
  };

  const closeImportReviewModal = () => {
    livePreviewRequestRef.current += 1;
    setLivePreviewing(false);
    setShowImportReviewModal(false);
    setImportPreviewRows([]);
    setImportPreviewResult(null);
    setImportPreviewErrors([]);
  };

  const handleConfirmImportSubmit = async () => {
    if (!ensureBulkToolsAllowed(true)) return;
    if (!importPreviewRows.length) return;
    if (hasSchedulingDependencyBlockers) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Import is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
      });
      return;
    }
    if (isProgramHead && !programHeadProgramId) {
      swalFire({ icon:'error', title:'Unauthorized', text:'Your account has no assigned program. Please contact the administrator.' });
      return;
    }
    if (!activeSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'Cannot import because there is no active semester for today.' });
      return;
    }
    // Final safety check: block submit if there are any unresolved validation errors
    if (Object.keys(previewErrorsByRow).length > 0) {
      swalFire({ 
        icon: 'error', 
        title: 'Review Required', 
        text: 'Please fix the errors highlighted in red before submitting the import.' 
      });
      setSubmittingReviewedImport(false);
      return;
    }

    setSubmittingReviewedImport(true);
    livePreviewRequestRef.current += 1;
    setLivePreviewing(false);
    try {
      const precheck = await runScheduleImportPreview(importPreviewRows);
      if (precheck.errors.length > 0) {
        swalFire({ icon:'warning', title:'Fix Required', text:'Rows with red highlights must be fixed before submit.' });
        return;
      }

      const payloadRows = buildScheduleImportPayloadRows(importPreviewRows);
      const result = await apiPost('class-schedules', { rows: payloadRows });
      setImportSummary({
        inserted: Number(result?.inserted || 0),
        skipped: Number(result?.skipped || 0),
        total: payloadRows.length,
      });
      const errs = Array.isArray(result?.errors) ? result.errors : [];
      setImportErrors(errs);

      if (errs.length) {
        setImportPreviewErrors(errs);
        setImportPreviewResult({
          inserted: Number(result?.inserted || 0),
          skipped: Number(result?.skipped || 0),
          total: payloadRows.length,
        });
        swalFire({ icon:'warning', title:'Import Completed with Errors', text: 'Some rows failed due to duplicate or conflict checks. Fix highlighted rows and resubmit.' });
      } else {
        closeImportReviewModal();
        swalFire({ icon:'success', title:'Import Successful', text: `${result.inserted} schedules imported.`, timer: 1800, showConfirmButton: false });
      }
      const s = await apiGet('class-schedules');
      setSchedules(Array.isArray(s)?s:[]);
    } catch (err) {
      console.error(err);
      swalFire({ icon:'error', title:'Import Submit Failed', text: err.body?.error || err.message || 'Failed to import reviewed rows' });
    } finally {
      setSubmittingReviewedImport(false);
    }
  };

  const schedulingDependencyBlockers = useMemo(() => {
    const issues = [];
    if (!activeDepartments.length) issues.push('Department');
    if (!activePrograms.length) issues.push('Program');
    if (!activeBuildings.length) issues.push('Building');
    if (!activeFloors.length) issues.push('Floor');
    if (!activeSubjects.length) issues.push('Subject');
    if (!activeSections.length) issues.push('Section');
    if (!availableActiveTeachers.length) issues.push('Teacher');
    if (!activeRooms.length) issues.push('Room');
    return issues;
  }, [
    activeDepartments,
    activePrograms,
    activeBuildings,
    activeFloors,
    activeSubjects,
    activeSections,
    availableActiveTeachers,
    activeRooms
  ]);
  const hasSchedulingDependencyBlockers = schedulingDependencyBlockers.length > 0;
  const schedulingDependencyBlockersText = schedulingDependencyBlockers.join(', ');

  // Batch modal helpers
  const openBatchModal = () => {
    if (!ensureBulkToolsAllowed(true)) return;
    if (isProgramHead && !programHeadProgramId) {
      swalFire('Unauthorized', 'Your account has no assigned program. Please contact the administrator.', 'error');
      return;
    }
    if (hasSchedulingDependencyBlockers) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Batch add is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
      });
      return;
    }
    const scopedDeptId = isProgramHead ? (programHeadDeptId || '') : (isDean ? (deanDeptId || '') : '');
    const scopedProgramId = isProgramHead ? (programHeadProgramId || '') : '';

    // If headers are empty, set sensible defaults from loaded lists - do not overwrite if user already set filters
    setHeaderDept(h => {
      if (isProgramHead || isDean) return scopedDeptId || h || '';
      return h || (activeDepartments[0]?.dept_id ?? '');
    });

    // Choose a default program within the chosen/default department without relying on filteredPrograms
    setHeaderProgram(h => {
      if (isProgramHead) return scopedProgramId || h || '';
      if (isDean) {
        if (h) {
          const valid = activePrograms.some(pp => String(pp.program_id) === String(h) && String(pp.dept_id) === String(scopedDeptId || ''));
          if (valid) return h;
        }
        const p = activePrograms.find(pp => String(pp.dept_id) === String(scopedDeptId || ''));
        if (p) return p.program_id;
      }
      if (h) return h;
      const depId = headerDept || (activeDepartments[0]?.dept_id ?? null);
      if (depId) {
        const p = activePrograms.find(pp => String(pp.dept_id) === String(depId));
        if (p) return p.program_id;
      }
      return activePrograms[0]?.program_id ?? '';
    });

    setHeaderBuilding(h => h || (activeBuildings[0]?.building_id ?? ''));

    // Choose default floor within the chosen/default building without relying on filteredFloors
    setHeaderFloor(h => {
      if (h) return h;
      const bId = activeBuildings[0]?.building_id ?? null;
      if (bId) {
        const f = activeFloors.find(ff => String(ff.building_id) === String(bId));
        if (f) return f.floor_id;
      }
      return activeFloors[0]?.floor_id ?? '';
    });

    // Default room based on chosen/default floor/building (avoid using filteredRooms before init)
    const defaultFloorId = activeFloors.find(ff => String(ff.building_id) === String(activeBuildings[0]?.building_id))?.floor_id || activeFloors[0]?.floor_id;
    const defaultRoom = activeRooms.find(rr => String(rr.floor_id) === String(defaultFloorId)) || activeRooms[0];

    setBatchForm(prev => ({
      ...prev,
      room_id: prev.room_id || (defaultRoom?.room_id ?? ''),
      subject_id: prev.subject_id || '',
      section_id: prev.section_id || '',
      user_id: prev.user_id || '',
      day_of_week: prev.day_of_week || 'monday',
      start_time: prev.start_time || '',
      end_time: prev.end_time || ''
    }));
    setEditingBatchIndex(null);
    setBatchPage(1);
    setShowBatchModal(true);
  };
  const closeBatchModal = () => { setShowBatchModal(false); setEditingBatchIndex(null); setBatchPage(1); };

  const handleBatchChange = (e) => {
    const { name, value } = e.target;
    setBatchForm(f => ({ ...f, [name]: value }));
  };

  const getConflictMessage = (candidate, sourceRows, { isScheduleSource = false, skipBatchIndex = null } = {}) => {
    const cDay = String(candidate.day_of_week || '').toLowerCase();
    const cStart = toMinutes(candidate.start_time);
    const cEnd = toMinutes(candidate.end_time);
    if (!cDay || cStart === null || cEnd === null) return null;

    for (let i = 0; i < sourceRows.length; i++) {
      if (!sourceRows[i]) continue;
      if (!isScheduleSource && skipBatchIndex !== null && i === skipBatchIndex) continue;

      const row = sourceRows[i];
      const day = String(row.day_of_week || '').toLowerCase();
      if (day !== cDay) continue;

      const start = toMinutes(row.start_time);
      const end = toMinutes(row.end_time);
      if (start === null || end === null) continue;

      const roomId = Number(row.room_id || 0);
      const subjectId = Number(row.subject_id || 0);
      const sectionId = Number(row.section_id || 0);
      const teacherId = Number((row.teacher_id ?? row.user_id) || 0);
      const rowSemesterId = Number(row.semester_id || activeSemesterId || 0);
      if (Number(activeSemesterId) && rowSemesterId && rowSemesterId !== Number(activeSemesterId)) continue;

      const isExact = roomId === Number(candidate.room_id)
        && subjectId === Number(candidate.subject_id)
        && sectionId === Number(candidate.section_id)
        && teacherId === Number(candidate.user_id)
        && rowSemesterId === Number(activeSemesterId || rowSemesterId)
        && String(row.start_time).slice(0,5) === String(candidate.start_time).slice(0,5)
        && String(row.end_time).slice(0,5) === String(candidate.end_time).slice(0,5);
      const sameSectionSameSubject = sectionId === Number(candidate.section_id)
        && subjectId === Number(candidate.subject_id);

      if (isExact) return 'Duplicate schedule already exists.';
      if (sameSectionSameSubject) {
        return 'Duplicate not allowed: this section already has this subject on the selected day.';
      }
      if (!overlap(cStart, cEnd, start, end)) continue;
      const sameSubject = subjectId === Number(candidate.subject_id);
      const exactParallelTime = sameTimeRange(row.start_time, row.end_time, candidate.start_time, candidate.end_time);
      if (sameSubject && !exactParallelTime) return parallelSubjectTimeMessage;
      if (roomId === Number(candidate.room_id)) return 'Room conflict: room already has a class during this time.';
    }
    return null;
  };

  const getInactiveDependencyIssues = useCallback((candidate) => {
    const issues = new Set();

    const room = rooms.find(r => String(r.room_id) === String(candidate?.room_id || ''));
    const subject = subjects.find(s => String(s.subject_id) === String(candidate?.subject_id || ''));
    const section = sections.find(s => String(s.section_id) === String(candidate?.section_id || ''));
    const teacher = teachers.find(t => String(t.user_id) === String(candidate?.user_id || candidate?.teacher_id || ''));

    if (room && !isEntityActive(room)) issues.add('Room');
    if (subject && !isEntityActive(subject)) issues.add('Subject');
    if (section && !isEntityActive(section)) issues.add('Section');
    if (teacher && !isEntityActive(teacher)) issues.add('Teacher');

    const floor = room ? floors.find(f => String(f.floor_id) === String(room.floor_id || '')) : null;
    if (floor && !isEntityActive(floor)) issues.add('Floor');

    const roomBuildingId = room?.building_id || floor?.building_id || '';
    const building = roomBuildingId ? buildings.find(b => String(b.building_id) === String(roomBuildingId)) : null;
    if (building && !isEntityActive(building)) issues.add('Building');

    const subjectProgramId = subject?.program_id ? String(subject.program_id) : '';
    const sectionProgramId = section?.program_id ? String(section.program_id) : '';
    const programId = subjectProgramId || sectionProgramId;
    const program = programId ? programs.find(p => String(p.program_id) === String(programId)) : null;
    if (program && !isEntityActive(program)) issues.add('Program');

    const deptId = program?.dept_id ? String(program.dept_id) : '';
    const department = deptId ? departments.find(d => String(d.dept_id) === String(deptId)) : null;
    if (department && !isEntityActive(department)) issues.add('Department');

    return Array.from(issues);
  }, [rooms, subjects, sections, teachers, floors, buildings, programs, departments]);



  const getProgramScopeIssues = useCallback((candidate) => {
    const issues = [];

    const subject = subjects.find(s => String(s.subject_id) === String(candidate?.subject_id || ''));
    const section = sections.find(s => String(s.section_id) === String(candidate?.section_id || ''));
    const teacher = teachers.find(t => String(t.user_id) === String(candidate?.user_id || candidate?.teacher_id || ''));

    const subjectProgramId = subject?.program_id ? String(subject.program_id) : '';
    const sectionProgramId = section?.program_id ? String(section.program_id) : '';
    if (subjectProgramId && sectionProgramId && subjectProgramId !== sectionProgramId) {
      issues.push('Subject and section belong to different programs.');
    }

    const rowProgramId = subjectProgramId || sectionProgramId;
    const assigneeRoleId = Number(teacher?.role_id || 0);
    const assigneeNeedsProgramMatch = [2, 3, 4, 5].includes(assigneeRoleId);
    if (teacher && assigneeNeedsProgramMatch) {
      const teacherProgramId = resolveTeacherProgramId(teacher);
      if (!teacherProgramId) {
        issues.push('Selected instructor has no program assignment.');
      } else if (rowProgramId && teacherProgramId !== rowProgramId) {
        issues.push('Selected instructor, subject, and section must belong to the same program.');
      }
    }

    if (isProgramHead) {
      const scopedProgramId = String(programHeadProgramId || '');
      if (!scopedProgramId) {
        issues.push('Your account has no assigned program.');
        return issues;
      }
      if (rowProgramId && rowProgramId !== scopedProgramId) {
        issues.push('Subject/section is outside your assigned program.');
      }
      if (teacher && assigneeNeedsProgramMatch) {
        const teacherProgramId = resolveTeacherProgramId(teacher);
        if (teacherProgramId && teacherProgramId !== scopedProgramId) {
          issues.push('Selected instructor belongs to a different program.');
        }
      }
    }

    if (isDean) {
      const scopedDeptId = String(deanDeptId || '');
      if (!scopedDeptId) {
        issues.push('Your account has no assigned department.');
        return issues;
      }
      const rowDeptId = rowProgramId ? String(programDeptIdByProgramId.get(String(rowProgramId)) || '') : '';
      if (!rowDeptId) {
        issues.push('Selected subject or section has no department assignment.');
      } else if (rowDeptId !== scopedDeptId) {
        issues.push('Subject/section is outside your assigned department.');
      }
      if (teacher) {
        const teacherDeptId = teacher?.dept_id ? String(teacher.dept_id) : '';
        if (teacherDeptId && teacherDeptId !== scopedDeptId) {
          issues.push('Selected instructor belongs to a different department.');
        }
      }
    }

    return issues;
  }, [isProgramHead, programHeadProgramId, isDean, deanDeptId, programDeptIdByProgramId, subjects, sections, teachers, resolveTeacherProgramId]);

  const handleBatchAdd = () => {
    if (!ensureBulkToolsAllowed(true)) return;
    // validate minimal fields
    const r = Number(batchForm.room_id) || null;
    const subj = Number(batchForm.subject_id) || null;
    const sec = Number(batchForm.section_id) || null;
    const usr = batchForm.user_id ? Number(batchForm.user_id) : null;
    const day = (batchForm.day_of_week || '').toLowerCase();
    const st = String(batchForm.start_time || '').slice(0,5);
    const et = String(batchForm.end_time || '').slice(0,5);
    if (!r || !subj || !sec || !usr || !day || !st || !et) {
      swalFire({ icon:'warning', title:'Batch Add', text:'room, subject, section, teacher, day, start_time and end_time are required.' });
      return;
    }
    if (st >= et) { swalFire({ icon:'warning', title:'Validation', text:'Start time must be before end time.' }); return; }
    if (!activeSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'Cannot add row because there is no active semester for today.' });
      return;
    }
    const row = { room_id: r, subject_id: subj, section_id: sec, user_id: usr, day_of_week: day, start_time: st, end_time: et };
    const inactiveIssues = getInactiveDependencyIssues(row);
    if (inactiveIssues.length > 0) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Cannot add this row because these linked records are inactive/archived: ${inactiveIssues.join(', ')}.`
      });
      return;
    }
    const programScopeIssues = getProgramScopeIssues(row);
    if (programScopeIssues.length > 0) {
      swalFire({
        icon: 'warning',
        title: 'Program Scope Validation',
        text: programScopeIssues.join(' ')
      });
      return;
    }

    const localConflict = getConflictMessage(row, batchRows, { skipBatchIndex: editingBatchIndex });
    if (localConflict) {
      swalFire({ icon:'error', title:'Batch Validation', text: localConflict });
      return;
    }
    const scheduleConflict = getConflictMessage(row, schedules, { isScheduleSource: true });
    if (scheduleConflict) {
      swalFire({ icon:'error', title:'Batch Validation', text: scheduleConflict });
      return;
    }

    setBatchRows(prev => {
      const next = editingBatchIndex === null
        ? [...prev, row]
        : prev.map((item, idx) => idx === editingBatchIndex ? row : item);
      const nextPage = editingBatchIndex === null
        ? Math.max(1, Math.ceil(next.length / BATCH_PAGE_SIZE))
        : Math.max(1, Math.floor(Number(editingBatchIndex) / BATCH_PAGE_SIZE) + 1);
      setBatchPage(nextPage);
      return next;
    });
    setEditingBatchIndex(null);
    setBatchForm(prev => ({ ...prev, start_time: prev.isParallel ? prev.start_time : '', end_time: prev.isParallel ? prev.end_time : '' }));
  };

  const handleBatchRemove = (idx) => {
    setBatchRows(prev => {
      const next = prev.filter((_,i)=>i!==idx);
      const totalPages = Math.max(1, Math.ceil(next.length / BATCH_PAGE_SIZE));
      setBatchPage(p => Math.min(p, totalPages));
      return next;
    });
    if (editingBatchIndex === idx) setEditingBatchIndex(null);
  };
  const handleBatchEdit = (idx) => {
    const row = batchRows[idx];
    if (!row) return;
    setBatchForm({
      room_id: String(row.room_id || ''),
      subject_id: String(row.subject_id || ''),
      section_id: String(row.section_id || ''),
      user_id: String(row.user_id || ''),
      day_of_week: row.day_of_week || 'monday',
      start_time: String(row.start_time || '').slice(0,5),
      end_time: String(row.end_time || '').slice(0,5)
    });
    setEditingBatchIndex(idx);
    setBatchPage(Math.max(1, Math.floor(Number(idx) / BATCH_PAGE_SIZE) + 1));
  };
  const handleBatchCancelEdit = () => {
    setEditingBatchIndex(null);
    setBatchForm(prev => ({ ...prev, start_time: '', end_time: '' }));
  };

  const handleBatchSubmit = async () => {
    if (!ensureBulkToolsAllowed(true)) return;
    if (!batchRows.length) { swalFire({ icon:'warning', title:'No rows', text:'Add at least one row to submit.' }); return; }
    if (hasSchedulingDependencyBlockers) {
      swalFire({
        icon: 'warning',
        title: 'Inactive/Archived Dependencies',
        text: `Batch submit is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
      });
      return;
    }
    if (!activeSemesterId) {
      swalFire({ icon:'warning', title:'No Active Semester', text:'Cannot submit batch because there is no active semester for today.' });
      return;
    }
    for (let i = 0; i < batchRows.length; i++) {
      const issues = getInactiveDependencyIssues(batchRows[i]);
      if (issues.length > 0) {
        swalFire({
          icon: 'warning',
          title: 'Inactive/Archived Dependencies',
          text: `Batch row ${i + 1} has inactive/archived links: ${issues.join(', ')}.`
        });
        return;
      }
    }
    setImporting(true);
    try {
      const res = await apiPost('class-schedules', { rows: batchRows });
      setImportSummary({ inserted: Number(res?.inserted||0), skipped: Number(res?.skipped||0), total: batchRows.length });
      setImportErrors(Array.isArray(res?.errors)?res.errors:[]);
      swalFire({ icon: (res?.errors && res.errors.length) ? 'warning' : 'success', title: 'Batch Import', text: `Inserted ${res?.inserted || 0}, skipped ${res?.skipped || 0}` });
      const s = await apiGet('class-schedules');
      setSchedules(Array.isArray(s)?s:[]);
      setBatchRows([]);
      setShowBatchModal(false);
      setEditingBatchIndex(null);
      setBatchPage(1);
    } catch (err) {
      console.error(err);
      swalFire({ icon:'error', title:'Batch Submit Failed', text: err.body?.error || err.message || 'Failed to submit batch' });
    } finally { setImporting(false); }
  };

  const subjectLabelById = useMemo(() => {
    const map = {};
    subjects.forEach(s => { map[String(s.subject_id)] = `${s.subject_code} - ${s.subject_name}`; });
    return map;
  }, [subjects]);
  const sectionLabelById = useMemo(() => {
    const map = {};
    sections.forEach(s => { map[String(s.section_id)] = s.section_name; });
    return map;
  }, [sections]);
  const teacherLabelById = useMemo(() => {
    const map = {};
    teachers.forEach(t => { map[String(t.user_id)] = `${t.first_name || ''} ${t.last_name || ''}`.trim(); });
    return map;
  }, [teachers]);
  const roomLabelById = useMemo(() => {
    const map = {};
    rooms.forEach(r => { map[String(r.room_id)] = r.room_name; });
    return map;
  }, [rooms]);

  const pagedBatchRows = useMemo(() => {
    const start = (batchPage - 1) * BATCH_PAGE_SIZE;
    return batchRows.slice(start, start + BATCH_PAGE_SIZE);
  }, [batchRows, batchPage]);

  const totalBatchPages = useMemo(() => {
    return Math.max(1, Math.ceil(batchRows.length / BATCH_PAGE_SIZE));
  }, [batchRows.length]);

  useEffect(() => {
    if (batchPage > totalBatchPages) setBatchPage(totalBatchPages);
  }, [batchPage, totalBatchPages]);

  const dayDistribution = useMemo(() => {
    const labels = {
      monday: 'Mon',
      tuesday: 'Tue',
      wednesday: 'Wed',
      thursday: 'Thu',
      friday: 'Fri',
      saturday: 'Sat',
      sunday: 'Sun'
    };
    const counts = DAY_OPTIONS.map(day => ({ key: day, label: labels[day] || day.slice(0, 3), count: 0 }));
    const byDay = new Map(counts.map(entry => [entry.key, entry]));
    displayedAndFiltered.forEach((row) => {
      const key = String(row?.day_of_week || '').toLowerCase();
      if (!byDay.has(key)) return;
      byDay.get(key).count += 1;
    });
    const peak = counts.reduce((max, entry) => Math.max(max, entry.count), 0);
    return counts.map(entry => ({
      ...entry,
      width: peak > 0 ? Math.max(8, Math.round((entry.count / peak) * 100)) : 0
    }));
  }, [DAY_OPTIONS, displayedAndFiltered]);

  const topRooms = useMemo(() => {
    const byRoom = new Map();
    displayedAndFiltered.forEach((row) => {
      const roomKey = String(row?.room_id || row?.room_name || '');
      if (!roomKey) return;
      const label = row?.room_name || `Room ${roomKey}`;
      byRoom.set(roomKey, { label, count: (byRoom.get(roomKey)?.count || 0) + 1 });
    });
    return Array.from(byRoom.values()).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [displayedAndFiltered]);

  const topPrograms = useMemo(() => {
    const byProgram = new Map();
    displayedAndFiltered.forEach((row) => {
      const label = row?.program_name || 'Unassigned Program';
      byProgram.set(label, (byProgram.get(label) || 0) + 1);
    });
    return Array.from(byProgram.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [displayedAndFiltered]);

  const statsCards = useMemo(() => {
    const uniqueTeachers = new Set();
    const uniqueRooms = new Set();
    const uniqueSections = new Set();
    displayedAndFiltered.forEach((row) => {
      const teacherId = row?.teacher_id ?? row?.user_id;
      if (teacherId) uniqueTeachers.add(String(teacherId));
      if (row?.room_id || row?.room_name) uniqueRooms.add(String(row.room_id || row.room_name));
      if (row?.section_id || row?.section_name) uniqueSections.add(String(row.section_id || row.section_name));
    });

    return [
      {
        title: 'Schedules In View',
        value: displayData.length,
        note: `${visibleSchedules.length} total records in your scope`
      },
      {
        title: 'Teachers Assigned',
        value: uniqueTeachers.size,
        note: 'Distinct teachers in current filter'
      },
      {
        title: 'Rooms Utilized',
        value: uniqueRooms.size,
        note: 'Unique rooms currently displayed'
      },
      {
        title: 'Sections Covered',
        value: uniqueSections.size,
        note: 'Sections with scheduled classes'
      }
    ];
  }, [displayData.length, displayedAndFiltered, visibleSchedules.length]);

  const topRoomPeak = useMemo(() => topRooms.reduce((max, room) => Math.max(max, room.count), 0), [topRooms]);

  const lockedDeptLabel = useMemo(() => {
    if (!isProgramHead) return '';
    const match = departmentFilterOptions.find(d => String(d.id) === String(filterDept));
    return match?.label || departmentFilterOptions[0]?.label || 'Assigned Department';
  }, [isProgramHead, departmentFilterOptions, filterDept]);

  const lockedProgramLabel = useMemo(() => {
    if (!isProgramHead) return '';
    const match = programFilterOptions.find(p => String(p.id) === String(filterProgram));
    return match?.label || programFilterOptions[0]?.label || 'Assigned Program';
  }, [isProgramHead, programFilterOptions, filterProgram]);

  const filterSelectClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 shadow-sm transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100";
  const filterLabelClass = "block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5";
  const quickActionButtonClass = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

  // Memoized parallel session detection for performance
  const parallelSessionMap = useMemo(() => {
    const map = new Map();
    schedules.forEach(sch => {
      const key = `${sch.user_id}|${sch.subject_id}|${sch.day_of_week}|${sch.start_time}|${sch.end_time}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(sch);
    });
    return map;
  }, [schedules]);

  const isParallelSession = useCallback((s) => {
    const key = `${s.user_id}|${s.subject_id}|${s.day_of_week}|${s.start_time}|${s.end_time}`;
    const group = parallelSessionMap.get(key);
    if (!group || group.length < 2) return false;
    return group.some(sch => Number(sch.room_id) !== Number(s.room_id));
  }, [parallelSessionMap]);

  const columns=[
    { key:'display_index', label:'#', render: (s) => <span>{s.display_index}</span> },
    { key:'teacher', label:'Teacher', render:(s)=> <span>{s.teacher_name || (s.first_name ? `${s.first_name} ${s.last_name}` : 'N/A')}</span> },
    { key:'subject', label:'Subject', render:(s)=> <span>{`${s.subject_code || 'N/A'}${s.subject_name ? ` - ${s.subject_name}` : ''}`}</span> },
    { key:'section', label:'Section', render:(s)=> <span>{s.section_name || 'N/A'}</span> },
    { key:'day_of_week', label:'Day', render: (s) => <span>{s.day_of_week ? s.day_of_week.charAt(0).toUpperCase() + s.day_of_week.slice(1) : ''}</span> },
    { key:'time', label:'Time', render:(s)=> <span>{`${formatToAmPm(s.start_time?.slice(0,5)||'')} - ${formatToAmPm(s.end_time?.slice(0,5)||'')}`}</span> },
    { 
      key: 'type', 
      label: 'Session Type', 
      render: (s) => {
        const isParallel = isParallelSession(s);
        return isParallel ? (
          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
            Parallel Session
          </span>
        ) : (
          <span className="text-xs text-slate-400 italic">Standard</span>
        );
      }
    },
    { key:'campus_name', label:'Campus', render:(s)=> <span>{s.campus_name || '-'}</span> },
    { key:'building_name', label:'Building', render:(s)=> <span>{s.building_name || '-'}</span> },
    { key:'floor_name', label:'Floor', render:(s)=> <span>{s.floor_name || '-'}</span> },
    { key:'room_name', label:'Room', render: (s) => <span>{s.room_name || '-'}</span> }
  ];

  columns.push({
    key:'actions',
    label:'Actions',
    actions: (row) => {
      const items = [{ label:'View', onClick: ()=> openViewModal(row) }];
      if (canEdit) items.unshift({ label:'Edit', onClick: ()=> openModal(row) });
      return items;
    }
  });

  return (
    <div className="p-6 class-schedule-page class-schedule-dashboard">
      <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-6 p-5 lg:grid-cols-[1.6fr_1fr] lg:p-7">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Class Schedule Control Center</h2>

            <div className={`mt-4 inline-flex rounded-xl border px-3 py-2 text-xs font-medium ${
              activeSemesterId ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}>
              {activeSemesterId
                ? `Active semester: ${activeSemesterLabel || 'Current term'}`
                : 'No active semester found for today. Import and batch submit stay blocked.'}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {statsCards.map((card) => (
                <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{card.title}</div>
                  <div className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{card.value}</div>
                  <div className="mt-1 text-xs text-slate-500">{card.note}</div>
                </div>
              ))}
            </div>

            {canUseBulkScheduleTools && (
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleImportFile}
                style={{ display:'none' }}
              />
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Static Weekly Distribution</div>
            <div className="mt-4 space-y-3">
              {dayDistribution.map((entry) => (
                <div key={entry.key} className="grid grid-cols-[52px_1fr_auto] items-center gap-3">
                  <span className="text-xs font-semibold text-slate-600">{entry.label}</span>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700"
                      style={{ width: `${entry.width}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700">{entry.count}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-500">Snapshot updates automatically from your current filters.</p>
          </div>
        </div>
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Top Room Load</div>
          {topRooms.length === 0 ? (
            <div className="text-sm text-slate-500">No room usage data in the current view.</div>
          ) : (
            <div className="space-y-3">
              {topRooms.map((room) => (
                <div key={room.label}>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium text-slate-700">{room.label}</span>
                    <span className="text-xs font-semibold text-slate-500">{room.count} class(es)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700"
                      style={{ width: `${topRoomPeak > 0 ? Math.max(8, Math.round((room.count / topRoomPeak) * 100)) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Program Coverage</div>
          {topPrograms.length === 0 ? (
            <div className="text-sm text-slate-500">No program distribution available.</div>
          ) : (
            <div className="space-y-2">
              {topPrograms.map((program, index) => (
                <div key={`${program.label}-${index}`} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="truncate pr-3 text-sm font-medium text-slate-700">{program.label}</span>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{program.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Quick Filters</div>
            <div className="mt-1 text-xs text-slate-500">Refine schedules by schedule day, faculty, and location.</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canManageSchedules && (
              <>
              <button
                type="button"
                onClick={() => openModal(null)}
                className={`${quickActionButtonClass} bg-emerald-600 text-white hover:bg-emerald-700`}
              >
                Add Schedule
              </button>
              <button
                type="button"
                onClick={openHistoricalModal}
                className={`${quickActionButtonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
              >
                View Historical Schedules
              </button>
              </>
            )}
            <button
              type="button"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
              onClick={() => {
                setFilterDay('');
                setFilterTeacher('');
              setFilterRoom('');
              setFilterCampus('');
              setFilterBuilding('');
              setFilterFloor('');
              setFilterDept(isProgramHead ? String(roleScopedDeptId || '') : '');
              setFilterProgram(isProgramHead ? String(programHeadProgramId || '') : '');
              setFilterSubject('');
              setFilterSection('');
            }}
            >
              Clear Filters
            </button>
            {canUseBulkScheduleTools && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (hasSchedulingDependencyBlockers) {
                      swalFire({
                        icon: 'warning',
                        title: 'Inactive/Archived Dependencies',
                        text: `Import is blocked. Activate these first: ${schedulingDependencyBlockersText}.`
                      });
                      return;
                    }
                    if (fileInputRef.current) fileInputRef.current.click();
                  }}
                  disabled={importing || hasSchedulingDependencyBlockers}
                  className={`${quickActionButtonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`}
                >
                  {importing ? 'Processing...' : 'Import Spreadsheet'}
                </button>
                <button
                  type="button"
                  onClick={openBatchModal}
                  disabled={importing || hasSchedulingDependencyBlockers}
                  className={`${quickActionButtonClass} bg-slate-900 text-white hover:bg-slate-800`}
                >
                  Batch Add
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-5">
          <div>
            <label className={filterLabelClass}>Day</label>
            <select className={filterSelectClass} value={filterDay} onChange={e=>setFilterDay(e.target.value)}>
              <option value="">All Days</option>
              {DAY_OPTIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Teacher</label>
            <select className={filterSelectClass} value={filterTeacher} onChange={e=>setFilterTeacher(e.target.value)}>
              <option value="">All Teachers</option>
              {availableTeachers.map(t => <option key={t.user_id} value={t.user_id}>{t.first_name} {t.last_name}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Department</label>
            {isProgramHead ? (
              <input
                type="text"
                readOnly
                value={lockedDeptLabel}
                className={`${filterSelectClass} bg-gray-100 text-gray-600 cursor-not-allowed`}
              />
            ) : (
              <select
                className={filterSelectClass}
                value={filterDept}
                onChange={e=>setFilterDept(e.target.value)}
              >
                <option value="">All Departments</option>
                {departmentFilterOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className={filterLabelClass}>Program</label>
            {isProgramHead ? (
              <input
                type="text"
                readOnly
                value={lockedProgramLabel}
                className={`${filterSelectClass} bg-gray-100 text-gray-600 cursor-not-allowed`}
              />
            ) : (
              <select
                className={filterSelectClass}
                value={filterProgram}
                onChange={e=>setFilterProgram(e.target.value)}
              >
                <option value="">All Programs</option>
                {programFilterOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className={filterLabelClass}>Subject</label>
            <select className={filterSelectClass} value={filterSubject} onChange={e=>setFilterSubject(e.target.value)}>
              <option value="">All Subjects</option>
              {subjectFilterOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Section</label>
            <select className={filterSelectClass} value={filterSection} onChange={e=>setFilterSection(e.target.value)}>
              <option value="">All Sections</option>
              {sectionFilterOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Campus</label>
            <select className={filterSelectClass} value={filterCampus} onChange={e=>setFilterCampus(e.target.value)}>
              <option value="">All Campuses</option>
              {campusFilterOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Building</label>
            <select className={filterSelectClass} value={filterBuilding} onChange={e=>setFilterBuilding(e.target.value)}>
              <option value="">All Buildings</option>
              {buildingFilterOptions.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Floor</label>
            <select className={filterSelectClass} value={filterFloor} onChange={e=>setFilterFloor(e.target.value)}>
              <option value="">All Floors</option>
              {floorFilterOptions.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className={filterLabelClass}>Room</label>
            <select className={filterSelectClass} value={filterRoom} onChange={e=>setFilterRoom(e.target.value)}>
              <option value="">All Rooms</option>
              {roomFilterOptions.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {importSummary && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${importErrors.length ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          Import summary: {importSummary.inserted} inserted, {importSummary.skipped} skipped, {importSummary.total} total rows.
        </div>
      )}

      {importErrors.length > 0 && (
        <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800">
          <div className="mb-2 font-semibold">Import errors (first 20 rows)</div>
          <ul className="list-disc pl-5">
            {importErrors.slice(0,20).map((err, idx)=>(
              <li key={`${err.row || idx}-${idx}`}>Row {err.row || idx + 1}: {err.message || err.error || 'Invalid data'}</li>
            ))}
          </ul>
          {importErrors.length > 20 && <div className="mt-2">And {importErrors.length - 20} more...</div>}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Schedule Directory</div>
            <div className="text-xs text-slate-500">Filtered and role-scoped records for daily operations.</div>
          </div>
          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {displayData.length} record(s)
          </div>
        </div>
        <div className="p-3 sm:p-4">
          {displayData.length === 0 ? (
            <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl">
              <div className="text-slate-400 mb-2 text-lg font-medium">
                🗓️ No schedules found
              </div>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Adjust your filters to broaden the search, or click <strong>"Add Schedule"</strong> to create a new class schedule.
              </p>
            </div>
          ) : (
            <Table columns={columns} data={displayData} pageSize={10} loading={false} horizontalScroll={true} wrapCells className="class-schedule-table responsive-table" />
          )}
        </div>
      </div>

      <Modal show={showModal} title={editingSchedule ? "Edit Class Schedule" : "Add New Class Schedule"} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Department Scope</label>
              <select
                value={modalDept}
                onChange={handleModalDeptChange}
                disabled={isProgramHead || isDean}
                className={`block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 ${(isProgramHead || isDean) ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : 'bg-white'}`}
              >
                <option value="">All Departments</option>
                {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Program Scope</label>
              <select
                value={modalProgram}
                onChange={handleModalProgramChange}
                disabled={isProgramHead}
                className={`block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500 ${isProgramHead ? 'bg-gray-100 text-gray-600 cursor-not-allowed' : 'bg-white'}`}
              >
                <option value="">All Programs</option>
                {modalPrograms.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
              </select>
            </div>
          </div>
          {isProgramHead && (
            <div className="text-xs text-gray-500 -mt-2">
              Department and program are fixed to your assigned scope.
            </div>
          )}
          {isDean && !isProgramHead && (
            <div className="text-xs text-gray-500 -mt-2">
              Department is fixed to your assigned scope.
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Building Scope</label>
              <select value={modalBuilding} onChange={handleModalBuildingChange} className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
                <option value="">All Buildings</option>
                {buildings.map(b => <option key={b.building_id} value={b.building_id}>{b.building_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Floor Scope</label>
              <select value={modalFloor} onChange={handleModalFloorChange} className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
                <option value="">All Floors</option>
                {modalFloors.map(f => <option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
            <select name="room_id" value={form.room_id} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">Select room</option>
              {modalRooms.map(r=> <option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Teacher</label>
            <select name="user_id" value={form.user_id || ''} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">Select teacher</option>
              {modalTeachers.map(t=> <option key={t.user_id} value={t.user_id}>{t.first_name} {t.last_name}{t.role_name ? ` (${t.role_name})` : ''}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <select name="subject_id" value={form.subject_id} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
              <option value="">Select subject</option>
              {modalSubjects.map(s=> <option key={s.subject_id} value={s.subject_id}>{s.subject_code} - {s.subject_name}</option>)}
            </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
              <select name="section_id" value={form.section_id} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
                <option value="">Select section</option>
                {modalSections.map(s=> <option key={s.section_id} value={s.section_id}>{s.section_name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Day of Week</label>
              <select name="day_of_week" value={form.day_of_week} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2 focus:outline-none focus:ring-1 focus:ring-green-500">
                {DAY_OPTIONS.map(d=> <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input type="time" name="start_time" value={form.start_time} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-3 text-base focus:outline-none focus:ring-1 focus:ring-green-500"/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input type="time" name="end_time" value={form.end_time} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-3 text-base focus:outline-none focus:ring-1 focus:ring-green-500"/>
              </div>
            </div>

            <div className="flex justify-end items-center gap-2">
              <button type="button" onClick={closeModal} className="px-3 py-2 rounded border bg-white text-sm">Cancel</button>
              <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700">{loading ? 'Saving...' : (editingSchedule ? 'Update Schedule' : 'Save Schedule')}</button>
            </div>
          </form>
        </Modal>

        <Modal show={showViewModal} title="Schedule Details" onClose={closeViewModal} size="xl">
          {!viewingSchedule ? (
            <div className="text-sm text-gray-600">No schedule selected.</div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-2xl bg-[#1D8551] text-white p-6">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-white/80">Class Schedule Profile</div>
                    <div className="text-2xl font-semibold mt-1">
                      {viewingSchedule.subject_code || 'N/A'}{viewingSchedule.subject_name ? ` - ${viewingSchedule.subject_name}` : ''}
                    </div>
                    <div className="text-sm text-white/90 mt-1">
                      Section {viewingSchedule.section_name || '-'} | Teacher {viewingSchedule.teacher_name || '-'}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-[240px]">
                    <div className="rounded-xl border border-white/30 bg-white/10 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/80">Day</div>
                      <div className="text-lg font-semibold mt-1">
                        {viewingSchedule.day_of_week ? viewingSchedule.day_of_week.charAt(0).toUpperCase() + viewingSchedule.day_of_week.slice(1) : '-'}
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/30 bg-white/10 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-white/80">Time</div>
                      <div className="text-lg font-semibold mt-1">
                        {`${formatToAmPm(viewingSchedule.start_time?.slice(0,5) || '')} - ${formatToAmPm(viewingSchedule.end_time?.slice(0,5) || '')}`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-xl border border-[#d4eadc] bg-[#f6fbf8] p-4">
                  <div className="text-xs uppercase tracking-wide text-[#1D8551]">Program</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{viewingSchedule.program_name || '-'}</div>
                  <div className="text-xs text-gray-600 mt-1">Department: {viewingSchedule.dept_name || '-'}</div>
                </div>
                <div className="rounded-xl border border-[#d4eadc] bg-[#f6fbf8] p-4">
                  <div className="text-xs uppercase tracking-wide text-[#1D8551]">Location</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{viewingSchedule.room_name || '-'}</div>
                  <div className="text-xs text-gray-600 mt-1">{viewingSchedule.building_name || '-'} | {viewingSchedule.floor_name || '-'}</div>
                </div>
                <div className="rounded-xl border border-[#d4eadc] bg-[#f6fbf8] p-4">
                  <div className="text-xs uppercase tracking-wide text-[#1D8551]">Teacher</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{viewingSchedule.teacher_name || '-'}</div>
                  <div className="text-xs text-gray-600 mt-1">{viewingSchedule.subject_name || viewingSchedule.subject_code || '-'}</div>
                </div>
                <div className="rounded-xl border border-[#d4eadc] bg-[#f6fbf8] p-4">
                  <div className="text-xs uppercase tracking-wide text-[#1D8551]">Semester</div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{activeSemesterLabel || 'N/A'}</div>
                  <div className="text-xs text-gray-600 mt-1">{viewingSchedule.semester_start || '-'} to {viewingSchedule.semester_end || '-'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[#d4eadc] p-4 bg-white">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#1D8551] mb-3">Academic Details</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Program</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.program_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Department</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.dept_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Section</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.section_name || '-'}</span></div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#d4eadc] p-4 bg-white">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#1D8551] mb-3">Location</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Campus</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.campus_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Building</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.building_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Floor</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.floor_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Room</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.room_name || '-'}</span></div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#d4eadc] p-4 bg-white">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#1D8551] mb-3">Teacher Assignment</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Teacher</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.teacher_name || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Subject</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.subject_name || viewingSchedule.subject_code || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Day</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.day_of_week ? viewingSchedule.day_of_week.charAt(0).toUpperCase() + viewingSchedule.day_of_week.slice(1) : '-'}</span></div>
                  </div>
                </div>

                <div className="rounded-xl border border-[#d4eadc] p-4 bg-white">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#1D8551] mb-3">Semester Window</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Start</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.semester_start || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">End</span><span className="font-medium text-gray-900 text-right">{viewingSchedule.semester_end || '-'}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-gray-500">Status</span><span className="font-medium text-gray-900 text-right">{activeSemesterLabel || 'N/A'}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Modal>

        <Modal show={canUseBulkScheduleTools && showImportReviewModal} title="Review Spreadsheet Import" onClose={closeImportReviewModal} size="xl">
          <div className="space-y-4">
            <div className={`rounded-xl border p-4 ${activeSemesterId ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1">Active Semester (Fixed for Import)</div>
              <div className="text-sm font-semibold">
                {activeSemesterId
                  ? activeSemesterLabel
                  : 'No active semester is available for today.'}
              </div>
              <div className="text-xs mt-1">
                Semester is assigned automatically from the current active semester for every imported row.
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-2">Preview Summary</div>
              <div className="overflow-hidden">
                <table className="w-full text-sm text-left text-gray-700">
                  <thead className="text-xs uppercase bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-3 py-2">Valid Rows</th>
                      <th className="px-3 py-2">Skipped Rows</th>
                      <th className="px-3 py-2">Total Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-white border-t border-gray-200">
                      <td className="px-3 py-2 font-semibold text-green-700">{importPreviewResult ? Math.max(0, importPreviewResult.inserted - Object.keys(localImportErrors).length) : '-'}</td>
                      <td className="px-3 py-2 font-semibold text-amber-700">{importPreviewResult ? Math.max(0, importPreviewResult.skipped + Object.keys(localImportErrors).length) : '-'}</td>
                      <td className="px-3 py-2 font-semibold text-gray-800">{importPreviewResult ? importPreviewResult.total : '-'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-gray-600 mt-2">Only valid rows will be inserted. Duplicate and conflicting rows are blocked by validation.</div>
            </div>

            {Object.keys(previewErrorsByRow).length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
                <div className="font-semibold mb-2">Detected issues</div>
                <ul className="list-disc pl-5 text-sm">
                  {Object.keys(previewErrorsByRow).slice(0, 30).map((rowNum, idx) => (
                    <li key={`err-${rowNum}-${idx}`}>Row {rowNum}: {previewErrorsByRow[rowNum].join('. ')}</li>
                  ))}
                </ul>
                {Object.keys(previewErrorsByRow).length > 30 && <div className="text-sm mt-2">And {Object.keys(previewErrorsByRow).length - 30} more...</div>}
              </div>
            )}

            {importPreviewRows.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="font-semibold text-sm mb-2">Rows Preview (editable)</div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500">Rows with issues are highlighted in red. Identifiers update in real time while you edit.</div>
                  <div className={`text-xs font-medium ${livePreviewing ? 'text-blue-700' : 'text-green-700'}`}>
                    {livePreviewing ? 'Updating identifiers...' : 'Up to date'}
                  </div>
                </div>
                <div className="overflow-y-auto max-h-96" style={{ overflowX: 'hidden', touchAction: 'pan-y' }}>
                  <table className="w-full table-fixed text-xs text-left text-gray-700">
                    <thead className="text-xs uppercase bg-gray-100 text-gray-600">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Teacher Name</th>
                        <th className="px-3 py-2">Gmail</th>
                        <th className="px-3 py-2">Room</th>
                        <th className="px-3 py-2">Subject</th>
                        <th className="px-3 py-2">Section</th>
                        <th className="px-3 py-2">Day</th>
                        <th className="px-3 py-2">Start</th>
                        <th className="px-3 py-2">End</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importPreviewRows.map((row, idx) => {
                        const rowNumber = Number(row?._row || (idx + 1));
                        const issues = previewErrorsByRow[rowNumber] || [];
                        const issueFields = inferImportIssueFields(issues);
                        const cellClass = (field) => `w-full border rounded px-2 py-1 text-sm ${issueFields.has(field) ? 'border-red-500 bg-red-50 text-red-900' : 'border-gray-300 bg-white text-gray-700'}`;
                        return (
                        <tr key={`preview-${rowNumber}-${idx}`} className={`border-t border-gray-100 ${issues.length ? 'bg-red-50/40' : ''}`}>
                          <td className="px-3 py-2 font-medium text-gray-900">{rowNumber}</td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('teacher_name')}
                              value={row.teacher_name || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'teacher_name', e.target.value)}
                              placeholder="teacher full name"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('teacher')}
                              value={row.teacher || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'teacher', e.target.value)}
                              placeholder="teacher email (Gmail)"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('room')}
                              value={row.room || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'room', e.target.value)}
                              placeholder="room name or room id"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('subject')}
                              value={row.subject || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'subject', e.target.value)}
                              placeholder="subject code/name/id"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('section')}
                              value={row.section || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'section', e.target.value)}
                              placeholder="section name/id"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <select
                              className={cellClass('day_of_week')}
                              value={row.day_of_week || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'day_of_week', e.target.value)}
                            >
                              <option value="">Select day</option>
                              {DAY_OPTIONS.map(day => <option key={day} value={day}>{day}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('start_time')}
                              value={row.start_time || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'start_time', e.target.value)}
                              placeholder="e.g. 07:30"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="text"
                              className={cellClass('end_time')}
                              value={row.end_time || ''}
                              onChange={(e)=>handleImportDraftCellChange(idx, 'end_time', e.target.value)}
                              placeholder="e.g. 09:00"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {issues.length > 0 ? (
                              <div className="cursor-pointer" onClick={() => swalFire('Validation Error', issues.join('. '), 'error')}>
                                <div className="font-semibold text-rose-600">Action Required</div>
                                <div className="text-[10px] text-rose-500 truncate max-w-[120px]">
                                  {issues[0]}
                                </div>
                              </div>
                            ) : (
                              <span className="font-semibold text-emerald-600">Ready to Save</span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-xs text-gray-500 mt-2">Showing {importPreviewRows.length} row(s).</div>
              </div>
            )}

            <div className="flex justify-end items-center gap-2">
              <button type="button" onClick={closeImportReviewModal} className="px-3 py-2 rounded border bg-white text-sm">Cancel</button>
              <button type="button" onClick={handleValidateImportDraft} disabled={submittingReviewedImport || !importPreviewRows.length || hasSchedulingDependencyBlockers} className="px-4 py-2 rounded border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 text-sm">
                {submittingReviewedImport ? 'Validating...' : 'Validate'}
              </button>
              <button type="button" onClick={handleConfirmImportSubmit} disabled={submittingReviewedImport || !importPreviewRows.length || hasSchedulingDependencyBlockers || Object.keys(previewErrorsByRow).length > 0} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed disabled:text-gray-200">
                {submittingReviewedImport ? 'Submitting...' : 'Submit Import'}
              </button>
            </div>
          </div>
        </Modal>

        <Modal show={showHistoricalModal} title="Historical Schedules Archive" onClose={closeHistoricalModal} size="xxl">
          <div className="space-y-4">
            <div className={`rounded-xl border p-4 ${activeSemesterId ? 'border-green-200 bg-green-50 text-green-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1">Semester Context</div>
              <div className="text-sm font-semibold">
                {activeSemesterId
                  ? `Currently active: ${activeSemesterLabel}`
                  : 'No active semester set for today.'}
              </div>
              <div className="text-xs mt-1">Select a semester below to browse historical schedules from past academic terms.</div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-600 mb-3">Filter Historical Records</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Semester</label>
                  <select value={historicalFilterSemester} onChange={e => setHistoricalFilterSemester(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Semesters</option>
                    {historicalSemesterOptions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Department</label>
                  <select value={historicalFilterDept} onChange={e => setHistoricalFilterDept(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Departments</option>
                    {departments.map(d => <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Program</label>
                  <select value={historicalFilterProgram} onChange={e => setHistoricalFilterProgram(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Programs</option>
                    {historicalProgramOptions.map(p => <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Teacher</label>
                  <select value={historicalFilterTeacher} onChange={e => setHistoricalFilterTeacher(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Teachers</option>
                    {availableTeachers.map(t => <option key={t.user_id} value={t.user_id}>{t.first_name} {t.last_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Day</label>
                  <select value={historicalFilterDay} onChange={e => setHistoricalFilterDay(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Days</option>
                    {DAY_OPTIONS.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Subject</label>
                  <select value={historicalFilterSubject} onChange={e => setHistoricalFilterSubject(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Subjects</option>
                    {subjects.map(s => <option key={s.subject_id} value={s.subject_id}>{s.subject_code} - {s.subject_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Section</label>
                  <select value={historicalFilterSection} onChange={e => setHistoricalFilterSection(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2 text-sm">
                    <option value="">All Sections</option>
                    {sections.map(s => <option key={s.section_id} value={s.section_id}>{s.section_name}</option>)}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => {
                      setHistoricalFilterSemester(activeSemesterId ? String(activeSemesterId) : '');
                      setHistoricalFilterDept(isProgramHead ? String(programHeadDeptId || '') : (isDean ? String(deanDeptId || '') : ''));
                      setHistoricalFilterProgram(isProgramHead ? String(programHeadProgramId || '') : '');
                      setHistoricalFilterTeacher('');
                      setHistoricalFilterDay('');
                      setHistoricalFilterSubject('');
                      setHistoricalFilterSection('');
                    }}
                    className="w-full px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold uppercase tracking-wide text-slate-600 transition hover:bg-slate-100"
                  >
                    Reset Filters
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
                <div className="text-sm font-semibold text-gray-800">Historical Schedule Records</div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
                  {historicalFilteredSchedules.length} record(s)
                </div>
              </div>
              <div className="p-3 sm:p-4">
                {historicalLoading ? (
                  <div className="text-center py-10 text-sm text-slate-500">Loading historical schedules...</div>
                ) : historicalFilteredSchedules.length === 0 ? (
                  <div className="text-center py-14 border-2 border-dashed border-slate-200 rounded-2xl">
                    <div className="text-slate-400 mb-2 text-lg font-medium">📚 No historical schedules found</div>
                    <p className="text-sm text-slate-500 max-w-md mx-auto">
                      No class schedules match the selected filter criteria. Try adjusting your filters or selecting a different semester to browse past academic records.
                    </p>
                  </div>
                ) : (
                  <Table
                    columns={[
                      { key:'display_index', label:'#', render: (s) => <span>{s.display_index}</span> },
                      { key:'teacher', label:'Teacher', render:(s)=> <span>{s.teacher_name || (s.first_name ? `${s.first_name} ${s.last_name}` : 'N/A')}</span> },
                      { key:'subject', label:'Subject', render:(s)=> <span>{`${s.subject_code || 'N/A'}${s.subject_name ? ` - ${s.subject_name}` : ''}`}</span> },
                      { key:'section', label:'Section', render:(s)=> <span>{s.section_name || 'N/A'}</span> },
                      { key:'day_of_week', label:'Day', render: (s) => <span>{s.day_of_week ? s.day_of_week.charAt(0).toUpperCase() + s.day_of_week.slice(1) : ''}</span> },
                      { key:'time', label:'Time', render:(s)=> <span>{`${formatToAmPm(s.start_time?.slice(0,5)||'')} - ${formatToAmPm(s.end_time?.slice(0,5)||'')}`}</span> },
                      {
                        key: 'type',
                        label: 'Session Type',
                        render: (s) => {
                          const isParallel = isParallelSession(s);
                          return isParallel ? (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">Parallel Session</span>
                          ) : (
                            <span className="text-xs text-slate-400 italic">Standard</span>
                          );
                        }
                      },
                      { key:'room_name', label:'Room', render: (s) => <span>{s.room_name || '-'}</span> },
                      {
                        key: 'semester_label',
                        label: 'Semester',
                        render: (s) => {
                          const sem = semesters.find(sem => Number(sem.semester_id) === Number(s.semester_id));
                          return <span className="text-xs">{sem ? `${sem.session_name || sem.school_year || ''} ${sem.term || sem.semester_name || ''}`.trim() || `Semester ${sem.semester_id}` : '-'}</span>;
                        }
                      },
                      {
                        key:'actions',
                        label:'Actions',
                        actions: (row) => [{ label:'View', onClick: ()=> openViewModal(row) }]
                      }
                    ]}
                    data={historicalFilteredSchedules}
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
              <button type="button" onClick={closeHistoricalModal} className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 text-sm">Close</button>
            </div>
          </div>
        </Modal>

        <Modal show={canUseBulkScheduleTools && showBatchModal} title="Batch Add Schedules" onClose={closeBatchModal} size="xxl">
          <div className="space-y-5">
            <div className={`text-sm rounded px-3 py-2 border ${activeSemesterId ? 'bg-green-50 text-green-800 border-green-200' : 'bg-red-50 text-red-800 border-red-200'}`}>
              {activeSemesterId
                ? `Active semester is used automatically: ${activeSemesterLabel || 'Current term'}.`
                : 'No active semester is available for today. Batch submit/import will be blocked.'}
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Header Filters</div>
              <div className={`grid grid-cols-1 ${isProgramHead ? 'md:grid-cols-2' : (isDean ? 'md:grid-cols-3' : 'md:grid-cols-4')} gap-4`}>
              {!isProgramHead && !isDean && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                  <select value={headerDept} onChange={e=>setHeaderDept(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2">
                    <option value="">All Departments</option>
                    {activeDepartments.map(d=> <option key={d.dept_id} value={d.dept_id}>{d.dept_name}</option>)}
                  </select>
                </div>
              )}
              {!isProgramHead && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Program</label>
                  <select value={headerProgram} onChange={e=>setHeaderProgram(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2">
                    <option value="">All Programs</option>
                    {filteredPrograms.map(p=> <option key={p.program_id} value={p.program_id}>{p.program_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
                <select value={headerBuilding} onChange={e=>setHeaderBuilding(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2">
                  <option value="">All Buildings</option>
                  {activeBuildings.map(b=> <option key={b.building_id} value={b.building_id}>{b.building_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Floor</label>
                <select value={headerFloor} onChange={e=>setHeaderFloor(e.target.value)} className="block w-full border border-gray-200 rounded px-3 py-2">
                  <option value="">All Floors</option>
                  {filteredFloors.map(f=> <option key={f.floor_id} value={f.floor_id}>{f.floor_name}</option>)}
                </select>
              </div>
            </div>
            {isProgramHead && (
              <div className="mt-2 text-xs text-gray-600">
                Department and program are fixed to your account assignment.
              </div>
            )}
            {isDean && (
              <div className="mt-2 text-xs text-gray-600">
                Department is fixed to your account assignment.
              </div>
            )}
            {hasSchedulingDependencyBlockers && (
              <div className="mt-2 text-xs text-red-700">
                Batch add/import blocked until these are active: {schedulingDependencyBlockersText}.
              </div>
            )}
            </div>

            <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Batch Row Form</div>
                <label className="flex items-center gap-2 text-sm font-medium text-blue-800 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={batchForm.isParallel}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setBatchForm(f => {
                        // When enabling parallel mode, keep current values locked
                        // When disabling, just toggle the flag
                        return { ...f, isParallel: checked };
                      });
                    }}
                    className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span>Parallel Class Mode</span>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                <select name="subject_id" value={batchForm.subject_id} onChange={handleBatchChange} disabled={batchForm.isParallel} className="block w-full border border-gray-200 rounded px-3 py-2 disabled:bg-gray-200 disabled:cursor-not-allowed">
                  <option value="">Select subject</option>
                  {filteredSubjects.map(s=> <option key={s.subject_id} value={s.subject_id}>{s.subject_code} - {s.subject_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
                <select name="section_id" value={batchForm.section_id} onChange={handleBatchChange} className="block w-full border border-gray-200 rounded px-3 py-2">
                  <option value="">Select section</option>
                  {filteredSections.map(s=> <option key={s.section_id} value={s.section_id}>{s.section_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teacher</label>
                <select name="user_id" value={batchForm.user_id} onChange={handleBatchChange} className="block w-full border border-gray-200 rounded px-3 py-2">
                  <option value="">Select teacher</option>
                  {batchTeachers.map(t=> <option key={t.user_id} value={t.user_id}>{t.first_name} {t.last_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
                <select name="room_id" value={batchForm.room_id} onChange={handleBatchChange} className="block w-full border border-gray-200 rounded px-3 py-2">
                  <option value="">Select room</option>
                  {filteredRooms.map(r=> <option key={r.room_id} value={r.room_id}>{r.room_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Day</label>
                <select name="day_of_week" value={batchForm.day_of_week} onChange={handleBatchChange} disabled={batchForm.isParallel} className="block w-full border border-gray-200 rounded px-3 py-2 disabled:bg-gray-200 disabled:cursor-not-allowed">
                  {DAY_OPTIONS.map(d=> <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <input
                  type="time"
                  name="start_time"
                  value={batchForm.start_time}
                  onChange={handleBatchChange}
                  disabled={batchForm.isParallel}
                  className="w-full block border border-gray-200 rounded px-3 py-2 disabled:bg-gray-200 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <input
                  type="time"
                  name="end_time"
                  value={batchForm.end_time}
                  onChange={handleBatchChange}
                  disabled={batchForm.isParallel}
                  className="w-full block border border-gray-200 rounded px-3 py-2 disabled:bg-gray-200 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <div className="flex justify-end items-center gap-2 mt-4">
              {editingBatchIndex !== null && (
                <button type="button" onClick={handleBatchCancelEdit} className="px-4 py-2 rounded border bg-white text-sm">Cancel Edit</button>
              )}
              <button
                type="button"
                onClick={() => {
                  setBatchForm({ isParallel: false, room_id:'', subject_id:'', section_id:'', user_id:'', day_of_week:'monday', start_time:'', end_time:'' });
                  setEditingBatchIndex(null);
                }}
                className="px-4 py-2 rounded border bg-white text-sm hover:bg-gray-50"
              >
                Clear
              </button>
              <button type="button" onClick={handleBatchAdd} disabled={hasSchedulingDependencyBlockers} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {editingBatchIndex !== null ? 'Update Row' : 'Add Row'}
              </button>
            </div>
            </div>

            {batchRows.length > 0 && (
              <div className="overflow-x-auto bg-gray-50 rounded-xl shadow-sm border border-gray-200 p-4">
                <table className="w-full text-sm text-left text-gray-500">
                  <thead className="text-xs text-gray-700 uppercase bg-gray-100">
                    <tr>
                      <th className="px-6 py-3">Subject</th>
                      <th className="px-6 py-3">Section</th>
                      <th className="px-6 py-3">Teacher</th>
                      <th className="px-6 py-3">Room</th>
                      <th className="px-6 py-3">Day</th>
                      <th className="px-6 py-3">Time</th>
                      <th className="px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedBatchRows.map((row, idx) => {
                      const actualIndex = ((batchPage - 1) * BATCH_PAGE_SIZE) + idx;
                      return (
                        <tr key={actualIndex} className="bg-white border-b">
                          <td className="px-6 py-4">{subjectLabelById[String(row.subject_id)] || row.subject_id}</td>
                          <td className="px-6 py-4">{sectionLabelById[String(row.section_id)] || row.section_id}</td>
                          <td className="px-6 py-4">{teacherLabelById[String(row.user_id)] || row.user_id}</td>
                          <td className="px-6 py-4">{roomLabelById[String(row.room_id)] || row.room_id}</td>
                          <td className="px-6 py-4">{row.day_of_week ? row.day_of_week.charAt(0).toUpperCase() + row.day_of_week.slice(1) : ''}</td>
                          <td className="px-6 py-4">{`${formatToAmPm(row.start_time)} - ${formatToAmPm(row.end_time)}`}</td>
                          <td className="px-6 py-4 space-x-3">
                            <button type="button" onClick={() => handleBatchEdit(actualIndex)} className="text-blue-700 hover:underline">Edit</button>
                            <button type="button" onClick={() => handleBatchRemove(actualIndex)} className="text-red-600 hover:underline">Remove</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-600">
                  <div>Showing {pagedBatchRows.length} of {batchRows.length} rows</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                      disabled={batchPage <= 1}
                      onClick={() => setBatchPage(p => Math.max(1, p - 1))}
                    >
                      Prev
                    </button>
                    <span>Page {batchPage} of {totalBatchPages}</span>
                    <button
                      type="button"
                      className="px-2 py-1 rounded border bg-white disabled:opacity-40"
                      disabled={batchPage >= totalBatchPages}
                      onClick={() => setBatchPage(p => Math.min(totalBatchPages, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end items-center gap-2 border-t border-gray-200 pt-4">
              <button type="button" onClick={closeBatchModal} className="px-3 py-2 rounded border bg-white text-sm">Cancel</button>
              <button type="button" onClick={handleBatchSubmit} disabled={importing || hasSchedulingDependencyBlockers} className="px-5 py-2 rounded bg-green-600 text-white hover:bg-green-700">{importing ? 'Submitting...' : 'Submit Batch'}</button>
            </div>
          </div>
        </Modal>
      </div>
    );
  }

  export default ClassScheduleIndex;