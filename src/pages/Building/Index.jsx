import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";

function BuildingIndex(){
  const [buildings, setBuildings] = React.useState([]);
  const [schools, setSchools] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ building_name: '', school_id: '', latitude: '', longitude: '', radius: '' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lastCoords, setLastCoords] = React.useState(null);
  const [liveGpsActive, setLiveGpsActive] = React.useState(false);
  const watchIdRef = React.useRef(null);
  const livePollRef = React.useRef(null);

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) {
      if (err?.status === 405 || err?.status === 500) return await fallback();
      throw err;
    }
  };

  const loadData = React.useCallback(async () => {
    try{
      const [d, s] = await Promise.all([apiGet('buildings'), apiGet('school')]);
      const list = Array.isArray(d) ? d.filter(x => String(x.status || '').toLowerCase() !== 'archive') : [];
      setBuildings(list);
      setSchools(Array.isArray(s) ? s.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
    }catch(e){ console.error(e); setError('Failed to load buildings'); }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  React.useEffect(() => {
    let timer = null;
    let stopped = false;

    const pollBuildings = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      await loadData();
    };

    // HTTPS polling interval (30s) for buildings updates
    timer = setInterval(pollBuildings, 30000);

    const onVisibility = () => { if (!stopped) pollBuildings(); };
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

  const openModal = (b=null) => {
    setError('');
    if (b) {
      setEditing(b);
      setForm({ building_name: b.building_name || '', school_id: b.school_id || '', latitude: b.latitude ?? '', longitude: b.longitude ?? '', radius: b.radius ?? '' });
    } else {
      setEditing(null);
      setForm({ building_name:'', school_id: schools[0]?.school_id || '', latitude: '', longitude: '', radius: '' });
    }
    setShowModal(true);
  };
  const closeModal = ()=> setShowModal(false);
  const handleChange = (e) => setForm(p=>({...p,[e.target.name]: e.target.value}));

  const updateLiveCoords = (coords = {}) => {
    const lat = (typeof coords.latitude === 'number') ? Number(coords.latitude) : null;
    const lon = (typeof coords.longitude === 'number') ? Number(coords.longitude) : null;
    setLastCoords({ latitude: lat, longitude: lon });
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
    setShowModal(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      updateLiveCoords(pos.coords || {});
    }, () => {
      // ignore immediate errors
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 });

    const id = navigator.geolocation.watchPosition((pos) => {
      updateLiveCoords(pos.coords || {});
    }, (err) => {
      console.error('watchPosition error', err);
      setError(err?.message || 'Failed to watch position');
      if (err && err.code === 1) {
        setLiveGpsActive(false);
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 6000 });
    watchIdRef.current = id;
    if (typeof window !== 'undefined') window.__geoWatchId = id;

    if (livePollRef.current == null) {
      livePollRef.current = setInterval(() => {
        navigator.geolocation.getCurrentPosition((pos) => {
          updateLiveCoords(pos.coords || {});
        }, () => {
          // ignore polling errors
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 2000 });
      }, 800);
      if (typeof window !== 'undefined') window.__geoPollId = livePollRef.current;
    }
    setLiveGpsActive(true);
  };

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

  React.useEffect(() => {
    return () => {
      stopLiveGps();
      if (typeof window !== 'undefined' && window.__activeGeoStop === stopLiveGps) {
        window.__activeGeoStop = null;
      }
    };
  }, [stopLiveGps]);

  const validateForm = () => {
    const name = (form.building_name||'').trim();
    if (!name) return 'Building name is required';
    const conflictName = buildings.find(b => b.building_name && String(b.building_name).toLowerCase() === name.toLowerCase() && (!editing || Number(b.building_id) !== Number(editing.building_id)));
    if (conflictName) return 'A building with the same name already exists';
    const lat = form.latitude !== '' && form.latitude !== null ? Number(form.latitude) : null;
    const lon = form.longitude !== '' && form.longitude !== null ? Number(form.longitude) : null;
    if (lat !== null && lon !== null) {
      const conflictLL = buildings.find(b => b.latitude !== null && b.longitude !== null && Math.abs(Number(b.latitude) - lat) < 0.0000001 && Math.abs(Number(b.longitude) - lon) < 0.0000001 && (!editing || Number(b.building_id) !== Number(editing.building_id)));
      if (conflictLL) return 'Another building with same latitude/longitude exists';
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    const v = validateForm();
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }

    try{
      const payload = {
        building_name: form.building_name.trim(),
        school_id: form.school_id ? Number(form.school_id) : null,
        latitude: form.latitude !== '' ? Number(form.latitude) : null,
        longitude: form.longitude !== '' ? Number(form.longitude) : null,
        radius: form.radius !== '' ? Number(form.radius) : 0
      };
      if (editing && editing.building_id) {
        await runWithFallback(
          () => apiPut(`buildings/${editing.building_id}`, payload),
          () => apiPost(`buildings/${editing.building_id}/update`, payload)
        );
      } else {
        await apiPost('buildings', payload);
      }

      const d = await apiGet('buildings');
      setBuildings(Array.isArray(d) ? d.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Building updated' : 'Building added', timer: 1400, showConfirmButton: false }); } catch(e){}
    } catch (err) {
      console.error(err);
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save';
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title: 'Error', text: msg }); else alert(msg); } catch(e){}
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleToggle = async (b) => {
    if (!b || !b.building_id) return;
    const newStatus = String(b.status) === 'active' ? 'inactive' : 'active';
    try{
      await runWithFallback(
        () => apiPut(`buildings/${b.building_id}`, { status: newStatus }),
        () => apiPost(`buildings/${b.building_id}/update`, { status: newStatus })
      );
      const d = await apiGet('buildings');
      setBuildings(Array.isArray(d)? d.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); else alert(err.body?.error || err.message || 'Failed to update status'); } catch(e){}
    }
  };

  const handleArchive = async (b) => {
    if (!b || !b.building_id) return;
    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive building?', text: 'This will remove the building from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive building?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`buildings/${b.building_id}`, { status: 'archive' }),
        () => apiPost(`buildings/${b.building_id}/update`, { status: 'archive' })
      );
      const d = await apiGet('buildings');
      setBuildings(Array.isArray(d)? d.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); else alert(err.body?.error || err.message || 'Failed to archive'); } catch(e){}
    }
  };

  const columns = [
    { key: 'rownum', label: '#', render: (r, pIdx, gIdx) => gIdx + 1 },
    { key: 'building_name', label: 'Building Name' },
    { key: 'school_name', label: 'School' },
    { key: 'latitude', label: 'Latitude' },
    { key: 'longitude', label: 'Longitude' },
    { key: 'radius', label: 'Radius (m)' },
    { key: 'status', label: 'Status', render: (r) => {
      const s = (r.status || '').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status || 'N/A'));
      return (<span className={`badge ${cls}`}>{text}</span>);
    }},
    { key: 'actions', label: 'Actions', actions: [
      { label: 'Edit', onClick: (row) => openModal(row) },
      { label: 'Toggle', onClick: (row) => handleToggle(row) },
      { label: 'Archive', variant: 'danger', onClick: (row) => handleArchive(row) }
    ] }
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Buildings</h2>
        <div className="flex gap-2">
          <button className="btn btn-success" onClick={()=>openModal()}>Add Building</button>
        </div>
      </div>

      {error && <div className="mb-3 text-red-600">{error}</div>}
      {lastCoords && (
        <div className="mb-3 text-sm text-gray-700">
          Live coords: Lat: {lastCoords.latitude != null ? Number(lastCoords.latitude).toFixed(7) : 'N/A'}, Lon: {lastCoords.longitude != null ? Number(lastCoords.longitude).toFixed(7) : 'N/A'}
        </div>
      )}

      <Table columns={columns} data={buildings} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Building' : 'Add Building'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Building Name</label>
            <input name="building_name" value={form.building_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">School</label>
            <select name="school_id" value={form.school_id} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2">
              <option value="">Select school (optional)</option>
              {schools.map(s => <option key={s.school_id} value={s.school_id}>{s.school_name}</option>)}
            </select>
          </div>

          {/* location_description removed: backend handles optional description columns automatically */}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
              <input name="latitude" type="number" step="any" placeholder="e.g. 8.469967" value={form.latitude} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
              <input name="longitude" type="number" step="any" placeholder="e.g. 124.634364" value={form.longitude} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Radius (m)</label>
              <input name="radius" type="number" step="1" min="0" value={form.radius} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={captureGps} className={`px-3 py-2 rounded border ${liveGpsActive ? 'bg-yellow-200' : ''}`}>{liveGpsActive ? 'Stop Live' : 'Start Live'}</button>
            <button type="button" onClick={applyLiveCoords} className="px-3 py-2 rounded border">Apply Live</button>
            <div className="text-sm text-gray-600">Live: {liveGpsActive ? 'ON' : 'OFF'} | Lat: {lastCoords && lastCoords.latitude != null ? Number(lastCoords.latitude).toFixed(7) : (form.latitude || 'N/A')} | Lon: {lastCoords && lastCoords.longitude != null ? Number(lastCoords.longitude).toFixed(7) : (form.longitude || 'N/A')}</div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white">{loading ? 'Saving...' : (editing ? 'Update Building' : 'Save Building')}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export default BuildingIndex;

