import React from 'react';
import { apiGet, apiPut } from '../../services/api.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatNotificationTime(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (!date || Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNotificationAge(value) {
  if (!value) return '';
  const date = new Date(String(value).replace(' ', 'T'));
  if (!date || Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60 * 1000) return 'Just now';
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function normalizeNotificationLink(rawLink) {
  const raw = String(rawLink || '').trim();
  if (!raw) return '';
  if (raw.startsWith('#/')) return raw.slice(1);
  if (raw.startsWith('/')) return raw;
  try {
    const parsed = new URL(raw, window.location.origin);
    if (parsed.origin !== window.location.origin) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (e) {
    return raw.startsWith('/') ? raw : `/${raw}`;
  }
}

function getInitials(name) {
  const parts = cleanText(name).split(' ').filter(Boolean);
  if (parts.length === 0) return 'N';
  return parts.slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('');
}

export default function NotificationIndex() {
  const [notifications, setNotifications] = React.useState([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [actioning, setActioning] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [query, setQuery] = React.useState('');
  const [error, setError] = React.useState('');

  const loadNotifications = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const payload = await apiGet('notification?limit=100&include_hidden=1');
      const list = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.notifications) ? payload.notifications : []);
      setNotifications(list);
      setUnreadCount(Number(payload?.unread_count || list.filter(n => Number(n?.is_read || 0) === 0).length || 0));
    } catch (err) {
      setError(err?.body?.message || err?.message || 'Failed to load notifications.');
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      loadNotifications({ silent: true });
    }, 15000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  const readCount = Math.max(0, notifications.length - unreadCount);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleNotifications = notifications.filter((notif) => {
    const isUnread = Number(notif?.is_read || 0) === 0;
    if (statusFilter === 'unread' && !isUnread) return false;
    if (statusFilter === 'read' && isUnread) return false;
    if (!normalizedQuery) return true;
    const haystack = [
      notif?.title,
      notif?.message,
      notif?.actor_name,
      notif?.created_at
    ].map(cleanText).join(' ').toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const markRead = async (notifId) => {
    if (!notifId) return;
    setNotifications(prev => prev.map(n => Number(n?.notif_id) === Number(notifId) ? { ...n, is_read: 1 } : n));
    setUnreadCount(prev => Math.max(0, Number(prev || 0) - 1));
    try {
      await apiPut(`notification/${notifId}`, {});
    } catch (err) {
      await loadNotifications({ silent: true });
    }
  };

  const markAllRead = async () => {
    if (!unreadCount || actioning) return;
    setActioning(true);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
    setUnreadCount(0);
    try {
      await apiPut('notification/read-all', {});
    } catch (err) {
      await loadNotifications({ silent: true });
    } finally {
      setActioning(false);
    }
  };

  const openNotification = async (notif) => {
    const notifId = Number(notif?.notif_id || 0);
    if (notifId && Number(notif?.is_read || 0) === 0) {
      await markRead(notifId);
    }
    const link = normalizeNotificationLink(notif?.link);
    if (link) window.location.hash = `#${link.startsWith('/') ? link : `/${link}`}`;
  };

  const statCards = [
    { key: 'all', label: 'Total Notifications', value: notifications.length, tone: 'bg-slate-900 text-white', icon: 'bi bi-bell-fill' },
    { key: 'unread', label: 'Unread', value: unreadCount, tone: 'bg-emerald-600 text-white', icon: 'bi bi-envelope-fill' },
    { key: 'read', label: 'Read', value: readCount, tone: 'bg-sky-600 text-white', icon: 'bi bi-check2-circle' },
  ];

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-6 rounded-2xl border border-slate-200 bg-white px-5 py-5 shadow-sm md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Notification Center</p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 md:text-4xl">Notifications</h1>
              <p className="mt-2 text-sm text-slate-500">Shows your full notification history, including items cleared from the Navbar.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => loadNotifications()}
                disabled={loading || refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <i className="bi bi-arrow-repeat"></i>
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={markAllRead}
                disabled={!unreadCount || actioning}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <i className="bi bi-check2-all"></i>
                Mark All Read
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {statCards.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={`flex items-center justify-between rounded-2xl border px-4 py-4 text-left shadow-sm transition ${
                statusFilter === item.key ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white hover:border-emerald-200'
              }`}
            >
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{item.label}</p>
                <p className="mt-1 text-2xl font-extrabold text-slate-900">{item.value}</p>
              </div>
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl text-lg ${item.tone}`}>
                <i className={item.icon}></i>
              </span>
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {['all', 'unread', 'read'].map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className={`rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide transition ${
                    statusFilter === filter
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative">
                <i className="bi bi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notifications"
                  className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100 sm:w-72"
                />
              </div>
            </div>
          </div>

          {error ? (
            <div className="mx-4 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center justify-center gap-3 p-10 text-sm font-semibold text-slate-500">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"></span>
              Loading notifications...
            </div>
          ) : visibleNotifications.length === 0 ? (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl text-slate-400">
                <i className="bi bi-bell"></i>
              </div>
              <div className="mt-4 text-lg font-black text-slate-800">No notifications found</div>
              <p className="mt-2 text-sm text-slate-500">New system notifications will appear here automatically.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleNotifications.map((notif) => {
                const isUnread = Number(notif?.is_read || 0) === 0;
                const title = cleanText(notif?.title) || 'Notification';
                const message = cleanText(notif?.message);
                const actor = cleanText(notif?.actor_name) || 'System';
                const hasLink = !!normalizeNotificationLink(notif?.link);
                const isClearedFromNavbar = Boolean(notif?.navbar_hidden_at);

                return (
                  <button
                    key={notif?.notif_id || `${title}-${notif?.created_at}`}
                    type="button"
                    onClick={() => openNotification(notif)}
                    className={`block w-full px-4 py-4 text-left transition hover:bg-emerald-50/60 md:px-5 ${
                      isUnread ? 'bg-emerald-50/50' : 'bg-white'
                    }`}
                  >
                    <div className="flex gap-4">
                      <div className="relative flex-shrink-0">
                        {notif?.actor_avatar ? (
                          <img
                            src={notif.actor_avatar}
                            alt={actor}
                            className="h-11 w-11 rounded-full border border-slate-200 object-cover"
                          />
                        ) : (
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                            {getInitials(actor)}
                          </span>
                        )}
                        {isUnread ? (
                          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500"></span>
                        ) : null}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-black text-slate-900">{title}</span>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                                isUnread ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'
                              }`}>
                                {isUnread ? 'Unread' : 'Read'}
                              </span>
                              {hasLink ? (
                                <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-sky-700">
                                  Link
                                </span>
                              ) : null}
                              {isClearedFromNavbar ? (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                                  Cleared From Navbar
                                </span>
                              ) : null}
                            </div>
                            {message ? <p className="mt-2 text-sm leading-6 text-slate-600">{message}</p> : null}
                            <div className="mt-2 text-xs font-semibold text-slate-400">From {actor}</div>
                          </div>
                          <div className="whitespace-nowrap text-xs font-semibold text-slate-400">
                            <div>{formatNotificationTime(notif?.created_at)}</div>
                            <div className="mt-1 text-right text-slate-500">{formatNotificationAge(notif?.created_at)}</div>
                            {hasLink ? (
                              <div className="mt-3 text-right">
                                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white">
                                  Open
                                  <i className="bi bi-arrow-right-short text-sm"></i>
                                </span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
