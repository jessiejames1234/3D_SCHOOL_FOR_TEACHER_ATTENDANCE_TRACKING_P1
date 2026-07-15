import React from 'react';
import { apiGet, apiPost, apiPut } from '../../services/api.js';
import Table from "../../components/Table.jsx";
import Modal from "../../components/Modal.jsx";
import QrModal from "../../components/QrModal.jsx";
import { useLiveGeolocation } from '../../utils/useLiveGeolocation.js';

function FloorIndex(){
  const [floors, setFloors] = React.useState([]);
  const [buildings, setBuildings] = React.useState([]);
  const [showModal, setShowModal] = React.useState(false);
  const [qrModalOpen, setQrModalOpen] = React.useState(false);
  const [qrModalToken, setQrModalToken] = React.useState(null);
  const [qrModalStatus, setQrModalStatus] = React.useState('inactive');
  const [editing, setEditing] = React.useState(null);
  const [form, setForm] = React.useState({ building_id:'', floor_name:'', baseline_altitude:'', floor_meter_vertical:'' });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [lastAltitude, setLastAltitude] = React.useState(null);
  const [selectedBuildingId, setSelectedBuildingId] = React.useState('');

  const runWithFallback = async (primary, fallback) => {
    try { return await primary(); } catch (err) {
      if (err?.status === 405 || err?.status === 500) return await fallback();
      throw err;
    }
  };

  const loadData = React.useCallback(async () => {
    try{
      const [f, b] = await Promise.all([apiGet('floors'), apiGet('buildings')]);
      // hide archived floors
      const fl = Array.isArray(f) ? f.filter(x => String(x.status || '').toLowerCase() !== 'archive') : [];
      setFloors(fl);
      setBuildings(Array.isArray(b)?b:[]);
    }catch(e){ console.error(e); setError('Failed to load floors or buildings'); }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredFloors = React.useMemo(() => {
    if (!selectedBuildingId) return floors;
    return floors.filter(floor => String(floor.building_id) === String(selectedBuildingId));
  }, [floors, selectedBuildingId]);

  React.useEffect(() => {
    let timer = null;
    let stopped = false;

    const pollFloors = async () => {
      if (stopped) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      await loadData();
    };

    // HTTPS polling interval (30s) for floors updates
    timer = setInterval(pollFloors, 30000);

    const onVisibility = () => { if (!stopped) pollFloors(); };
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

  const openModal = (fl=null) => {
    setError('');
    if (fl) {
      setEditing(fl);
      setForm({ building_id: fl.building_id || '', floor_name: fl.floor_name || '', baseline_altitude: fl.baseline_altitude ?? '', floor_meter_vertical: fl.floor_meter_vertical ?? '' });
    } else {
      setEditing(null);
      setForm({ building_id: buildings[0]?.building_id || '', floor_name:'', baseline_altitude:'', floor_meter_vertical:'' });
    }
    setShowModal(true);
  };
  const closeModal = ()=> {
    stopLiveAltitude();
    setLastAltitude(0);
    setShowModal(false);
  };
  const handleChange = (e)=> setForm(p=>({...p, [e.target.name]: e.target.value}));

  const updateLiveAltitude = (coords = {}) => {
    const alt = (typeof coords.altitude === 'number' && !isNaN(coords.altitude)) ? Number(coords.altitude) : null;
    setLastAltitude(alt);
  };

  const {
    active: liveAltActive,
    start: startLiveAltitude,
    stop: stopLiveAltitude
  } = useLiveGeolocation({
    onPosition: updateLiveAltitude,
    onError: (message, err) => {
      if (err) console.error('geolocation error', err);
      setError(message || 'Failed to watch position');
    }
  });

  const captureAltitude = () => {
    setError('');
    if (liveAltActive) {
      stopLiveAltitude();
      setLastAltitude(0);
      return;
    }
    setShowModal(true);
    setLastAltitude(null);
    startLiveAltitude();
  };

  const applyLiveAltitude = () => {
    setError('');
    if (!liveAltActive) {
      setError('Start Live first.');
      return;
    }
    if (lastAltitude == null) {
      setError('No live altitude available. Start Live first.');
      return;
    }
    setForm(prev => ({ ...prev, baseline_altitude: Number(lastAltitude).toFixed(1) }));
  };

  const validateForm = () => {
    const name = (form.floor_name||'').trim();
    if (!name) return 'Floor name is required';
    if (!form.building_id) return 'Building is required';
    const bId = Number(form.building_id);
    // duplicate name check within same building
    const conflictName = floors.find(f => f.floor_name && String(f.floor_name).toLowerCase() === name.toLowerCase() && Number(f.building_id) === bId && (!editing || Number(f.floor_id) !== Number(editing.floor_id)));
    if (conflictName) return 'A floor with the same name already exists in this building';
    // baseline altitude duplicate check within same building if provided
    const alt = form.baseline_altitude !== '' && form.baseline_altitude !== null ? Number(form.baseline_altitude) : null;
    if (alt !== null) {
      const conflictAlt = floors.find(f => f.baseline_altitude !== null && Math.abs(Number(f.baseline_altitude) - alt) < 0.0000001 && Number(f.building_id) === bId && (!editing || Number(f.floor_id) !== Number(editing.floor_id)));
      if (conflictAlt) return 'Another floor with same baseline altitude exists in this building';
    }
    return null;
  };

  const handleSubmit = async (e)=>{
    e.preventDefault(); setLoading(true); setError('');
    const v = validateForm();
    if (v) { try { if (window.Swal) await window.Swal.fire({ icon:'warning', title:'Validation', text: v }); else alert(v); } catch(e){} setLoading(false); return; }
    try{
      const payload = { building_id: Number(form.building_id), floor_name: form.floor_name.trim(), baseline_altitude: form.baseline_altitude !== '' ? Number(form.baseline_altitude) : null, floor_meter_vertical: form.floor_meter_vertical !== '' ? Number(form.floor_meter_vertical) : null };
      if (editing && editing.floor_id) {
        await runWithFallback(
          () => apiPut(`floors/${editing.floor_id}`, payload),
          () => apiPost(`floors/${editing.floor_id}/update`, payload)
        );
      } else {
        await apiPost('floors', payload);
      }
      const f = await apiGet('floors');
      setFloors(Array.isArray(f)? f.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      closeModal();
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: editing ? 'Floor updated' : 'Floor added', timer:1400, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      const msg = err?.body?.message || err?.body?.error || err?.message || 'Failed to save';
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: msg }); else alert(msg); } catch(e){}
      setError(msg);
    } finally { setLoading(false); }
  };

  const handleToggle = async (fl)=>{
    if (!fl || !fl.floor_id) return;
    const newStatus = String(fl.status) === 'active' ? 'inactive' : 'active';
    try{
      await runWithFallback(
        () => apiPut(`floors/${fl.floor_id}`, { status: newStatus }),
        () => apiPost(`floors/${fl.floor_id}/update`, { status: newStatus })
      );
      // Also ensure QR active flag follows status
      try {
        await apiPost(`floors/${fl.floor_id}/qr/toggle-active`, { active: newStatus === 'active' ? 1 : 0 });
      } catch(qe) { console.warn('QR toggle failed', qe); }

      const f = await apiGet('floors');
      setFloors(Array.isArray(f)? f.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Status updated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to update status' }); else alert(err.body?.error || err.message || 'Failed to update status'); } catch(e){}
    }
  };

  const handleArchive = async (fl)=>{
    if (!fl || !fl.floor_id) return;
    try{
      const res = window.Swal ? await window.Swal.fire({ title: 'Archive floor?', text: 'This will remove the floor from the active list.', icon: 'warning', showCancelButton: true }) : { isConfirmed: confirm('Archive floor?') };
      if (!res.isConfirmed) return;
      await runWithFallback(
        () => apiPut(`floors/${fl.floor_id}`, { status: 'archive' }),
        () => apiPost(`floors/${fl.floor_id}/update`, { status: 'archive' })
      );
      // Deactivate QR when archived
      try {
        await apiPost(`floors/${fl.floor_id}/qr/toggle-active`, { active: 0 });
      } catch(qe) { console.warn('QR deactivate failed on archive', qe); }

      const f = await apiGet('floors');
      setFloors(Array.isArray(f)? f.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'Archived', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) {
      console.error(err);
      try { if (window.Swal) await window.Swal.fire({ icon:'error', title:'Error', text: err.body?.error || err.message || 'Failed to archive' }); else alert(err.body?.error || err.message || 'Failed to archive'); } catch(e){}
    }
  };

  const handleViewQr = (r)=>{
    if (!r) return;
    setQrModalToken(r.qr_token);
    setQrModalStatus(r.status || 'inactive');
    setQrModalOpen(true);
  };

  const handleRegenerateQr = async (floorId)=>{
    try{
      const data = await apiPost(`floors/${floorId}/qr/regenerate`, {});
      setQrModalToken(data.qr_token);
      setQrModalStatus(data.status || 'active');
      setQrModalOpen(true);
      const f = await apiGet('floors');
      setFloors(Array.isArray(f)? f.filter(x => String(x.status || '').toLowerCase() !== 'archive') : []);
      try { if (window.Swal) await window.Swal.fire({ icon:'success', title: 'QR regenerated', timer:1200, showConfirmButton:false }); } catch(e){}
    } catch (err) { console.error(err); setError(err.body?.error || err.message || 'Failed to regenerate QR'); }
  };

  const columns = [
    { key:'rownum', label:'#', render: (r,pIdx,gIdx)=> gIdx + 1 },
    { key:'floor_name', label:'Floor' },
    { key:'building_name', label:'Building' },
    { key:'baseline_altitude', label:'Baseline Alt (m)' },
    { key:'floor_meter_vertical', label:'Floor Vertical (m)' },
    { key:'status', label:'Status', render: (r)=>{
      const s = (r.status||'').toLowerCase();
      const cls = s === 'active' ? 'bg-success' : (s === 'inactive' ? 'bg-danger' : 'bg-secondary');
      const text = s === 'active' ? 'Active' : (s === 'inactive' ? 'Inactive' : (r.status || 'N/A'));
      return (<span className={`badge ${cls}`}>{text}</span>);
    }},
    { key:'actions', label:'Actions', actions: [
      { label:'View QR', onClick: (row) => handleViewQr(row) },
      { label:'Edit', onClick: (row)=> openModal(row) },
      { label:'Toggle', onClick: (row)=> handleToggle(row) },
      { label:'Archive', variant:'danger', onClick: (row)=> handleArchive(row) }
    ]}
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold">Floors</h2>
        <div className="flex gap-2">
          <button className="btn btn-success" onClick={()=>openModal()}>Add Floor</button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-md border border-gray-200 bg-white p-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-xs">
          <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
          <select
            value={selectedBuildingId}
            onChange={(e) => setSelectedBuildingId(e.target.value)}
            className="block w-full border border-gray-200 rounded px-3 py-2"
          >
            <option value="">All buildings</option>
            {buildings.map(b => (
              <option key={b.building_id} value={b.building_id}>{b.building_name || b.building_id}</option>
            ))}
          </select>
        </div>
        {selectedBuildingId && (
          <button type="button" onClick={() => setSelectedBuildingId('')} className="px-3 py-2 rounded border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
            Clear
          </button>
        )}
      </div>

      {error && <div className="mb-3 text-red-600">{error}</div>}
      {lastAltitude != null && (
        <div className="mb-3 text-sm text-gray-700">
          Live altitude: {Number(lastAltitude).toFixed(1)}m
        </div>
      )}

      <Table columns={columns} data={filteredFloors} pageSize={10} />

      <Modal show={showModal} title={editing ? 'Edit Floor' : 'Add Floor'} onClose={closeModal} size="md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Building</label>
            <select name="building_id" value={form.building_id} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2">
              <option value="">Select building</option>
              {buildings.map(b => <option key={b.building_id} value={b.building_id}>{b.building_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Floor Name</label>
            <input name="floor_name" value={form.floor_name} onChange={handleChange} required className="block w-full border border-gray-200 rounded px-3 py-2" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Baseline Altitude (m)</label>
              <input name="baseline_altitude" type="number" step="0.1" value={form.baseline_altitude} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Floor Vertical Meter (m)</label>
              <input name="floor_meter_vertical" type="number" step="0.01" value={form.floor_meter_vertical} onChange={handleChange} className="block w-full border border-gray-200 rounded px-3 py-2" />
            </div>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={captureAltitude} className={`px-3 py-2 rounded border ${liveAltActive ? 'bg-yellow-200' : ''}`}>{liveAltActive ? 'Stop Live' : 'Start Live'}</button>
            <button type="button" onClick={applyLiveAltitude} className="px-3 py-2 rounded border">Apply Live</button>
            <div className="text-sm text-gray-600">Live: {liveAltActive ? 'ON' : 'OFF'} | Altitude: {lastAltitude != null ? `${Number(lastAltitude).toFixed(1)}m` : (form.baseline_altitude || 'N/A')}</div>
          </div>

          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className="px-3 py-2 rounded border">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded bg-green-600 text-white">{loading ? 'Saving...' : (editing ? 'Update Floor' : 'Save Floor')}</button>
          </div>
        </form>
      </Modal>

      <QrModal key={qrModalToken || 'qrmodal'} show={qrModalOpen} onClose={()=>setQrModalOpen(false)} token={qrModalToken} active={qrModalStatus === 'active'} />
    </div>
  );
}

export default FloorIndex;

