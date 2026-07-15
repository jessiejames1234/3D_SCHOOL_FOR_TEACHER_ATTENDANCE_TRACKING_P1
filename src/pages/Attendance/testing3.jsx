import React from 'react';
import Modal from '../../components/Modal.jsx';
// Ensure these components exist in your project or adjust imports
import { apiGet, apiPost } from '../../services/api.js';

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '/server-php/api';
const ALTITUDE_CALIBRATION_STORAGE_KEY = 'attendance_altitude_calibration_v1';
const IOS_CALIBRATION_MAX_OFFSET_METERS = 200;

// --- Helpers ---
const deg2rad = (deg) => (deg * Math.PI) / 180;
const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const detectDevicePlatform = () => {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = String(navigator.userAgent || '');
  const platform = String(navigator.userAgentData?.platform || navigator.platform || '');
  if (/android/i.test(ua) || /android/i.test(platform)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua) || /iphone|ipad|ipod/i.test(platform)) return 'ios';
  if (/mac/i.test(platform) && Number(navigator.maxTouchPoints || 0) > 1) return 'ios';
  if (/windows|mac|linux/i.test(platform)) return 'desktop';
  return 'unknown';
};

const altitudeCalibrationKey = (platform, buildingId) => `${platform || 'unknown'}:${buildingId || 'global'}`;

const readAltitudeCalibrationMap = () => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(ALTITUDE_CALIBRATION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
};

const readAltitudeCalibration = (platform, buildingId = null) => {
  const map = readAltitudeCalibrationMap();
  const specific = map[altitudeCalibrationKey(platform, buildingId)];
  const fallback = map[altitudeCalibrationKey(platform, null)];
  const found = specific || fallback || null;
  return found && toFiniteNumber(found.offset) !== null ? found : null;
};

const saveAltitudeCalibration = (calibration) => {
  if (typeof localStorage === 'undefined' || !calibration) return;
  const platform = calibration.platform || 'unknown';
  const map = readAltitudeCalibrationMap();
  map[altitudeCalibrationKey(platform, calibration.building_id)] = calibration;
  map[altitudeCalibrationKey(platform, null)] = calibration;
  try {
    localStorage.setItem(ALTITUDE_CALIBRATION_STORAGE_KEY, JSON.stringify(map));
  } catch (e) {}
};

const getDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return Infinity;
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const isInsideBox = (coords, room) => {
  if (!coords || !room) return false;
  const metersPerDegLat = 111320;
  const deltaLat = Number(room.radius) / metersPerDegLat;
  const latRad = deg2rad(Number(room.latitude || 0));
  const metersPerDegLon = Math.max(1e-6, metersPerDegLat * Math.cos(latRad));
  const deltaLon = Number(room.radius) / metersPerDegLon;
    
  const minLat = Number(room.latitude) - deltaLat;
  const maxLat = Number(room.latitude) + deltaLat;
  const minLon = Number(room.longitude) - deltaLon;
  const maxLon = Number(room.longitude) + deltaLon;

  return coords.latitude >= minLat && coords.latitude <= maxLat && 
         coords.longitude >= minLon && coords.longitude <= maxLon;
};

const formatDateYMD = (d) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatTime12 = (value) => {
  if (!value) return '—';
  const timeStr = value.includes('T') ? value : `1970-01-01T${value}`;
  const d = new Date(timeStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

const timeKey = (value) => String(value || '').slice(0, 5);

const subjectKey = (record) => {
  if (!record) return '';
  if (record.subject_id !== undefined && record.subject_id !== null && String(record.subject_id) !== '') {
    return `id:${record.subject_id}`;
  }
  return `text:${String(record.subject_code || record.subject_name || '').trim().toLowerCase()}`;
};

const isSameScheduleGroup = (a, b) => {
  if (!a || !b) return false;
  return String(a.date || '') === String(b.date || '')
    && timeKey(a.start_time) === timeKey(b.start_time)
    && timeKey(a.end_time) === timeKey(b.end_time)
    && subjectKey(a) === subjectKey(b);
};

const isRecordActiveNow = (record, now = new Date()) => {
  if (!record?.date || !record?.start_time || !record?.end_time) return false;
  const start = new Date(`${record.date}T${record.start_time}`);
  const end = new Date(`${record.date}T${record.end_time}`);
  return now >= start && now <= end;
};

const getFlagLabel = (flagId) => {
  switch (Number(flagId)) {
    case 1: return 'Upcoming';
    case 2: return 'Present';
    case 3: return 'Absent';
    case 4: return 'Substituted';
    case 5: return 'Late';
    case 7: return 'On Leave';
    case 8: return 'Pending';
    default: return '—';
  }
};

const formatClockDate = (d) => {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '—';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const month = months[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${month} ${day},${year} ${hours}:${minutes}${ampm}`;
};

export default function AttendanceIndex() {
  const [userId, setUserId] = React.useState(null);
  const [teacherName, setTeacherName] = React.useState('');
    
  const [records, setRecords] = React.useState([]);
  const [rooms, setRooms] = React.useState([]);
  const [floors, setFloors] = React.useState([]);
  const [buildings, setBuildings] = React.useState([]);
  const [currentBuilding, setCurrentBuilding] = React.useState(null);
    
  const [coords, setCoords] = React.useState(null);
  const [errorMessage, setErrorMessage] = React.useState(null);
  const [wrongFloorInfo, setWrongFloorInfo] = React.useState(null);
  const [filterMode, setFilterMode] = React.useState('today');
    
  const [actionAllowed, setActionAllowed] = React.useState(false);
  const [allowAt, setAllowAt] = React.useState(null);
  const [currentAction, setCurrentAction] = React.useState(null);
    
  const [isCameraVisible, setIsCameraVisible] = React.useState(false);
  const [detectedFloor, setDetectedFloor] = React.useState(null);
  const [usingDbFloor, setUsingDbFloor] = React.useState(false);

  const debugVideoRef = React.useRef(null);
  const previewStreamRef = React.useRef(null);
  const [previewActive, setPreviewActive] = React.useState(false);
  const scannerStartedRef = React.useRef(false);
  const handleCheckNowRef = React.useRef(null);
    
  const [nextSchedule, setNextSchedule] = React.useState(null);
  const [nextStartDate, setNextStartDate] = React.useState(null);
  const [nextSecondsLeft, setNextSecondsLeft] = React.useState(null);

  const [cameraPermission, setCameraPermission] = React.useState('prompt');

  const [scannedQrToken, setScannedQrToken] = React.useState(null);
  const [scannedFloor, setScannedFloor] = React.useState(null);
  const [devicePlatform] = React.useState(() => detectDevicePlatform());
  const [connectionQuality, setConnectionQuality] = React.useState(null);
  const pingIntervalRef = React.useRef(null);

  const [nowClock, setNowClock] = React.useState(new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNowClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const measurePing = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setConnectionQuality({ rtt: null, effectiveType: 'offline', label: 'No Signal', color: '#6c757d' });
        return;
      }
      const start = performance.now();
      let ok = true;
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 5000);
        await fetch('/server-php/api/ping.json?t=' + Date.now(), { method: 'GET', cache: 'no-store', mode: 'no-cors', signal: ctrl.signal });
        clearTimeout(timeout);
      } catch (_) { ok = false; }
      const elapsed = Math.round(performance.now() - start);
      if (!ok) {
        setConnectionQuality({ rtt: null, effectiveType: 'unknown', label: 'No Signal', color: '#6c757d' });
        return;
      }
      const clamped = Math.min(Math.max(elapsed, 0), 999);
      let label, color;
      if (clamped < 100) { label = 'Good'; color = '#28a745'; }
      else if (clamped < 200) { label = 'Fair'; color = '#ffc107'; }
      else { label = 'Poor'; color = '#dc3545'; }
      setConnectionQuality({ rtt: clamped, effectiveType: navigator.connection?.effectiveType || 'unknown', label, color });
    };
    measurePing();
    const onOnline = () => measurePing();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', () => setConnectionQuality({ rtt: null, effectiveType: 'offline', label: 'No Signal', color: '#6c757d' }));
    pingIntervalRef.current = setInterval(measurePing, 3000);
    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
    }, []);
  const [altitudeCalibration, setAltitudeCalibration] = React.useState(null);
  const LOCAL_STORAGE_KEY = 'attendance_scanned_qr_v1';

  // --- Logic Effects ---
  React.useEffect(() => {
    try {
      const floorsReady = Array.isArray(floors) && floors.length > 0;
      const recordsReady = Array.isArray(records); 
      if (!floorsReady || !recordsReady) return; 

      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.token) return;

      const now = new Date();
      const todayStr = formatDateYMD(now);
      const todays = records.filter(r => r.date === todayStr);
      const active = todays.find(r => {
        if (!r.start_time || !r.end_time) return false;
        const start = new Date(`${r.date}T${r.start_time}`);
        const end = new Date(`${r.date}T${r.end_time}`);
        return now >= start && now <= end;
      }) || null;

      if (parsed.schedule_id && active && (String(parsed.schedule_id) !== String(active.schedule_id))) {
        const parsedRecord = todays.find(r => String(r.schedule_id) === String(parsed.schedule_id));
        if (parsedRecord && isSameScheduleGroup(parsedRecord, active)) {
          // Keep one QR scan alive when the teacher has multiple sections in the same subject/time slot.
        } else {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
          return;
        }
      }

      if (parsed.group_key && active && parsed.group_key !== `${active.date}|${subjectKey(active)}|${timeKey(active.start_time)}|${timeKey(active.end_time)}`) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return;
      }

      if (parsed.floor_id) {
        const f = floors.find(ff => String(ff.floor_id) === String(parsed.floor_id));
        if (f) {
          setScannedQrToken(parsed.token);
          setScannedFloor(f);
        } else {
          localStorage.removeItem(LOCAL_STORAGE_KEY);
        }
      } else {
        setScannedQrToken(parsed.token);
      }
    } catch (e) { }
  }, [floors, records]);

  React.useEffect(() => {
    try {
      if (!scannedQrToken) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        return;
      }
      const now = new Date();
      const todayStr = formatDateYMD(now);
      const todays = records.filter(r => r.date === todayStr);
      const active = todays.find(r => {
        if (!r.start_time || !r.end_time) return false;
        const start = new Date(`${r.date}T${r.start_time}`);
        const end = new Date(`${r.date}T${r.end_time}`);
        return now >= start && now <= end;
      }) || null;

      const payload = {
        token: scannedQrToken,
        floor_id: scannedFloor ? scannedFloor.floor_id : null,
        schedule_id: active ? active.schedule_id : null,
        group_key: active ? `${active.date}|${subjectKey(active)}|${timeKey(active.start_time)}|${timeKey(active.end_time)}` : null,
        ts: Date.now()
      };
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {}
  }, [scannedQrToken, scannedFloor, records]);

  const lastCoordsRef = React.useRef(null);
  const watchIdRef = React.useRef(null);
  const pollingRef = React.useRef(null);
  const isFetchingRef = React.useRef(false);
  const pausedPollingRef = React.useRef(false);

  const ACCURACY_THRESHOLD_METERS = 30;
  const ALTITUDE_ACCURACY_THRESHOLD_METERS = 30;
  const LOCATION_DISTANCE_INTERVAL_METERS = 5;
  const BUILDING_TOLERANCE_METERS = 10;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const uid = params.get('userId');
    const nameParam = params.get('name') || '';
    if (uid) {
      setUserId(Number(uid));
      setTeacherName(nameParam);
      return;
    }
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && (parsed.user_id || parsed.id || parsed.userId)) {
          const resolvedId = parsed.user_id || parsed.id || parsed.userId;
          setUserId(Number(resolvedId));
          setTeacherName((parsed.first_name && parsed.last_name) ? `${parsed.first_name} ${parsed.last_name}` : (nameParam || parsed.name || ''));
          return;
        }
      }
    } catch (e) {}
    setUserId(null);
    setTeacherName(nameParam || '');
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const [roomsData, floorsData] = await Promise.all([apiGet('rooms'), apiGet('floors')]);
        if (Array.isArray(roomsData)) setRooms(roomsData);
        if (Array.isArray(floorsData)) setFloors(floorsData);
      } catch (err) {
        console.error('Failed loading rooms/floors (initial):', err);
      }
    })();
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        const data = await apiGet('buildings');
        setBuildings(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error('Failed to load buildings', e);
      }
    })();
  }, []);

  const loadMyAttendance = React.useCallback(async () => {
    if (!userId || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const data = await apiGet(`attendance?teacher_id=${userId}`);
      setRecords(Array.isArray(data) ? data : []);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err && err.message ? `Network Error: ${err.message}` : 'Network Error');
    } finally {
      isFetchingRef.current = false;
    }
  }, [userId]);

  const startLocationTracking = React.useCallback(() => {
    if (!('geolocation' in navigator)) {
      setErrorMessage('Geolocation is not supported.');
      return;
    }
    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const newCoords = pos.coords;
          const last = lastCoordsRef.current;
          if (last) {
            const dist = getDistanceMeters(newCoords.latitude, newCoords.longitude, last.latitude, last.longitude);
            if (dist < LOCATION_DISTANCE_INTERVAL_METERS) return; 
          }
          lastCoordsRef.current = newCoords;
          setCoords(newCoords);
          setErrorMessage(null);
        },
        (err) => {
          setErrorMessage(`GPS Error: ${err && err.message ? err.message : String(err)}`);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } catch (err) {
      setErrorMessage('Failed to start geolocation: ' + (err.message || err));
    }
  }, []);

  const gpsPollRef = React.useRef(null);
  const LOCATION_POLL_INTERVAL_MS = 2000;

  const startGpsPoll = React.useCallback(() => {
    if (gpsPollRef.current) return;
    if (!('geolocation' in navigator)) return;
    gpsPollRef.current = setInterval(() => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const newCoords = pos.coords;
            lastCoordsRef.current = newCoords;
            setCoords(newCoords);
            setErrorMessage(null);
          },
          (err) => {
            console.debug('GPS Poll Error (suppressed in UI):', err && err.message ? err.message : String(err));
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      } catch (e) {}
    }, LOCATION_POLL_INTERVAL_MS);
  }, []);

  const stopGpsPoll = React.useCallback(() => {
    try {
      if (gpsPollRef.current) {
        clearInterval(gpsPollRef.current);
        gpsPollRef.current = null;
      }
    } catch (e) {}
  }, []);

  React.useEffect(() => {
    const update = () => {
      try {
        const visible = (typeof document !== 'undefined') ? document.visibilityState === 'visible' : true;
        if (userId && visible && !isCameraVisible) startGpsPoll(); else stopGpsPoll();
      } catch (e) {}
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => { stopGpsPoll(); document.removeEventListener('visibilitychange', update); };
  }, [userId, isCameraVisible, startGpsPoll, stopGpsPoll]);

  React.useEffect(() => {
    if (!userId) return;
    (async () => {
      try {
        const [roomsData, floorsData] = await Promise.all([
          apiGet('rooms'),
          apiGet('floors')
        ]);
        if (Array.isArray(roomsData)) setRooms(roomsData);
        if (Array.isArray(floorsData)) setFloors(floorsData);
      } catch (err) {
        console.error('Failed loading rooms/floors', err);
      }
    })();
    loadMyAttendance();
    startLocationTracking();
    pollingRef.current = setInterval(loadMyAttendance, 5000);
    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [userId, loadMyAttendance, startLocationTracking]);

  const detectFloorFromAltitude = React.useCallback((alt, buildingId = null) => {
    if (alt == null || !floors.length) return null;
    const candidates = buildingId ? floors.filter(f => f.building_id === buildingId) : floors;
    if (!candidates.length) return null;
    let best = null;
    for (const f of candidates) {
      if (f.baseline_altitude == null) continue;
      const diff = Math.abs(Number(f.baseline_altitude) - Number(alt));
      if (!best || diff < best.diff) {
        best = { diff, floor: f };
      }
    }
    return best ? best.floor : null;
  }, [floors]);

  const getActiveSchedules = React.useCallback(() => {
    const now = new Date();
    const todayStr = formatDateYMD(now);
    const todays = records.filter(r => r.date === todayStr);
    return todays.filter(r => isRecordActiveNow(r, now));
  }, [records]);

  const pickScheduleByLocation = React.useCallback((items) => {
    if (!Array.isArray(items) || !items.length) return null;

    const roomFor = (rec) => rooms.find(r => Number(r.room_id) === Number(rec.room_id)) || null;

    if (coords) {
      let best = null;
      for (const rec of items) {
        const room = roomFor(rec);
        if (!room || room.latitude == null || room.longitude == null) continue;
        if (scannedFloor && Number(room.floor_id) !== Number(scannedFloor.floor_id)) continue;
        if (!isInsideBox(coords, room)) continue;
        const dist = getDistanceMeters(coords.latitude, coords.longitude, Number(room.latitude), Number(room.longitude));
        if (!best || dist < best.dist) best = { rec, dist };
      }
      if (best) return best.rec;
    }

    if (scannedFloor) {
      const onScannedFloor = items.find(rec => {
        const room = roomFor(rec);
        return room && Number(room.floor_id) === Number(scannedFloor.floor_id);
      });
      if (onScannedFloor) return onScannedFloor;
    }

    if (coords) {
      let best = null;
      for (const rec of items) {
        const room = roomFor(rec);
        if (!room || room.latitude == null || room.longitude == null) continue;
        if (!isInsideBox(coords, room)) continue;
        const dist = getDistanceMeters(coords.latitude, coords.longitude, Number(room.latitude), Number(room.longitude));
        if (!best || dist < best.dist) best = { rec, dist };
      }
      if (best) return best.rec;
    }

    return items[0];
  }, [coords, rooms, scannedFloor]);

  const findActiveSchedule = React.useCallback(() => {
    return pickScheduleByLocation(getActiveSchedules());
  }, [getActiveSchedules, pickScheduleByLocation]);

  const findMatchingScheduleGroup = React.useCallback((base) => {
    if (!base) return [];
    return getActiveSchedules().filter(r => isSameScheduleGroup(r, base));
  }, [getActiveSchedules]);

  const activeSchedule = React.useMemo(() => findActiveSchedule(), [findActiveSchedule]);
  const activeScheduleGroup = React.useMemo(() => (
    activeSchedule ? findMatchingScheduleGroup(activeSchedule) : []
  ), [activeSchedule, findMatchingScheduleGroup]);

  const getScheduleRoomName = React.useCallback((record) => {
    if (!record) return '';
    if (record.room_name) return String(record.room_name);
    const room = rooms.find(r => Number(r.room_id) === Number(record.room_id));
    return room?.room_name ? String(room.room_name) : '';
  }, [rooms]);

  const getParallelRoomNames = React.useCallback((record) => {
    if (!record) return [];
    const seen = new Set();
    return records
      .filter(other => {
        if (!other || !isSameScheduleGroup(other, record)) return false;
        const sameAttendance = other.attendance_id && record.attendance_id && String(other.attendance_id) === String(record.attendance_id);
        const sameSchedule = other.schedule_id && record.schedule_id && String(other.schedule_id) === String(record.schedule_id);
        return !(sameAttendance || sameSchedule);
      })
      .map(getScheduleRoomName)
      .filter(name => {
        const key = name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [records, getScheduleRoomName]);

  const activeOtherParallelRoomNames = React.useMemo(() => (
    activeSchedule ? getParallelRoomNames(activeSchedule) : []
  ), [activeSchedule, getParallelRoomNames]);

  const activeParallelRoomNames = React.useMemo(() => {
    if (activeScheduleGroup.length <= 1) return [];
    const seen = new Set();
    return activeScheduleGroup
      .map(getScheduleRoomName)
      .filter(name => {
        const key = name.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [activeScheduleGroup, getScheduleRoomName]);

  const currentRoomObj = React.useMemo(() => {
    return activeSchedule ? rooms.find(r => Number(r.room_id) === Number(activeSchedule.room_id)) || null : null;
  }, [activeSchedule, rooms]);

  const scheduledBuildingObj = React.useMemo(() => {
    if (!currentRoomObj || !Array.isArray(buildings)) return null;
    return buildings.find(b => Number(b.building_id) === Number(currentRoomObj.building_id)) || null;
  }, [currentRoomObj, buildings]);

  const altitudeCalibrationBuildingId = React.useMemo(() => {
    const id = scannedFloor?.building_id ?? currentRoomObj?.building_id ?? currentBuilding?.building_id ?? scheduledBuildingObj?.building_id ?? null;
    const n = toFiniteNumber(id);
    return n !== null ? Number(n) : null;
  }, [scannedFloor, currentRoomObj, currentBuilding, scheduledBuildingObj]);

  const rawAltitude = React.useMemo(() => toFiniteNumber(coords?.altitude), [coords]);

  React.useEffect(() => {
    setAltitudeCalibration(readAltitudeCalibration(devicePlatform, altitudeCalibrationBuildingId));
  }, [devicePlatform, altitudeCalibrationBuildingId]);

  React.useEffect(() => {
    if (devicePlatform !== 'ios' || !scannedFloor) return;
    const baseline = toFiniteNumber(scannedFloor.baseline_altitude);
    if (baseline === null || rawAltitude === null) return;

    const offset = baseline - rawAltitude;
    if (!Number.isFinite(offset) || Math.abs(offset) > IOS_CALIBRATION_MAX_OFFSET_METERS) return;

    const calibration = {
      platform: devicePlatform,
      building_id: altitudeCalibrationBuildingId,
      floor_id: scannedFloor.floor_id ?? null,
      offset,
      raw_altitude: rawAltitude,
      baseline_altitude: baseline,
      updated_at: Date.now()
    };

    saveAltitudeCalibration(calibration);
    setAltitudeCalibration(prev => {
      const prevOffset = toFiniteNumber(prev?.offset);
      if (
        prev &&
        prevOffset !== null &&
        Math.abs(prevOffset - offset) < 1 &&
        String(prev.floor_id || '') === String(calibration.floor_id || '')
      ) {
        return prev;
      }
      return calibration;
    });
  }, [devicePlatform, scannedFloor, rawAltitude, altitudeCalibrationBuildingId]);

  const attendanceAltitude = React.useMemo(() => {
    const info = {
      platform: devicePlatform,
      building_id: altitudeCalibrationBuildingId,
      raw: rawAltitude,
      normalized: rawAltitude,
      offset: null,
      source: 'raw',
      calibrated: false
    };

    if (devicePlatform !== 'ios') return info;

    const scannedBaseline = toFiniteNumber(scannedFloor?.baseline_altitude);
    if (scannedBaseline !== null) {
      if (rawAltitude === null) {
        return {
          ...info,
          normalized: scannedBaseline,
          source: 'ios_scanned_floor',
          calibrated: true
        };
      }
      const offset = scannedBaseline - rawAltitude;
      if (Number.isFinite(offset) && Math.abs(offset) <= IOS_CALIBRATION_MAX_OFFSET_METERS) {
        return {
          ...info,
          normalized: rawAltitude + offset,
          offset,
          source: 'ios_scanned_floor',
          calibrated: true
        };
      }
    }

    if (rawAltitude === null) return info;

    const storedOffset = toFiniteNumber(altitudeCalibration?.offset);
    if (storedOffset !== null && Math.abs(storedOffset) <= IOS_CALIBRATION_MAX_OFFSET_METERS) {
      return {
        ...info,
        normalized: rawAltitude + storedOffset,
        offset: storedOffset,
        source: 'ios_saved_offset',
        calibrated: true
      };
    }

    return info;
  }, [devicePlatform, altitudeCalibrationBuildingId, rawAltitude, scannedFloor, altitudeCalibration]);

  React.useEffect(() => {
    if (!coords || !Array.isArray(buildings) || buildings.length === 0) { setCurrentBuilding(null); return; }
    let best = null;
    for (const b of buildings) {
      const bLat = (b.latitude ?? b.lat ?? b.altitude ?? null);
      const bLon = (b.longitude ?? b.lon ?? b.lng ?? b.longitude ?? null);
      const bRadius = Number(b.radius ?? b.building_radius ?? 0);
      if (bLat == null || bLon == null) continue;
      const d = getDistanceMeters(coords.latitude, coords.longitude, Number(bLat), Number(bLon));
      if (d <= bRadius) {
        if (!best || d < best.dist) best = { building: b, dist: d };
      }
    }
    try {
      if (scheduledBuildingObj && coords && (scheduledBuildingObj.latitude != null) && (scheduledBuildingObj.longitude != null)) {
        const schedLat = Number(scheduledBuildingObj.latitude);
        const schedLon = Number(scheduledBuildingObj.longitude);
        const schedRadius = Number(scheduledBuildingObj.radius ?? scheduledBuildingObj.building_radius ?? 0);
        const distToScheduled = getDistanceMeters(coords.latitude, coords.longitude, schedLat, schedLon);
        if (!Number.isNaN(distToScheduled) && distToScheduled <= (schedRadius + BUILDING_TOLERANCE_METERS)) {
          setCurrentBuilding(scheduledBuildingObj);
          return;
        }
      }
    } catch (e) { }
    setCurrentBuilding(best ? best.building : null);
  }, [coords, buildings, scheduledBuildingObj]);

  const findNearestRoom = React.useCallback((coords) => {
    if (!coords || !rooms.length) return null;
    const buildingIdToUse = scannedFloor?.building_id ?? currentBuilding?.building_id ?? scheduledBuildingObj?.building_id ?? null;
    let candidates = rooms.filter(room => {
      if (!room) return false;
      if (buildingIdToUse && Number(room.building_id) !== Number(buildingIdToUse)) return false;
      return isInsideBox(coords, room);
    });

    if (scannedFloor) {
      candidates = candidates.filter(r => String(r.floor_id) === String(scannedFloor.floor_id));
      const NEAREST_FALLBACK_METERS = 100;
      if (!candidates.length) {
        const within = [];
        for (const room of rooms) {
          if (String(room.floor_id) !== String(scannedFloor.floor_id)) continue;
          if (room.latitude == null || room.longitude == null) continue;
          const d = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
          if (d <= NEAREST_FALLBACK_METERS) within.push({ room, dist: d });
        }
        if (within.length) {
          within.sort((a,b)=> a.dist - b.dist);
          candidates = within.map(w => w.room);
        } else {
          return null;
        }
      }
    } else {
      const NEAREST_FALLBACK_METERS = 100;
      if (!candidates.length) {
        const within = [];
        for (const room of rooms) {
          if (room.latitude == null || room.longitude == null) continue;
          const d = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
          if (d <= NEAREST_FALLBACK_METERS) within.push({ room, dist: d });
        }
        if (within.length) {
          within.sort((a,b)=> a.dist - b.dist);
          candidates = within.map(w => w.room);
        } else {
          let best = null; let bestDist = Infinity;
          for (const room of rooms) {
            if (room.latitude == null || room.longitude == null) continue;
            const d = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
            if (d < bestDist) { bestDist = d; best = room; }
          }
          return best;
        }
      }
    }

    const alt = scannedFloor && scannedFloor.baseline_altitude != null
      ? Number(scannedFloor.baseline_altitude)
      : attendanceAltitude.normalized;
    if (alt != null && Array.isArray(floors) && floors.length) {
      const preferred = [];
        
      for (const room of candidates) {
        const roomFloor = room.floor_id ? floors.find(f => f.floor_id === room.floor_id) : null;
        const buildingId = room.building_id || (roomFloor ? roomFloor.building_id : null);
        
        let baseline = null;
        let vertical = null;

        if (roomFloor && roomFloor.baseline_altitude != null) {
          baseline = Number(roomFloor.baseline_altitude);
          vertical = roomFloor.floor_meter_vertical != null ? Number(roomFloor.floor_meter_vertical) : null;
        } else if (buildingId) {
          const matchedFloor = detectFloorFromAltitude(alt, buildingId);
          if (matchedFloor && matchedFloor.floor_id === room.floor_id && matchedFloor.baseline_altitude != null) {
            baseline = Number(matchedFloor.baseline_altitude);
            vertical = matchedFloor.floor_meter_vertical != null ? Number(matchedFloor.floor_meter_vertical) : null;
          }
        }

        if (baseline != null) {
          const diff = Math.abs(baseline - Number(alt));
          const tolerance = vertical != null ? vertical / 2 : 1.5;
            
          if (diff <= tolerance) {
            const dist = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
            preferred.push({ room, dist });
          }
        }
      }

      if (preferred.length) {
        preferred.sort((a, b) => a.dist - b.dist);
        return preferred[0].room;
      }
    }

    let best = null;
    let bestDist = Infinity;
    for (const room of candidates) {
      const d = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
      if (d < bestDist) {
        bestDist = d;
        best = room;
      }
    }
    return best;
  }, [rooms, floors, detectFloorFromAltitude, scannedFloor, currentBuilding, scheduledBuildingObj, attendanceAltitude]);

  const getNearestRoomLabel = (coords) => {
    if (!coords) return { name: 'X', floor: 'X', building: 'X' };
    if (!currentBuilding && !scannedFloor && !usingDbFloor && !detectedFloor) {
      return { name: 'X', floor: 'X', building: 'X' };
    }
    const room = findNearestRoom(coords);
    if (!room) {
      return scannedFloor
        ? { name: 'No nearby room found on scanned floor', floor: scannedFloor.floor_name || 'Scanned floor', building: 'X' }
        : { name: 'X', floor: 'X', building: 'X' };
    }
    if (scannedFloor && String(room.floor_id) !== String(scannedFloor.floor_id)) {
      return { name: 'No nearby room found on scanned floor', floor: scannedFloor.floor_name || 'Scanned floor', building: 'X' };
    }
    const dist = getDistanceMeters(coords.latitude, coords.longitude, room.latitude, room.longitude);
    const roomFloor = (room.floor_id && floors.length) ? floors.find(f => f.floor_id === room.floor_id) : null;
    const floorName = scannedFloor ? (scannedFloor.floor_name || 'X') : (roomFloor ? roomFloor.floor_name : (detectFloorFromAltitude(attendanceAltitude.normalized, room.building_id)?.floor_name || 'X'));
    const buildingObj = buildings.find(b => Number(b.building_id) === Number(room.building_id)) || currentBuilding || null;
    const buildingName = buildingObj ? (buildingObj.building_name || 'X') : 'X';
    return { name: `${room.room_name || 'Unnamed'} (${Math.round(dist)}m)`, floor: floorName, building: buildingName };
  };

  React.useEffect(() => {
    if (!('permissions' in navigator)) return;
    let mounted = true;
    try {
      navigator.permissions.query({ name: 'camera' }).then(status => {
        if (!mounted) return;
        setCameraPermission(status.state || 'prompt');
        status.onchange = () => { if (mounted) setCameraPermission(status.state || 'prompt'); };
      }).catch(() => {});
    } catch (e) {}
    return () => { mounted = false; };
  }, []);

  const computeActionState = React.useCallback((rec, group = null) => {
    if (!rec) return { allowed: false, action: null, allowAt: null, predictedFlag: null };
    const now = new Date();
    const classStart = new Date(`${rec.date}T${rec.start_time}`);
    const classEnd = new Date(`${rec.date}T${rec.end_time}`);
    const groupRecords = Array.isArray(group) && group.length ? group : [rec];

    let action = null;
    if (groupRecords.some(item => !item.time_in)) action = 'check-in';
    else if (groupRecords.some(item => !item.time_check)) action = 'mid-check';
    else if (groupRecords.some(item => !item.time_out)) action = 'check-out';
    else return { allowed: false, action: null, allowAt: null, predictedFlag: null };

    if (action === 'check-in') {
      if (now < classStart) return { allowed: false, allowAt: classStart.toISOString(), action, predictedFlag: null };
      const presentEnd = new Date(classStart.getTime() + 15 * 60000);
      const predictedFlag = now <= presentEnd ? 'present' : 'late';
      return { allowed: true, allowAt: null, action, predictedFlag };
    }

    if (action === 'mid-check') {
      const center = new Date(classStart.getTime() + (classEnd.getTime() - classStart.getTime()) / 2);
      const midStart = new Date(center.getTime() - 10 * 60000);
      if (now < midStart) return { allowed: false, allowAt: midStart.toISOString(), action, predictedFlag: null };
      const predictedFlag = (now >= midStart && now <= new Date(center.getTime() + 10 * 60000)) ? 'present' : 'late';
      return { allowed: true, allowAt: null, action, predictedFlag };
    }

    const outStart = new Date(classEnd.getTime() - 15 * 60000);
    if (now < outStart) return { allowed: false, allowAt: outStart.toISOString(), action, predictedFlag: null };
    if (now > classEnd) return { allowed: false, allowAt: null, action, predictedFlag: null };
    return { allowed: true, allowAt: null, action, predictedFlag: 'present' };
  }, []);

  const computeNextSchedule = React.useCallback(() => {
    if (!records || !records.length) {
      setNextSchedule(null); setNextStartDate(null); setNextSecondsLeft(null);
      return;
    }
    const now = new Date();
    let best = null;
    let bestStart = null;

    for (const r of records) {
      const st = new Date(`${r.date}T${r.start_time}`);
      if (st.getTime() >= now.getTime()) {
        if (!bestStart || st < bestStart) {
          best = r;
          bestStart = st;
        }
      }
    }

    if (!best) {
      setNextSchedule(null); setNextStartDate(null); setNextSecondsLeft(null);
      return;
    }
    setNextSchedule(best);
    setNextStartDate(bestStart);
    setNextSecondsLeft(Math.max(0, Math.ceil((bestStart.getTime() - Date.now()) / 1000)));
  }, [records]);

  React.useEffect(() => {
    computeNextSchedule();
  }, [records, computeNextSchedule]);

  React.useEffect(() => {
    if (!nextStartDate) {
      setNextSecondsLeft(null);
      return;
    }
    const tick = () => {
      setNextSecondsLeft(Math.max(0, Math.ceil((nextStartDate.getTime() - Date.now()) / 1000)));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [nextStartDate]);

  React.useEffect(() => {
    const active = findActiveSchedule();
    const group = active ? findMatchingScheduleGroup(active) : [];
    const st = computeActionState(active, group);
    setActionAllowed(st.allowed);
    setAllowAt(st.allowAt);
    setCurrentAction(st.action);
    computeNextSchedule();
  }, [records, findActiveSchedule, findMatchingScheduleGroup, computeActionState, computeNextSchedule]);

  const filteredRecords = React.useMemo(() => {
    if (!Array.isArray(records)) return [];
    const now = new Date();
    const todayStr = formatDateYMD(now);
    const activeFirst = (list) => list
      .map((record, index) => ({ record, index, active: isRecordActiveNow(record, now) }))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return a.index - b.index;
      })
      .map(item => item.record);
    try {
      if (filterMode === 'today') {
        return activeFirst(records.filter(r => r.date === todayStr));
      }
      if (filterMode === 'past') {
        return activeFirst(records.filter(r => {
          if (!r.date || !r.end_time) return false;
          return new Date(`${r.date}T${r.end_time}`).getTime() < now.getTime();
        }));
      }
      if (filterMode === 'future') {
        return activeFirst(records.filter(r => {
          if (!r.date || !r.start_time) return false;
          return new Date(`${r.date}T${r.start_time}`).getTime() > now.getTime();
        }));
      }
    } catch (e) {
      return activeFirst(records);
    }
    return activeFirst(records);
  }, [records, filterMode]);

  const currentDist = React.useMemo(() => (coords && currentRoomObj) 
    ? getDistanceMeters(coords.latitude, coords.longitude, Number(currentRoomObj.latitude), Number(currentRoomObj.longitude)) 
    : null, 
  [coords, currentRoomObj]);

  const isInRoomBox = coords && currentRoomObj ? isInsideBox(coords, currentRoomObj) : false;
  const isOutOfRange = currentRoomObj ? !isInRoomBox : false;

  const scannedFloorInRange = React.useMemo(() => {
    try {
      if (!scannedFloor || !coords) return false;
      const base = (scannedFloor.baseline_altitude != null) ? Number(scannedFloor.baseline_altitude) : null;
      const vert = (scannedFloor.floor_meter_vertical != null) ? Number(scannedFloor.floor_meter_vertical) : null;
      if (base == null || vert == null) return false;
      const min = base - vert;
      const max = base + vert;
      const alt = attendanceAltitude.normalized;
      if (alt == null) return false;
      return alt >= min && alt <= max;
    } catch (e) { return false; }
  }, [scannedFloor, coords, attendanceAltitude]);

  const scannedFloorRange = React.useMemo(() => {
    if (!scannedFloor) return null;
    const base = (scannedFloor.baseline_altitude != null) ? Number(scannedFloor.baseline_altitude) : null;
    const vert = (scannedFloor.floor_meter_vertical != null) ? Number(scannedFloor.floor_meter_vertical) : null;
    if (base == null || vert == null) return null;
    return { min: base - vert, max: base + vert, base };
  }, [scannedFloor]);

  const altDetectedFloor = React.useMemo(() => {
    if (!coords || attendanceAltitude.normalized === null) return null;
    const bId = currentBuilding && currentBuilding.building_id ? Number(currentBuilding.building_id) : null;
    return detectFloorFromAltitude(attendanceAltitude.normalized, bId);
  }, [coords, attendanceAltitude, detectFloorFromAltitude, currentBuilding]);

  const isOutsideBuilding = React.useMemo(() => {
    if (!currentRoomObj) return false;
    try {
      if (scheduledBuildingObj && coords && (scheduledBuildingObj.latitude != null) && (scheduledBuildingObj.longitude != null)) {
        const schedLat = Number(scheduledBuildingObj.latitude);
        const schedLon = Number(scheduledBuildingObj.longitude);
        const schedRadius = Number(scheduledBuildingObj.radius ?? scheduledBuildingObj.building_radius ?? 0);
        const distToScheduled = getDistanceMeters(coords.latitude, coords.longitude, schedLat, schedLon);
        if (!Number.isNaN(distToScheduled) && distToScheduled <= (schedRadius + BUILDING_TOLERANCE_METERS)) {
          return false;
        }
      }
    } catch (e) { }

    if (!currentBuilding) return true; 
    return Number(currentBuilding.building_id) !== Number(currentRoomObj.building_id);
  }, [currentRoomObj, currentBuilding, scheduledBuildingObj, coords]);

  const notInAnyBuilding = React.useMemo(() => (!currentBuilding && Array.isArray(buildings) && buildings.length > 0), [currentBuilding, buildings]);

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (currentBuilding && currentBuilding.building_id) {
          const bId = Number(currentBuilding.building_id);
          const [roomsData, floorsData] = await Promise.all([
            apiGet(`rooms?building_id=${bId}`),
            apiGet(`floors?building_id=${bId}`)
          ]);
          if (!mounted) return;
          if (Array.isArray(roomsData) && roomsData.length) setRooms(roomsData);
          if (Array.isArray(floorsData) && floorsData.length) setFloors(floorsData);
        } else {
          const [roomsData, floorsData] = await Promise.all([apiGet('rooms'), apiGet('floors')]);
          if (!mounted) return;
          if (Array.isArray(roomsData)) setRooms(roomsData);
          if (Array.isArray(floorsData)) setFloors(floorsData);
        }
      } catch (e) {
        console.warn('Failed to load building-scoped rooms/floors', e);
      }
    })();
    return () => { mounted = false; };
  }, [currentBuilding]);

  const renderWrongFloorMessage = () => {
    const info = wrongFloorInfo;
    if (!info && (!errorMessage || !String(errorMessage).includes('wrong_floor'))) return null;

    if (info) {
      const floorId = info.expected_floor_id || info.floor_id || null;
      const floorObj = floorId && Array.isArray(floors) ? floors.find(f => Number(f.floor_id) === Number(floorId)) : null;
      const floorName = floorObj ? (floorObj.floor_name || `Floor ${floorId}`) : (info.expected_floor_name || 'the expected floor');
      const minAlt = (info.min_altitude != null) ? Number(info.min_altitude).toFixed(1) : null;
      const maxAlt = (info.max_altitude != null) ? Number(info.max_altitude).toFixed(1) : null;
      const detected = (info.detected_altitude != null) ? Number(info.detected_altitude).toFixed(1) : (attendanceAltitude.normalized !== null ? Number(attendanceAltitude.normalized).toFixed(1) : 'N/A');

      return (
        <div style={{ padding: 10, backgroundColor: '#fff3cd', color: '#856404', borderRadius: 5, margin: '10px 0', textAlign: 'center', border: '1px solid #ffeeba' }}>
          <div>You appear to be on a different floor.</div>
          <div>Expected: {floorName} — altitude range {minAlt !== null ? `${minAlt}m` : 'N/A'} to {maxAlt !== null ? `${maxAlt}m` : 'N/A'}</div>
          <div>Your altitude: {detected}m</div>
        </div>
      );
    }
    return (
      <div style={{ padding: 10, backgroundColor: '#fff3cd', color: '#856404', borderRadius: 5, margin: '10px 0', textAlign: 'center', border: '1px solid #ffeeba' }}>
        Your device altitude indicates you may be on a different floor. Move to the correct floor or contact the administrator.
      </div>
    );
  };

  const nextCountdownStr = () => {
    if (nextSecondsLeft == null) return null;
    if (nextSecondsLeft <= 0) return 'now';
    const days = Math.floor(nextSecondsLeft / 86400);
    const hours = Math.floor((nextSecondsLeft % 86400) / 3600);
    const mins = Math.floor((nextSecondsLeft % 3600) / 60);
    const secs = nextSecondsLeft % 60;
      
    const h = String(hours).padStart(2, '0');
    const m = String(mins).padStart(2, '0');
    const s = String(secs).padStart(2, '0');
      
    if (days > 0) return `${days}d ${h}:${m}:${s}`;
    return `${h}:${m}:${s}`;
  };

  const openScannerWithPermission = async () => {
    const rec = findActiveSchedule();
    if (!rec) return alert('No active schedule — scanning disabled');
    if (cameraPermission === 'denied') {
      setErrorMessage('Camera permission is denied — enable it in browser settings.');
      return;
    }
    if (cameraPermission === 'prompt') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
        setCameraPermission('granted');
      } catch (e) {
        setCameraPermission('denied');
        setErrorMessage('Camera access denied.');
        return;
      }
    }
    try {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
        pausedPollingRef.current = true;
      }
    } catch(e) {}
    setIsCameraVisible(true);
  };

  React.useEffect(() => {
    if (!isCameraVisible && pausedPollingRef.current) {
      try {
        if (!pollingRef.current && userId) {
          pollingRef.current = setInterval(loadMyAttendance, 5000);
        }
        loadMyAttendance().catch(()=>{});
      } catch (e) {}
      pausedPollingRef.current = false;
    }
  }, [isCameraVisible, userId, loadMyAttendance]);

  const ensureSwalLoaded = async () => {
    if (typeof window === 'undefined') return;
    if (window.Swal) return;
    if (!document.querySelector('link[data-swal]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.min.css';
      l.setAttribute('data-swal', '1');
      document.head.appendChild(l);
    }
    if (document.querySelector('script[data-swal]')) {
      const existing = document.querySelector('script[data-swal]');
      if ((existing.getAttribute('data-loaded')) === '1' && window.Swal) return;
      await new Promise((resolve, reject) => {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load SweetAlert')));
      });
      if (window.Swal) return;
    }
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11/dist/sweetalert2.all.min.js';
      s.async = true;
      s.setAttribute('data-swal', '1');
      s.onload = () => { s.setAttribute('data-loaded', '1'); resolve(); };
      s.onerror = () => reject(new Error('Failed to load SweetAlert script'));
      document.head.appendChild(s);
    });
    if (!window.Swal) throw new Error('SweetAlert failed to initialize');
  };

  const handleCheckNow = React.useCallback(async (scannedQrToken = null) => {
    setErrorMessage(null); 
    setWrongFloorInfo(null);

    const rec = findActiveSchedule();
    if (!rec) {
      if (scannedQrToken) {
        alert('No active schedule found.');
        setIsCameraVisible(false);
      } else {
        alert('No active schedule found.');
      }
      return;
    }

    const activeGroup = findMatchingScheduleGroup(rec);
    const actionState = computeActionState(rec, activeGroup);
    const actionToRun = actionState.action || currentAction || 'check-in';

    if (!scannedQrToken) {
      if (!actionState.allowed) return alert('Action not allowed at this time.');
      if (!coords) return alert('Waiting for GPS coordinates.');
      if (!currentRoomObj) {
        console.warn('Room lookup failed for schedule:', rec);
        try {
          const refreshed = await apiGet('rooms');
          if (Array.isArray(refreshed) && refreshed.length) {
            setRooms(refreshed);
            const found = refreshed.find(r => Number(r.room_id) === Number(rec.room_id));
            if (!found) {
              alert('Room data not found after refreshing rooms. Contact admin.');
              return;
            }
          } else {
            alert('Room data not found (rooms API empty).');
            return;
          }
        } catch (e) {
          console.error('Failed to refresh rooms:', e);
          alert('Room data not found and refresh failed.');
          return;
        }
      }
      if (isOutOfRange) return alert('You are out of range. Move closer to the room.');
      if (coords.accuracy > ACCURACY_THRESHOLD_METERS) return alert('Poor GPS accuracy.');

      const poorAltitude = (!coords.altitudeAccuracy && coords.altitudeAccuracy !== 0) || (coords.altitudeAccuracy > ALTITUDE_ACCURACY_THRESHOLD_METERS);
      if (poorAltitude) {
        try {
          await ensureSwalLoaded();
          const res = await window.Swal.fire({
            title: 'Poor altitude accuracy',
            text: '(Not recommended to do check right now) Altitude accuracy too poor — move outdoors or scan the floor QR? for more vertical altitude validition.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Scan QR',
            cancelButtonText: 'Cancel'
          });
          if (res.isConfirmed) { openScannerWithPermission(); return; }
          return;
        } catch (e) {
          const ok = window.confirm('Altitude accuracy too poor — move outdoors or scan the floor QR. Press OK to open scanner now.');
          if (ok) { openScannerWithPermission(); return; }
          return;
        }
      }
    }

    const payload = {
      schedule_id: rec.schedule_id,
      user_id: userId,
      date: rec.date,
      latitude: coords?.latitude || 0,
      longitude: coords?.longitude || 0,
      accuracy: coords?.accuracy || 100,
      altitude: attendanceAltitude.normalized !== null ? attendanceAltitude.normalized : null,
      raw_altitude: attendanceAltitude.raw !== null ? attendanceAltitude.raw : null,
      normalized_altitude: attendanceAltitude.normalized !== null ? attendanceAltitude.normalized : null,
      altitude_offset: attendanceAltitude.offset !== null ? attendanceAltitude.offset : null,
      altitude_source: attendanceAltitude.source,
      device_platform: devicePlatform,
      altitudeAccuracy: coords?.altitudeAccuracy ?? null,
      qr_token: scannedQrToken || null,
    };

    try {
      const endpoint = actionToRun ? `attendance/${actionToRun}` : 'attendance/check-in';
      const data = await apiPost(endpoint, payload);

      const updatedRecords = Array.isArray(data?.records)
        ? data.records
        : [data?.attendance || data?.record].filter(Boolean);

      if (updatedRecords.length) {
        setRecords(prev => {
          try {
            let copy = prev.slice();
            for (const att of updatedRecords) {
              const idx = copy.findIndex(r => (r.attendance_id && att.attendance_id && r.attendance_id === att.attendance_id) || (r.schedule_id === att.schedule_id && r.date === att.date));
              if (idx >= 0) {
                copy[idx] = { ...copy[idx], ...att };
              } else {
                copy = [att, ...copy];
              }
            }
            return copy;
          } catch (e) { return prev; }
        });

        const primaryAttendance = updatedRecords[0];
        if (primaryAttendance?.floor_id) {
          const serverFloor = floors.find(f => f.floor_id === Number(primaryAttendance.floor_id));
          if (serverFloor) setDetectedFloor(serverFloor);
        }
        setWrongFloorInfo(null);
        if (data && data.used_db_floor) {
          setUsingDbFloor(true);
          if (primaryAttendance?.floor_id) {
            const serverFloor = floors.find(f => f.floor_id === Number(primaryAttendance.floor_id));
            if (serverFloor) setDetectedFloor(serverFloor);
          }
          try { alert('Using floor altitude (QR)'); } catch(e){}
        }
      } else {
        await loadMyAttendance();
      }

      const groupCount = Number(data?.group_count || updatedRecords.length || 1);
      alert(`Success: ${data.message || 'OK'}${groupCount > 1 ? ` (${groupCount} schedules updated)` : ''}`);
      setIsCameraVisible(false);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      const body = err && err.body ? err.body : null;
      if (body && body.error === 'wrong_floor') {
        setWrongFloorInfo(body);
        setErrorMessage('wrong_floor');
        if (devicePlatform === 'ios' && !scannedQrToken) {
          try {
            await ensureSwalLoaded();
            const res = await window.Swal.fire({
              title: 'iOS altitude needs calibration',
              text: 'Scan the floor QR once so the app can align this device altitude with the floor baseline.',
              icon: 'warning',
              showCancelButton: true,
              confirmButtonText: 'Scan QR',
              cancelButtonText: 'Cancel'
            });
            if (res.isConfirmed) openScannerWithPermission();
          } catch (e) {
            const ok = window.confirm('iOS altitude needs floor calibration. Scan the floor QR now?');
            if (ok) openScannerWithPermission();
          }
          return;
        }
      } else {
        setWrongFloorInfo(null);
        setErrorMessage(body && body.error ? body.error : msg);
      }
      alert(`Error: ${body && body.error ? body.error : msg}`);
      if (scannedQrToken) setIsCameraVisible(false);
    }
  }, [findActiveSchedule, findMatchingScheduleGroup, computeActionState, coords, attendanceAltitude, devicePlatform, currentRoomObj, isOutOfRange, userId, currentAction, floors, loadMyAttendance]);

  React.useEffect(() => {
    handleCheckNowRef.current = handleCheckNow;
  }, [handleCheckNow]);

  const lastAutoTriggerRef = React.useRef(0);
  React.useEffect(() => {
    if (!userId) return;
    if (actionAllowed && !isOutOfRange && currentAction) {
      const now = Date.now();
      if (now - lastAutoTriggerRef.current > 30000) {
        lastAutoTriggerRef.current = now;
        handleCheckNow(scannedQrToken).catch(() => {});
      }
    }
  }, [actionAllowed, isOutOfRange, currentAction, userId, scannedQrToken, handleCheckNow]);

  const ensureHtml5QrcodeLoaded = async () => {
    if (typeof window === 'undefined') return;
    if (window.Html5Qrcode || window.Html5QrcodeScanner) return;
    const existing = document.querySelector('script[data-html5qrcode]');
    if (existing) {
      await new Promise((resolve, reject) => {
        if (existing.getAttribute('data-loaded') === '1') return resolve();
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed loading html5-qrcode script')));
      });
      if (window.Html5Qrcode || window.Html5QrcodeScanner) return;
      throw new Error('html5-qrcode loaded but globals not exposed');
    }

    const cdns = [
      'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.7/minified/html5-qrcode.min.js',
      'https://unpkg.com/html5-qrcode@2.3.7/minified/html5-qrcode.min.js',
      'https://rawcdn.githack.com/mebjas/html5-qrcode/v2.3.7/minified/html5-qrcode.min.js'
    ];

    let lastErr = null;
    for (const src of cdns) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.setAttribute('data-html5qrcode', '1');
          s.onload = () => {
            s.setAttribute('data-loaded', '1');
            setTimeout(() => {
              if (window.Html5Qrcode || window.Html5QrcodeScanner) resolve();
              else reject(new Error('html5-qrcode did not expose expected globals after load'));
            }, 50);
          };
          s.onerror = () => reject(new Error('Failed to load html5-qrcode from ' + src));
          document.head.appendChild(s);
        });
        return;
      } catch (err) {
        lastErr = err;
        try {
          const failed = document.querySelector('script[data-html5qrcode]');
          if (failed && failed.getAttribute('src') === src) failed.parentNode.removeChild(failed);
        } catch (e) {}
      }
    }
    throw lastErr || new Error('All CDNs failed for html5-qrcode');
  };

  React.useEffect(() => {
    if (!isCameraVisible) return;
    let activeScanner = null;
    let usingScannerUI = false;
    let stopped = false;

    const startScanner = async () => {
      try {
        if (typeof window.Html5Qrcode === 'undefined' && typeof window.Html5QrcodeScanner === 'undefined') {
          try {
            await ensureHtml5QrcodeLoaded();
          } catch (err) {
            setErrorMessage('QR library failed to load: ' + (err && err.message ? err.message : String(err)));
            return;
          }
        }
        try {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && debugVideoRef.current) {
            const previewStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            previewStreamRef.current = previewStream;
            try { debugVideoRef.current.srcObject = previewStream; } catch (e) {}
            try { const p = debugVideoRef.current.play(); if (p && p.then) p.catch(()=>{}); } catch(e){}
            setPreviewActive(true);
          }
        } catch (err) {
          setErrorMessage('Camera preview failed: ' + (err && err.message ? err.message : String(err)));
        }

        let cameraId = null;
        if (typeof window.Html5Qrcode !== 'undefined') {
          try {
            const cams = await window.Html5Qrcode.getCameras();
            if (Array.isArray(cams) && cams.length) {
              let preferred = cams.find(c => /back|rear|environment|rear camera/i.test(c.label));
              if (!preferred) preferred = cams[cams.length - 1];
              cameraId = preferred && (preferred.id || preferred.deviceId || preferred.cameraId) ? (preferred.id || preferred.deviceId || preferred.cameraId) : null;
            }
          } catch (e) {
            cameraId = null;
          }
        }

        const stopPreviewIfAny = () => {
          try {
            if (previewStreamRef.current) {
              previewStreamRef.current.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
              previewStreamRef.current = null;
            }
            setPreviewActive(false);
            if (debugVideoRef.current) {
              try { debugVideoRef.current.srcObject = null; } catch (e) {}
            }
          } catch (e) {}
        };

        stopPreviewIfAny();
        if (scannerStartedRef.current) return;
        const html5QrCode = new window.Html5Qrcode('qr-scanner-container');
        activeScanner = html5QrCode;

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        const cameraOrConstr = cameraId || { facingMode: 'environment' };

        try {
          await html5QrCode.start(
            cameraOrConstr,
            config,
            (decodedText) => {
              try { html5QrCode.stop(); } catch (e) {}
              try { html5QrCode.clear(); } catch (e) {}
              if (!stopped) {
                const matchedFloor = floors.find(f => f.qr_token === decodedText);
                const active = findActiveSchedule ? findActiveSchedule() : null;
                const activeGroup = active ? findMatchingScheduleGroup(active) : [];
                const scheduledFloorIds = new Set();
                try {
                  for (const rec of activeGroup.length ? activeGroup : (active ? [active] : [])) {
                    const rr = rooms.find(r => Number(r.room_id) === Number(rec.room_id));
                    if (rr?.floor_id !== undefined && rr.floor_id !== null) scheduledFloorIds.add(Number(rr.floor_id));
                  }
                } catch(e) {}

                if (!matchedFloor) {
                  (async () => {
                    try { await ensureSwalLoaded(); window.Swal.fire({ toast:true, position:'top', icon:'error', title: 'Scanned QR is not recognized', showConfirmButton:false, timer:3000 }); } catch (e) { alert('Scanned QR is not recognized'); }
                  })();
                } else if (scheduledFloorIds.size && !scheduledFloorIds.has(Number(matchedFloor.floor_id))) {
                  (async () => {
                    try { await ensureSwalLoaded(); window.Swal.fire({ toast:true, position:'top', icon:'error', title: 'Scanned floor does not match your active class', showConfirmButton:false, timer:3500 }); } catch (e) { alert('Scanned floor does not match your active class'); }
                  })();
                } else {
                  (async () => {
                    try { await ensureSwalLoaded(); window.Swal.fire({ toast:true, position:'top', icon:'success', title: `Scanned: ${matchedFloor.floor_name || 'floor'}`, showConfirmButton:false, timer:2000 }); } catch (e) { /* ignore */ }
                  })();
                  setScannedQrToken(decodedText);
                  setScannedFloor(matchedFloor);
                }
                setIsCameraVisible(false);
              }
            },
            (_error) => { }
          );
          scannerStartedRef.current = true;
        } catch (startErr) {
          const em = (startErr && startErr.message) ? startErr.message : String(startErr);
          if (em.toLowerCase().includes('notreadable') || em.toLowerCase().includes('could not start video')) {
            setErrorMessage('Camera busy or inaccessible. Close other apps/tabs using the camera and try again.');
          } else if (em.toLowerCase().includes('notallowed') || em.toLowerCase().includes('permission')) {
            setErrorMessage('Camera permission denied. Allow camera access in browser/site settings.');
          } else {
            setErrorMessage('Failed to start QR scanner: ' + em);
          }
          try { html5QrCode.clear(); } catch (e) {}
          return;
        }
        return;
      } catch (err) {
        setErrorMessage('Failed to start QR scanner: ' + (err && err.message ? err.message : String(err)));
      }
    };

    startScanner();

    return () => {
      stopped = true;
      scannerStartedRef.current = false;
      try {
        if (previewStreamRef.current) {
          previewStreamRef.current.getTracks().forEach(t => { try{ t.stop(); }catch(e){} });
          previewStreamRef.current = null;
        }
        setPreviewActive(false);
        if (debugVideoRef.current) { try { debugVideoRef.current.srcObject = null; } catch (e) {} }
      } catch (e) {}
      (async () => {
        try {
          if (!activeScanner) return;
          if (!usingScannerUI && typeof activeScanner.stop === 'function') {
            try { await activeScanner.stop(); } catch (e) {}
            try { activeScanner.clear(); } catch (e) {}
          }
          if (usingScannerUI) {
            try { activeScanner.clear(); } catch (e) {}
          }
        } catch (e) {}
      })();
    };
  }, [isCameraVisible, floors, rooms, findActiveSchedule, findMatchingScheduleGroup]);

  React.useEffect(() => {
    try {
      const rec = findActiveSchedule();
      if (!rec) {
        setUsingDbFloor(false);
        return;
      }
      const current = records.find(r => (r.attendance_id && rec.attendance_id && r.attendance_id === rec.attendance_id) || (r.schedule_id === rec.schedule_id && r.date === rec.date));
      if (!current || !current.floor_id || !current.room_id) {
        setUsingDbFloor(false);
        return;
      }
      const room = rooms.find(r => Number(r.room_id) === Number(current.room_id));
      if (room && Number(current.floor_id) === Number(room.floor_id)) {
        setUsingDbFloor(false);
      } else {
        setUsingDbFloor(true);
        const f = floors.find(ff => Number(ff.floor_id) === Number(current.floor_id));
        if (f) setDetectedFloor(f);
      }
    } catch (e) { }
  }, [records, rooms, floors, findActiveSchedule]);

  React.useEffect(() => {
    let timer = null;
    try {
      const now = new Date();
      const todayStr = formatDateYMD(now);
      const todays = records.filter(r => r.date === todayStr);
      const active = todays.find(r => {
        if (!r.start_time || !r.end_time) return false;
        const start = new Date(`${r.date}T${r.start_time}`);
        const end = new Date(`${r.date}T${r.end_time}`);
        return now >= start && now <= end;
      }) || null;
    
      if (!active) {
        setScannedQrToken(null);
        setScannedFloor(null);
        try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){}
        return () => {};
      }
    
      const endTs = new Date(`${active.date}T${active.end_time}`).getTime();
      const msLeft = endTs - Date.now();
      if (msLeft <= 0) {
        setScannedQrToken(null);
        setScannedFloor(null);
        try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){}
        return () => {};
      }
    
      timer = setTimeout(() => {
        setScannedQrToken(null);
        setScannedFloor(null);
        try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){}
      }, msLeft + 1000);
    } catch (e) {
      setScannedQrToken(null);
      setScannedFloor(null);
      try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){}
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [records]);

  const nearestRoomLabel = coords ? getNearestRoomLabel(coords) : null;
  const roomGuideLabel = scannedFloor ? 'Scanned-floor room' : 'Estimated room';
  const altitudeLabel = attendanceAltitude.normalized !== null ? `${Number(attendanceAltitude.normalized).toFixed(1)}m` : 'N/A';
  const rawAltitudeLabel = attendanceAltitude.raw !== null ? `${Number(attendanceAltitude.raw).toFixed(1)}m` : 'N/A';
  const altitudeDisplayLabel = attendanceAltitude.calibrated ? `${altitudeLabel} (raw ${rawAltitudeLabel})` : altitudeLabel;

  // --- Render ---
  return (
    <div className="attendance-container" style={{ padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
      
      {/* HEADER SECTION - Matches Reference Image Top Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ margin: 0, fontSize: '2.2rem', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.025em' }}>
          {teacherName || 'John Lester Zarsosa'}
        </h1>
        <div style={{ backgroundColor: '#15803d', color: '#ffffff', padding: '10px 24px', borderRadius: '12px', fontSize: '1.2rem', fontWeight: '700', boxShadow: '0 4px 6px -1px rgba(21, 128, 61, 0.3)', letterSpacing: '0.025em' }}>
          {formatClockDate(nowClock)}
        </div>
      </div>

      {/* MAIN CONTAINER CARD */}
      <div className="attendance-card" style={{ backgroundColor: '#ffffff', borderRadius: '20px', padding: '28px', boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)', border: '1px solid #e2e8f0' }}>
        
        {/* CARD TOP BAR: Title & Scan QR Button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '700', color: '#1e293b' }}>My Attendance</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {!coords && !errorMessage && (
              <button onClick={startLocationTracking} style={{ border: 'none', backgroundColor: '#e2e8f0', color: '#475569', padding: '10px 18px', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '0.95rem' }}>
                GPS
              </button>
            )}
            <button 
              onClick={openScannerWithPermission} 
              disabled={cameraPermission === 'denied'}
              style={{ border: 'none', backgroundColor: '#e2e8f0', color: '#1e293b', padding: '10px 24px', borderRadius: '10px', fontWeight: '700', cursor: 'pointer', fontSize: '0.95rem', transition: 'background-color 0.2s' }}
            >
              Scan QR
            </button>
          </div>
        </div>

        {/* BANNERS (Building / Errors / Warnings) */}
        <div className="attendance-banners" style={{ marginBottom: '20px' }}>
          {(currentBuilding || scheduledBuildingObj || scannedFloor || usingDbFloor || detectedFloor) && (
            <div style={{ backgroundColor: '#f1f5f9', padding: '12px 16px', borderRadius: '10px', fontSize: '0.85rem', color: '#475569', marginBottom: '12px' }}>
              {currentBuilding && <div>Detected building: {currentBuilding.building_name || 'Building'} (radius {Math.round(Number(currentBuilding.radius || currentBuilding.building_radius || 0))}m)</div>}
              {currentRoomObj && <div style={{ marginTop:4 }}>Scheduled building: {currentBuilding ? (scheduledBuildingObj? (scheduledBuildingObj.building_name || 'Building'): 'X') : 'X'}</div>}

              {isOutsideBuilding && currentRoomObj && scheduledBuildingObj && coords && (
                <div style={{ color: '#dc2626', fontWeight: '600', marginTop: 4 }}>
                  You are outside {scheduledBuildingObj.building_name || 'the scheduled building'} by {Math.max(0, Math.round(getDistanceMeters(coords.latitude, coords.longitude, Number(scheduledBuildingObj.latitude), Number(scheduledBuildingObj.longitude)) - Number(scheduledBuildingObj.radius || scheduledBuildingObj.building_radius || 0)))}m — attendance denied
                </div>
              )}

              {scannedFloor && <div style={{ color: '#16a34a', fontWeight: '600', marginTop: 4 }}>QR validated — floor: {scannedFloor.floor_name || 'floor'}</div>}
              {!scannedFloor && usingDbFloor && detectedFloor && <div style={{ color: '#16a34a', fontWeight: '600', marginTop: 4 }}>Using DB floor altitude — floor: {detectedFloor.floor_name || 'floor'}</div>}
              {!scannedFloor && !usingDbFloor && detectedFloor && currentRoomObj && (
                <div style={{ color: '#0284c7', fontWeight: '600', marginTop: 4 }}>
                  GPS-detected floor: {detectedFloor.floor_name || '...'} — expected: { (floors.find(f=>String(f.floor_id)===String(currentRoomObj.floor_id)) || {}).floor_name || 'scheduled floor' }
                </div>
              )}
            </div>
          )}

          {!userId && (
            <div style={{ backgroundColor: '#fee2e2', color: '#991b1b', padding: '14px', borderRadius: '10px', marginBottom: '12px', fontSize: '0.9rem' }}>
              <div>No user selected. Open this page with a teacher id in the URL (e.g. ?userId=6) or log in.</div>
              <div style={{ marginTop:8 }}><button onClick={()=> { const id = prompt('Enter test userId (e.g. 6)'); if (id) { setUserId(Number(id)); } }} style={{ backgroundColor: '#991b1b', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}>Use test user id</button></div>
            </div>
          )}

          {errorMessage && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '12px 16px', borderRadius: '10px', marginBottom: '12px', fontWeight: '600', fontSize: '0.9rem' }}>{errorMessage}</div>}
          {renderWrongFloorMessage()}
          {notInAnyBuilding && <div style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '12px 16px', borderRadius: '10px', marginBottom: '12px', fontWeight: '500', fontSize: '0.9rem' }}>You are not inside any known building. Move closer to the building or check location permissions.</div>}
          {isOutsideBuilding && currentRoomObj && !scheduledBuildingObj && (
             <div style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '12px 16px', borderRadius: '10px', marginBottom: '12px', fontWeight: '500', fontSize: '0.9rem' }}>You are not in the correct building for the active class. Move to the assigned building or scan the floor QR.</div>
          )}
          {activeParallelRoomNames.length > 1 && (
            <div style={{ backgroundColor: '#e0f2fe', color: '#0369a1', padding: '12px 16px', borderRadius: '10px', marginBottom: '12px', fontSize: '0.9rem' }}>
              Parallel class detected for the current time. Rooms in this class group: {activeParallelRoomNames.join(', ')}. Active schedules are shown first.
            </div>
          )}
          {isOutOfRange && currentRoomObj && (
            <div style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '12px 16px', borderRadius: '10px', marginBottom: '12px', fontWeight: '500', fontSize: '0.9rem' }}>
              You are out of range for the active class ({currentDist ? Math.round(currentDist) : 'N/A'}m away). Move closer to room '{currentRoomObj.room_name}'{activeOtherParallelRoomNames.length > 0 ? ` or another parallel room: ${activeOtherParallelRoomNames.join(', ')}` : ''}.
            </div>
          )}
        </div>

        {/* TWO-COLUMN UI LAYOUT EXACTLY MATCHING THE DESIGN */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '24px' }}>
          
          {/* LEFT COLUMN: Schedules */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* CURRENT SCHEDULE CARD */}
            <div style={{ backgroundColor: '#e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
              <div style={{ backgroundColor: '#15803d', color: '#ffffff', padding: '12px 20px', fontSize: '1rem', fontWeight: '700', letterSpacing: '0.05em' }}>
                CURRENT SCHEDULE
              </div>
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.9rem', color: '#334155', fontWeight: '600', lineHeight: '1.6' }}>
                <div>
                  <div style={{ marginBottom: '4px' }}>SECTION: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.section_name || 'BSIT1-01'}</span></div>
                  <div style={{ marginBottom: '16px' }}>SUBJECT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.subject_code ? `${activeSchedule.subject_code} - ${activeSchedule.subject_name || ''}` : 'ITE010 - Programming 1'}</span></div>
                  <div>BUILDING: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.building_name || 'MW'}</span></div>
                  <div>FLOOR: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.floor_name || 'MW-2ND-FLOOR'}</span></div>
                  <div>ROOM: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.room_name || 'MW 202'}</span></div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                  <div>CHECK IN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule ? `${formatTime12(activeSchedule.start_time)} - ${formatTime12(activeSchedule.end_time)}` : '9:00PM - 10:30AM'}</span></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    CHECK IN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.time_in ? formatTime12(activeSchedule.time_in) : '9:20AM'}</span>
                    <span style={{ backgroundColor: (activeSchedule?.flag_in_id === 5 || !activeSchedule?.time_in) ? '#fbbf24' : '#15803d', color: (activeSchedule?.flag_in_id === 5 || !activeSchedule?.time_in) ? '#0f172a' : '#ffffff', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '800' }}>
                      {activeSchedule?.flag_in_id ? getFlagLabel(activeSchedule.flag_in_id).toUpperCase() : 'LATE'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    CHECK RAN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.time_check ? formatTime12(activeSchedule.time_check) : '10:05AM'}</span>
                    <span style={{ backgroundColor: '#15803d', color: '#ffffff', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '800' }}>
                      {activeSchedule?.flag_check_id ? getFlagLabel(activeSchedule.flag_check_id).toUpperCase() : 'PRESENT'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    CHECK AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{activeSchedule?.time_out ? formatTime12(activeSchedule.time_out) : '10:20AM'}</span>
                    <span style={{ backgroundColor: '#15803d', color: '#ffffff', padding: '2px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: '800' }}>
                      {activeSchedule?.flag_out_id ? getFlagLabel(activeSchedule.flag_out_id).toUpperCase() : 'PRESENT'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* NEXT SCHEDULE CARD */}
            <div style={{ backgroundColor: '#e2e8f0', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)' }}>
              <div style={{ backgroundColor: '#a3b1ab', color: '#1e293b', padding: '12px 20px', fontSize: '1rem', fontWeight: '700', letterSpacing: '0.05em' }}>
                NEXT SCHEDULE
              </div>
              <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: '0.9rem', color: '#334155', fontWeight: '600', lineHeight: '1.6' }}>
                <div>
                  <div style={{ marginBottom: '4px' }}>SECTION: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.section_name || 'BSIT2-02'}</span></div>
                  <div style={{ marginBottom: '16px' }}>SUBJECT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.subject_code ? `${nextSchedule.subject_code} - ${nextSchedule.subject_name || ''}` : 'ITE012 - Programming 2'}</span></div>
                  <div>BUILDING: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.building_name || 'MW'}</span></div>
                  <div>FLOOR: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.floor_name || 'MW-3RD-FLOOR'}</span></div>
                  <div>ROOM: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.room_name || 'MW 305'}</span></div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start' }}>
                  <div>CHECK IN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule ? `${formatTime12(nextSchedule.start_time)} - ${formatTime12(nextSchedule.end_time)}` : '10:30AM - 11:30AM'}</span></div>
                  <div>CHECK IN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.time_in ? formatTime12(nextSchedule.time_in) : ''}</span></div>
                  <div>CHECK RAN AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.time_check ? formatTime12(nextSchedule.time_check) : ''}</span></div>
                  <div>CHECK AT: <span style={{ fontWeight: '700', color: '#0f172a' }}>{nextSchedule?.time_out ? formatTime12(nextSchedule.time_out) : ''}</span></div>
                </div>
              </div>
            </div>

            {/* PRESERVED FILTER PILLS & LIST FOR EXTENDED USAGE */}
            <div style={{ marginTop: '10px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {['today', 'past', 'future'].map(mode => (
                  <button 
                    key={mode} 
                    onClick={() => setFilterMode(mode)} 
                    style={{ border: 'none', padding: '6px 14px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', backgroundColor: filterMode === mode ? '#0f172a' : '#e2e8f0', color: filterMode === mode ? '#ffffff' : '#475569', transition: 'all 0.2s' }}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '250px', overflowY: 'auto' }}>
                {filteredRecords.length > 0 ? filteredRecords.map(item => {
                  const isActive = isRecordActiveNow(item);
                  const parallelRooms = getParallelRoomNames(item);
                  return (
                    <div key={item.attendance_id || `${item.schedule_id}-${item.date}`} style={{ padding: '12px 16px', backgroundColor: isActive ? '#f0fdf4' : '#f8fafc', border: `1px solid ${isActive ? '#86efac' : '#e2e8f0'}`, borderRadius: '10px', fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{item.date} ({item.day_of_week || ''})</div>
                      {isActive && <div style={{ color: '#16a34a', fontWeight: '600', fontSize: '0.75rem', marginBottom: '4px' }}>Current active schedule</div>}
                      {parallelRooms.length > 0 && (
                        <div style={{ color: '#0284c7', fontSize: '0.75rem', marginBottom: '4px' }}>
                          Parallel room{parallelRooms.length > 1 ? 's' : ''}: {parallelRooms.join(', ')}
                        </div>
                      )}
                      <div style={{ color: '#475569' }}><strong style={{ color: '#1e293b' }}>Class:</strong> {item.subject_code || ''} - {item.section_name || ''}</div>
                      <div style={{ color: '#475569' }}><strong style={{ color: '#1e293b' }}>Time:</strong> {formatTime12(item.start_time)} - {formatTime12(item.end_time)}</div>
                      <div style={{ color: '#475569' }}><strong style={{ color: '#1e293b' }}>Room:</strong> {item.room_name || ''}</div>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.75rem', fontWeight: '600', color: '#334155' }}>
                        <span>In: <span style={{ color: '#0f172a' }}>{getFlagLabel(item.flag_in_id)}</span></span>
                        <span>Mid: <span style={{ color: '#0f172a' }}>{getFlagLabel(item.flag_check_id)}</span></span>
                        <span>Out: <span style={{ color: '#0f172a' }}>{getFlagLabel(item.flag_out_id)}</span></span>
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ color: '#64748b', fontSize: '0.85rem', padding: '12px 0' }}>No records for this filter.</div>
                )}
              </div>
            </div>

          </div>

          {/* RIGHT COLUMN: Action & Status Panel */}
          <div style={{ backgroundColor: '#d1d5db', borderRadius: '20px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)' }}>
            
            {/* CURRENT ACTION */}
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1e293b', marginBottom: '10px', letterSpacing: '0.025em' }}>CURRENT ACTION</div>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <button 
                  onClick={() => handleCheckNow(scannedQrToken)}
                  style={{ backgroundColor: '#15803d', color: '#ffffff', border: 'none', padding: '12px 28px', borderRadius: '10px', fontWeight: '700', fontSize: '0.95rem', boxShadow: '0 4px 6px -1px rgba(21, 128, 61, 0.3)', cursor: 'pointer', transition: 'transform 0.1s', width: 'auto', minWidth: '220px' }}
                >
                  {actionAllowed && !isOutOfRange ? (currentAction ? `AUTOMATIC ${currentAction.replace('-', ' ').toUpperCase()}` : 'AUTOMATIC CHECK') : (currentAction ? `READY: ${currentAction.replace('-', ' ').toUpperCase()}` : 'AUTOMATIC CHECK')}
                </button>
              </div>
              {!actionAllowed && allowAt && <div style={{ fontSize: '0.8rem', color: '#475569', textAlign: 'center', marginTop: '8px', fontWeight: '600' }}>Allowed at: {new Date(allowAt).toLocaleTimeString()}</div>}
              {nextSchedule && (
                <div style={{ fontSize: '0.8rem', color: '#334155', textAlign: 'center', marginTop: '8px', fontWeight: '600' }}>
                   Next: {nextSchedule.subject_code} at {formatTime12(nextSchedule.start_time)} ({nextSecondsLeft != null ? `Starts in ${nextCountdownStr()}` : ''})
                </div>
              )}
            </div>

            {/* QR STATUS */}
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1e293b', marginBottom: '10px', letterSpacing: '0.025em' }}>QR STATUS</div>
              <div style={{ backgroundColor: '#15803d', color: '#ffffff', padding: '14px', borderRadius: '12px', textAlign: 'center', fontWeight: '700', fontSize: '0.85rem', lineHeight: '1.5', boxShadow: '0 4px 6px -1px rgba(21, 128, 61, 0.2)', position: 'relative' }}>
                {!scannedQrToken ? (
                  <div>
                    <div>SCANNED VALID QR CODE</div>
                    <div style={{ fontWeight: '600', opacity: 0.9 }}>{scannedFloor?.floor_name || 'MW-2ND-FLOOR'} {attendanceAltitude.normalized !== null ? Number(attendanceAltitude.normalized).toFixed(2) : '82.00'} VERTICAL +-5 (77 - 87)</div>
                  </div>
                ) : (
                  <div>
                    <div>SCANNED: {(scannedFloor && scannedFloor.floor_name) ? scannedFloor.floor_name.toUpperCase() : scannedQrToken}</div>
                    {scannedFloor && (
                      <div style={{ fontWeight: '600', opacity: 0.9 }}>
                        {scannedFloorInRange ? 'ON SCANNED FLOOR' : 'NOT ON SCANNED FLOOR'} | BASELINE: {scannedFloorRange ? Number(scannedFloorRange.base).toFixed(2) + 'm' : 'N/A'}
                      </div>
                    )}
                    {(!scannedFloorInRange && altDetectedFloor) && (
                      <div style={{ marginTop: 4, fontSize: '0.75rem', opacity: 0.85 }}>
                        Detected floor by GPS: {altDetectedFloor.floor_name || 'Unknown'}
                      </div>
                    )}
                    <button style={{ position: 'absolute', right: '10px', top: '10px', background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', fontWeight: 'bold' }} onClick={() => { setScannedQrToken(null); setScannedFloor(null); try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){} }}>✕</button>
                  </div>
                )}
              </div>
            </div>

            {/* GPS COORDINATE */}
            <div>
              <div style={{ fontSize: '0.9rem', fontWeight: '700', color: '#1e293b', marginBottom: '10px', letterSpacing: '0.025em' }}>GPS COORDINATE</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem', color: '#334155', fontWeight: '600', marginBottom: '8px' }}>
                <div>LATITUDE: <span style={{ color: '#0f172a' }}>{coords?.latitude ? coords.latitude.toFixed(7) : '8.4699670'}</span></div>
                <div>LONGITUDE: <span style={{ color: '#0f172a' }}>{coords?.longitude ? coords.longitude.toFixed(7) : '124.6343640'}</span></div>
              </div>
              <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '600', marginBottom: '14px' }}>
                ALTITUDE: <span style={{ color: '#0f172a' }}>{attendanceAltitude.normalized !== null ? Number(attendanceAltitude.normalized).toFixed(3) : '82.201'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: '12px', alignItems: 'center' }}>
                <div style={{ fontSize: '0.85rem', color: '#334155', fontWeight: '600', lineHeight: '1.6' }}>
                  <div>CAMPUS: <span style={{ color: '#0f172a' }}>{activeSchedule?.campus_name || 'Carmen'}</span></div>
                  <div>BUILDING: <span style={{ color: '#0f172a' }}>{currentBuilding?.building_name || activeSchedule?.building_name || 'MW'}</span></div>
                  <div>FLOOR: <span style={{ color: '#0f172a' }}>{detectedFloor?.floor_name || activeSchedule?.floor_name || 'MW-2ND-FLOOR'}</span></div>
                  <div>ROOM: <span style={{ color: '#0f172a' }}>{currentRoomObj?.room_name || activeSchedule?.room_name || 'MW 202'}</span></div>
                </div>
                <div style={{ backgroundColor: isOutOfRange ? '#dc2626' : '#15803d', color: '#ffffff', padding: '14px 12px', borderRadius: '12px', textAlign: 'center', fontWeight: '800', fontSize: '0.75rem', lineHeight: '1.4', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '64px' }}>
                  {isOutOfRange ? "YOU'RE CURRENTLY OUTSIDE OF YOUR SCHEDULED ROOM" : "YOU'RE CURRENTLY INSIDE OF YOUR SCHEDULED ROOM"}
                </div>
              </div>
            </div>

            {/* PRESERVED WIFI SPEED & MINI DEBUG */}
            <div style={{ borderTop: '1px solid #9ca3af', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {connectionQuality && (
                <div style={{ fontSize: '0.8rem', color: '#334155', fontWeight: '600' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#475569', marginBottom: '4px' }}>WIFI SPEED</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: '700', color: connectionQuality.color }}>● {connectionQuality.label}</span>
                    <span style={{ color: '#475569' }}>{connectionQuality.rtt !== null ? `${connectionQuality.rtt}ms` : ''}{connectionQuality.effectiveType && connectionQuality.effectiveType !== 'offline' ? `, ${connectionQuality.effectiveType}` : ''}</span>
                  </div>
                </div>
              )}
              {coords && (
                <div style={{ fontSize: '0.75rem', color: '#475569', lineHeight: '1.4' }}>
                  <div style={{ fontWeight: '700', color: '#334155' }}>GPS STATUS</div>
                  Acc: {coords.accuracy?.toFixed(1)}m | Device: {devicePlatform} | {roomGuideLabel}: {nearestRoomLabel ? nearestRoomLabel.name : 'X'}
                </div>
              )}
            </div>

          </div>

        </div>

        {/* PRESERVED MODAL FOR CAMERA QR SCANNING */}
        <Modal show={isCameraVisible} title="Scan QR Code" onClose={() => setIsCameraVisible(false)}>
          <div style={{ position: 'relative', minWidth: 300, minHeight: 300 }}>
            {previewActive && (
              <div style={{ marginBottom: 8, textAlign: 'center' }}>
                <video ref={debugVideoRef} autoPlay playsInline muted id="debug-camera-preview" style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 6 }} />
              </div>
            )}
            <div id="qr-scanner-container" style={{ width: '100%', height: '100%' }}></div>
            <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: 250, height: 250, border: '2px solid #00FF00', pointerEvents: 'none', borderRadius: 6 }}></div>
          </div>
        </Modal>

      </div>
    </div>
  );
}