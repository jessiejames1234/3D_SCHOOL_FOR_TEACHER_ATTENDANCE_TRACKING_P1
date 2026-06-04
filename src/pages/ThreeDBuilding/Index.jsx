import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiGet } from '../../services/api.js';
import './Index.css';

function ThreeDBuildingIndex() {
  const defaultAvatarSrc = (() => {
    try {
      if (typeof window === 'undefined') return '/src/assets/unknown.jpg';
      const parts = window.location.pathname.split('/').filter(Boolean);
      let projectRoot = '';
      if (parts.length) {
        const first = String(parts[0]).toLowerCase();
        if (first !== 'public') projectRoot = '/' + parts[0];
      }
      return `${projectRoot}/src/assets/unknown.jpg`;
    } catch (e) {
      return '/src/assets/unknown.jpg';
    }
  })();

  const resolveUrl = (path) => {
    try { return new URL(path, window.location.href).href; }
    catch (e) { return path; }
  };

  const resolveServerRoot = () => {
    const apiBase = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '../server-php/index.php/api';
    let base = apiBase;
    try { base = new URL(apiBase, window.location.href).href; }
    catch (e) { base = resolveUrl(apiBase); }
    return base.replace(/\/?index\.php\/api\/?$/, '').replace(/\/?api\/?$/, '');
  };

  const serverRoot = resolveServerRoot();
  const defaultModel = new URL('./3dbuilding/MWv1.1.glb', `${serverRoot}/`).href;
  const fallbackModel = 'http://localhost/3D_SCHOOL_FOR_TEACHER_ATTENDANCE_TRACKING_P1/server-php/3dbuilding/MWv1.1.glb';

  const [modelSrc, setModelSrc] = useState(defaultModel);
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');
  const [markerData, setMarkerData] = useState(null);
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [nowTime, setNowTime] = useState(new Date());
  const [catalog, setCatalog] = useState({ schools: [], buildings: [], floors: [], rooms: [] });

  const [searchTeacher, setSearchTeacher] = useState('');
  const [pendingFilters, setPendingFilters] = useState({ campus: '', building: '', floor: '', room: '' });
  const [appliedFilters, setAppliedFilters] = useState({ campus: '', building: '', floor: '', room: '' });
  const [logsPage, setLogsPage] = useState(1);
  const [roomModal, setRoomModal] = useState(null);
  const [focusedRoom, setFocusedRoom] = useState('');
  const [viewButtonVisible, setViewButtonVisible] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sceneBusyLabel, setSceneBusyLabel] = useState('Loading 3D model...');
  const [isUploadBusy, setIsUploadBusy] = useState(false);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [moveModeEnabled, setMoveModeEnabled] = useState(false);
  const [activeUploadTransform, setActiveUploadTransform] = useState(null);

  const viewerWrapRef = useRef(null);
  const mountRef = useRef(null);
  const fileInputRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelRef = useRef(null);
  const uploadedObjectsRef = useRef([]);
  const pinRef = useRef(null);
  const labelRef = useRef(null);
  const meshMapRef = useRef({});
  const requestRef = useRef(null);
  const camAnimRef = useRef(null);
  const viewBtnRef = useRef(null);
  const focusedRoomCenterRef = useRef(null);
  const focusedRoomRef = useRef('');
  const viewButtonVisibleRef = useRef(false);
  const fullscreenRef = useRef(false);
  const sceneBusyRef = useRef(true);
  const nativeFullscreenRef = useRef(false);
  const filePickerActiveRef = useRef(false);
  const pendingUploadObjectRef = useRef(null);
  const pendingUploadActiveRef = useRef(false);
  const uploadAnchorRefs = useRef({});
  const uploadAnchorPositionsRef = useRef([
    { id: 'upload-anchor-left', x: -25, y: 0, z: 0 },
    { id: 'upload-anchor-right', x: 25, y: 0, z: 0 }
  ]);
  const moveModeRef = useRef(false);
  const selectedUploadAnchorIdRef = useRef('upload-anchor-left');
  const raycasterRef = useRef(null);
  const dragStateRef = useRef({
    active: false,
    pointerId: null,
    object: null,
    plane: null,
    offsetX: 0,
    offsetZ: 0
  });

  const uniqueValues = (list) => Array.from(new Set((list || []).filter(Boolean)));
  const nameEq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const toLocalYmd = (dateValue = new Date()) => {
    const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const [selectedScheduleDate, setSelectedScheduleDate] = useState(() => toLocalYmd());

  const normalizeMeshKey = (name) => {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/\.\d+$/, '') // strip Blender suffix like .001
      .replace(/[\s._-]+/g, '');
  };

  useEffect(() => {
    focusedRoomRef.current = focusedRoom;
    if (!focusedRoom) focusedRoomCenterRef.current = null;
  }, [focusedRoom]);

  useEffect(() => {
    viewButtonVisibleRef.current = viewButtonVisible;
  }, [viewButtonVisible]);

  useEffect(() => {
    fullscreenRef.current = isFullscreen;
  }, [isFullscreen]);

  useEffect(() => {
    sceneBusyRef.current = status === 'loading' || isUploadBusy;
  }, [status, isUploadBusy]);

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    if (isFullscreen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = originalOverflow;

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (nativeFullscreenRef.current) return;
      setIsFullscreen(false);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    requestAnimationFrame(() => {
      syncViewerSize();
      updateUploadAnchorButtons();
    });
  }, [isFullscreen]);

  useEffect(() => {
    moveModeRef.current = moveModeEnabled;
    if (!moveModeEnabled) stopDraggingMoveTarget();
    updateViewerCursor();
  }, [moveModeEnabled]);

  useEffect(() => {
    if (!activeUploadTransform && moveModeEnabled) {
      setMoveModeEnabled(false);
      return;
    }
    updateViewerCursor();
  }, [activeUploadTransform, moveModeEnabled]);

  useEffect(() => {
    const handleWindowFocus = () => {
      if (!filePickerActiveRef.current) return;
      window.setTimeout(() => {
        filePickerActiveRef.current = false;
        requestAnimationFrame(() => syncViewerSize());
      }, 240);
    };

    window.addEventListener('focus', handleWindowFocus);
    return () => window.removeEventListener('focus', handleWindowFocus);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
      const viewerIsFullscreen = fullscreenElement === viewerWrapRef.current;
      const hadNativeFullscreen = nativeFullscreenRef.current;
      nativeFullscreenRef.current = viewerIsFullscreen;
      if (viewerIsFullscreen) {
        setIsFullscreen(true);
      } else if (hadNativeFullscreen && !filePickerActiveRef.current) {
        setIsFullscreen(false);
      }
      requestAnimationFrame(() => syncViewerSize());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  const smoothCameraTo = (targetPos, targetLookAt, duration = 700, onComplete) => {
    if (!cameraRef.current) return;
    if (camAnimRef.current) cancelAnimationFrame(camAnimRef.current);

    const cam = cameraRef.current;
    const startPos = cam.position.clone();
    const startTarget = controlsRef.current?.target ? controlsRef.current.target.clone() : new window.THREE.Vector3(0, 0, 0);
    const endPos = targetPos.clone();
    const endTarget = targetLookAt.clone();
    const startTime = performance.now();

    const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / duration);
      const k = easeInOutCubic(t);
      cam.position.lerpVectors(startPos, endPos, k);
      if (controlsRef.current) {
        controlsRef.current.target.lerpVectors(startTarget, endTarget, k);
        controlsRef.current.update();
      } else {
        cam.lookAt(endTarget);
      }
      if (t < 1) {
        camAnimRef.current = requestAnimationFrame(step);
      } else if (onComplete) {
        try { onComplete(); } catch (e) { /* ignore */ }
      }
    };
    camAnimRef.current = requestAnimationFrame(step);
  };

  const updateViewButtonPosition = () => {
    const btn = viewBtnRef.current;
    if (!btn) return;
    if (!mountRef.current || !cameraRef.current) return;
    if (!focusedRoomRef.current || !viewButtonVisibleRef.current || !focusedRoomCenterRef.current) {
      btn.style.display = 'none';
      return;
    }
    const rect = mountRef.current.getBoundingClientRect();
    const point = focusedRoomCenterRef.current.clone().project(cameraRef.current);
    if (point.z < -1 || point.z > 1) {
      btn.style.display = 'none';
      return;
    }
    const x = (point.x * 0.5 + 0.5) * rect.width;
    const y = (-point.y * 0.5 + 0.5) * rect.height;
    if (x < -40 || x > rect.width + 40 || y < -40 || y > rect.height + 40) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'inline-flex';
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
  };
  const extractTimeText = (value) => {
    const txt = String(value || '').trim();
    if (!txt) return '';
    const match = txt.match(/(?:T|\s|^)(\d{1,2}:\d{2}(?::\d{2})?)/);
    return match ? match[1] : txt;
  };
  const toMinutes = (t) => {
    const txt = extractTimeText(t);
    if (!txt) return null;
    const parts = txt.split(':');
    if (parts.length < 2) return null;
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return (h * 60) + m;
  };
  const formatClock = (timeText) => {
    const txt = extractTimeText(timeText);
    if (!txt) return '--:--';
    const parts = txt.split(':');
    if (parts.length < 2) return txt;
    let h = Number(parts[0]);
    const m = parts[1];
    if (!Number.isFinite(h)) return txt;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m}${ampm}`;
  };
  const toDateTime = (dateText, timeText) => {
    const d = String(dateText || '').trim();
    const rawTime = String(timeText || '').trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]/.test(rawTime)) {
      const direct = new Date(rawTime.replace(' ', 'T'));
      if (!Number.isNaN(direct.getTime())) return direct;
    }
    const t = extractTimeText(rawTime);
    if (!d || !t) return null;
    const dt = new Date(`${d}T${t}`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };
  const timeTextFromDate = (dateValue) => {
    if (!(dateValue instanceof Date) || Number.isNaN(dateValue.getTime())) return '';
    return [
      String(dateValue.getHours()).padStart(2, '0'),
      String(dateValue.getMinutes()).padStart(2, '0'),
      String(dateValue.getSeconds()).padStart(2, '0')
    ].join(':');
  };
  const getMidpointTime = (record) => {
    const start = toDateTime(record?.date, record?.start_time);
    const end = toDateTime(record?.date, record?.end_time);
    if (!start || !end) return record?.start_time || '';
    return timeTextFromDate(new Date(start.getTime() + ((end.getTime() - start.getTime()) / 2)));
  };
  const normalizeDateKey = (value) => {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  };
  const dayNameForDate = (dateValue) => {
    const key = normalizeDateKey(dateValue);
    if (!key) return '';
    const d = new Date(`${key}T00:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  };
  const isDateWithinScheduleRange = (dateValue, startValue, endValue) => {
    const dateKey = normalizeDateKey(dateValue);
    const startKey = normalizeDateKey(startValue);
    const endKey = normalizeDateKey(endValue);
    if (!dateKey) return false;
    if (startKey && dateKey < startKey) return false;
    if (endKey && dateKey > endKey) return false;
    return true;
  };
  const deriveBuildingFromRoom = (roomName) => {
    const match = String(roomName || '').trim().match(/^([A-Za-z]+)[-\s]/);
    if (match && match[1]) return match[1].toUpperCase();
    return '';
  };
  const deriveFloorFromRoom = (roomName, buildingName = '') => {
    const room = String(roomName || '').trim();
    const digits = room.match(/(\d{3,4})/);
    if (!digits || !digits[1]) return '';
    const level = Number(digits[1].charAt(0));
    if (!level || Number.isNaN(level)) return '';
    const ordMap = { 1: '1ST', 2: '2ND', 3: '3RD', 4: '4TH', 5: '5TH' };
    const ord = ordMap[level] || `${level}TH`;
    const b = buildingName || deriveBuildingFromRoom(room);
    return b ? `${b}-${ord}-FLOOR` : `${ord}-FLOOR`;
  };
  const supportedUploadExts = ['.glb', '.gltf', '.obj', '.fbx', '.stl'];
  const moveNudgeStep = 0.5;
  const uploadAnchorDefs = [
    { id: 'upload-anchor-left', label: 'Add building on the left' },
    { id: 'upload-anchor-right', label: 'Add building on the right' }
  ];
  const getMoveTargetObject = () => pendingUploadObjectRef.current || uploadedObjectsRef.current[0] || null;
  const syncActiveUploadTransform = (object = getMoveTargetObject()) => {
    if (!object) {
      setActiveUploadTransform(null);
      return;
    }

    const next = {
      name: object.name || 'uploaded model',
      x: Number(object.position.x.toFixed(2)),
      y: Number(object.position.y.toFixed(2)),
      z: Number(object.position.z.toFixed(2))
    };

    setActiveUploadTransform((prev) => {
      if (
        prev
        && prev.name === next.name
        && prev.x === next.x
        && prev.y === next.y
        && prev.z === next.z
      ) {
        return prev;
      }
      return next;
    });
  };
  const updateViewerCursor = () => {
    const canvas = rendererRef.current?.domElement;
    if (!canvas) return;
    if (dragStateRef.current.active) {
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (moveModeRef.current && getMoveTargetObject()) {
      canvas.style.cursor = 'grab';
      return;
    }
    canvas.style.cursor = '';
  };
  const stopDraggingMoveTarget = () => {
    const canvas = rendererRef.current?.domElement;
    const dragState = dragStateRef.current;
    if (canvas && dragState.pointerId != null && typeof canvas.releasePointerCapture === 'function') {
      try { canvas.releasePointerCapture(dragState.pointerId); } catch (e) { /* ignore */ }
    }
    dragStateRef.current = {
      active: false,
      pointerId: null,
      object: null,
      plane: null,
      offsetX: 0,
      offsetZ: 0
    };
    if (controlsRef.current) controlsRef.current.enabled = true;
    updateViewerCursor();
  };
  const applyUploadAnchorPlacement = (object) => {
    if (!object || !window.THREE) return;
    const anchor = uploadAnchorPositionsRef.current.find((item) => item.id === selectedUploadAnchorIdRef.current)
      || uploadAnchorPositionsRef.current[0]
      || null;
    if (!anchor) return;
    object.position.add(new window.THREE.Vector3(anchor.x, 0, anchor.z));
  };
  const storeInitialUploadPosition = (object) => {
    if (!object || !window.THREE) return;
    object.userData.initialViewerPosition = object.position.clone();
  };
  const resetMoveTargetPosition = () => {
    const object = getMoveTargetObject();
    const initialPosition = object?.userData?.initialViewerPosition || null;
    if (!object || !initialPosition) return;
    object.position.copy(initialPosition);
    if (controlsRef.current) controlsRef.current.update();
    syncActiveUploadTransform(object);
    setMessage(`Reset "${object.name || 'uploaded model'}" to its initial viewer position.`);
  };
  const nudgeMoveTarget = (dx = 0, dy = 0, dz = 0) => {
    const object = getMoveTargetObject();
    if (!object) return;
    stopDraggingMoveTarget();
    object.position.x += dx;
    object.position.y += dy;
    object.position.z += dz;
    if (controlsRef.current) controlsRef.current.update();
    syncActiveUploadTransform(object);
  };

  const disposeMaterial = (material) => {
    if (!material) return;
    if (Array.isArray(material)) {
      material.forEach(disposeMaterial);
      return;
    }
    Object.values(material).forEach((value) => {
      if (value && value.isTexture && typeof value.dispose === 'function') {
        try { value.dispose(); } catch (e) { /* ignore */ }
      }
    });
    if (typeof material.dispose === 'function') {
      try { material.dispose(); } catch (e) { /* ignore */ }
    }
  };

  const disposeObject = (object) => {
    if (!object) return;
    object.traverse((child) => {
      if (child.geometry && typeof child.geometry.dispose === 'function') {
        try { child.geometry.dispose(); } catch (e) { /* ignore */ }
      }
      if (child.material) disposeMaterial(child.material);
    });
  };

  const removeSceneObject = (object) => {
    if (!object) return;
    if (object.parent) object.parent.remove(object);
    disposeObject(object);
  };

  const clearUploadedObjects = ({ suppressTransformSync = false } = {}) => {
    stopDraggingMoveTarget();
    uploadedObjectsRef.current.forEach((object) => removeSceneObject(object));
    uploadedObjectsRef.current = [];
    if (!suppressTransformSync) syncActiveUploadTransform(null);
  };

  const setPendingUploadState = (nextUpload) => {
    pendingUploadActiveRef.current = !!nextUpload;
    setPendingUpload(nextUpload);
  };

  const setAcceptedUploadsVisible = (visible) => {
    uploadedObjectsRef.current.forEach((object) => {
      if (object) object.visible = visible;
    });
  };

  const clearPendingUploadPreview = ({ restoreCommitted = false, suppressState = false, suppressTransformSync = false } = {}) => {
    stopDraggingMoveTarget();
    if (pendingUploadObjectRef.current) {
      removeSceneObject(pendingUploadObjectRef.current);
      pendingUploadObjectRef.current = null;
    }
    if (restoreCommitted) setAcceptedUploadsVisible(true);
    if (suppressState) {
      pendingUploadActiveRef.current = false;
    } else {
      setPendingUploadState(null);
    }
    if (!suppressTransformSync) syncActiveUploadTransform();
  };

  const applyMeshDefaults = (object) => {
    if (!object) return;
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
    });
  };

  const rebuildMeshMap = (object) => {
    const nextMeshMap = {};
    object?.traverse((child) => {
      if (!child.isMesh) return;
      const normalized = normalizeMeshKey(child.name);
      if (normalized) nextMeshMap[normalized] = child;
    });
    meshMapRef.current = nextMeshMap;
  };

  const centerObjectAtOrigin = (object) => {
    if (!object || !window.THREE) return;
    const box = new window.THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const center = box.getCenter(new window.THREE.Vector3());
    object.position.sub(center);
  };
  const placeObjectOnGround = (object, groundY = 0) => {
    if (!object || !window.THREE) return;
    const box = new window.THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    object.position.y += groundY - box.min.y;
  };

  const frameObjectInCamera = (object) => {
    if (!object || !cameraRef.current || !window.THREE) return;
    const box = new window.THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new window.THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = cameraRef.current.fov * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 0.82;
    cameraRef.current.position.set(cameraZ, cameraZ * 0.45, cameraZ);
    cameraRef.current.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }
  };

  const syncViewerSize = () => {
    if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    if (!width || !height) return;
    cameraRef.current.aspect = width / height;
    cameraRef.current.updateProjectionMatrix();
    rendererRef.current.setSize(width, height);
  };

  const setUploadAnchorRef = (id, node) => {
    if (node) uploadAnchorRefs.current[id] = node;
    else delete uploadAnchorRefs.current[id];
  };

  const hideUploadAnchorButtons = () => {
    Object.values(uploadAnchorRefs.current).forEach((button) => {
      if (!button) return;
      button.style.display = 'none';
    });
  };

  const updateUploadAnchorLayout = (rootObject = modelRef.current) => {
    if (!window.THREE || !rootObject) {
      uploadAnchorPositionsRef.current = [
        { id: 'upload-anchor-left', x: -25, y: 0, z: 0 },
        { id: 'upload-anchor-right', x: 25, y: 0, z: 0 }
      ];
      return;
    }

    const box = new window.THREE.Box3().setFromObject(rootObject);
    if (box.isEmpty()) return;

    const center = box.getCenter(new window.THREE.Vector3());
    const size = box.getSize(new window.THREE.Vector3());
    const sidePadding = Math.max(size.x * 0.08, 4);
    const anchorY = box.min.y + Math.max(size.y * 0.04, 0.25);

    uploadAnchorPositionsRef.current = [
      { id: 'upload-anchor-left', x: box.min.x - sidePadding, y: anchorY, z: center.z },
      { id: 'upload-anchor-right', x: box.max.x + sidePadding, y: anchorY, z: center.z }
    ];
  };

  const updateUploadAnchorButtons = () => {
    if (!mountRef.current || !cameraRef.current || !window.THREE) return;
    if (!fullscreenRef.current || sceneBusyRef.current || pendingUploadActiveRef.current) {
      hideUploadAnchorButtons();
      return;
    }

    const rect = mountRef.current.getBoundingClientRect();
    uploadAnchorPositionsRef.current.forEach((anchor) => {
      const button = uploadAnchorRefs.current[anchor.id];
      if (!button) return;

      const point = new window.THREE.Vector3(anchor.x, anchor.y, anchor.z).project(cameraRef.current);
      if (point.z < -1 || point.z > 1) {
        button.style.display = 'none';
        return;
      }

      const x = (point.x * 0.5 + 0.5) * rect.width;
      const y = (-point.y * 0.5 + 0.5) * rect.height;
      if (x < -48 || x > rect.width + 48 || y < -48 || y > rect.height + 48) {
        button.style.display = 'none';
        return;
      }

      button.style.display = 'inline-flex';
      button.style.left = `${x}px`;
      button.style.top = `${y}px`;
    });
  };

  const getFileExtension = (filename) => {
    const parts = String(filename || '').toLowerCase().match(/(\.[a-z0-9]+)$/);
    return parts?.[1] || '';
  };

  const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read "${file.name}".`));
    reader.readAsArrayBuffer(file);
  });

  const readFileAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Unable to read "${file.name}".`));
    reader.readAsText(file);
  });

  const normalizeRecord = (raw) => {
    const roomName = raw?.room_name || raw?.room || raw?.Room || '';
    const teacherName = `${raw?.first_name || ''} ${raw?.last_name || ''}`.trim() || raw?.teacher_name || 'Teacher';
    const buildingName = raw?.building_name || deriveBuildingFromRoom(roomName);
    const floorName = raw?.floor_name || raw?.attendance_floor_name || deriveFloorFromRoom(roomName, buildingName);
    return {
      attendance_id: raw?.attendance_id || '',
      schedule_id: raw?.schedule_id || '',
      user_id: raw?.user_id || raw?.teacher_id || '',
      avatar: raw?.avatar || raw?.image || raw?.teacher_avatar || '',
      date: raw?.date || '',
      room_name: roomName,
      teacher_name: teacherName,
      campus_name: raw?.campus_name || raw?.school_name || '',
      building_name: buildingName,
      floor_name: floorName,
      start_time: raw?.start_time || '',
      end_time: raw?.end_time || '',
      time_in: raw?.time_in || '',
      time_check: raw?.time_check || '',
      time_out: raw?.time_out || '',
      flag_in_id: raw?.flag_in_id ?? null,
      flag_in_name: raw?.flag_in_name || '',
      flag_check_id: raw?.flag_check_id ?? null,
      flag_check_name: raw?.flag_check_name || '',
      flag_out_id: raw?.flag_out_id ?? null,
      flag_out_name: raw?.flag_out_name || '',
      is_schedule_only: !!raw?._schedule_only
    };
  };

  const statusFromFlag = (flagIdValue, flagNameValue) => {
    const flagId = Number(flagIdValue || 0);
    const flagName = String(flagNameValue || '').trim().toLowerCase();
    if (flagId === 5 || flagName === 'late') return 'LATE';
    if (flagId === 3 || flagName === 'absent') return 'ABSENT';
    if (flagId === 2 || flagName === 'present' || flagId === 4 || flagName === 'substituted') return 'PRESENT';
    return '';
  };

  const computeAttendanceStatus = (record) => {
    const flagStatus = statusFromFlag(record?.flag_in_id, record?.flag_in_name);
    if (flagStatus) return flagStatus;

    const hasIn = !!String(record?.time_in || '').trim();
    if (!hasIn) return 'ABSENT';
    const inMins = toMinutes(record?.time_in);
    const startMins = toMinutes(record?.start_time);
    if (inMins !== null && startMins !== null && inMins > (startMins + 5)) return 'LATE';
    return 'PRESENT';
  };

  const computeCheckpointStatus = (record, checkpoint) => {
    const config = {
      in: {
        timeKey: 'time_in',
        flagIdKey: 'flag_in_id',
        flagNameKey: 'flag_in_name',
        compareTimeKey: 'start_time'
      },
      mid: {
        timeKey: 'time_check',
        flagIdKey: 'flag_check_id',
        flagNameKey: 'flag_check_name'
      },
      out: {
        timeKey: 'time_out',
        flagIdKey: 'flag_out_id',
        flagNameKey: 'flag_out_name'
      }
    }[checkpoint];
    if (!config) return 'ABSENT';

    const flagStatus = statusFromFlag(record?.[config.flagIdKey], record?.[config.flagNameKey]);
    if (flagStatus) return flagStatus;

    const timeValue = String(record?.[config.timeKey] || '').trim();
    if (!timeValue) return 'ABSENT';
    if (checkpoint === 'in') {
      const inMins = toMinutes(timeValue);
      const startMins = toMinutes(record?.[config.compareTimeKey]);
      if (inMins !== null && startMins !== null && inMins > (startMins + 5)) return 'LATE';
    }
    return 'PRESENT';
  };

  const normalizeScheduleForDate = (schedule, dateKey) => normalizeRecord({
    ...schedule,
    date: dateKey,
    user_id: schedule?.teacher_id || schedule?.user_id || '',
    _schedule_only: true
  });

  const buildScheduleRecordsForDate = (schedules, dateKey) => {
    const dayName = dayNameForDate(dateKey);
    if (!dayName || !Array.isArray(schedules)) return [];
    return schedules
      .filter((schedule) => String(schedule?.day_of_week || '').trim().toLowerCase() === dayName)
      .filter((schedule) => isDateWithinScheduleRange(dateKey, schedule?.semester_start, schedule?.semester_end))
      .map((schedule) => normalizeScheduleForDate(schedule, dateKey));
  };

  const attendanceRecordKey = (record, fallbackDate = selectedScheduleDate) => [
    String(record?.schedule_id || ''),
    String(record?.user_id || record?.teacher_id || ''),
    normalizeDateKey(record?.date) || fallbackDate
  ].join('|');

  const mergeSchedulesWithAttendance = (scheduleRecords, attendanceRows, dateKey) => {
    const merged = new Map();
    scheduleRecords.forEach((record) => {
      merged.set(attendanceRecordKey(record, dateKey), record);
    });
    attendanceRows.forEach((record) => {
      const key = attendanceRecordKey(record, dateKey);
      const scheduleRecord = merged.get(key);
      merged.set(key, scheduleRecord ? {
        ...scheduleRecord,
        ...record,
        campus_name: scheduleRecord.campus_name || record.campus_name,
        building_name: scheduleRecord.building_name || record.building_name,
        floor_name: scheduleRecord.floor_name || record.floor_name
      } : record);
    });
    return Array.from(merged.values());
  };

  const buildMarkerFromRecord = (record, now) => {
    if (!record) return null;
    const start = toDateTime(record.date, record.start_time);
    const end = toDateTime(record.date, record.end_time);
    const hasIn = !!String(record.time_in || '').trim();
    const hasMid = !!String(record.time_check || '').trim();
    const hasOut = !!String(record.time_out || '').trim();

    let markerColor = 'green';
    let statusText = 'Checked In';

    if (hasOut) {
      markerColor = 'green';
      statusText = 'Checked Out';
    } else if (hasMid) {
      markerColor = 'green';
      statusText = 'Mid Check OK';
    } else if (hasIn && start && end) {
      const durationMs = end.getTime() - start.getTime();
      const midPoint = new Date(start.getTime() + durationMs / 2);
      const midStart = new Date(midPoint.getTime() - (10 * 60 * 1000));
      const midEnd = new Date(midPoint.getTime() + (10 * 60 * 1000));
      const outStart = new Date(end.getTime() - (15 * 60 * 1000));

      if (now >= outStart) {
        markerColor = 'red';
        statusText = 'Missed Check-Out';
      } else if (now >= midStart && now <= midEnd && !hasMid) {
        markerColor = 'red';
        statusText = 'Missed Mid-Check';
      }
    } else if (!hasIn) {
      markerColor = 'orange';
      statusText = 'No Check-In Yet';
    }

    return {
      roomName: record.room_name || '',
      teacherName: record.teacher_name || '',
      color: markerColor,
      statusText
    };
  };

  const attendanceCampusOptions = useMemo(() => {
    const vals = uniqueValues(attendanceRecords.map(r => r.campus_name));
    return vals;
  }, [attendanceRecords]);
  const attendanceBuildingOptions = useMemo(() => {
    return uniqueValues(
      attendanceRecords
        .filter(r => !pendingFilters.campus || nameEq(r.campus_name, pendingFilters.campus))
        .map(r => r.building_name)
    );
  }, [attendanceRecords, pendingFilters.campus]);
  const attendanceFloorOptions = useMemo(() => {
    return uniqueValues(
      attendanceRecords
        .filter(r => (!pendingFilters.campus || nameEq(r.campus_name, pendingFilters.campus))
          && (!pendingFilters.building || nameEq(r.building_name, pendingFilters.building)))
        .map(r => r.floor_name)
    );
  }, [attendanceRecords, pendingFilters.campus, pendingFilters.building]);
  const attendanceRoomOptions = useMemo(() => {
    return uniqueValues(
      attendanceRecords
        .filter(r => (!pendingFilters.campus || nameEq(r.campus_name, pendingFilters.campus))
          && (!pendingFilters.building || nameEq(r.building_name, pendingFilters.building))
          && (!pendingFilters.floor || nameEq(r.floor_name, pendingFilters.floor)))
        .map(r => r.room_name)
    );
  }, [attendanceRecords, pendingFilters.campus, pendingFilters.building, pendingFilters.floor]);

  const campusOptions = useMemo(() => {
    const schoolNames = uniqueValues((catalog.schools || []).map(s => s.school_name));
    return schoolNames.length ? schoolNames : attendanceCampusOptions;
  }, [catalog.schools, attendanceCampusOptions]);

  const selectedCampusId = useMemo(() => {
    if (!pendingFilters.campus) return null;
    const found = (catalog.schools || []).find(s => nameEq(s.school_name, pendingFilters.campus));
    return found ? found.school_id : null;
  }, [catalog.schools, pendingFilters.campus]);

  const catalogBuildingOptions = useMemo(() => {
    const list = Array.isArray(catalog.buildings) ? catalog.buildings : [];
    if (!list.length) return [];
    const filtered = list.filter(b => {
      if (!selectedCampusId) return true;
      return String(b.school_id) === String(selectedCampusId);
    });
    return uniqueValues(filtered.map(b => b.building_name));
  }, [catalog.buildings, selectedCampusId]);

  const buildingOptions = useMemo(() => {
    return catalogBuildingOptions.length ? catalogBuildingOptions : attendanceBuildingOptions;
  }, [catalogBuildingOptions, attendanceBuildingOptions]);

  const selectedBuilding = useMemo(() => {
    if (!pendingFilters.building) return null;
    return (catalog.buildings || []).find(b => nameEq(b.building_name, pendingFilters.building)) || null;
  }, [catalog.buildings, pendingFilters.building]);

  const selectedBuildingId = selectedBuilding ? selectedBuilding.building_id : null;

  const catalogFloorOptions = useMemo(() => {
    const list = Array.isArray(catalog.floors) ? catalog.floors : [];
    if (!list.length) return [];
    const filtered = list.filter(f => {
      if (!selectedBuildingId) return true;
      return String(f.building_id) === String(selectedBuildingId);
    });
    return uniqueValues(filtered.map(f => f.floor_name));
  }, [catalog.floors, selectedBuildingId]);

  const floorOptions = useMemo(() => {
    return catalogFloorOptions.length ? catalogFloorOptions : attendanceFloorOptions;
  }, [catalogFloorOptions, attendanceFloorOptions]);

  const selectedFloor = useMemo(() => {
    if (!pendingFilters.floor) return null;
    return (catalog.floors || []).find(f =>
      nameEq(f.floor_name, pendingFilters.floor)
      && (!selectedBuildingId || String(f.building_id) === String(selectedBuildingId))
    ) || null;
  }, [catalog.floors, pendingFilters.floor, selectedBuildingId]);

  const selectedFloorId = selectedFloor ? selectedFloor.floor_id : null;

  const catalogRoomOptions = useMemo(() => {
    const list = Array.isArray(catalog.rooms) ? catalog.rooms : [];
    if (!list.length) return [];
    const filtered = list.filter(r => {
      if (selectedBuildingId && String(r.building_id) !== String(selectedBuildingId)) return false;
      if (selectedFloorId && String(r.floor_id) !== String(selectedFloorId)) return false;
      return true;
    });
    return uniqueValues(filtered.map(r => r.room_name));
  }, [catalog.rooms, selectedBuildingId, selectedFloorId]);

  const roomOptions = useMemo(() => {
    return catalogRoomOptions.length ? catalogRoomOptions : attendanceRoomOptions;
  }, [catalogRoomOptions, attendanceRoomOptions]);
  const sortedRoomOptions = useMemo(() => {
    return [...roomOptions].sort((a, b) => String(a).localeCompare(String(b)));
  }, [roomOptions]);

  useEffect(() => {
    setPendingFilters(prev => ({
      campus: (prev.campus && campusOptions.includes(prev.campus)) ? prev.campus : '',
      building: prev.building && buildingOptions.includes(prev.building) ? prev.building : '',
      floor: prev.floor && floorOptions.includes(prev.floor) ? prev.floor : '',
      room: prev.room && roomOptions.includes(prev.room) ? prev.room : ''
    }));
    setAppliedFilters(prev => ({
      campus: (prev.campus && campusOptions.includes(prev.campus)) ? prev.campus : '',
      building: prev.building && buildingOptions.includes(prev.building) ? prev.building : '',
      floor: prev.floor && floorOptions.includes(prev.floor) ? prev.floor : '',
      room: prev.room && roomOptions.includes(prev.room) ? prev.room : ''
    }));
  }, [campusOptions, buildingOptions, floorOptions, roomOptions]);

  const recordMatchesFilter = (record, filters) => {
    const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    if (filters.campus && !eq(record.campus_name, filters.campus)) return false;
    if (filters.building && !eq(record.building_name, filters.building)) return false;
    if (filters.floor && !eq(record.floor_name, filters.floor)) return false;
    if (filters.room && !eq(record.room_name, filters.room)) return false;
    return true;
  };

  const filteredRecords = useMemo(
    () => attendanceRecords.filter(r => recordMatchesFilter(r, appliedFilters)),
    [attendanceRecords, appliedFilters]
  );

  const searchedRecords = useMemo(() => {
    const q = String(searchTeacher || '').trim().toLowerCase();
    if (!q) return filteredRecords;
    return filteredRecords.filter((r) => {
      const hay = `${r.teacher_name || ''} ${r.room_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filteredRecords, searchTeacher]);

  const stats = useMemo(() => {
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    searchedRecords.forEach((rec) => {
      const statusTag = computeAttendanceStatus(rec);
      if (statusTag === 'PRESENT') totalPresent += 1;
      else if (statusTag === 'LATE') totalLate += 1;
      else totalAbsent += 1;
    });
    return { totalPresent, totalLate, totalAbsent };
  }, [searchedRecords]);

  const recentLogs = useMemo(() => {
    const checkpoints = [
      { key: 'in', label: 'CHECK IN', timeKey: 'time_in', fallback: (rec) => rec.start_time || '' },
      { key: 'mid', label: 'CHECK MID', timeKey: 'time_check', fallback: (rec) => getMidpointTime(rec) },
      { key: 'out', label: 'CHECK OUT', timeKey: 'time_out', fallback: (rec) => rec.end_time || '' }
    ];
    const items = searchedRecords.flatMap((rec, idx) => checkpoints.map((checkpoint) => {
      const eventTime = rec[checkpoint.timeKey] || checkpoint.fallback(rec) || rec.start_time || '';
      const sortDate = toDateTime(rec.date, eventTime) || toDateTime(rec.date, rec.start_time) || new Date(0);
      return {
        id: `${rec.attendance_id || rec.schedule_id || idx}-${rec.teacher_name}-${rec.room_name}-${checkpoint.key}`,
        teacherName: rec.teacher_name || 'Teacher',
        roomName: rec.room_name || '-',
        campusName: rec.campus_name || '',
        buildingName: rec.building_name || '',
        floorName: rec.floor_name || '',
        avatar: rec.avatar || '',
        type: checkpoint.label,
        status: computeCheckpointStatus(rec, checkpoint.key),
        eventTime,
        sortDate,
        record: rec
      };
    }));
    items.sort((a, b) => b.sortDate.getTime() - a.sortDate.getTime());
    return items;
  }, [searchedRecords]);

  const LOGS_PER_PAGE = 8;
  const totalLogPages = Math.max(1, Math.ceil(recentLogs.length / LOGS_PER_PAGE));
  const pagedLogs = useMemo(() => {
    const start = (logsPage - 1) * LOGS_PER_PAGE;
    return recentLogs.slice(start, start + LOGS_PER_PAGE);
  }, [recentLogs, logsPage]);

  useEffect(() => {
    if (logsPage > totalLogPages) setLogsPage(totalLogPages);
  }, [logsPage, totalLogPages]);

  useEffect(() => {
    setLogsPage(1);
  }, [searchTeacher, appliedFilters, selectedScheduleDate]);

  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [schools, buildings, floors, rooms] = await Promise.all([
          apiGet('school'),
          apiGet('buildings'),
          apiGet('floors'),
          apiGet('rooms')
        ]);
        if (!mounted) return;
        const clean = (list) => Array.isArray(list)
          ? list.filter(x => String(x.status || '').toLowerCase() !== 'archive')
          : [];
        setCatalog({
          schools: clean(schools),
          buildings: clean(buildings),
          floors: clean(floors),
          rooms: clean(rooms)
        });
      } catch (err) {
        console.error('Catalog fetch failed:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const fetchTeacherLocation = async () => {
      try {
        const queryDate = selectedScheduleDate || toLocalYmd();
        const [records, schedules] = await Promise.all([
          apiGet(`attendance?date=${encodeURIComponent(queryDate)}`),
          apiGet('class-schedules').catch((err) => {
            console.warn('Schedule fetch failed for 3D viewer:', err);
            return [];
          })
        ]);
        const normalizedAttendance = Array.isArray(records) ? records.map(normalizeRecord) : [];
        const scheduleRecords = buildScheduleRecordsForDate(Array.isArray(schedules) ? schedules : [], queryDate);
        setAttendanceRecords(mergeSchedulesWithAttendance(scheduleRecords, normalizedAttendance, queryDate));
        setMessage('');
      } catch (err) {
        console.error('Attendance fetch failed:', err);
        if (err?.status === 401 || err?.status === 403) {
          setMessage('Unable to load schedules. Please sign in again.');
          setAttendanceRecords([]);
        }
      }
    };

    fetchTeacherLocation();
    const interval = setInterval(fetchTeacherLocation, 5000);
    return () => clearInterval(interval);
  }, [selectedScheduleDate]);

  useEffect(() => {
    const now = nowTime;
    const candidates = searchedRecords.filter((r) => {
      const end = toDateTime(r.date, r.end_time);
      const hasAnyCheck = !!r.time_in || !!r.time_check || !!r.time_out;
      return !!end && now <= end && hasAnyCheck;
    });

    if (!candidates.length) {
      setMarkerData(null);
      return;
    }

    const picked = candidates.reduce((best, r) => {
      const start = toDateTime(r.date, r.start_time);
      if (!start) return best;
      const diff = Math.abs(start.getTime() - now.getTime());
      if (!best || diff < best.diff) return { rec: r, diff };
      return best;
    }, null);

    setMarkerData(picked ? buildMarkerFromRecord(picked.rec, now) : null);
  }, [searchedRecords, nowTime]);

  useEffect(() => {
    if (!window.THREE || !mountRef.current) return;

    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;

    const scene = new window.THREE.Scene();
    scene.background = new window.THREE.Color(0x1f1f1f);
    sceneRef.current = scene;

    const camera = new window.THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    cameraRef.current = camera;

    const renderer = new window.THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.shadowMap.enabled = true;
    renderer.outputEncoding = window.THREE.sRGBEncoding;
    raycasterRef.current = new window.THREE.Raycaster();

    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new window.THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.78);
    scene.add(ambientLight);
    const dirLight = new window.THREE.DirectionalLight(0xffffff, 1.15);
    dirLight.position.set(50, 100, 50);
    scene.add(dirLight);

    const getPointerNdc = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return new window.THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
    };

    const handleViewerPointerDown = (event) => {
      if (event.button !== 0 || !moveModeRef.current) return;
      if (!cameraRef.current || !raycasterRef.current || !window.THREE) return;

      const moveTarget = getMoveTargetObject();
      if (!moveTarget) return;

      const pointer = getPointerNdc(event);
      if (!pointer) return;

      raycasterRef.current.setFromCamera(pointer, cameraRef.current);
      const hits = raycasterRef.current.intersectObject(moveTarget, true);
      if (!hits.length) return;

      const moveTargetCenter = new window.THREE.Box3()
        .setFromObject(moveTarget)
        .getCenter(new window.THREE.Vector3());
      const plane = new window.THREE.Plane(new window.THREE.Vector3(0, 1, 0), -moveTargetCenter.y);
      const planePoint = raycasterRef.current.ray.intersectPlane(plane, new window.THREE.Vector3());
      if (!planePoint) return;

      dragStateRef.current = {
        active: true,
        pointerId: event.pointerId ?? null,
        object: moveTarget,
        plane,
        offsetX: planePoint.x - moveTarget.position.x,
        offsetZ: planePoint.z - moveTarget.position.z
      };

      if (controlsRef.current) controlsRef.current.enabled = false;
      if (typeof renderer.domElement.setPointerCapture === 'function' && event.pointerId != null) {
        try { renderer.domElement.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
      }
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
      updateViewerCursor();
    };

    const handleViewerPointerMove = (event) => {
      const dragState = dragStateRef.current;
      if (!dragState.active || !dragState.object || !dragState.plane) return;
      if (!cameraRef.current || !raycasterRef.current || !window.THREE) return;

      const pointer = getPointerNdc(event);
      if (!pointer) return;

      raycasterRef.current.setFromCamera(pointer, cameraRef.current);
      const planePoint = raycasterRef.current.ray.intersectPlane(dragState.plane, new window.THREE.Vector3());
      if (!planePoint) return;

      dragState.object.position.set(
        planePoint.x - dragState.offsetX,
        dragState.object.position.y,
        planePoint.z - dragState.offsetZ
      );
      syncActiveUploadTransform(dragState.object);
      event.preventDefault();
    };

    const handleViewerPointerUp = () => {
      if (!dragStateRef.current.active) return;
      stopDraggingMoveTarget();
      syncActiveUploadTransform();
    };

    const animate = () => {
      requestRef.current = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      updateViewButtonPosition();
      updateUploadAnchorButtons();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => syncViewerSize();
    const resizeObserver = window.ResizeObserver
      ? new window.ResizeObserver(() => syncViewerSize())
      : null;

    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', handleViewerPointerMove);
    window.addEventListener('pointerup', handleViewerPointerUp);
    window.addEventListener('pointercancel', handleViewerPointerUp);
    renderer.domElement.addEventListener('pointerdown', handleViewerPointerDown, true);
    resizeObserver?.observe(mountRef.current);
    if (viewerWrapRef.current && viewerWrapRef.current !== mountRef.current) {
      resizeObserver?.observe(viewerWrapRef.current);
    }
    syncViewerSize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handleViewerPointerMove);
      window.removeEventListener('pointerup', handleViewerPointerUp);
      window.removeEventListener('pointercancel', handleViewerPointerUp);
      renderer.domElement.removeEventListener('pointerdown', handleViewerPointerDown, true);
      resizeObserver?.disconnect();
      cancelAnimationFrame(requestRef.current);
      stopDraggingMoveTarget();
      clearPendingUploadPreview({ suppressState: true, suppressTransformSync: true });
      clearUploadedObjects({ suppressTransformSync: true });
      removeSceneObject(modelRef.current);
      modelRef.current = null;
      if (pinRef.current) { removeSceneObject(pinRef.current); pinRef.current = null; }
      if (labelRef.current) { removeSceneObject(labelRef.current); labelRef.current = null; }
      hideUploadAnchorButtons();
      meshMapRef.current = {};
      if (mountRef.current) mountRef.current.innerHTML = '';
      if (controlsRef.current?.dispose) controlsRef.current.dispose();
      if (rendererRef.current) rendererRef.current.dispose();
      rendererRef.current = null;
      raycasterRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current || !window.THREE) return;

    clearPendingUploadPreview();
    clearUploadedObjects();
    if (modelRef.current) {
      removeSceneObject(modelRef.current);
      modelRef.current = null;
    }
    meshMapRef.current = {};
    setSceneBusyLabel('Loading 3D model...');
    setStatus('loading');
    setMessage('');

    const loader = new window.THREE.GLTFLoader();
    loader.load(
      modelSrc,
      (gltf) => {
        const object = gltf.scene || gltf.scenes?.[0];
        if (!object) {
          setStatus('error');
          setMessage('Failed to load model scene.');
          return;
        }

        applyMeshDefaults(object);
        rebuildMeshMap(object);
        centerObjectAtOrigin(object);
        updateUploadAnchorLayout(object);
        sceneRef.current.add(object);
        modelRef.current = object;
        frameObjectInCamera(object);
        requestAnimationFrame(() => syncViewerSize());
        setStatus('ready');
      },
      undefined,
      (error) => {
        console.error(error);
        if (modelSrc !== fallbackModel) {
          setModelSrc(fallbackModel);
        } else {
          setStatus('error');
          setMessage('Failed to load model.');
        }
      }
    );
  }, [modelSrc, fallbackModel]);

  const createTextLabel = (text) => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const fontSize = 48;
    ctx.font = `bold ${fontSize}px Arial`;
    const textWidth = ctx.measureText(text).width;
    canvas.width = textWidth + 24;
    canvas.height = fontSize + 24;

    ctx.fillStyle = 'rgba(0,0,0,0.66)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 10);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.fillText(text, 12, fontSize + 2);

    const texture = new window.THREE.CanvasTexture(canvas);
    const material = new window.THREE.SpriteMaterial({ map: texture });
    const sprite = new window.THREE.Sprite(material);
    sprite.scale.set(10 * (canvas.width / canvas.height), 10, 1);
    return sprite;
  };

  useEffect(() => {
    if (!modelRef.current || !window.THREE || !sceneRef.current) return;

    if (pinRef.current) { removeSceneObject(pinRef.current); pinRef.current = null; }
    if (labelRef.current) { removeSceneObject(labelRef.current); labelRef.current = null; }
    if (!markerData) return;

    const normalizedTarget = normalizeMeshKey(markerData.roomName);
    let targetMesh = meshMapRef.current[normalizedTarget] || null;
    if (!targetMesh) {
      modelRef.current.traverse((child) => {
        if (child.isMesh && normalizeMeshKey(child.name) === normalizedTarget) {
          targetMesh = child;
        }
      });
    }

    if (!targetMesh) {
      setMessage(`Room "${markerData.roomName}" was not found in the 3D model.`);
      return;
    }

    const box = new window.THREE.Box3().setFromObject(targetMesh);
    const center = box.getCenter(new window.THREE.Vector3());
    const size = box.getSize(new window.THREE.Vector3());
    const colorHex = markerData.color === 'red' ? 0xff4d4f : markerData.color === 'orange' ? 0xffb020 : 0x22c55e;
    const emissiveHex = markerData.color === 'red' ? 0x5a1212 : markerData.color === 'orange' ? 0x5a3b12 : 0x114922;

    const geometry = new window.THREE.SphereGeometry(size.y * 0.4, 32, 32);
    const material = new window.THREE.MeshStandardMaterial({ color: colorHex, emissive: emissiveHex, roughness: 0.25 });
    const pin = new window.THREE.Mesh(geometry, material);
    pin.position.copy(center);
    pin.position.y += size.y + 1;
    sceneRef.current.add(pin);
    pinRef.current = pin;

    const sprite = createTextLabel(markerData.teacherName || 'Teacher');
    sprite.position.copy(center);
    sprite.position.y += size.y + 4;
    sceneRef.current.add(sprite);
    labelRef.current = sprite;
  }, [markerData]);

  const applyView = (view) => {
    if (!cameraRef.current) return;
    const d = 50;
    if (view === 'top') cameraRef.current.position.set(0, d, 0);
    else cameraRef.current.position.set(0, 20, d);
    cameraRef.current.lookAt(0, 0, 0);
    if (controlsRef.current) controlsRef.current.target.set(0, 0, 0);
  };

  const rotateModel = (degrees) => {
    if (!modelRef.current || !window.THREE) return;
    const rad = window.THREE.MathUtils.degToRad(degrees);
    modelRef.current.rotation.y += rad;
  };

  const handleResetView = () => {
    applyView('front');
    setFocusedRoom('');
    setRoomModal(null);
    setViewButtonVisible(false);
    focusedRoomCenterRef.current = null;
  };

  const clearViewFocus = () => {
    setFocusedRoom('');
    setViewButtonVisible(false);
    setRoomModal(null);
    focusedRoomCenterRef.current = null;
  };

  const showSwal = async ({ title, text, icon = 'info' }) => {
    if (window.Swal) {
      await window.Swal.fire({ title, text, icon });
    } else {
      alert(`${title}\n${text}`);
    }
  };

  const requestViewerFullscreen = async () => {
    const viewerElement = viewerWrapRef.current;
    if (!viewerElement) return;

    setIsFullscreen(true);
    setMessage('');
    filePickerActiveRef.current = false;

    try {
      if (viewerElement.requestFullscreen) {
        await viewerElement.requestFullscreen();
      } else if (viewerElement.webkitRequestFullscreen) {
        viewerElement.webkitRequestFullscreen();
      } else if (viewerElement.msRequestFullscreen) {
        viewerElement.msRequestFullscreen();
      } else {
        throw new Error('Fullscreen mode is not supported in this browser.');
      }
      requestAnimationFrame(() => syncViewerSize());
    } catch (error) {
      console.warn('Browser fullscreen request was not kept; using expanded viewer mode instead.', error);
      requestAnimationFrame(() => syncViewerSize());
    }
  };

  const exitViewerFullscreen = async () => {
    filePickerActiveRef.current = false;

    try {
      if (document.fullscreenElement === viewerWrapRef.current && document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitFullscreenElement === viewerWrapRef.current && document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msFullscreenElement === viewerWrapRef.current && document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    } catch (error) {
      console.warn('Could not exit native fullscreen cleanly.', error);
    } finally {
      nativeFullscreenRef.current = false;
      setIsFullscreen(false);
      requestAnimationFrame(() => {
        syncViewerSize();
        updateUploadAnchorButtons();
      });
    }
  };

  const triggerUploadDialog = (anchorId = selectedUploadAnchorIdRef.current) => {
    if (!fileInputRef.current || isUploadBusy || pendingUploadActiveRef.current) return;
    selectedUploadAnchorIdRef.current = anchorId;
    setMessage('');
    filePickerActiveRef.current = true;
    fileInputRef.current.click();
  };

  const parseUploadedModelFile = async (file, ext) => {
    if (!window.THREE) throw new Error('The 3D engine is not ready yet.');

    if (ext === '.glb' || ext === '.gltf') {
      const loader = new window.THREE.GLTFLoader();
      const source = ext === '.glb' ? await readFileAsArrayBuffer(file) : await readFileAsText(file);
      return new Promise((resolve, reject) => {
        loader.parse(
          source,
          '',
          (gltf) => {
            const object = gltf.scene || gltf.scenes?.[0];
            if (!object) {
              reject(new Error(`"${file.name}" did not contain a usable 3D scene.`));
              return;
            }
            resolve(object);
          },
          (error) => {
            const fallbackText = ext === '.gltf'
              ? 'Use a self-contained .gltf or .glb file for uploads.'
              : 'The file could not be parsed.';
            reject(new Error(error?.message ? `${error.message} ${fallbackText}` : fallbackText));
          }
        );
      });
    }

    if (ext === '.obj') {
      if (!window.THREE.OBJLoader) throw new Error('OBJ uploads are not available in this build.');
      const source = await readFileAsText(file);
      return new window.THREE.OBJLoader().parse(source);
    }

    if (ext === '.fbx') {
      if (!window.THREE.FBXLoader) throw new Error('FBX uploads are not available in this build.');
      const source = await readFileAsArrayBuffer(file);
      return new window.THREE.FBXLoader().parse(source, '');
    }

    if (ext === '.stl') {
      if (!window.THREE.STLLoader) throw new Error('STL uploads are not available in this build.');
      const source = await readFileAsArrayBuffer(file);
      const geometry = new window.THREE.STLLoader().parse(source);
      if (typeof geometry.computeVertexNormals === 'function') geometry.computeVertexNormals();
      const material = new window.THREE.MeshStandardMaterial({
        color: 0xd9e2ec,
        metalness: 0.08,
        roughness: 0.72
      });
      return new window.THREE.Mesh(geometry, material);
    }

    throw new Error(`Unsupported file type. Choose one of: ${supportedUploadExts.join(', ')}`);
  };

  const handleUploadedModelSelection = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      filePickerActiveRef.current = false;
      return;
    }

    const ext = getFileExtension(file.name);
    if (!supportedUploadExts.includes(ext)) {
      setMessage(`Unsupported file type. Choose one of: ${supportedUploadExts.join(', ')}`);
      filePickerActiveRef.current = false;
      event.target.value = '';
      return;
    }

    setMessage('');
    setIsUploadBusy(true);
    setSceneBusyLabel(`Importing ${file.name}...`);

    try {
      const object = await parseUploadedModelFile(file, ext);
      object.name = object.name || file.name;
      applyMeshDefaults(object);
      centerObjectAtOrigin(object);
      placeObjectOnGround(object);
      applyUploadAnchorPlacement(object);
      storeInitialUploadPosition(object);
      if (!sceneRef.current) {
        removeSceneObject(object);
        return;
      }
      clearPendingUploadPreview({ suppressState: true });
      setAcceptedUploadsVisible(false);
      sceneRef.current.add(object);
      pendingUploadObjectRef.current = object;
      setPendingUploadState({ name: file.name });
      syncActiveUploadTransform(object);
      setMessage(`Preview ready for "${file.name}". Accept or cancel the upload changes.`);
      controlsRef.current?.update();
      requestAnimationFrame(() => {
        syncViewerSize();
        updateUploadAnchorButtons();
      });
    } catch (error) {
      console.error(error);
      setMessage(error?.message || `Failed to import "${file.name}".`);
    } finally {
      setIsUploadBusy(false);
      setSceneBusyLabel('Loading 3D model...');
      filePickerActiveRef.current = false;
      event.target.value = '';
    }
  };

  const acceptPendingUploadChanges = () => {
    const pendingObject = pendingUploadObjectRef.current;
    if (!pendingObject) return;

    clearUploadedObjects();
    pendingObject.visible = true;
    uploadedObjectsRef.current = [pendingObject];
    pendingUploadObjectRef.current = null;
    setPendingUploadState(null);
    syncActiveUploadTransform(pendingObject);
    setMessage(`Accepted "${pendingObject.name || 'uploaded model'}".`);
    requestAnimationFrame(() => {
      syncViewerSize();
      updateUploadAnchorButtons();
    });
  };

  const cancelPendingUploadChanges = () => {
    const pendingName = pendingUpload?.name || pendingUploadObjectRef.current?.name || 'upload preview';
    clearPendingUploadPreview({ restoreCommitted: true });
    setMessage(`Canceled changes for "${pendingName}".`);
    requestAnimationFrame(() => {
      syncViewerSize();
      updateUploadAnchorButtons();
    });
  };

  const focusRoomCamera = (roomName, onDone) => {
    if (!roomName || !modelRef.current || !cameraRef.current || !window.THREE) return false;
    const normalizedTarget = normalizeMeshKey(roomName);
    let targetMesh = meshMapRef.current[normalizedTarget] || null;
    if (!targetMesh) {
      modelRef.current.traverse((child) => {
        if (child.isMesh && normalizeMeshKey(child.name) === normalizedTarget) {
          targetMesh = child;
        }
      });
    }
    if (!targetMesh) return false;

    const box = new window.THREE.Box3().setFromObject(targetMesh);
    const center = box.getCenter(new window.THREE.Vector3());
    const size = box.getSize(new window.THREE.Vector3());
    const anchor = center.clone();
    anchor.y += Math.max(size.y * 0.6, 0.5);
    focusedRoomCenterRef.current = anchor;
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cameraRef.current.fov * (Math.PI / 180);
    let distance = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    distance = Math.max(distance * 0.85, 1.8);

    const direction = new window.THREE.Vector3(1, 0.4, 1).normalize();
    const position = center.clone().add(direction.multiplyScalar(distance));
    smoothCameraTo(position, center, 650, onDone);
    return true;
  };

  const getRoomMeta = (roomName) => {
    const room = (catalog.rooms || []).find(r => nameEq(r.room_name, roomName)) || null;
    const building = room
      ? (catalog.buildings || []).find(b => String(b.building_id) === String(room.building_id))
      : null;
    const floor = room
      ? (catalog.floors || []).find(f => String(f.floor_id) === String(room.floor_id))
      : null;
    return {
      roomName,
      buildingName: building?.building_name || pendingFilters.building || '-',
      floorName: floor?.floor_name || pendingFilters.floor || '-'
    };
  };

  const getLogRoomMeta = (log) => {
    const roomName = String(log?.roomName || log?.record?.room_name || '').trim();
    const catalogMeta = getRoomMeta(roomName);
    return {
      roomName,
      buildingName: log?.buildingName || log?.record?.building_name || catalogMeta.buildingName,
      floorName: log?.floorName || log?.record?.floor_name || catalogMeta.floorName
    };
  };

  const handleViewRoom = (roomName) => {
    if (roomName) setFocusedRoom(roomName);
    focusRoomCamera(roomName);
    setRoomModal(getRoomMeta(roomName));
  };

  const handleRecentLogClick = async (log) => {
    const roomName = String(log?.roomName || '').trim();
    if (!roomName || roomName === '-') {
      await showSwal({
        title: 'Room Not Found',
        text: 'This log has no room assigned.',
        icon: 'warning'
      });
      return;
    }

    const meta = getLogRoomMeta(log);
    setRoomModal(null);
    setFocusedRoom(roomName);
    setViewButtonVisible(false);
    setPendingFilters((prev) => ({
      ...prev,
      campus: log.campusName || prev.campus || '',
      building: log.buildingName || prev.building || '',
      floor: log.floorName || prev.floor || '',
      room: roomName
    }));

    const ok = focusRoomCamera(roomName, () => {
      setViewButtonVisible(true);
      setRoomModal(meta);
    });

    if (!ok) {
      setFocusedRoom('');
      setViewButtonVisible(false);
      await showSwal({
        title: 'Room Not Found',
        text: `Room "${roomName}" was not found in the 3D model.`,
        icon: 'warning'
      });
    }
  };

  const applyFilterView = async () => {
    setAppliedFilters({ ...pendingFilters });
    setViewButtonVisible(false);
    const hasAttendance = attendanceRecords.some(r => recordMatchesFilter(r, pendingFilters));
    const hasCatalog = (() => {
      if (pendingFilters.room) return roomOptions.includes(pendingFilters.room);
      if (pendingFilters.floor) return roomOptions.length > 0;
      if (pendingFilters.building) return floorOptions.length > 0 || roomOptions.length > 0;
      if (pendingFilters.campus) return buildingOptions.length > 0 || floorOptions.length > 0 || roomOptions.length > 0;
      return true;
    })();
    if (!hasAttendance && !hasCatalog) {
      await showSwal({
        title: 'No Rooms Found',
        text: 'No rooms or schedules match your selected filters.',
        icon: 'warning'
      });
      return;
    }
    if (pendingFilters.room) {
      const ok = focusRoomCamera(pendingFilters.room, () => setViewButtonVisible(true));
      setFocusedRoom(ok ? pendingFilters.room : '');
      if (!ok) {
        await showSwal({
          title: 'Room Not Found',
          text: `Room "${pendingFilters.room}" was not found in the 3D model.`,
          icon: 'error'
        });
      }
    } else {
      setFocusedRoom('');
    }
  };

  const roomSchedules = useMemo(() => {
    if (!roomModal?.roomName) return [];
    const targetDate = String(selectedScheduleDate || '').trim();
    return attendanceRecords.filter((r) => {
      if (!nameEq(r.room_name, roomModal.roomName)) return false;
      if (!targetDate) return true;
      return String(r.date || '').slice(0, 10) === targetDate;
    });
  }, [attendanceRecords, roomModal?.roomName, selectedScheduleDate]);

  const selectedLogDate = (() => {
    const key = normalizeDateKey(selectedScheduleDate) || toLocalYmd();
    const d = new Date(`${key}T00:00:00`);
    return Number.isNaN(d.getTime()) ? nowTime : d;
  })();
  const dateTimeStamp = `${selectedLogDate
    .toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
    .toUpperCase()
    .replace(', ', ',')} ${nowTime
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .toUpperCase()
    .replace(' ', '')}`;
  const isSceneBusy = status === 'loading' || isUploadBusy;
  const hasMovableUpload = !!activeUploadTransform;

  return (
    <div className="tdb-page">
      <div className="tdb-shell">
        <div className="tdb-main">
          <div className="tdb-top-row">
            <h2 className="tdb-title">3D Building Viewer</h2>
            <div className="tdb-stats">
              <div className="tdb-stat-card">
                <div className="tdb-stat-label">TOTAL PRESENT</div>
                <div className="tdb-stat-value">{stats.totalPresent}</div>
              </div>
              <div className="tdb-stat-card">
                <div className="tdb-stat-label">TOTAL LATE</div>
                <div className="tdb-stat-value">{stats.totalLate}</div>
              </div>
              <div className="tdb-stat-card">
                <div className="tdb-stat-label">TOTAL ABSENT</div>
                <div className="tdb-stat-value">{stats.totalAbsent}</div>
              </div>
            </div>
          </div>

          <div className="tdb-filter-row">
            <div className="tdb-field">
              <label>Search Teacher...</label>
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder="Search Teacher..."
                value={searchTeacher}
                onChange={(e) => setSearchTeacher(e.target.value)}
              />
            </div>
            <div className="tdb-field">
              <label>Filter By Campus</label>
              <select
                className="form-select form-select-sm"
                value={pendingFilters.campus}
                onChange={(e) => {
                  clearViewFocus();
                  setPendingFilters(() => ({
                    campus: e.target.value,
                    building: '',
                    floor: '',
                    room: ''
                  }));
                }}
              >
                <option value="">All Campus</option>
                {campusOptions.map((campus) => <option key={campus} value={campus}>{campus}</option>)}
              </select>
            </div>
            <div className="tdb-field">
              <label>Filter By Building</label>
              <select
                className="form-select form-select-sm"
                value={pendingFilters.building}
                onChange={(e) => {
                  clearViewFocus();
                  setPendingFilters((prev) => ({
                    ...prev,
                    building: e.target.value,
                    floor: '',
                    room: ''
                  }));
                }}
              >
                <option value="">All Building</option>
                {buildingOptions.map((building) => <option key={building} value={building}>{building}</option>)}
              </select>
            </div>
            <div className="tdb-field">
              <label>Filter By Floor</label>
              <select
                className="form-select form-select-sm"
                value={pendingFilters.floor}
                onChange={(e) => {
                  clearViewFocus();
                  setPendingFilters((prev) => ({
                    ...prev,
                    floor: e.target.value,
                    room: ''
                  }));
                }}
              >
                <option value="">All Floor</option>
                {floorOptions.map((floor) => <option key={floor} value={floor}>{floor}</option>)}
              </select>
            </div>
            <div className="tdb-field">
              <label>Filter By Rooms</label>
              <select
                className="form-select form-select-sm"
                value={pendingFilters.room}
                onChange={(e) => {
                  clearViewFocus();
                  setPendingFilters((prev) => ({ ...prev, room: e.target.value }));
                }}
              >
                <option value="">All Rooms</option>
                {roomOptions.map((room) => <option key={room} value={room}>{room}</option>)}
              </select>
            </div>
            <div className="tdb-view-button-wrap">
              <button type="button" onClick={applyFilterView} className="btn btn-success btn-sm tdb-view-button">VIEW</button>
            </div>
          </div>

          <div
            className={`tdb-viewer-wrap${isFullscreen ? ' tdb-viewer-wrap--fullscreen' : ''}`}
            ref={viewerWrapRef}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="tdb-hidden-file-input"
              accept={supportedUploadExts.join(',')}
              onChange={handleUploadedModelSelection}
            />

            {!isFullscreen && (
              <button
                type="button"
                className="tdb-glass-plus-btn tdb-glass-plus-btn--entry"
                onClick={requestViewerFullscreen}
                aria-label="Expand 3D viewer fullscreen"
                title="Expand 3D viewer"
              >
                <span aria-hidden="true">+</span>
              </button>
            )}

            {isFullscreen && (
              <button
                type="button"
                className="tdb-glass-plus-btn tdb-glass-plus-btn--exit"
                onClick={exitViewerFullscreen}
                aria-label="Exit fullscreen"
                title="Exit fullscreen"
              >
                <span aria-hidden="true">&times;</span>
              </button>
            )}

            <div className="tdb-viewer" ref={mountRef} />

            {isFullscreen && uploadAnchorDefs.map((anchor) => (
              <button
                key={anchor.id}
                type="button"
                className="tdb-glass-plus-btn tdb-glass-plus-btn--anchor"
                onClick={() => triggerUploadDialog(anchor.id)}
                aria-label={anchor.label}
                title={anchor.label}
                ref={(node) => setUploadAnchorRef(anchor.id, node)}
                style={{ display: 'none' }}
              >
                <span aria-hidden="true">+</span>
              </button>
            ))}

            <div className="tdb-side-controls">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleResetView}>Reset View</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => applyView('top')}>Top View</button>
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => rotateModel(45)}>Rotate</button>
              <button
                type="button"
                className={`btn btn-sm ${moveModeEnabled ? 'btn-warning' : 'btn-outline-secondary'}`}
                onClick={() => setMoveModeEnabled((prev) => !prev)}
                disabled={!hasMovableUpload}
                title={hasMovableUpload ? 'Drag the uploaded building to reposition it in the viewer' : 'Upload a building first'}
              >
                {moveModeEnabled ? 'Stop Move' : 'Move Building'}
              </button>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={resetMoveTargetPosition}
                disabled={!hasMovableUpload}
                title={hasMovableUpload ? 'Reset the uploaded building back to its initial viewer position' : 'Upload a building first'}
              >
                Reset Position
              </button>
              {activeUploadTransform && (
                <div className={`tdb-move-chip${moveModeEnabled ? ' tdb-move-chip--active' : ''}`}>
                  <div className="tdb-move-chip-title">
                    {moveModeEnabled ? 'Move mode: drag building' : activeUploadTransform.name}
                  </div>
                  <div className="tdb-move-chip-coords">
                    X: {activeUploadTransform.x} | Y: {activeUploadTransform.y} | Z: {activeUploadTransform.z}
                  </div>
                  <div className="tdb-nudge-grid" aria-label="Fine move controls">
                    <span className="tdb-nudge-spacer" aria-hidden="true" />
                    <button
                      type="button"
                      className="tdb-nudge-btn"
                      onClick={() => nudgeMoveTarget(0, 0, -moveNudgeStep)}
                      title={`Move forward by ${moveNudgeStep}`}
                    >
                      ^
                    </button>
                    <span className="tdb-nudge-spacer" aria-hidden="true" />
                    <button
                      type="button"
                      className="tdb-nudge-btn"
                      onClick={() => nudgeMoveTarget(-moveNudgeStep, 0, 0)}
                      title={`Move left by ${moveNudgeStep}`}
                    >
                      &lt;
                    </button>
                    <div className="tdb-nudge-step">step {moveNudgeStep}</div>
                    <button
                      type="button"
                      className="tdb-nudge-btn"
                      onClick={() => nudgeMoveTarget(moveNudgeStep, 0, 0)}
                      title={`Move right by ${moveNudgeStep}`}
                    >
                      &gt;
                    </button>
                    <span className="tdb-nudge-spacer" aria-hidden="true" />
                    <button
                      type="button"
                      className="tdb-nudge-btn"
                      onClick={() => nudgeMoveTarget(0, 0, moveNudgeStep)}
                      title={`Move backward by ${moveNudgeStep}`}
                    >
                      v
                    </button>
                    <span className="tdb-nudge-spacer" aria-hidden="true" />
                  </div>
                  {!moveModeEnabled && (
                    <div className="tdb-move-chip-hint">Toggle move mode or use the arrows to adjust the location on the ground.</div>
                  )}
                </div>
              )}
            </div>

            {isSceneBusy && (
              <div className="tdb-loading-overlay" role="status" aria-live="polite">
                <div className="tdb-loading-spinner" />
                <div className="tdb-loading-text">{sceneBusyLabel}</div>
              </div>
            )}

            {pendingUpload && (
              <div className="tdb-upload-review">
                <div className="tdb-upload-review-copy">
                  <div className="tdb-upload-review-title">Review Upload</div>
                  <div className="tdb-upload-review-name">{pendingUpload.name}</div>
                </div>
                <div className="tdb-upload-review-actions">
                  <button
                    type="button"
                    className="btn btn-outline-light btn-sm"
                    onClick={cancelPendingUploadChanges}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={acceptPendingUploadChanges}
                  >
                    Accept
                  </button>
                </div>
              </div>
            )}

            {focusedRoom && viewButtonVisible && (
              <button
                type="button"
                className="btn btn-secondary btn-sm tdb-view-room-btn"
                onClick={() => handleViewRoom(focusedRoom)}
                ref={viewBtnRef}
              >
                View Room
              </button>
            )}

            {markerData && (
              <div
                className="tdb-active-class"
                style={{ borderColor: markerData.color === 'red' ? '#dc3545' : markerData.color === 'orange' ? '#f59e0b' : '#198f54' }}
              >
                <div className="tdb-active-title">ACTIVE CLASS</div>
                <div className="tdb-active-room">{markerData.roomName || '-'}</div>
                <div className="tdb-active-teacher">{markerData.teacherName || '-'}</div>
                <div
                  className="tdb-active-status"
                  style={{ color: markerData.color === 'red' ? '#f8d7da' : markerData.color === 'orange' ? '#fde68a' : '#d1fae5' }}
                >
                  {markerData.statusText}
                </div>
              </div>
            )}

            {!markerData && status === 'ready' && (
              <div className="tdb-note tdb-note-idle">Waiting for active check-in...</div>
            )}

            {message && <div className="tdb-note tdb-note-error">{message}</div>}

            {roomModal && (
              <div className="tdb-modal-backdrop" onClick={() => setRoomModal(null)}>
                <div className="tdb-modal-card" onClick={(e) => e.stopPropagation()}>
                  <div className="tdb-modal-title">{roomModal.roomName}</div>
                  <div className="tdb-modal-meta">Building: {roomModal.buildingName}</div>
                  <div className="tdb-modal-meta">Floor: {roomModal.floorName}</div>
                  <div className="tdb-modal-date-row">
                    <label htmlFor="tdb-modal-date" className="tdb-modal-date-label">Schedule Date</label>
                    <input
                      id="tdb-modal-date"
                      type="date"
                      className="form-control form-control-sm tdb-modal-date-input"
                      value={selectedScheduleDate}
                      onChange={(e) => setSelectedScheduleDate(e.target.value || toLocalYmd())}
                    />
                  </div>
                  <div className="tdb-modal-sched-title">Schedules</div>
                  <div className="tdb-modal-sched-list">
                    {roomSchedules.length === 0 ? (
                      <div className="tdb-modal-empty">No schedules found for this room.</div>
                    ) : (
                      roomSchedules.map((rec, idx) => (
                        <div key={`${rec.room_name}-${rec.date}-${idx}`} className="tdb-modal-sched-item">
                          <div className="tdb-modal-sched-room">{rec.teacher_name || 'Teacher'}</div>
                          <div className="tdb-modal-sched-meta">{rec.date || '-'} | {formatClock(rec.start_time)} - {formatClock(rec.end_time)}</div>
                          <div className="tdb-modal-sched-meta">Status: {computeAttendanceStatus(rec)}</div>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="tdb-modal-actions">
                    <button type="button" className="btn btn-success btn-sm" onClick={() => setRoomModal(null)}>Close</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="tdb-logs-panel">
          <div className="tdb-time-chip">{dateTimeStamp}</div>
          <div className="tdb-log-date-field">
            <label htmlFor="tdb-log-date">Logs Date</label>
            <input
              id="tdb-log-date"
              type="date"
              className="form-control form-control-sm"
              value={selectedScheduleDate}
              onChange={(e) => setSelectedScheduleDate(e.target.value || toLocalYmd())}
            />
          </div>
          <div className="tdb-logs-title">Recent Logs</div>

          <div className="tdb-logs-list">
            {pagedLogs.length === 0 ? (
              <div className="tdb-no-logs">No logs found for current filters.</div>
            ) : (
              pagedLogs.map((log) => {
                const statusClass = log.status === 'PRESENT'
                  ? 'tdb-status-present'
                  : log.status === 'LATE'
                    ? 'tdb-status-late'
                    : 'tdb-status-absent';
                return (
                  <button
                    key={log.id}
                    type="button"
                    className="tdb-log-item tdb-log-item--clickable"
                    onClick={() => handleRecentLogClick(log)}
                    aria-label={`View room ${log.roomName}`}
                    title={`View ${log.roomName}`}
                  >
                    <div className="tdb-log-avatar">
                      <img
                        src={log.avatar || defaultAvatarSrc}
                        alt={log.teacherName || 'User'}
                        onError={(e) => {
                          if (e.currentTarget.src !== defaultAvatarSrc) e.currentTarget.src = defaultAvatarSrc;
                        }}
                      />
                    </div>
                    <div className="tdb-log-body">
                      <div className="tdb-log-name">{log.teacherName} ({log.roomName})</div>
                      <div className="tdb-log-meta">
                        <span className="tdb-pill tdb-pill-type">{log.type}:</span>
                        <span className={`tdb-pill ${statusClass}`}>{log.status}</span>
                        <span className="tdb-log-time">{formatClock(log.eventTime)}</span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="tdb-pagination">
            <button
              type="button"
              className="btn btn-success btn-sm tdb-page-btn"
              disabled={logsPage <= 1}
              onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
            >
              {'<'}
            </button>
            {Array.from({ length: totalLogPages }, (_, idx) => idx + 1).slice(0, 5).map((pageNo) => (
              <button
                key={pageNo}
                type="button"
                className={`btn btn-sm tdb-page-btn ${logsPage === pageNo ? 'btn-light' : 'btn-outline-light'}`}
                onClick={() => setLogsPage(pageNo)}
              >
                {pageNo}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-success btn-sm tdb-page-btn"
              disabled={logsPage >= totalLogPages}
              onClick={() => setLogsPage((p) => Math.min(totalLogPages, p + 1))}
            >
              {'>'}
            </button>
          </div>
        </aside>
      </div>

    </div>
  );
}

export default ThreeDBuildingIndex;
