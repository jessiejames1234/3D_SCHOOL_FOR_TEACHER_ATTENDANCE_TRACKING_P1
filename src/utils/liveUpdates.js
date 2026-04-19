function normalizeSocketServerUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return 'http://localhost:8080';
  if (value.startsWith('ws://')) return 'http://' + value.slice(5);
  if (value.startsWith('wss://')) return 'https://' + value.slice(6);
  return value;
}

export function connectLiveUpdates(options = {}) {
  if (typeof window === 'undefined' || typeof window.io !== 'function') {
    throw new Error('Socket.IO client is not available');
  }

  const token = (() => {
    try {
      return localStorage.getItem('token') || '';
    } catch (e) {
      return '';
    }
  })();

  const baseUrl = normalizeSocketServerUrl(window.SOCKET_SERVER || 'http://localhost:8080');
  const socket = window.io(baseUrl, {
    auth: token ? { token } : {},
    transports: ['websocket'],
    reconnection: false,
    timeout: 10000,
  });

  socket.on('connect', () => {
    if (typeof options.onConnect === 'function') options.onConnect(socket);
  });

  socket.on('REFRESH_DATA', (payload) => {
    if (typeof options.onRefresh === 'function') options.onRefresh(payload);
    if (typeof options.onMessage === 'function') options.onMessage({ type: 'REFRESH_DATA', payload });
  });

  socket.on('ENTITY_UPDATE', (payload) => {
    if (typeof options.onEntityUpdate === 'function') options.onEntityUpdate(payload);
    if (typeof options.onMessage === 'function') options.onMessage({ type: 'ENTITY_UPDATE', payload });
  });

  socket.on('disconnect', (reason) => {
    if (typeof options.onDisconnect === 'function') options.onDisconnect(reason);
  });

  socket.on('connect_error', (error) => {
    if (typeof options.onError === 'function') options.onError(error);
  });

  return socket;
}
