// This allows the app to work on localhost AND via the public link.
window.API_BASE = null; 

// Optional Socket.IO server URL. Set this in your environment or here for devtunnel usage.
// Example: window.SOCKET_SERVER = 'https://pg7tj9bp-8080.asse.devtunnels.ms';
const __host = (typeof window !== 'undefined' && window.location && window.location.hostname)
  ? window.location.hostname.toLowerCase()
  : '';
const __isDevTunnel = __host.includes('devtunnels.ms');
const __defaultSocket = __isDevTunnel
  ? 'https://pg7tj9bp-8080.asse.devtunnels.ms'
  : 'http://localhost:8080';
window.SOCKET_SERVER = window.SOCKET_SERVER || __defaultSocket;


// window.API_BASE = '../server-php/index.php/api';
