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
  switch (flagId) {
    case 1: return 'NA';
    case 2: return 'Present';
    case 3: return 'Absent';
    case 4: return 'Excused';
    case 5: return 'Late';
    default: return '—';
  }
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

  const currentRoomObj = React.useMemo(() => {
    const active = findActiveSchedule();
    return active ? rooms.find(r => Number(r.room_id) === Number(active.room_id)) || null : null;
  }, [records, rooms, findActiveSchedule]);

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
    try {
      if (filterMode === 'today') {
        return records.filter(r => r.date === todayStr);
      }
      if (filterMode === 'past') {
        return records.filter(r => {
          if (!r.date || !r.end_time) return false;
          return new Date(`${r.date}T${r.end_time}`).getTime() < now.getTime();
        });
      }
      if (filterMode === 'future') {
        return records.filter(r => {
          if (!r.date || !r.start_time) return false;
          return new Date(`${r.date}T${r.start_time}`).getTime() > now.getTime();
        });
      }
    } catch (e) {
      return records;
    }
    return records;
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
    <div className="attendance-container">
      <div className="attendance-card">
        
        {/* HEADER */}
        <div className="attendance-header">
          <h2 className="attendance-title">My Attendance {teacherName ? `– ${teacherName}` : ''}</h2>
          <div className="header-actions">
            {!coords && !errorMessage && <p style={{ margin: 0, fontSize: '0.85rem', color: '#666', marginRight: 10 }}>Waiting for location...</p>}
            {!coords && !errorMessage && (
              <button onClick={startLocationTracking} className="action-btn gps-btn">
                GPS
              </button>
            )}
            <button 
              onClick={openScannerWithPermission} 
              disabled={cameraPermission === 'denied'}
              className="action-btn qr-btn"
            >
              Scan QR
            </button>
          </div>
        </div>

        {/* BANNERS (Building / Errors) - Full Width */}
        <div className="attendance-banners">
          {(currentBuilding || scheduledBuildingObj || scannedFloor || usingDbFloor || detectedFloor) && (
            <div className="status-banner">
              {currentBuilding && <div>Detected building: {currentBuilding.building_name || 'Building'} (radius {Math.round(Number(currentBuilding.radius || currentBuilding.building_radius || 0))}m)</div>}
              {currentRoomObj && <div style={{ marginTop:6 }}>Scheduled building: {currentBuilding ? (scheduledBuildingObj? (scheduledBuildingObj.building_name || 'Building'): 'X') : 'X'}</div>}

              {isOutsideBuilding && currentRoomObj && scheduledBuildingObj && coords && (
                <div className="error-banner">
                  You are outside {scheduledBuildingObj.building_name || 'the scheduled building'} by {Math.max(0, Math.round(getDistanceMeters(coords.latitude, coords.longitude, Number(scheduledBuildingObj.latitude), Number(scheduledBuildingObj.longitude)) - Number(scheduledBuildingObj.radius || scheduledBuildingObj.building_radius || 0)))}m — attendance denied
                </div>
              )}

              {scannedFloor && <div className="success-banner">QR validated — floor: {scannedFloor.floor_name || 'floor'}</div>}
              {!scannedFloor && usingDbFloor && detectedFloor && <div className="success-banner">Using DB floor altitude — floor: {detectedFloor.floor_name || 'floor'}</div>}
              {!scannedFloor && !usingDbFloor && detectedFloor && currentRoomObj && (
                <div className="info-banner">
                  GPS-detected floor: {detectedFloor.floor_name || '...'} — expected: { (floors.find(f=>String(f.floor_id)===String(currentRoomObj.floor_id)) || {}).floor_name || 'scheduled floor' }
                </div>
              )}
            </div>
          )}

          {!userId && (
            <div className="error-banner-box">
              <div>No user selected. Open this page with a teacher id in the URL (e.g. ?userId=6) or log in.</div>
              <div style={{ marginTop:8 }}><button onClick={()=> { const id = prompt('Enter test userId (e.g. 6)'); if (id) { setUserId(Number(id)); } }} className="test-user-btn">Use test user id</button></div>
            </div>
          )}

          {errorMessage && <div className="error-alert">{errorMessage}</div>}
          {renderWrongFloorMessage()}
          {notInAnyBuilding && <div className="warning-banner">You are not inside any known building. Move closer to the building or check location permissions.</div>}
          {isOutsideBuilding && currentRoomObj && !scheduledBuildingObj && (
             <div className="warning-banner">You are not in the correct building for the active class. Move to the assigned building or scan the floor QR.</div>
          )}
          {isOutOfRange && currentRoomObj && <div className="warning-banner">You are out of range for the active class ({currentDist ? Math.round(currentDist) : 'N/A'}m away). Move closer to room '{currentRoomObj.room_name}'.</div>}
        </div>

        {/* MAIN CONTENT GRID */}
        <div className="attendance-grid">
          
          {/* LEFT COLUMN: Filters & List */}
          <div className="attendance-left">
            <div className="filter-group">
              {['today', 'past', 'future'].map(mode => (
                <button 
                  key={mode} 
                  onClick={() => setFilterMode(mode)} 
                  className={`filter-pill ${filterMode === mode ? 'active' : ''}`}
                >
                  {/* Dynamic Labels restored */}
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>

            <div className="records-list">
              {filteredRecords.length > 0 ? filteredRecords.map(item => (
                <div key={item.attendance_id || `${item.schedule_id}-${item.date}`} className={`record-card ${isRecordActiveNow(item) ? 'record-card-active' : ''}`}>
                  <div className="record-header">{item.date} ({item.day_of_week || ''})</div>
                  <div><span className="record-label">Class:</span> {item.subject_code || ''} - {item.section_name || ''}</div>
                  <div><span className="record-label">Time:</span> {formatTime12(item.start_time)} - {formatTime12(item.end_time)}</div>
                  <div><span className="record-label">Room:</span> {item.room_name || ''}</div>
                  <div><span className="record-label">Check In:</span> {getFlagLabel(item.flag_in_id)}</div>
                  <div><span className="record-label">Mid Check:</span> {getFlagLabel(item.flag_check_id)}</div>
                  <div><span className="record-label">Check Out:</span> {getFlagLabel(item.flag_out_id)}</div>
                </div>
              )) : (
                <div className="no-records">No records for this filter.</div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Action & Status */}
          <div className="attendance-right">
            <div className="status-panel">
              <div className="panel-label">CURRENT ACTION</div>
              
              <div 
                className={`action-status-btn ${actionAllowed && !isOutOfRange ? 'active' : 'inactive'}`}
              >
                 {actionAllowed && !isOutOfRange ? (currentAction ? `Automatically ${currentAction.replace('-', ' ')}` : 'Performing attendance') : (currentAction ? `Ready: ${currentAction.replace('-', ' ')}` : 'No Active Schedule')}
              </div>
              
              {!actionAllowed && allowAt && <div className="allow-at-text">Allowed at: {new Date(allowAt).toLocaleTimeString()}</div>}
              
              {nextSchedule && (
                <div className="next-schedule-info">
                   Next: {nextSchedule.subject_code} at {formatTime12(nextSchedule.start_time)}
                   <br/>
                   {nextSecondsLeft != null ? `Starts in ${nextCountdownStr()}` : ''}
                </div>
              )}

              <div className="panel-label mt-4">QR STATUS</div>
              <div className="qr-status-box">
                {!scannedQrToken ? (
                  <div className="qr-text-inactive">No QR scanned</div>
                ) : (
                  <div className="qr-text-active">
                      <strong>Scanned: </strong> {(scannedFloor && scannedFloor.floor_name) ? scannedFloor.floor_name : scannedQrToken}
                      {scannedFloor && (
                        <div className={`qr-range-info ${scannedFloorInRange ? 'text-success' : 'text-danger'}`}>
                          {scannedFloorInRange ? 'On scanned floor' : 'Not on scanned floor'}
                          <br/>
                          Range: {scannedFloorRange ? `${Number(scannedFloorRange.min).toFixed(1)}m - ${Number(scannedFloorRange.max).toFixed(1)}m` : 'N/A'}
                          <br/>
                          Baseline: {scannedFloorRange ? Number(scannedFloorRange.base).toFixed(1) + 'm' : 'N/A'}. Your alt: {altitudeDisplayLabel}
                        </div>
                      )}
                      
                      {/* Fallback floor detection restored */}
                      {(!scannedFloorInRange && altDetectedFloor) && (
                        <div style={{ marginTop: 6, fontSize: 12, color: '#0c5460' }}>
                          Detected floor by GPS: {altDetectedFloor.floor_name || 'Unknown'}
                        </div>
                      )}

                      <button className="clear-qr-btn" onClick={() => { setScannedQrToken(null); setScannedFloor(null); try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch(e){} }}>✕</button>
                  </div>
                )}
              </div>

               {/* Condensed GPS Info */}
               {coords && (
                 <div className="gps-mini-debug">
                   <div className="panel-label mt-2">GPS STATUS</div>
                   GPS: {coords.latitude.toFixed(5)}, {coords.longitude.toFixed(5)} <br/>
                    Acc: {coords.accuracy?.toFixed(1)}m | Alt: {altitudeDisplayLabel} | Device: {devicePlatform}
                   <br/>
                   {roomGuideLabel}: {nearestRoomLabel ? nearestRoomLabel.name : 'X'}
                 </div>
               )}
            </div>
          </div>

        </div>

        {/* Modal remains at bottom */}
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
