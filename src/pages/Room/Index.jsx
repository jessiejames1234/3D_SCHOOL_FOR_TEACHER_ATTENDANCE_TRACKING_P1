import React from 'react';
import { apiGet, apiPost, apiPut } from '../../services/api.js'; // Ensure this matches your project structure
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";

function RoomIndex(){
  const [rooms, setRooms] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ building_id: '', floor_id: '', room_name: '', latitude: '', longitude: '', radius: '5', altitude: '' });
  const [lastCoords, setLastCoords] = React.useState(null);
  const [buildings, setBuildings] = React.useState([]);
  const [allFloors, setAllFloors] = React.useState([]);
  const [liveGpsActive, setLiveGpsActive] = React.useState(false);
  const watchIdRef = React.useRef(null);
  const livePollRef = React.useRef(null);

  React.useEffect(()=>{ fetchRooms(); }, []);

  React.useEffect(() => {
    let timer = null;
    let stopped = false;

    const pollRooms = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      await fetchRooms(true);
    };

    // HTTPS polling interval (30s) for rooms updates
    timer = setInterval(pollRooms, 30000);

    const onVisibility = () => { if (!stopped) pollRooms(); };
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
  }, []);

  // fetch buildings and floors once
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const b = await apiGet('buildings'); if (mounted && Array.isArray(b)) setBuildings(b);
      } catch (e) { console.error('failed to load buildings', e); }
    })();
    (async () => {
      try {
        const f = await apiGet('floors'); if (mounted && Array.isArray(f)) setAllFloors(f);
      } catch (e) { console.error('failed to load floors', e); }
    })();
    return () => { mounted = false; };
  }, []);

  async function fetchRooms(silent = false){
    if (!silent) { setLoading(true); setError(''); }
    try{
      const res = await apiGet('rooms');
      if (Array.isArray(res)) setRooms(res);
      else setRooms([]);
    }catch(e){ console.error(e); if (!silent) setError('Failed to load rooms'); }
    finally{ if (!silent) setLoading(false); }
  }

  const openModal = (r=null) => {
    setError('');
    if (r) {
      setEditing(r);
      setForm({
        building_id: r.building_id || '',
        floor_id: r.floor_id || '',
        room_name: r.room_name || '',
        latitude: r.latitude ?? '',
        longitude: r.longitude ?? '',
        radius: r.radius ?? '',
        altitude: r.altitude ?? ''
      });
    } else {
      setEditing(null);
      // reset form and keep any last captured coords visible to the user
      setForm({ building_id: '', floor_id: '', room_name: '', latitude: '', longitude: '', radius: '5', altitude: '' });
    }
    setShowModal(true);
  };
  const closeModal = ()=> setShowModal(false);
  const handleChange = (e) => { const { name, value } = e.target; setForm(prev=> ({ ...prev, [name]: value })); };

  const updateLiveCoords = (coords = {}) => {
    const lat = (typeof coords.latitude === 'number') ? Number(coords.latitude) : null;
    const lon = (typeof coords.longitude === 'number') ? Number(coords.longitude) : null;
    const alt = (typeof coords.altitude === 'number' && !isNaN(coords.altitude)) ? Number(coords.altitude) : null;
    setLastCoords({ latitude: lat, longitude: lon, altitude: alt });
  };

  const clearGlobalGeo = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    if (window.__geoWatchId != null && 'geolocation' in navigator) {
      try { navigator.geolocation.clearWatch(window.__geoWatchId); } catch (e) { /* ignore */ }
    }
    if (window.__geoPollId != null) {
      try { clearInterval(window.__geoPollId); } catch (e) { /* ignore */ }
    }
    window.__geoWatchId = null;
    window.__geoPollId = null;
  }, []);

  const stopLiveGps = React.useCallback(() => {
    if (watchIdRef.current != null && 'geolocation' in navigator) {
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch (e) { /* ignore */ }
    }
    if (livePollRef.current != null) {
      try { clearInterval(livePollRef.current); } catch (e) { /* ignore */ }
    }
    watchIdRef.current = null;
    livePollRef.current = null;
    setLiveGpsActive(false);
    if (typeof window !== 'undefined' && window.__activeGeoStop === stopLiveGps) {
      clearGlobalGeo();
      window.__activeGeoStop = null;
    }
  }, [clearGlobalGeo]);

  const claimGlobalGeo = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const existing = window.__activeGeoStop;
    if (existing && existing !== stopLiveGps) {
      try { existing(); } catch (e) { /* ignore */ }
    }
    clearGlobalGeo();
    window.__activeGeoStop = stopLiveGps;
  }, [stopLiveGps, clearGlobalGeo]);

  // Start/stop live GPS watch; auto update latitude/longitude continuously
  const captureGps = () => {
    setError('');
    if (!('geolocation' in navigator)) { setError('Geolocation not supported in this browser'); return; }
    if (liveGpsActive) {
      stopLiveGps();
      if (typeof window !== 'undefined' && window.__activeGeoStop === stopLiveGps) {
        window.__activeGeoStop = null;
      }
      return;
    }
    claimGlobalGeo();
    // open modal immediately so user can see live updates
    setShowModal(true);
    // get an immediate fix, then keep watching
    navigator.geolocation.getCurrentPosition((pos) => {
      updateLiveCoords(pos.coords || {});
    }, () => {
      // ignore immediate errors
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 });

    const id = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords || {};
      updateLiveCoords(c);
    }, (err) => {
      console.error('watchPosition error', err);
      setError(err?.message || 'Failed to watch position');
      if (err && err.code === 1) {
        // permission denied
        setLiveGpsActive(false);
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 });
    watchIdRef.current = id;
    if (typeof window !== 'undefined') window.__geoWatchId = id;
    // start a short polling interval to increase update frequency on devices that don't push frequent watch updates
    if (livePollRef.current == null) {
      livePollRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition((pos) => {
          const c = pos.coords || {};
          updateLiveCoords(c);
        }, () => {
          // ignore errors from frequent polling
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 2000 });
      }, 800);
      if (typeof window !== 'undefined') window.__geoPollId = livePollRef.current;
    }
    setLiveGpsActive(true);
  };

  // Apply latest live coordinates into the modal form
  const applyLiveCoords = () => {
    setError('');
    if (!lastCoords) {
      setError('No live coordinates available. Start Live GPS first.');
      return;
    }
    const { latitude, longitude } = lastCoords;
    if (latitude == null || longitude == null) {
      setError('Live coordinates are not available yet.');
      return;
    }
    setForm(prev => ({
      ...prev,
      latitude: Number(latitude).toFixed(7),
      longitude: Number(longitude).toFixed(7)
    }));
  };

  // cleanup watcher on unmount: must be inside component body to use hooks correctly
  React.useEffect(() => {
    return () => {
      stopLiveGps();
      if (typeof window !== 'undefined' && window.__activeGeoStop === stopLiveGps) {
        window.__activeGeoStop = null;
      }
    };
  }, [stopLiveGps]);

  // ensure SweetAlert2 is loaded on demand
  const ensureSwalLoaded = async () => {
    if (window.Swal) return window.Swal;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/sweetalert2@11';
      s.onload = () => resolve(window.Swal);
      s.onerror = () => reject(new Error('Failed to load SweetAlert2'));
      document.head.appendChild(s);
    });
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!silent) { setLoading(true); setError(''); }
    try{
      const payload = {
        building_id: form.building_id ? Number(form.building_id) : null,
        floor_id: form.floor_id ? Number(form.floor_id) : null,
        room_name: (form.room_name || '').trim(),
        latitude: form.latitude !== '' ? parseFloat(form.latitude) : null,
        longitude: form.longitude !== '' ? parseFloat(form.longitude) : null,
        radius: form.radius !== '' ? parseFloat(form.radius) : null,
        altitude: form.altitude !== '' ? (isNaN(Number(form.altitude)) ? null : Number(form.altitude)) : null
      };

      // duplicate name check: same room_name within same building and floor
      if (payload.room_name && Array.isArray(rooms) && rooms.length) {
        const dupName = rooms.find(r => {
          if (!r.room_name) return false;
          if (editing && editing.room_id && Number(editing.room_id) === Number(r.room_id)) return false;
          const sameName = String(r.room_name).trim().toLowerCase() === String(payload.room_name).trim().toLowerCase();
          const sameBuilding = (payload.building_id == null && (r.building_id == null || r.building_id === '')) || String(r.building_id) === String(payload.building_id);
          const sameFloor = (payload.floor_id == null && (r.floor_id == null || r.floor_id === '')) || String(r.floor_id) === String(payload.floor_id);
          return sameName && sameBuilding && sameFloor;
        });
        if (dupName) {
          try {
            const Swal = await ensureSwalLoaded();
            // show a non-blocking toast warning for 3 seconds
            Swal.fire({
              toast: true,
              position: 'top',
              icon: 'warning',
              title: `Duplicate room name: ${dupName.room_name}`,
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true
            });
          } catch (e) {
            console.warn('Duplicate room name detected:', dupName.room_name);
          }
        }
      }

      // duplicate check: same coords already present (ignore current editing row)
      if (payload.latitude != null && payload.longitude != null && Array.isArray(rooms) && rooms.length) {
        const tol = 1e-7; // tolerance for comparing floats
        const dup = rooms.find(r => {
          if (!r.latitude || !r.longitude) return false;
          if (editing && editing.room_id && Number(editing.room_id) === Number(r.room_id)) return false;
          const rlat = Number(r.latitude);
          const rlon = Number(r.longitude);
          return Math.abs(rlat - payload.latitude) <= tol && Math.abs(rlon - payload.longitude) <= tol;
        });
        if (dup) {
          try {
            const Swal = await ensureSwalLoaded();
            // show a non-blocking toast warning for 3 seconds
            Swal.fire({
              toast: true,
              position: 'top',
              icon: 'warning',
              title: `Possible duplicate coordinates (room ${dup.room_name || dup.room_id})`,
              showConfirmButton: false,
              timer: 3000,
              timerProgressBar: true
            });
          } catch (e) {
            console.warn('Duplicate coordinates detected for room:', dup.room_name || dup.room_id);
          }
        }
      }

      if (editing && editing.room_id) {
        // try modern PUT, fallback to POST update if API requires
        try { await apiPut(`rooms/${editing.room_id}`, payload); } catch(e){ await apiPost(`rooms/${editing.room_id}/update`, payload); }
      } else {
        await apiPost('rooms', payload);
      }
      await fetchRooms();
      // remember last captured coords for display after successful save
      if (payload.latitude != null && payload.longitude != null) {
        setLastCoords({ latitude: payload.latitude, longitude: payload.longitude, altitude: payload.altitude });
      }
      closeModal();
    }catch(e){ console.error(e); setError(e?.message || 'Failed to save room'); }
    finally{ if (!silent) setLoading(false); }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r, pIdx, gIdx) => gIdx + 1 },
    { key: 'room_name', label: 'Room' },
    { key: 'building_name', label: 'Building' },
    { key: 'floor_name', label: 'Floor' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
    { key: 'radius', label: 'Radius (m)' },
    { 
      key: 'status', 
      label: 'Status', 
      render: (r) => {
        const s = (r.status || '').toLowerCase();
        const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
        const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status || 'N/A'));
        return (<span className={`badge ${cls}`}>{text}</span>);
      }
    },
    { key: 'actions', label: 'Actions', actions: [
      { label: 'Edit', onClick: (row) => openModal(row) }
    ] }
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Room Management</h2>
        <div className="flex gap-2">
          <button className="btn btn-success" onClick={()=>openModal()}>Add Room</button>
        </div>
      </div>

      {/* Show live/last captured coordinates if available */}
      {lastCoords && (
        <div className="mb-3 text-sm text-gray-700">Live coords: Lat: {lastCoords.latitude != null ? Number(lastCoords.latitude).toFixed(7) : 'N/A'}, Lon: {lastCoords.longitude != null ? Number(lastCoords.longitude).toFixed(7) : 'N/A'}</div>
      )}

      {error && <div className="mb-3 text-red-600">{error}</div>}

      <Table columns={columns} data={rooms} loading={loading} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Room' : 'Add Room'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Room Name</label>
            <input name="room_name" value={form.room_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input name="latitude" value={form.latitude} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input name="longitude" value={form.longitude} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Radius (m)</label>
              <input name="radius" value={form.radius} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
          </div>

          {/* Building and Floor filters inside modal */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
              <select name="building_id" value={form.building_id} onChange={(e)=>{ handleChange(e); /* reset floor when building changes */ setForm(prev=>({ ...prev, floor_id: '' })); }} className="block w-full border border-gray-200 rounded px-3 py-2">
                <option value="">Select building</option>
                {buildings.map(b => (<option key={b.building_id} value={b.building_id}>{b.building_name || b.building_id}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Floor</label>
              <select
                name="floor_id"
                value={form.floor_id}
                onChange={handleChange}
                disabled={!form.building_id}
                className="block w-full border border-gray-200 rounded px-3 py-2 disabled:bg-gray-100"
              >
                <option value="">{form.building_id ? 'Select floor' : 'Select building first'}</option>
                {form.building_id && allFloors
                  .filter(f => String(f.building_id) === String(form.building_id))
                  .map(f => (
                    <option key={f.floor_id} value={f.floor_id}>{f.floor_name || f.floor_id}</option>
                  ))
                }
              </select>
            </div>
          </div>

          {/* Live GPS controls inside modal: start/stop and apply live */}
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={captureGps} className={`px-3 py-2 rounded border ${liveGpsActive ? 'bg-yellow-200' : ''}`}>{liveGpsActive ? 'Stop Live' : 'Start Live'}</button>
            <button type="button" onClick={applyLiveCoords} className="px-3 py-2 rounded border">Apply Live</button>
            <div className="text-sm text-gray-600">Live: {liveGpsActive ? 'ON' : 'OFF'} | Lat: {lastCoords && lastCoords.latitude != null ? Number(lastCoords.latitude).toFixed(7) : (form.latitude || 'N/A')} | Lon: {lastCoords && lastCoords.longitude != null ? Number(lastCoords.longitude).toFixed(7) : (form.longitude || 'N/A')}</div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white">{loading ? 'Saving...' : (editing ? 'Update Room' : 'Save Room')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default RoomIndex;


