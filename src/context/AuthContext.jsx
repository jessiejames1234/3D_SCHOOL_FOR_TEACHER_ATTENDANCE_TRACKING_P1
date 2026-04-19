const { createContext, useCallback, useEffect, useRef, useState } = React;

const AuthContext = createContext(null);

const USER_STORAGE_KEY = 'user';
const TOKEN_STORAGE_KEY = 'token';
const LAST_ACTIVITY_KEY = 'last_activity_at';
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const ACTIVITY_WRITE_THROTTLE_MS = 30000;

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_STORAGE_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  } catch (e) {
    return '';
  }
}

function readStoredActivity() {
  try {
    const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
    return Number.isFinite(value) ? value : 0;
  } catch (e) {
    return 0;
  }
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4 || 4)) % 4);
    return JSON.parse(atob(padded));
  } catch (e) {
    return null;
  }
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => readStoredUser());
  const lastTouchRef = useRef(0);
  const logoutRef = useRef(() => {});

  const clearSession = useCallback(() => {
    try {
      localStorage.removeItem(USER_STORAGE_KEY);
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch (e) {}
  }, []);

  const logout = useCallback((options = {}) => {
    setUser(null);
    clearSession();
    if (options.notice) {
      try { window.alert(options.notice); } catch (e) {}
    }
    if (typeof window !== 'undefined') {
      window.location.hash = '#/login';
    }
  }, [clearSession]);

  logoutRef.current = logout;

  const touchActivity = useCallback((force = false) => {
    if (!readStoredToken()) return;
    const now = Date.now();
    if (!force && now - lastTouchRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastTouchRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch (e) {}
  }, []);

  const login = useCallback((nextUser, token) => {
    setUser(nextUser || null);
    try {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser || null));
    } catch (e) {}
    if (typeof token !== 'undefined' && token !== null && token !== '') {
      try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch (e) {}
    }
    touchActivity(true);
  }, [touchActivity]);

  useEffect(() => {
    try {
      window.__touchSessionActivity = touchActivity;
    } catch (e) {}
    return () => {
      try { delete window.__touchSessionActivity; } catch (e) {}
    };
  }, [touchActivity]);

  useEffect(() => {
    const token = readStoredToken();
    if (!user || !token) return;

    const expireSession = (notice) => {
      logoutRef.current({ notice });
    };

    const checkSession = () => {
      const lastActivity = readStoredActivity();
      if (lastActivity > 0 && Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
        expireSession('You were signed out after 15 minutes of inactivity.');
        return;
      }

      const payload = decodeJwtPayload(token);
      const expiryMs = Number(payload?.exp || 0) * 1000;
      if (expiryMs > 0 && Date.now() >= expiryMs) {
        expireSession('Your session expired. Please sign in again.');
      }
    };

    if (!readStoredActivity()) {
      touchActivity(true);
    }
    checkSession();

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll', 'focus'];
    const onActivity = () => touchActivity();
    const onStorage = (event) => {
      if (event.key === USER_STORAGE_KEY) {
        setUser(readStoredUser());
      }
      if (event.key === TOKEN_STORAGE_KEY && !event.newValue) {
        setUser(null);
      }
      if (event.key === LAST_ACTIVITY_KEY) {
        lastTouchRef.current = Number(event.newValue || 0) || lastTouchRef.current;
      }
    };
    const intervalId = setInterval(checkSession, 15000);

    activityEvents.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    window.addEventListener('storage', onStorage);

    return () => {
      clearInterval(intervalId);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, onActivity, { passive: true }));
      window.removeEventListener('storage', onStorage);
    };
  }, [user, touchActivity]);

  return (
    <AuthContext.Provider value={{ user, login, logout, touchActivity }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext, AuthProvider };
