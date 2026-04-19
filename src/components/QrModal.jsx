// Minimal QrModal using QRCode lib from CDN
function QrModal({ show, onClose, token, active }) {
  const canvasRef = React.useRef(null);
  const [qrAvailable, setQrAvailable] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState('');

  React.useEffect(() => {
    if (!show || !token) return;
    let cancelled = false;
    (async () => {
      try {
        // Prefer global QRCode (loaded via CDN script tag)
        let QR = (typeof window !== 'undefined' && window.QRCode) ? window.QRCode : null;
        if (!QR) {
          // Try virtual module 'qrcode' handled by the in-browser loader
          try { const mod = await import('qrcode'); QR = mod && (mod.default || mod); } catch (e) { QR = null; }
        }

        if (cancelled) return;

        if (QR && canvasRef.current) {
          try {
            if (typeof QR.toCanvas === 'function') {
              await QR.toCanvas(canvasRef.current, token, { width: 240 });
              setQrAvailable(true);
              setImageUrl('');
              return;
            }
            if (typeof QR === 'function') {
              try { QR(canvasRef.current, token); setQrAvailable(true); setImageUrl(''); return; } catch(e){}
            }
          } catch (e) {
            console.error('QrModal: QR generation failed', e);
          }
        }

        // Fallback: use server-side QR proxy to avoid CORS issues
        // Try several candidate API base paths and pick the first that resolves (helps with php -S + port-forward tunnels)
        const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin.replace(/\/$/, '') : '';
        const candidates = [];
        if (typeof window !== 'undefined' && window.API_BASE) {
          const apiBase = window.API_BASE.replace(/\/+$/,'');
          candidates.push(apiBase);
          // If API_BASE is /server-php/index.php/api, derive the /server-php/api folder (where qrcode.php lives)
          const derivedApi = apiBase.replace(/\/index\.php\/api\/?$/, '/api');
          if (derivedApi !== apiBase) candidates.push(derivedApi);
        }
        // Common locations to try
        candidates.push('/server-php/api');
        candidates.push('/api');
        candidates.push('./server-php/api');
        candidates.push('./api');
        // If app is hosted under a project root (e.g. /3D1.2), add that root explicitly
        if (origin && typeof window !== 'undefined' && window.location) {
          const parts = window.location.pathname.split('/').filter(Boolean);
          const host = (window.location.hostname || '').toLowerCase();
          let projectRoot = '';
          if (parts.length) {
            const first = String(parts[0]).toLowerCase();
            if (first !== 'public' && host.indexOf('devtunnels.ms') === -1) {
              projectRoot = '/' + parts[0];
            }
          }
          if (projectRoot) {
            candidates.push(origin + projectRoot + '/server-php/api');
            candidates.push(origin + projectRoot + '/api');
          }
        }
        // Some tunnels add a '/public' prefix
        if (origin) {
          candidates.push(origin + '/server-php/api');
          candidates.push(origin + '/public/server-php/api');
          candidates.push(origin + '/api');
        }

        let found = null;
        for (const c of candidates) {
          try {
            const testUrl = c.replace(/\/+$/,'') + '/qrcode.php?data=' + encodeURIComponent(token);
            // Try a lightweight HEAD request to check existence (some hosts may not support HEAD; fallback to GET small request)
            const resp = await fetch(testUrl, { method: 'HEAD' });
            if (resp && resp.ok) { found = testUrl; break; }
            // If HEAD not allowed, try GET but don't download body
            if (resp && (resp.status === 405 || resp.status === 403 || resp.status === 0)) {
              const r2 = await fetch(testUrl, { method: 'GET' });
              if (r2 && r2.ok) { found = testUrl; break; }
            }
          } catch (e) {
            // ignore and try next
          }
        }
        // If nothing resolved, fall back to reasonable default (window.API_BASE or ./server-php/api)
        if (!found) {
          let fallback = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE.replace(/\/+$/,'') : './server-php/api';
          const derived = fallback.replace(/\/index\.php\/api\/?$/, '/api');
          if (derived !== fallback) fallback = derived;
          found = fallback.replace(/\/+$/,'') + '/qrcode.php?data=' + encodeURIComponent(token);
        }
        setImageUrl(found);
        setQrAvailable(false);
      } catch (err) {
        console.error('QrModal error', err);
        let base = (typeof window !== 'undefined' && window.API_BASE)
          ? window.API_BASE.replace(/\/+$/,'')
          : './server-php/api';
        const derived = base.replace(/\/index\.php\/api\/?$/, '/api');
        if (derived !== base) base = derived;
        const proxyUrl = base.replace(/\/+$/,'') + '/qrcode.php?data=' + encodeURIComponent(token);
        setImageUrl(proxyUrl);
        setQrAvailable(false);
      }
    })();
    return () => { cancelled = true; };
  }, [show, token]);

  const download = async () => {
    if (qrAvailable && canvasRef.current) {
      const canvas = canvasRef.current; const url = canvas.toDataURL('image/png'); const a = document.createElement('a'); a.href = url; a.download = `qr_${token}.png`; document.body.appendChild(a); a.click(); a.remove(); return;
    }
    if (imageUrl) {
      try {
        // Fetch from same-origin proxy so CORS is not an issue
        const res = await fetch(imageUrl, { mode: 'cors' });
        if (!res.ok) throw new Error('Failed to fetch QR image');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `qr_${token}.png`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } catch (e) {
        console.error('QrModal download failed', e);
        // fallback: open in new tab
        window.open(imageUrl, '_blank');
      }
    }
  };

  if (!show) return null;
  return (
    <div style={{position:'fixed',left:0,right:0,top:0,bottom:0,background:'rgba(0,0,0,0.4)'}} onClick={(e)=>{ if (e.target===e.currentTarget) onClose?.(); }}>
      <div style={{maxWidth:360,margin:'60px auto',background:'#fff',padding:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <h4 style={{margin:0}}>QR Code {active? '(Active)':'(Inactive)'}</h4>
          <button onClick={onClose}>X</button>
        </div>
        <div style={{textAlign:'center'}}>
          {qrAvailable ? (
            <canvas ref={canvasRef} />
          ) : (
            imageUrl ? <img src={imageUrl} alt="QR code" width={240} height={240} style={{display:'block',margin:'0 auto'}} /> : <div style={{color:'#888',marginTop:8}}>QR library not loaded — cannot render QR.</div>
          )}

          <div style={{marginTop:12}}><button onClick={download} disabled={!token}>Download</button></div>
        </div>
      </div>
    </div>
  );
}

export default QrModal;
