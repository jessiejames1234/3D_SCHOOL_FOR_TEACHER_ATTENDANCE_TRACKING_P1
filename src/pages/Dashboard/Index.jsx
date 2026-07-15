import React, { useState, useEffect, useMemo, useRef } from 'react';
import { attendanceFlagKey, attendanceFlagLabel } from '../../utils/attendanceFlags.js';
// Assuming apiGet is globally available or imported. If not, simple fetch wrapper:
// const apiGet = async (url) => { const r = await fetch(`/server-php/api/${url}`); return r.json(); };

function DashboardPage({ scopeMode = 'managed' }) {
  // --- STATE & REFS ---
  const [data, setData] = useState(null);
  const [recentPage, setRecentPage] = useState(1);
  const rootRef = useRef(null);
  const refs = {
    donut: useRef(null),
    trend: useRef(null),
    heatmap: useRef(null),
    topRooms: useRef(null),
    floorDonut: useRef(null),
    rolePie: useRef(null),
    weekly: useRef(null),
  };

  const [d3Loaded, setD3Loaded] = useState(!!(typeof window !== 'undefined' && window.d3));
  const [httpsPollingActive, setHttpsPollingActive] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [apiError, setApiError] = useState(null);
  const recentPageSize = 20;

  const toLocalYmd = (value) => {
    const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!d || Number.isNaN(d.getTime())) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const toWeekdayShort = (ymd) => {
    const d = new Date(`${ymd}T00:00:00`);
    if (!d || Number.isNaN(d.getTime())) return ymd;
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  };

  const getStatusMeta = (rawName) => {
    const value = rawName || 'Upcoming';
    const key = attendanceFlagKey(null, value);
    const label = attendanceFlagLabel(null, value);
    if (key === 'present') return { key, label, className: 'bg-green-100 text-green-700' };
    if (key === 'late') return { key, label, className: 'bg-yellow-100 text-yellow-700' };
    if (key === 'on_leave') return { key, label, className: 'bg-sky-100 text-sky-700' };
    if (key === 'substituted') return { key, label, className: 'bg-indigo-100 text-indigo-700' };
    if (key === 'pending') return { key, label, className: 'bg-orange-100 text-orange-700' };
    if (key === 'upcoming') return { key, label, className: 'bg-slate-100 text-slate-600' };
    if (key === 'absent') return { key, label, className: 'bg-red-100 text-red-700' };
    return { key, label: label || 'Unknown', className: 'bg-red-100 text-red-700' };
  };

  const formatDateLabel = (value) => {
    const d = new Date(`${value}T00:00:00`);
    if (!d || Number.isNaN(d.getTime())) return value || '-';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTimeLabel = (dateValue, timeValue) => {
    if (!dateValue && !timeValue) return '-';
    const rawTime = String(timeValue || '').trim();
    let composed = dateValue || '';
    if (rawTime) {
      if (rawTime.includes('T') || rawTime.includes(' ')) {
        composed = rawTime.replace(' ', 'T');
      } else {
        composed = `${dateValue || ''}T${rawTime.slice(0, 8)}`;
      }
    }
    const d = new Date(composed);
    if (!d || Number.isNaN(d.getTime())) return `${dateValue || ''} ${timeValue || ''}`.trim();
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const threeDModelSrc = useMemo(() => {
    if (typeof window === 'undefined') return '';
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
    try {
      const serverRoot = resolveServerRoot();
      return new URL('./3dbuilding/MW1_4.glb', `${serverRoot}/`).href;
    } catch (e) {
      return 'http://localhost/3D_SCHOOL_FOR_TEACHER_ATTENDANCE_TRACKING_P1/server-php/3dbuilding/MW1_4.glb';
    }
  }, []);

  const openThreeDBuildingPage = () => {
    if (typeof window === 'undefined') return;
    window.location.hash = '/3d-building';
  };

  const isUpcomingStatus = (rawName) => {
    const key = attendanceFlagKey(null, rawName || 'Upcoming');
    return key === 'upcoming';
  };

  const renderCheckpoint = (flagName, dateValue, timeValue) => {
    const statusMeta = getStatusMeta(flagName);
    const hasTime = Boolean(String(timeValue || '').trim());
    return (
      <div className="flex flex-col gap-1">
        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusMeta.className}`}>
          {statusMeta.label}
        </span>
        {hasTime ? (
          <span className="whitespace-nowrap font-mono text-[10px] text-slate-400">
            {formatDateTimeLabel(dateValue, timeValue || '')}
          </span>
        ) : null}
      </div>
    );
  };

  // --- EFFECTS ---

  // 1. Resize Listener
  useEffect(() => {
    const upd = () => { try { const w = rootRef.current ? Math.max(320, rootRef.current.clientWidth) : window.innerWidth; setContainerWidth(w); } catch (e) { } };
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);

  useEffect(() => {
    if (d3Loaded) return;
    const timer = setInterval(() => {
      if (typeof window !== 'undefined' && window.d3) {
        setD3Loaded(true);
        clearInterval(timer);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [d3Loaded]);

  // Central data loader used by initial load and HTTPS polling.
  const loadData = async () => {
    setApiError(null);
    try {
      const endpoint = String(scopeMode || '').toLowerCase() === 'self'
        ? 'dashboard/full?scope=self'
        : 'dashboard/full';
      const res = await apiGet(endpoint);
      setData(res);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
      setApiError(err && err.message ? err.message : 'Failed to load dashboard data');
    }
  };

  useEffect(() => {
    (async () => {
      await loadData();
    })();
  }, []);

  useEffect(() => {
    const rows = (data?.recent_attendance || []).filter((r) => {
      const statuses = [r.flag_in_name, r.flag_check_name, r.flag_out_name];
      return statuses.some((value) => !isUpcomingStatus(value));
    });
    const pages = Math.max(1, Math.ceil(rows.length / recentPageSize));
    setRecentPage((prev) => Math.min(Math.max(prev, 1), pages));
  }, [data?.recent_attendance]);

  // 4. HTTPS polling refresh
  useEffect(() => {
    setHttpsPollingActive(true);
    const pollTimer = setInterval(() => {
      loadData();
    }, 15 * 1000);

    return () => {
      clearInterval(pollTimer);
    };
  }, []);

  // 5. KPI Number Animation
  useEffect(() => {
    if (!data || !data.summary) return;
    const root = rootRef.current;
    if (!root) return;
    const meta = data.summary.meta || {};
    const keys = ['total_departments', 'total_programs', 'total_sections', 'total_rooms', 'total_teachers'];
    keys.forEach(k => {
      if ((k === 'total_departments' && meta.department_display) || (k === 'total_programs' && meta.program_display)) return;
      const el = root.querySelector(`[data-kpi="${k}"]`);
      if (!el) return;
      const start = parseInt(el.textContent) || 0;
      const end = data.summary[k] || 0;
      if (!Number.isFinite(end)) return;
      if (start === end) return;
      const duration = 800; const startTime = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - startTime) / duration);
        const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
        const v = Math.round(start + (end - start) * easeOutCubic(p));
        el.textContent = v;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }, [data && data.summary]);

  // --- CHART HELPERS & RENDERERS ---

  const getTooltip = (container) => {
    let tt = container.querySelector('.viz-tooltip');
    if (!tt) {
      tt = document.createElement('div');
      tt.className = 'viz-tooltip';
      // Tailwind-ish styles applied via inline for dynamic positioning
      Object.assign(tt.style, {
        position: 'absolute', pointerEvents: 'none', padding: '8px 12px',
        background: 'rgba(15, 23, 42, 0.9)', color: '#fff', borderRadius: '8px',
        fontSize: '12px', display: 'none', zIndex: 9999,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        backdropFilter: 'blur(4px)'
      });
      container.appendChild(tt);
    }
    return tt;
  };

  // --- D3 CHARTS ---

  // 1. Donut
  useEffect(() => {
    if (!data || !d3Loaded) return;
    const d3 = window.d3;
    const el = refs.donut.current; if (!el) return;
    el.innerHTML = '';
    const attendance = data.summary.attendance_today || { present: 0, absent: 0, late: 0, pending: 0, upcoming: 0 };
    const series = [
      { key: 'Present', value: Number(attendance.present || 0), color: '#22c55e' },
      { key: 'Late', value: Number(attendance.late || 0), color: '#eab308' },
      { key: 'Absent', value: Number(attendance.absent || 0), color: '#ef4444' },
      { key: 'Pending', value: Number(attendance.pending || 0), color: '#f97316' },
      { key: 'Upcoming', value: Number(attendance.upcoming || 0), color: '#94a3b8' }
    ];

    const cardWidth = Math.max(220, el.clientWidth || 280);
    const W = Math.min(360, cardWidth);
    const H = W; const R = Math.min(W, H) / 2 - 8;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${W} ${H}`).style('overflow', 'visible');
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(R * 0.55).outerRadius(R);
    const arcHover = d3.arc().innerRadius(R * 0.55).outerRadius(R + 10);

    const paths = g.selectAll('path').data(pie(series)).enter().append('path')
      .attr('d', arc)
      .attr('fill', d => d.data.color)
      .attr('stroke', '#fff').attr('stroke-width', 2)
      .each(function (d) { this._current = { startAngle: 0, endAngle: 0 }; })
      .on('mouseenter', function (event, d) {
        d3.select(this).transition().duration(220).attr('d', arcHover);
        const tt = getTooltip(el); tt.style.display = 'block';
        tt.innerHTML = `<div class="font-bold">${d.data.key}</div><div>${d.data.value} teachers</div>`;
        const rect = el.getBoundingClientRect();
        tt.style.left = (event.clientX - rect.left + 10) + 'px'; tt.style.top = (event.clientY - rect.top + 10) + 'px';
      })
      .on('mousemove', function (event) { const tt = getTooltip(el); const rect = el.getBoundingClientRect(); tt.style.left = (event.clientX - rect.left + 10) + 'px'; tt.style.top = (event.clientY - rect.top + 10) + 'px'; })
      .on('mouseleave', function () { d3.select(this).transition().duration(220).attr('d', arc); const tt = getTooltip(el); tt.style.display = 'none'; });

    paths.transition().duration(900).attrTween('d', function (d) { const i = d3.interpolate(this._current, d); this._current = i(1); return t => arc(i(t)); });

    // Center Text
    const total = d3.sum(series, d => d.value);
    const center = g.append('g').attr('class', 'center');
    center.append('text').attr('text-anchor', 'middle').attr('dy', '-0.2em').style('font-size', '28px').style('font-weight', 800).style('fill', '#1e293b').text(total);
    center.append('text').attr('text-anchor', 'middle').attr('dy', '1.4em').style('font-size', '12px').style('fill', '#64748b').text('Today');

    // Legend
    const legend = svg.append('g').attr('transform', `translate(${10},10)`);
    series.forEach((s, i) => {
      const lg = legend.append('g').attr('transform', `translate(0,${i * 20})`);
      lg.append('circle').attr('r', 5).attr('cx', 5).attr('cy', 5).attr('fill', s.color);
      lg.append('text').attr('x', 15).attr('y', 9).style('font-size', '11px').style('fill', '#475569').text(`${s.key} (${s.value})`);
    });

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded, containerWidth]);

  // 2. Trend (14d)
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3;
    const el = refs.trend.current; if (!el) return; el.innerHTML = '';
    const raw = data.viz && data.viz.trend_14d ? data.viz.trend_14d : [];
    if (!raw || raw.length === 0) return;

    const days = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      days.push(toLocalYmd(d));
    }
    const map = {};
    raw.forEach(r => map[r.d] = { present: (parseInt(r.present)||0), absent: (parseInt(r.absent)||0), late: (parseInt(r.late)||0) });
    const stacked = days.map(d => ({ date: d, present: map[d]?.present || 0, absent: map[d]?.absent || 0, late: map[d]?.late || 0 }));

    const margin = { top: 18, right: 20, bottom: 36, left: 48 };
    // Responsive width logic
    const W = Math.max(400, el.clientWidth); 
    const H = 240;

    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`).style('overflow', 'visible');
    const x = d3.scaleBand().domain(stacked.map(d => d.date)).range([margin.left, W - margin.right]).padding(0.1);
    const maxY = d3.max(stacked, d => d.present + d.absent + d.late) || 1;
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([H - margin.bottom, margin.top]);
    
    const series = d3.stack().keys(['present', 'late', 'absent'])(stacked);
    const area = d3.area().x((d, i) => x(stacked[i].date) + x.bandwidth() / 2).y0(d => y(d[0])).y1(d => y(d[1])).curve(d3.curveMonotoneX);
    const colors = { present: '#22c55e', late: '#eab308', absent: '#ef4444' };

    const g = svg.append('g');
    const areas = g.selectAll('path').data(series);
    areas.enter().append('path').attr('d', d => area(d)).attr('fill', d => colors[d.key]).attr('opacity', 0.9).attr('stroke', 'none').transition().duration(900).attr('opacity', 1);

    // Axes
    const xAxis = d3.axisBottom(x).tickValues(stacked.filter((d,i)=>i%2===0).map(d=>d.date)).tickFormat(d => d.slice(5)); // Show MM-DD
    svg.append('g').attr('transform', `translate(0,${H - margin.bottom})`).call(xAxis).selectAll('text').style('color','#64748b');
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).ticks(5)).selectAll('text').style('color','#64748b');
    
    // Remove axis lines for cleaner look
    svg.selectAll('.domain').remove();
    svg.selectAll('line').attr('stroke', '#e2e8f0');

    // Tooltip logic (Same as before but styled)
    const tt = getTooltip(el);
    const overlay = svg.append('rect').attr('x', margin.left).attr('y', margin.top).attr('width', W - margin.left - margin.right).attr('height', H - margin.top - margin.bottom).style('fill', 'none').style('pointer-events', 'all');
    const vline = svg.append('line').attr('stroke', '#94a3b8').attr('stroke-width', 1).attr('stroke-dasharray','4 4').attr('y1', margin.top).attr('y2', H - margin.bottom).style('opacity', 0);

    overlay.on('mousemove', function (event) {
      const [mx] = d3.pointer(event);
      const ratio = (mx - margin.left) / Math.max(1, (W - margin.left - margin.right));
      const idx = Math.max(0, Math.min(stacked.length - 1, Math.round(ratio * (stacked.length - 1))));
      const day = stacked[idx];
      const xVal = x(stacked[idx].date);
      const xPos = xVal ? xVal + x.bandwidth() / 2 : margin.left;
      
      vline.attr('x1', xPos).attr('x2', xPos).style('opacity', 1);
      tt.style.display = 'block';
      tt.innerHTML = `<div class="font-bold border-b border-gray-600 mb-1 pb-1">${day.date}</div>
                      <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-green-500"></span> Present: ${day.present}</div>
                      <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-yellow-500"></span> Late: ${day.late}</div>
                      <div class="flex items-center gap-2"><span class="w-2 h-2 rounded-full bg-red-500"></span> Absent: ${day.absent}</div>`;
      const rect = el.getBoundingClientRect();
      tt.style.left = (event.clientX - rect.left + 15) + 'px'; tt.style.top = (event.clientY - rect.top) + 'px';
    });
    overlay.on('mouseleave', () => { vline.style('opacity', 0); tt.style.display = 'none'; });

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded, containerWidth]);

  // 3. Heatmap
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3; const el = refs.heatmap.current; if (!el) return; el.innerHTML = '';
    const raw = (data.viz && data.viz.hourly_today) || [];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const map = {}; raw.forEach(r => map[parseInt(r.hr)] = parseInt(r.cnt));
    const values = hours.map(h => ({ hr: h, cnt: map[h] || 0 }));

    const cols = 8; const rows = Math.ceil(24 / cols);
    const cell = 36; const width = cols * cell + 20; const height = rows * cell + 20;
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);
    const maxV = d3.max(values, d => d.cnt) || 1;
    // Green scale
    const color = d3.scaleLinear().domain([0, maxV]).range(['#f0fdf4', '#15803d']);

    const g = svg.append('g').attr('transform', 'translate(10,10)');
    values.forEach((v, i) => {
      const c = i % cols; const r = Math.floor(i / cols);
      const gx = g.append('g').attr('transform', `translate(${c * cell},${r * cell})`);
      gx.append('rect').attr('width', cell - 4).attr('height', cell - 4).attr('rx', 6).attr('ry', 6).attr('fill', color(v.cnt))
        .attr('opacity', 0).transition().delay(i * 30).duration(400).attr('opacity', 1);
      
      // Count
      if(v.cnt > 0) gx.append('text').attr('x', (cell - 4) / 2).attr('y', (cell - 4) / 2 + 4).attr('text-anchor', 'middle').style('font-size', '10px').style('font-weight','bold').style('fill', v.cnt > maxV/2 ? '#fff' : '#1e293b').text(v.cnt);
      // Hour
      gx.append('text').attr('x', (cell - 4) / 2).attr('y', (cell - 4) / 2 + 14).attr('text-anchor', 'middle').style('font-size', '8px').style('fill', v.cnt > maxV/2 ? 'rgba(255,255,255,0.7)' : '#94a3b8').text(`${v.hr}h`);
    });

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded]);

  // 4. Top Rooms
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3; const el = refs.topRooms.current; if (!el) return; el.innerHTML = '';
    const raw = (data.viz && data.viz.top_rooms_30d) || [];
    if (raw.length === 0) { el.innerHTML = '<div class="p-4 text-gray-400 italic">No room data available</div>'; return; }
    
    const W = Math.max(300, el.clientWidth); const H = 300; 
    const longestLabel = raw.reduce((max, item) => Math.max(max, String(item.room_name || '').length), 0);
    const leftMargin = Math.max(88, Math.min(170, 44 + (longestLabel * 6)));
    const margin = { top: 20, right: 30, bottom: 30, left: leftMargin };
    
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const x = d3.scaleLinear().domain([0, d3.max(raw, d => parseInt(d.checks)) || 1]).range([margin.left, W - margin.right]);
    const y = d3.scaleBand().domain(raw.map(r => r.room_name)).range([margin.top, H - margin.bottom]).padding(0.2);
    
    // Bars
    svg.append('g').selectAll('rect').data(raw).enter().append('rect')
      .attr('x', margin.left).attr('y', d => y(d.room_name)).attr('height', y.bandwidth()).attr('width', 0).attr('fill', '#3b82f6').attr('rx', 4)
      .transition().duration(800).attr('width', d => x(parseInt(d.checks)) - margin.left);
    
    // Labels on left
    svg.append('g').attr('transform', `translate(${margin.left},0)`).call(d3.axisLeft(y).tickSize(0)).selectAll('text').style('font-size', '11px').style('fill', '#475569').style('text-anchor','end').attr('x', -10);
    svg.selectAll('.domain').remove(); // remove axis line

    // Value Labels inside bar
    svg.append('g').selectAll('text.val').data(raw).enter().append('text')
      .attr('x', d => x(parseInt(d.checks)) + 5).attr('y', d => y(d.room_name) + y.bandwidth()/2 + 4)
      .text(d => d.checks).style('font-size','10px').style('fill','#64748b').style('font-weight','bold')
      .attr('opacity',0).transition().delay(500).attr('opacity',1);

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded, containerWidth]);

  // 5. Floor Donut
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3; const el = refs.floorDonut.current; if (!el) return; el.innerHTML = '';
    const raw = (data.viz && data.viz.floor_distribution_30d) || [];
    if (raw.length === 0) { el.innerHTML = '<div class="p-4 text-gray-400 text-sm">No data</div>'; return; }
    
    const series = raw.map(r => ({ key: r.floor_name, value: parseInt(r.checks) }));
    const size = Math.max(180, Math.min(260, el.clientWidth || 220));
    const W = size; const H = size; const R = Math.min(W, H) / 2;
    
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    
    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(R * 0.5).outerRadius(R - 5);
    const color = d3.scaleOrdinal(d3.schemeTableau10).domain(series.map(s => s.key));
    
    g.selectAll('path').data(pie(series)).enter().append('path').attr('d', arc).attr('fill', d => color(d.data.key)).attr('stroke', '#fff').attr('stroke-width', 2)
      .transition().duration(700).attrTween('d', function(d) { const i = d3.interpolate(d.startAngle+0.1, d.endAngle); return function(t) { d.endAngle = i(t); return arc(d); } });
      
    // Center label
    g.append('text').attr('text-anchor','middle').attr('dy','0.35em').style('font-size','10px').style('fill','#64748b').text('Floors');

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded]);

  // 6. Role Pie
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3; const el = refs.rolePie.current; if (!el) return; el.innerHTML = '';
    const raw = (data.viz && data.viz.attendance_by_role_30d) || [];
    if (raw.length === 0) { el.innerHTML = '<div class="p-4 text-gray-400 text-sm">No data</div>'; return; }
    
    const series = raw.map(r => ({ key: r.role_name, value: parseInt(r.checks) }));
    const size = Math.max(180, Math.min(260, el.clientWidth || 220));
    const W = size; const H = size; const R = Math.min(W, H) / 2;
    
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', '100%').attr('viewBox', `0 0 ${W} ${H}`);
    const g = svg.append('g').attr('transform', `translate(${W / 2},${H / 2})`);
    
    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(0).outerRadius(R - 5);
    const color = d3.scaleOrdinal(d3.schemeCategory10);
    
    g.selectAll('path').data(pie(series)).enter().append('path').attr('d', arc).attr('fill', d => color(d.data.key)).attr('stroke', '#fff').attr('stroke-width', 2)
      .attr('transform', 'scale(0)').transition().duration(600).attr('transform', 'scale(1)');

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded]);

  // 7. Weekly Sparkline
  useEffect(() => {
    if (!data || !d3Loaded) return; const d3 = window.d3; const el = refs.weekly.current; if (!el) return; el.innerHTML = '';
    const raw = (data.viz && data.viz.weekly_7d) || [];
    if (raw.length === 0) return;
    
    const series = raw.map(r => ({ d: r.d, v: parseInt(r.total) }));
    const W = Math.max(300, el.clientWidth); const H = 80;
    const margin = { left: 10, right: 10, top: 10, bottom: 20 };
    
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const x = d3.scalePoint().domain(series.map(s => s.d)).range([margin.left, W - margin.right]);
    const y = d3.scaleLinear().domain([0, d3.max(series, s => s.v) || 1]).range([H - margin.bottom, margin.top]);
    const line = d3.line().x(d => x(d.d)).y(d => y(d.v)).curve(d3.curveCardinal);
    
    // Gradient
    const defs = svg.append('defs');
    const gradId = `sparkGradient-${Math.random().toString(36).slice(2)}`;
    const grad = defs.append('linearGradient').attr('id', gradId).attr('x1','0%').attr('y1','0%').attr('x2','100%').attr('y2','0%');
    grad.append('stop').attr('offset','0%').style('stop-color','#60a5fa');
    grad.append('stop').attr('offset','100%').style('stop-color','#2563eb');

    svg.append('path').datum(series).attr('d', line).attr('fill', 'none').attr('stroke', `url(#${gradId})`).attr('stroke-width', 3).attr('stroke-linecap', 'round');
    
    // Dots
    svg.selectAll('circle').data(series).enter().append('circle')
       .attr('cx', d => x(d.d)).attr('cy', d => y(d.v)).attr('r', 4).attr('fill', '#fff').attr('stroke', '#2563eb').attr('stroke-width', 2)
       .attr('opacity', 0).transition().delay((d,i)=>i*100).attr('opacity', 1);

    // Labels
    svg.selectAll('text').data(series).enter().append('text')
       .attr('x', d => x(d.d)).attr('y', H-2).text(d => toWeekdayShort(d.d)).attr('text-anchor','middle').style('font-size','10px').style('fill','#94a3b8');

    return () => { try { el.innerHTML = ''; } catch (e) { } };
  }, [data, d3Loaded, containerWidth]);


  // --- SUB-COMPONENTS ---

  const KpiCard = ({ kpiKey, label, colorClass, iconClass }) => {
    const val = (data?.summary && data.summary[kpiKey]) || 0;
    const meta = data?.summary?.meta || {};
    const displayOverride = kpiKey === 'total_departments'
      ? (meta.department_display || null)
      : (kpiKey === 'total_programs' ? (meta.program_display || null) : null);
    const labelOverride = kpiKey === 'total_teachers'
      ? (meta.teacher_label || label)
      : label;
    const displayValue = displayOverride || val;
    const animateKey = displayOverride ? null : kpiKey;
    return (
      <div className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg">
        <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-slate-100/80"></div>
        <div className="relative flex items-center gap-4">
          <div className={`inline-flex h-12 w-12 items-center justify-center rounded-xl text-lg text-white shadow-sm ${colorClass}`}>
            <i className={iconClass}></i>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{labelOverride}</div>
            <div className="text-2xl font-extrabold tracking-tight text-slate-800" {...(animateKey ? { 'data-kpi': animateKey } : {})}>{displayValue}</div>
          </div>
        </div>
      </div>
    );
  };

  const Panel = ({ title, subtitle, action, children, className = '' }) => (
    <div className={`overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 md:px-6">
        <div>
          <h3 className="text-base font-bold text-slate-800 md:text-lg">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-slate-500 md:text-sm">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="px-5 py-5 md:px-6">{children}</div>
    </div>
  );

  // --- MAIN RENDER ---

  if (apiError) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ maxWidth: 720, margin: '60px auto', background: '#fff', padding: 20, borderRadius: 8, boxShadow: '0 10px 30px rgba(2,6,23,0.08)' }}>
          <h3 style={{ marginTop: 0 }}>Dashboard Error</h3>
          <p style={{ color: '#b91c1c', fontWeight: 600 }}>{String(apiError)}</p>
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" onClick={async () => { 
              await loadData();
            }}>Retry</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { window.location.reload(); }}>Reload Page</button>
          </div>
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', color: '#444', fontSize: 13 }}>{(apiError && apiError.bodyText) ? apiError.bodyText : ''}</pre>
        </div>
      </div>
    );
  }

  if (!data) return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] animate-pulse">
      <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <div className="text-slate-500 font-medium">Loading Dashboard...</div>
    </div>
  );

  const attendanceToday = data?.summary?.attendance_today || {};
  const isFallbackSnapshot = Boolean(attendanceToday.is_fallback);
  const attendanceBlocks = [
    { key: 'present', label: 'Present', value: Number(attendanceToday.present || 0), className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    { key: 'late', label: 'Late', value: Number(attendanceToday.late || 0), className: 'bg-amber-100 text-amber-700 border-amber-200' },
    { key: 'absent', label: 'Absent', value: Number(attendanceToday.absent || 0), className: 'bg-red-100 text-red-700 border-red-200' },
    { key: 'pending', label: 'Pending', value: Number(attendanceToday.pending || 0), className: 'bg-orange-100 text-orange-700 border-orange-200' },
    { key: 'upcoming', label: 'Upcoming', value: Number(attendanceToday.upcoming || 0), className: 'bg-slate-100 text-slate-700 border-slate-200' },
  ];
  const floorDistributionRows = (data?.viz?.floor_distribution_30d || []).map((item) => ({
    floor_name: item.floor_name || '-',
    checks: Number(item.checks || 0),
  }));
  const roleActivityRows = (data?.viz?.attendance_by_role_30d || []).map((item) => ({
    role_name: item.role_name || '-',
    checks: Number(item.checks || 0),
  }));
  const recentAttendanceRows = (data?.recent_attendance || []).filter((r) => {
    const statuses = [r.flag_in_name, r.flag_check_name, r.flag_out_name];
    return statuses.some((value) => !isUpcomingStatus(value));
  });
  const recentTotalRows = recentAttendanceRows.length;
  const recentTotalPages = Math.max(1, Math.ceil(recentTotalRows / recentPageSize));
  const safeRecentPage = Math.min(Math.max(recentPage, 1), recentTotalPages);
  const recentStart = (safeRecentPage - 1) * recentPageSize;
  const recentEnd = Math.min(recentStart + recentPageSize, recentTotalRows);
  const recentPageRows = recentAttendanceRows.slice(recentStart, recentEnd);
  const recentPageButtons = [];
  const recentWindowStart = Math.max(1, safeRecentPage - 2);
  const recentWindowEnd = Math.min(recentTotalPages, recentWindowStart + 4);
  const isSelfDashboard = String(scopeMode || '').toLowerCase() === 'self';
  for (let p = recentWindowStart; p <= recentWindowEnd; p += 1) {
    recentPageButtons.push(p);
  }

  return (
    <div className="relative" ref={rootRef}>
      <div className="pointer-events-none absolute inset-0"></div>
      <div className="relative mx-auto max-w-[1440px] rounded-[28px] border border-emerald-100/70 bg-gradient-to-b from-emerald-50/60 via-slate-50 to-slate-100/70 p-4 shadow-sm md:p-6 lg:p-8">
        <div className="mb-6 rounded-2xl border border-slate-200/70 bg-white px-5 py-5 shadow-sm md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {isSelfDashboard ? 'Personal Analytics' : 'Campus Analytics'}
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-4xl">
                {isSelfDashboard ? 'My Dashboard' : 'Dashboard'}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${httpsPollingActive ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  <span className={`h-2 w-2 rounded-full ${httpsPollingActive ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                  {httpsPollingActive ? 'HTTPS polling active' : 'Starting HTTPS polling'}
                </span>
                <span className="text-xs font-medium text-slate-500">
                  Snapshot date: {formatDateLabel(attendanceToday.date || toLocalYmd(new Date()))}
                </span>
              </div>
              {isFallbackSnapshot ? (
                <p className="mt-2 text-xs font-medium text-amber-700">
                  No records found for today. Showing latest available attendance date.
                </p>
              ) : null}
            </div>
            <button
              onClick={async () => {
                const root = rootRef.current;
                if (root) root.classList.add('opacity-80', 'pointer-events-none');
                try {
                  await loadData();
                } catch (e) {
                  console.error(e);
                } finally {
                  if (root) setTimeout(() => root.classList.remove('opacity-80', 'pointer-events-none'), 220);
                }
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-emerald-300 hover:text-emerald-700 hover:shadow-sm"
            >
              <i className="bi bi-arrow-repeat"></i>
              Refresh Dashboard
            </button>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Today's Records</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.total_records || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked In</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_in || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked Mid</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_mid || 0)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200/70 bg-white px-4 py-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Checked Out</p>
            <p className="mt-1 text-2xl font-extrabold text-slate-900">{Number(attendanceToday.checked_out || 0)}</p>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard kpiKey="total_departments" label="Departments" colorClass="bg-emerald-600" iconClass="bi bi-buildings-fill" />
          <KpiCard kpiKey="total_programs" label="Programs" colorClass="bg-sky-600" iconClass="bi bi-mortarboard-fill" />
          <KpiCard kpiKey="total_sections" label="Sections" colorClass="bg-cyan-600" iconClass="bi bi-people-fill" />
          <KpiCard kpiKey="total_rooms" label="Rooms" colorClass="bg-amber-500" iconClass="bi bi-door-open-fill" />
          <KpiCard kpiKey="total_teachers" label="Teachers" colorClass="bg-rose-600" iconClass="bi bi-person-workspace" />
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 2xl:grid-cols-12">
          <div className="space-y-6 2xl:col-span-8">
            <Panel
              title="Attendance Trend"
              subtitle="Present, late, and absent counts for the last 14 days."
              action={<span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">14 days</span>}
            >
              <div ref={refs.trend} className="h-[260px] w-full"></div>
            </Panel>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Panel title="Hourly Activity" subtitle={`Scan volume by hour for ${formatDateLabel(attendanceToday.date || toLocalYmd(new Date()))}.`}>
                <div ref={refs.heatmap} className="flex min-h-[176px] w-full items-center justify-center"></div>
              </Panel>
              <Panel title="Most Used Rooms" subtitle="Top classroom check-ins over 30 days.">
                <div ref={refs.topRooms} className="h-[300px] w-full"></div>
              </Panel>
            </div>
          </div>

          <div className="space-y-6 2xl:col-span-4">
            <Panel title="Attendance Breakdown" subtitle={`Current status distribution for ${formatDateLabel(attendanceToday.date || toLocalYmd(new Date()))}.`}>
              <div className="grid gap-4">
                <div ref={refs.donut} className="mx-auto aspect-square w-full max-w-[280px]"></div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 2xl:grid-cols-1">
                  {attendanceBlocks.map((item) => (
                    <div key={item.key} className={`rounded-xl border px-3 py-2 ${item.className}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-wider">{item.label}</p>
                      <p className="text-xl font-extrabold">{item.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Panel>

            <Panel title="3D Digital Twin" subtitle="Spatial classroom context preview.">
              <div className="group rounded-xl border border-slate-700 bg-black p-3">
                <div className="relative aspect-video overflow-hidden rounded-lg">
                  <model-viewer
                    src={threeDModelSrc}
                    alt="3D campus building model"
                    camera-controls
                    auto-rotate
                    auto-rotate-delay="0"
                    rotation-per-second="20deg"
                    interaction-prompt="none"
                    reveal="auto"
                    className="h-full w-full bg-black"
                  ></model-viewer>
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/35 via-transparent to-transparent"></div>
                  <button
                    type="button"
                    onClick={openThreeDBuildingPage}
                    className="absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition hover:bg-white"
                  >
                    Preview mode
                  </button>
                </div>
                <p className="mt-3 text-xs text-slate-500">Full interactive view remains available in the dedicated 3D Building module.</p>
              </div>
            </Panel>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Panel title="Floor Distribution" subtitle="Check-in share by floor (30 days)." className="xl:min-h-[340px]">
            <div className="flex min-h-[230px] items-center justify-center">
              <div ref={refs.floorDonut} className="h-[240px] w-[240px] max-w-full"></div>
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              {floorDistributionRows.length === 0 ? (
                <p className="text-xs font-medium text-slate-400">No floor data available.</p>
              ) : floorDistributionRows.map((item, idx) => (
                <div key={`${item.floor_name}-${idx}`} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600">{item.floor_name}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{item.checks}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Role Activity" subtitle="Attendance records by role (30 days)." className="xl:min-h-[340px]">
            <div className="flex min-h-[230px] items-center justify-center">
              <div ref={refs.rolePie} className="h-[240px] w-[240px] max-w-full"></div>
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
              {roleActivityRows.length === 0 ? (
                <p className="text-xs font-medium text-slate-400">No role activity data available.</p>
              ) : roleActivityRows.map((item, idx) => (
                <div key={`${item.role_name}-${idx}`} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600">{item.role_name}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">{item.checks}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Weekly Volume" subtitle="7-day attendance movement." className="xl:min-h-[340px]">
            <div className="flex min-h-[230px] items-center">
              <div ref={refs.weekly} className="w-full"></div>
            </div>
          </Panel>
        </div>

        <Panel title="Recent Live Scans" subtitle="Most recent attendance checkpoints from classrooms and floors.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-2 py-3 md:px-3">Teacher</th>
                  <th className="px-2 py-3 md:px-3">Class / Location</th>
                  <th className="px-2 py-3 md:px-3">IN</th>
                  <th className="px-2 py-3 md:px-3">MID</th>
                  <th className="px-2 py-3 md:px-3">OUT</th>
                  <th className="px-2 py-3 md:px-3">Latest Scan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentPageRows.map((r, i) => {
                  const roomLabel = [r.subject_code, r.section_name, r.room_name].filter(Boolean).join(' | ') || '-';
                  const preferredStamp = r.time_out || r.time_check || r.time_in || '';
                  const normalizedStamp = preferredStamp ? String(preferredStamp).replace(' ', 'T') : '';
                  const stampDate = normalizedStamp ? new Date(normalizedStamp) : null;
                  const stampLabel = stampDate && !Number.isNaN(stampDate.getTime())
                    ? stampDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
                    : formatDateTimeLabel(r.date, preferredStamp || '');

                  return (
                    <tr key={r.attendance_id || i} className="transition-colors hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-2 py-3 font-semibold text-slate-800 md:px-3">
                        {r.first_name} {r.last_name}
                      </td>
                      <td className="px-2 py-3 text-slate-600 md:px-3">{roomLabel}</td>
                      <td className="px-2 py-3 md:px-3">{renderCheckpoint(r.flag_in_name, r.date, r.time_in)}</td>
                      <td className="px-2 py-3 md:px-3">{renderCheckpoint(r.flag_check_name, r.date, r.time_check)}</td>
                      <td className="px-2 py-3 md:px-3">{renderCheckpoint(r.flag_out_name, r.date, r.time_out)}</td>
                      <td className="whitespace-nowrap px-2 py-3 font-mono text-xs text-slate-500 md:px-3">{stampLabel}</td>
                    </tr>
                  );
                })}
                {recentPageRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-2 py-6 text-center text-sm font-medium text-slate-400 md:px-3">
                      No recent scan data available.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs font-medium text-slate-500">
              Showing {recentTotalRows === 0 ? 0 : recentStart + 1}-{recentEnd} of {recentTotalRows} scans
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setRecentPage((prev) => Math.max(1, prev - 1))}
                disabled={safeRecentPage <= 1}
              >
                Prev
              </button>
              {recentPageButtons.map((page) => (
                <button
                  key={page}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    page === safeRecentPage
                      ? 'bg-emerald-600 text-white'
                      : 'border border-slate-300 text-slate-600 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                  onClick={() => setRecentPage(page)}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={() => setRecentPage((prev) => Math.min(recentTotalPages, prev + 1))}
                disabled={safeRecentPage >= recentTotalPages}
              >
                Next
              </button>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export default DashboardPage;

