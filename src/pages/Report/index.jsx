import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import Table from '../../components/Table.jsx';
import { AuthContext } from '../../context/AuthContext.jsx';

// --- API CONFIGURATION ---
const computeApiBase = () => {
  if (typeof window === 'undefined') return '../server-php/index.php/api';
  if (window.API_BASE) return String(window.API_BASE).replace(/\/+$/, '');
  const origin = window.location.origin.replace(/\/+$/, '');
  const host = (window.location.hostname || '').toLowerCase();
  const parts = window.location.pathname.split('/').filter(Boolean);
  let projectRoot = '';
  if (parts.length) {
    const first = String(parts[0]).toLowerCase();
    if (first !== 'public' && host.indexOf('devtunnels.ms') === -1) projectRoot = '/' + parts[0];
  }
  return origin + projectRoot + '/server-php/index.php/api';
};

const __API_BASE = computeApiBase();
const API_ENDPOINT = __API_BASE + '/reports';
const USERS_ENDPOINT = __API_BASE + '/users'; 
const ROOMS_ENDPOINT = __API_BASE + '/rooms'; 

// --- D3 CHART COMPONENTS ---

// 1. Donut Chart Component (Uses D3.js)
const DonutChart = ({ data, colors, title }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!window.d3 || !svgRef.current || !data) return;
    const d3 = window.d3;

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    const width = 200, height = 200, margin = 20;
    const radius = Math.min(width, height) / 2 - margin;

    const svg = d3.select(svgRef.current)
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${width / 2},${height / 2})`);

    // Compute position of each group on the pie
    const pie = d3.pie().value(d => d.value).sort(null);
    const data_ready = pie(data);

    // Shape helper
    const arc = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.8);
    const arcHover = d3.arc().innerRadius(radius * 0.5).outerRadius(radius * 0.9);

    // Draw arcs
    svg.selectAll('allSlices')
      .data(data_ready)
      .enter()
      .append('path')
      .attr('d', arc)
      .attr('fill', (d, i) => colors[i % colors.length])
      .attr("stroke", "white")
      .style("stroke-width", "2px")
      .style("opacity", 0.9)
      .on("mouseover", function(event, d) {
         d3.select(this).transition().duration(200).attr('d', arcHover).style("opacity", 1);
         // Add center text
         svg.append("text")
            .attr("class", "center-text")
            .attr("text-anchor", "middle")
            .attr("dy", "-0.2em")
            .style("font-size", "12px")
            .style("font-weight", "bold")
            .style("fill", "#555")
            .text(d.data.label);
         svg.append("text")
            .attr("class", "center-text")
            .attr("text-anchor", "middle")
            .attr("dy", "1em")
            .style("font-size", "14px")
            .style("fill", "#888")
            .text(d.data.value);
      })
      .on("mouseout", function() {
         d3.select(this).transition().duration(200).attr('d', arc);
         svg.selectAll(".center-text").remove();
      });

  }, [data, colors]);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">{title}</h4>
      <svg ref={svgRef}></svg>
      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center text-xs text-gray-600">
            <span className="w-2 h-2 rounded-full mr-1" style={{backgroundColor: colors[i % colors.length]}}></span>
            {d.label} ({d.value})
          </div>
        ))}
      </div>
    </div>
  );
};

// 2. Bar Chart Component (Uses D3.js)
const BarChart = ({ data, color, title }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!window.d3 || !svgRef.current || !data) return;
    const d3 = window.d3;

    // Clear previous
    d3.select(svgRef.current).selectAll("*").remove();

    // Set dimensions
    const margin = { top: 10, right: 10, bottom: 40, left: 30 };
    const containerWidth = svgRef.current.parentElement.clientWidth || 300;
    const width = containerWidth - margin.left - margin.right;
    const height = 180 - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current)
      .attr("width", width + margin.left + margin.right)
      .attr("height", height + margin.top + margin.bottom)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // X axis
    const x = d3.scaleBand()
      .range([0, width])
      .domain(data.map(d => d.label))
      .padding(0.3);
    
    svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x).tickSize(0))
      .selectAll("text")
        .attr("transform", "translate(-10,0)rotate(-45)")
        .style("text-anchor", "end")
        .style("font-size", "10px")
        .style("fill", "#888");

    // Y axis
    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.value) || 10])
      .range([height, 0]);
    
    svg.append("g")
      .call(d3.axisLeft(y).ticks(5).tickSize(-width)) // grid lines
      .call(g => g.select(".domain").remove()) // hide axis line
      .selectAll("line")
      .attr("stroke", "#eee"); // lighter grid

    // Bars
    svg.selectAll("mybar")
      .data(data)
      .enter()
      .append("rect")
        .attr("x", d => x(d.label))
        .attr("y", d => y(d.value))
        .attr("width", x.bandwidth())
        .attr("height", d => height - y(d.value))
        .attr("fill", color)
        .attr("rx", 3) // rounded corners
        .on("mouseover", function() { d3.select(this).attr("opacity", 0.7); })
        .on("mouseout", function() { d3.select(this).attr("opacity", 1); });

  }, [data, color]);

  return (
    <div className="flex flex-col items-center justify-center h-full w-full">
      <h4 className="text-xs font-bold text-gray-500 uppercase mb-2">{title}</h4>
      <svg ref={svgRef}></svg>
    </div>
  );
};


// --- MAIN PAGE COMPONENT ---

export default function ReportsPage() {
  // FIX: Properly get user from context
  const { user } = useContext(AuthContext) || {};
  const token = localStorage.getItem('token') || null;

  // FIX: Identify User Role and Department
  const isAdmin = user && Number(user.role_id) === 1;
  const isTeacher = user && Number(user.role_id) === 5;
  const currentUserId = user?.user_id || user?.id || user?.userId || null;
  const userDeptId = user?.dept_id;

  // --- State ---
  const [report, setReport] = useState(isTeacher ? 'teacher_attendance_summary' : 'attendance_records');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0,10));
  
  // Filter inputs
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');

  // Dropdown Lists
  const [teachers, setTeachers] = useState([]);
  const [rooms, setRooms] = useState([]);

  // Data & UI State
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);

  const reportOptions = useMemo(() => {
    if (isTeacher) {
      return [{ value: 'teacher_attendance_summary', label: 'Teacher Attendance Summary' }];
    }
    return [
      { value: 'attendance_records', label: 'Attendance Records' },
      { value: 'teacher_attendance_summary', label: 'Teacher Attendance Summary' },
      { value: 'attendance_logs', label: 'Attendance Audit Logs' },
      { value: 'classroom_utilization', label: 'Classroom Utilization' },
      { value: 'leave_substitution', label: 'Leave & Substitution' },
      { value: 'system_logs', label: 'System Security Logs' },
    ];
  }, [isTeacher]);

  // --- Effects ---
  useEffect(() => { fetchLists(); }, [userDeptId]); // re-run if user logs in/dept_id is set
  useEffect(() => { fetchReport(); }, [report, startDate, endDate, teacherId, roomId, userDeptId]);
  useEffect(() => {
    if (isTeacher && report !== 'teacher_attendance_summary') {
      setReport('teacher_attendance_summary');
      setTeacherId('');
      setRoomId('');
    }
  }, [isTeacher, report]);

  // --- Helpers ---
  function buildQuery(params) {
    return Object.entries(params)
      .filter(([k,v]) => v !== null && v !== undefined && v !== '')
      .map(([k,v]) => encodeURIComponent(k)+'='+encodeURIComponent(v))
      .join('&');
  }

  // --- Logic: Which filters to show per report ---
  const showTeacherFilter = !isTeacher && ['attendance_records', 'attendance_logs', 'leave_substitution', 'system_logs', 'teacher_attendance_summary'].includes(report);
  const showRoomFilter = ['attendance_records', 'classroom_utilization'].includes(report);

  // --- API: Fetch Dropdowns ---
  async function fetchLists() {
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    try {
      // FIX: Add dept_id parameter to filter the dropdown list automatically from backend
      let usersUrl = USERS_ENDPOINT + '?list=1';
      if (!isAdmin && userDeptId) {
        usersUrl += `&dept_id=${userDeptId}`;
      }

      const ures = await fetch(usersUrl, { headers });
      if (ures.ok) {
        const udata = await ures.json();
        if (Array.isArray(udata)) {
          setTeachers(udata.map(u => ({
            id: u.id || u.user_id,
            label: u.label || u.full_name || (u.first_name + ' ' + u.last_name)
          })));
        }
      }
    } catch (e) { console.warn('Teachers fetch error', e); }

    try {
      const rres = await fetch(ROOMS_ENDPOINT + '?list=1', { headers });
      if (rres.ok) {
        const rdata = await rres.json();
        if (Array.isArray(rdata)) {
          setRooms(rdata.map(r => ({
            id: r.id || r.room_id,
            label: r.label || r.room_name || r.name
          })));
        }
      }
    } catch (e) { console.warn('Rooms fetch error', e); }
  }

  // --- API: Fetch Report Data ---
  async function fetchReport() {
    setLoading(true); setError(null);
    setColumns([]); setRows([]); 

    try {
      // FIX: Tell your `reports.php` file to filter the DB by sending `dept_id`
      const scopedTeacherId = isTeacher
        ? (currentUserId || undefined)
        : (showTeacherFilter ? (teacherId || undefined) : undefined);

      const qs = buildQuery({ 
        report, 
        start_date: startDate, 
        end_date: endDate, 
        teacher_id: scopedTeacherId, 
        room_id: showRoomFilter ? (roomId || undefined) : undefined,
        dept_id: (!isAdmin && userDeptId) ? userDeptId : undefined // <-- SECURE FILTER APPLIED HERE
      });
      
      const res = await fetch(API_ENDPOINT + '?' + qs, { 
        headers: token ? { 'Authorization': 'Bearer ' + token } : {} 
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();

      setTitle(data.title || report.replace(/_/g,' '));
      
      const apiCols = Array.isArray(data.columns) ? data.columns : [];
      setColumns(apiCols.map(c => ({ label: c, key: c })));
      setRows(Array.isArray(data.rows) ? data.rows : []);

    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load report');
    } finally { setLoading(false); }
  }

  // --- Export Functions ---
  function exportToExcel() {
    if (typeof XLSX === 'undefined') { alert('SheetJS not loaded'); return; }
    const exportRows = rows.map(r => {
      const rowData = {};
      columns.forEach(c => rowData[c.label] = (r[c.key] !== null) ? String(r[c.key]) : '');
      return rowData;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(exportRows);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${title.replace(/\s+/g, '_')}_${startDate}.xlsx`);
  }

  function exportToPDF() {
    if (typeof html2pdf === 'undefined') { window.print(); return; }
    if (!rows.length || !columns.length) {
      alert('No report data to export.');
      return;
    }

    const safeTitle = String(title || 'System Report').trim() || 'System Report';
    const safeFileTitle = safeTitle.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_');
    const today = new Date().toISOString().slice(0, 10);

    const formatCell = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch (e) { return String(value); }
      }
      return String(value);
    };

    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const getCellValue = (row, key) => {
      if (row && Object.prototype.hasOwnProperty.call(row, key)) return row[key];
      const normalizedKey = String(key || '').trim().toLowerCase();
      const foundKey = Object.keys(row || {}).find(
        (k) => String(k || '').trim().toLowerCase() === normalizedKey
      );
      return foundKey ? row[foundKey] : '';
    };

    const maxColumnsPerSection = 8;
    const columnChunks = [];
    for (let i = 0; i < columns.length; i += maxColumnsPerSection) {
      columnChunks.push(columns.slice(i, i + maxColumnsPerSection));
    }

    const sectionsHtml = columnChunks
      .map((chunk, chunkIndex) => {
        const headerHtml = ['<th style="width:56px;">#</th>']
          .concat(chunk.map((c) => `<th>${escapeHtml(c.label || c.key || '')}</th>`))
          .join('');

        const rowsHtml = rows
          .map((r, rowIndex) => {
            const cells = ['<td class="report-pdf-row-index">' + (rowIndex + 1) + '</td>']
              .concat(chunk.map((c) => `<td>${escapeHtml(formatCell(getCellValue(r, c.key)))}</td>`))
              .join('');
            return `<tr>${cells}</tr>`;
          })
          .join('');

        const sectionLabel = columnChunks.length > 1
          ? `<div class="report-pdf-section-label">Columns ${chunkIndex * maxColumnsPerSection + 1}-${Math.min((chunkIndex + 1) * maxColumnsPerSection, columns.length)} of ${columns.length}</div>`
          : '';

        return `
          <section class="report-pdf-section${chunkIndex > 0 ? ' section-break' : ''}">
            ${sectionLabel}
            <table class="report-pdf-table">
              <thead><tr>${headerHtml}</tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </section>
        `;
      })
      .join('');

    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '0';
    wrapper.style.top = '0';
    const exportWidth = Math.max(1300, Math.min(2600, (Math.min(columns.length, maxColumnsPerSection) + 1) * 220));
    wrapper.style.width = exportWidth + 'px';
    wrapper.style.maxWidth = 'none';
    wrapper.style.background = '#fff';
    wrapper.style.zIndex = '-1';
    wrapper.style.pointerEvents = 'none';
    wrapper.innerHTML = `
      <style>
        .report-pdf-root { font-family: Arial, sans-serif; color: #111827; padding: 16px; }
        .report-pdf-title { font-size: 20px; font-weight: 700; margin: 0 0 4px 0; }
        .report-pdf-meta { font-size: 12px; color: #6b7280; margin: 0 0 12px 0; }
        .report-pdf-summary { font-size: 11px; color: #374151; margin: 0 0 10px 0; }
        .report-pdf-section { margin-top: 8px; }
        .report-pdf-section.section-break { page-break-before: always; }
        .report-pdf-section-label { font-size: 12px; font-weight: 700; margin: 8px 0 6px 0; color: #1f2937; }
        .report-pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
        .report-pdf-table thead { display: table-header-group; }
        .report-pdf-table tr { page-break-inside: avoid; }
        .report-pdf-table th,
        .report-pdf-table td {
          border: 1px solid #d1d5db;
          padding: 6px 8px;
          text-align: left;
          vertical-align: top;
          word-break: break-word;
          white-space: normal;
        }
        .report-pdf-table th { background: #f3f4f6; font-weight: 700; }
        .report-pdf-row-index { background: #f9fafb; text-align: center; font-weight: 600; }
      </style>
      <div class="report-pdf-root">
        <h2 class="report-pdf-title">${escapeHtml(safeTitle)}</h2>
        <p class="report-pdf-meta">Generated on ${escapeHtml(new Date().toLocaleString())}</p>
        <p class="report-pdf-summary">Rows: ${rows.length} | Columns: ${columns.length} | Sections: ${columnChunks.length}</p>
        ${sectionsHtml}
      </div>
    `;

    document.body.appendChild(wrapper);
    const exportNode = wrapper.querySelector('.report-pdf-root') || wrapper;

    return html2pdf()
      .set({
        margin: [8, 8, 8, 8],
        filename: `${safeFileTitle}_${today}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 1.5,
          useCORS: true,
          allowTaint: true,
          scrollX: 0,
          scrollY: 0,
          windowWidth: exportWidth,
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'mm', format: 'a3', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
      })
      .from(exportNode)
      .save()
      .catch(() => { window.print(); })
      .finally(() => {
        if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
      });
  }

  // --- Visualization Data Logic ---
  const chartData = useMemo(() => {
    if (!rows.length) return { pie: [], bar: [], barMode: 'default' };

    let pie = [], bar = [];
    let barMode = 'default';

    // DATA PROCESSING BASED ON REPORT TYPE
    if (report === 'attendance_records') {
        // PIE: Count Status (Present vs Late vs Absent)
        const counts = { Present: 0, Late: 0, Absent: 0 };
        rows.forEach(r => {
            const status = String(r['Flag In'] || r.flag_in || '').toLowerCase();
            if (status.includes('present')) counts.Present++;
            else if (status.includes('late')) counts.Late++;
            else counts.Absent++;
        });
        pie = Object.keys(counts).map(k => ({ label: k, value: counts[k] })).filter(d => d.value > 0);

        // BAR: Top 5 Rooms by Usage (Count)
        const roomCounts = {};
        rows.forEach(r => {
            const rm = r['Room'] || r.room_name || 'Unknown';
            roomCounts[rm] = (roomCounts[rm] || 0) + 1;
        });
        bar = Object.entries(roomCounts)
            .map(([label, value]) => ({ label, value }))
            .sort((a,b) => b.value - a.value)
            .slice(0, 5); // Top 5
    
    } else if (report === 'teacher_attendance_summary') {
        // PIE: Aggregate teacher-level attendance totals
        const totals = { Present: 0, Late: 0, Absent: 0 };
        rows.forEach(r => {
            totals.Present += parseInt(r['Present'] || r.present || 0, 10) || 0;
            totals.Late += parseInt(r['Late'] || r.late || 0, 10) || 0;
            totals.Absent += parseInt(r['Absent'] || r.absent || 0, 10) || 0;
        });
        pie = Object.keys(totals).map(k => ({ label: k, value: totals[k] })).filter(d => d.value > 0);

        // BAR: Top 5 teachers by 7:30 AM red flags, then late minutes
        const teacherStats = rows.map(r => ({
            label: r['Teacher'] || r.teacher || 'Unknown',
            redFlags: parseInt(r['7:30 AM Red Flags'] || r.red_flags || 0, 10) || 0,
            lateMins: parseInt(r['Total Late Minutes'] || r.total_late_minutes || 0, 10) || 0
        }));
        const useLateMinutes = teacherStats.every(s => s.redFlags === 0);
        barMode = useLateMinutes ? 'late_minutes' : 'red_flags';
        bar = teacherStats
            .map(s => ({ label: s.label, value: useLateMinutes ? s.lateMins : s.redFlags, lateMins: s.lateMins }))
            .sort((a, b) => (b.value - a.value) || (b.lateMins - a.lateMins))
            .slice(0, 5)
            .map(({ label, value }) => ({ label, value }));
    } else if (report === 'classroom_utilization') {
        // PIE: Distribution of hours
        pie = rows.slice(0, 5).map(r => ({
            label: r['Room Name'] || r.room_name,
            value: parseFloat(r['Total Hours Used (hrs)'] || 0)
        }));
        
        // BAR: Classes held
        bar = rows.slice(0, 5).map(r => ({
            label: r['Room Name'] || r.room_name,
            value: parseInt(r['Total Classes Held'] || 0)
        }));
    } else {
        // Default / Logs: Simple count by Date
        const dates = {};
        rows.forEach(r => {
            const d = (r.Date || r.date || r.created_at || '').substring(0, 10);
            if(d) dates[d] = (dates[d] || 0) + 1;
        });
        bar = Object.entries(dates).slice(0,7).map(([label, value]) => ({ label, value }));
        
        // Generic pie
        pie = [{ label: 'Total', value: rows.length }];
    }

    return { pie, bar, barMode };
  }, [rows, report]);

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">System Reports</h1>
      </div>

      {/* --- TOP SECTION GRID --- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mb-6">
        
        {/* LEFT COLUMN: FILTERS (30% Width - lg:col-span-4) */}
        <div className="lg:col-span-4 bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col">
          <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4 border-b pb-2">Configuration</h2>
          
          <div className="flex-grow space-y-4">
            {/* Report Type */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Report Type</label>
              <select className="w-full form-select rounded-md border-gray-300 text-sm focus:ring-green-500"
                value={report} onChange={e => { setReport(e.target.value); setTeacherId(''); setRoomId(''); }}>
                {reportOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>

            {/* Dynamic Filters */}
            {showTeacherFilter && (
              <div className="bg-orange-50 p-2 rounded border border-orange-100">
                <label className="block text-xs font-bold text-orange-700 mb-1">User / Name</label>
                <select className="w-full form-select rounded-md border-orange-300 text-sm bg-white"
                  value={teacherId} onChange={e => setTeacherId(e.target.value)}>
                  <option value="">-- All Users --</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
            )}

            {showRoomFilter && (
              <div className="bg-green-50 p-2 rounded border border-green-100">
                <label className="block text-xs font-bold text-green-700 mb-1">Room</label>
                <select className="w-full form-select rounded-md border-green-300 text-sm bg-white"
                  value={roomId} onChange={e => setRoomId(e.target.value)}>
                  <option value="">-- All Rooms --</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
                <input type="date" className="w-full form-input rounded-md border-gray-300 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
                <input type="date" className="w-full form-input rounded-md border-gray-300 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 pt-4 border-t border-gray-100 space-y-2">
            <button className="w-full btn bg-green-700 hover:bg-green-800 text-white font-medium py-2 rounded shadow-sm"
              onClick={() => fetchReport()} disabled={loading}>
              {loading ? 'Generating...' : 'Apply Filters'}
            </button>
            <button className="w-full btn border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2 rounded"
              onClick={() => { setTeacherId(''); setRoomId(''); setStartDate(''); setEndDate(''); }}>
              Reset
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: VISUALIZATION (70% Width - lg:col-span-8) */}
        <div className="lg:col-span-8 bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-4 pb-2 border-b">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Analytics Preview</h2>
            <div className="flex gap-2">
               <button onClick={exportToExcel} className="text-xs flex items-center gap-1 bg-emerald-100 text-emerald-700 px-3 py-1 rounded hover:bg-emerald-200 transition">
                 <i className="bi bi-file-earmark-excel"></i> Excel
               </button>
               <button onClick={exportToPDF} className="text-xs flex items-center gap-1 bg-red-100 text-red-700 px-3 py-1 rounded hover:bg-red-200 transition">
                 <i className="bi bi-file-earmark-pdf"></i> PDF
               </button>
            </div>
          </div>
          
          {/* CHARTS CONTAINER: 1 Row, 2 Columns */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-64">
             {/* Chart 1: Donut (Orange Theme) */}
             <div className="border border-orange-100 bg-orange-50/50 rounded-lg p-2 relative">
                {rows.length > 0 ? (
                   <DonutChart 
                      data={chartData.pie} 
                      colors={["#f97316", "#3b82f6", "#ef4444", "#10b981"]} 
                      title={['attendance_records', 'teacher_attendance_summary'].includes(report) ? 'Status Distribution' : 'Breakdown'}
                   />
                ) : <div className="h-full flex items-center justify-center text-gray-400 text-xs">No Data</div>}
             </div>

             {/* Chart 2: Bar (Green/Blue Theme) */}
             <div className="border border-blue-100 bg-blue-50/50 rounded-lg p-2 relative">
                {rows.length > 0 ? (
                   <BarChart 
                      data={chartData.bar} 
                      color="#3b82f6" 
                      title={report === 'attendance_records' ? 'Activity by Room' : (report === 'teacher_attendance_summary' ? (chartData.barMode === 'late_minutes' ? 'Top Late Minutes' : 'Top Red Flags (7:30 AM)') : 'Trend Analysis')}
                   />
                ) : <div className="h-full flex items-center justify-center text-gray-400 text-xs">No Data</div>}
             </div>
          </div>
        </div>

      </div>

      {/* ERROR MESSAGE */}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded shadow-sm">
          <div className="flex">
            <div className="flex-shrink-0"><i className="bi bi-exclamation-circle text-red-500"></i></div>
            <div className="ml-3"><p className="text-sm text-red-700">{error}</p></div>
          </div>
        </div>
      )}

      {/* RESULTS TABLE (Full Width Below) */}
      <div id="report-printable-area" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
            <p className="text-xs text-gray-500 mt-1">Generated on {new Date().toLocaleDateString()}</p>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <Table columns={columns} data={rows} loading={loading} pageSize={15} wrapCells={report === 'teacher_attendance_summary'} />
        </div>
        
        {rows.length === 0 && !loading && !error && (
          <div className="p-12 text-center text-gray-400">
            <i className="bi bi-search text-4xl mb-2 block"></i>
            No records found. Try adjusting the filters.
          </div>
        )}
      </div>
    </div>
  );
}
