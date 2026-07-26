// This allows the app to work on localhost AND via the public link.
window.API_BASE = window.API_BASE || null;

function deriveSocketServerUrl() {
  if (typeof window === 'undefined' || !window.location) return 'http://localhost:8080';

  const host = (window.location.hostname || '').toLowerCase();
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  const isDevTunnel = host.endsWith('.devtunnels.ms');

  if (!isDevTunnel) return 'http://localhost:8080';

  // VS Code dev tunnels encode the forwarded port in the subdomain:
  // app-8070.region.devtunnels.ms -> app-8080.region.devtunnels.ms
  const socketHost = host.replace(/-\d+(\.[^.]+\.devtunnels\.ms)$/i, '-8080$1');
  return `${protocol}//${socketHost}`;
}

window.SOCKET_SERVER = window.SOCKET_SERVER || deriveSocketServerUrl();


// window.API_BASE = '../server-php/index.php/api';
