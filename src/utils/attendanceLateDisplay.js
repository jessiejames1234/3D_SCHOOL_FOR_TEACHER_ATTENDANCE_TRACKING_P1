// Report-only labels; attendance flags and stored timestamps stay unchanged.
export function attendanceReportBaseStatus(value) {
  return String(value || '').replace(/^Late\s*\(\d+ min \d+ sec\)$/i, 'Late');
}

function schoolTimestamp(value, date) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const timestamp = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)
    ? `${String(date || '').slice(0, 10)}T${raw.split(':').map((part) => part.padStart(2, '0')).concat(raw.split(':').length === 2 ? ['00'] : []).join(':')}`
    : raw.replace(' ', 'T');
  // Database timestamps use Asia/Manila (+08:00), independent of device timezone.
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(timestamp) ? timestamp : `${timestamp}+08:00`);
}

export function attendanceLateSeconds(status, stage, { date, startTime, endTime, scannedAt }) {
  const label = attendanceReportBaseStatus(status);
  if (label.toLowerCase() !== 'late' || !['in', 'mid'].includes(stage)) return 0;
  const start = schoolTimestamp(startTime, date);
  const scan = schoolTimestamp(scannedAt, date);
  const cutoff = stage === 'in'
    ? start + 15 * 60 * 1000
    : start + (schoolTimestamp(endTime, date) - start) / 2 + 10 * 60 * 1000;
  if (!Number.isFinite(scan) || !Number.isFinite(cutoff) || scan <= cutoff) return 0;
  return Math.floor((scan - cutoff) / 1000);
}

export function attendanceLateDisplay(status, stage, timing) {
  const label = attendanceReportBaseStatus(status);
  const seconds = attendanceLateSeconds(status, stage, timing);
  if (!seconds) return label;
  return `Late (${Math.floor(seconds / 60)} min ${seconds % 60} sec)`;
}

export function singleTeacherLateMinutes(rows) {
  if (!rows.length) return null;
  const teachers = new Set();
  let seconds = 0;
  for (const row of rows) {
    const id = row._teacher_id || row._user_id || row._teacherId || row.teacher_id || row.user_id;
    const name = String(row.Teacher || row.teacher || row.teacher_name || '').trim().toLowerCase();
    if (!id && !name) return null;
    teachers.add(id ? `id:${id}` : `name:${name}`);
    if (teachers.size > 1) return null;
    const value = Number(row._late_seconds ?? Number(row['Total Late Minutes'] || 0) * 60);
    if (Number.isFinite(value) && value > 0) seconds += value;
  }
  return Number((seconds / 60).toFixed(2));
}
