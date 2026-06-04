import React from 'react';
import { AuthContext } from '../../context/AuthContext.jsx';
import { apiGet, apiPut } from '../../services/api.js';
import { MODULE_LABELS } from '../../utils/moduleAccess.js';
import './Index.css';

const ALLOWED_TARGET_ROLES_FOR_DEAN = new Set([3, 4, 5]);
const MODULE_CATEGORY_ORDER = ['Attendance', 'Academic', 'Facility', 'Faculty Portal', 'Reports', 'Administration', 'Other'];
const SETTINGS_LANDING_CARDS = [
  {
    id: 'module_access',
    title: 'Module Access Matrix',
    description: 'Manage module permissions per user and override role defaults when needed.',
    tag: 'Access Control',
    state: 'ready',
    initials: 'MA',
    cta: 'Open Module Access',
  },
  {
    id: 'home_content',
    title: 'Home Text Customizer',
    description: 'Customize the home page headline and preview its color before publishing.',
    tag: 'Home Page',
    state: 'ready',
    initials: 'HT',
    cta: 'Customize Text',
  },
  {
    id: 'locked_account',
    title: 'Locked Account',
    description: 'View and manage temporarily locked user accounts after failed login attempts.',
    tag: 'Security',
    state: 'soon',
    initials: 'LA',
    cta: 'Coming Soon',
  },
  {
    id: 'change_password',
    title: 'Change Password Account',
    description: 'Handle account password resets and forced password update policies.',
    tag: 'Security',
    state: 'soon',
    initials: 'CP',
    cta: 'Coming Soon',
  },
  {
    id: 'login_monitor',
    title: 'Login Attempt Monitor',
    description: 'Track suspicious login spikes and failed authentication trends.',
    tag: 'Monitoring',
    state: 'soon',
    initials: 'LM',
    cta: 'Coming Soon',
  },
  {
    id: 'account_recovery',
    title: 'Account Recovery Setup',
    description: 'Configure account recovery flow for supported user roles.',
    tag: 'Recovery',
    state: 'soon',
    initials: 'AR',
    cta: 'Coming Soon',
  },
  {
    id: 'security_policy',
    title: 'Security Policy Rules',
    description: 'Set password standards, lockout thresholds, and session controls.',
    tag: 'Policy',
    state: 'soon',
    initials: 'SP',
    cta: 'Coming Soon',
  },
];

const DEFAULT_HOME_TITLE = 'Time is Gold';
const DEFAULT_HOME_TITLE_COLOR = '#c69500';
const HOME_TITLE_COLOR_PRESETS = ['#c69500', '#0f5132', '#166534', '#0d6efd', '#7c3aed', '#dc2626'];

function getHomeHeadlineStyle(title, color = DEFAULT_HOME_TITLE_COLOR) {
  const text = String(title || '').trim();
  const length = text.length;
  const longestWord = text.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  const weight = Math.max(length, longestWord * 1.4);

  let fontSize = 'clamp(1.45rem, 2.4vw, 2.2rem)';
  if (weight <= 14) {
    fontSize = 'clamp(2.35rem, 5vw, 4.25rem)';
  } else if (weight <= 24) {
    fontSize = 'clamp(2.1rem, 4.4vw, 3.75rem)';
  } else if (weight <= 38) {
    fontSize = 'clamp(1.85rem, 3.6vw, 3rem)';
  } else if (weight <= 56) {
    fontSize = 'clamp(1.6rem, 2.9vw, 2.45rem)';
  }

  return {
    color,
    display: 'block',
    maxWidth: '100%',
    margin: 0,
    fontSize,
    fontWeight: 900,
    lineHeight: 0.96,
    letterSpacing: 0,
    overflowWrap: 'anywhere',
  };
}

function formatRoleName(roleName) {
  const raw = String(roleName || '').trim();
  if (!raw) return 'Unknown';
  return raw
    .replace(/_/g, ' ')
    .split(/\s+/)
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : ''))
    .join(' ');
}

function sortUnique(list) {
  return Array.from(new Set((Array.isArray(list) ? list : []).map((x) => String(x || '').trim()).filter(Boolean))).sort();
}

function formatModuleLabel(moduleKey) {
  const label = MODULE_LABELS[moduleKey];
  if (label) return label;
  return String(moduleKey || '')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function detectModuleCategory(moduleKey) {
  const key = String(moduleKey || '').toLowerCase();
  if (!key) return 'Other';

  if (/(attendance|edit_request|schedule_edit|audit|logs)/.test(key)) return 'Attendance';
  if (/(subject|program|department|section|semester|school_year|class_schedule|offering)/.test(key)) return 'Academic';
  if (/(building|room|floor|3d|school)/.test(key)) return 'Facility';
  if (/(faculty|my_|leave|substitute)/.test(key)) return 'Faculty Portal';
  if (/(report)/.test(key)) return 'Reports';
  if (/(user|dashboard|settings|penalt|system_log)/.test(key)) return 'Administration';
  return 'Other';
}

function getInitials(firstName, lastName) {
  const a = String(firstName || '').trim().charAt(0).toUpperCase();
  const b = String(lastName || '').trim().charAt(0).toUpperCase();
  return `${a}${b}`.trim() || 'U';
}

export default function GeneralSettingsIndex() {
  const { user } = React.useContext(AuthContext) || {};
  const roleId = Number(user?.role_id || 0);
  const isAdmin = roleId === 1;
  const isDean = roleId === 2;
  const canManage = isAdmin || isDean;
  const [routePath, setRoutePath] = React.useState(window.location.hash.slice(1) || '/settings/system');

  const [managedUsers, setManagedUsers] = React.useState([]);
  const [loadingUsers, setLoadingUsers] = React.useState(false);
  const [selectedUserId, setSelectedUserId] = React.useState('');
  const [loadingAccess, setLoadingAccess] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');
  const [moduleSearch, setModuleSearch] = React.useState('');
  const [schemaReady, setSchemaReady] = React.useState(true);

  const [targetInfo, setTargetInfo] = React.useState(null);
  const [roleDefaultModules, setRoleDefaultModules] = React.useState([]);
  const [manageableModules, setManageableModules] = React.useState([]);
  const [checkedModules, setCheckedModules] = React.useState([]);
  const [homeSettingsLoading, setHomeSettingsLoading] = React.useState(false);
  const [homeSettingsSaving, setHomeSettingsSaving] = React.useState(false);
  const [homeTitleDraft, setHomeTitleDraft] = React.useState(DEFAULT_HOME_TITLE);
  const [homeTitleColorDraft, setHomeTitleColorDraft] = React.useState(DEFAULT_HOME_TITLE_COLOR);
  const homePreviewTitleStyle = React.useMemo(() => getHomeHeadlineStyle(
    homeTitleDraft || DEFAULT_HOME_TITLE,
    /^#[0-9a-fA-F]{6}$/.test(homeTitleColorDraft) ? homeTitleColorDraft : DEFAULT_HOME_TITLE_COLOR
  ), [homeTitleDraft, homeTitleColorDraft]);

  React.useEffect(() => {
    const onHashChange = () => setRoutePath(window.location.hash.slice(1) || '/settings/system');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const normalizedRoute = React.useMemo(() => {
    const raw = String(routePath || '').trim().split('?')[0].split('#')[0].toLowerCase();
    if (!raw) return '/settings/system';
    return raw.startsWith('/') ? raw : `/${raw}`;
  }, [routePath]);

  const isModuleAccessView = normalizedRoute.startsWith('/settings/module-access');
  const isHomeContentView = normalizedRoute.startsWith('/settings/home-content');

  const openModuleAccessView = React.useCallback(() => {
    window.location.hash = '#/settings/module-access';
  }, []);

  const openHomeContentView = React.useCallback(() => {
    window.location.hash = '#/settings/home-content';
  }, []);

  const openSettingsHome = React.useCallback(() => {
    window.location.hash = '#/settings/system';
  }, []);

  const handleSettingsCardClick = React.useCallback(async (card) => {
    if (!card) return;
    if (card.id === 'module_access') {
      openModuleAccessView();
      return;
    }
    if (card.id === 'home_content') {
      openHomeContentView();
      return;
    }

    const message = `${card.title} is not connected yet. I already added the card layout and ready-state placeholder.`;
    try {
      if (window?.Swal) {
        await window.Swal.fire({
          icon: 'info',
          title: 'Coming Soon',
          text: message,
        });
        return;
      }
    } catch (swErr) {
      console.warn('Settings card info popup failed', swErr);
    }

    if (typeof window !== 'undefined') {
      window.alert(message);
    }
  }, [openModuleAccessView, openHomeContentView]);

  const filteredManagedUsers = React.useMemo(() => {
    let list = Array.isArray(managedUsers) ? managedUsers.slice() : [];
    if (isAdmin) {
      list = list.filter((u) => Number(u?.role_id || 0) !== 1);
    }
    if (isDean) {
      list = list.filter((u) => ALLOWED_TARGET_ROLES_FOR_DEAN.has(Number(u?.role_id || 0)));
    }
    list.sort((a, b) => {
      const aName = `${a?.last_name || ''} ${a?.first_name || ''}`.trim().toLowerCase();
      const bName = `${b?.last_name || ''} ${b?.first_name || ''}`.trim().toLowerCase();
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return Number(a?.user_id || 0) - Number(b?.user_id || 0);
    });
    return list;
  }, [managedUsers, isAdmin, isDean]);

  React.useEffect(() => {
    if (!canManage || !isModuleAccessView) return;
    let mounted = true;
    (async () => {
      setLoadingUsers(true);
      setError('');
      try {
        const data = await apiGet('users');
        if (!mounted) return;
        setManagedUsers(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!mounted) return;
        const message = err?.body?.message || err?.message || 'Failed to load users.';
        setError(message);
      } finally {
        if (mounted) setLoadingUsers(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [canManage, isModuleAccessView]);

  React.useEffect(() => {
    if (!isModuleAccessView || !selectedUserId) return;
    let mounted = true;
    (async () => {
      setLoadingAccess(true);
      setError('');
      setSuccess('');
      try {
        const data = await apiGet(`users/${selectedUserId}/module-access`);
        if (!mounted) return;
        const manageable = sortUnique(data?.manageable_modules);
        const effective = sortUnique(data?.effective_modules).filter((key) => manageable.includes(key));
        const defaults = sortUnique(data?.role_default_modules).filter((key) => manageable.includes(key));
        setTargetInfo({
          user_id: Number(data?.user_id || selectedUserId),
          first_name: String(data?.first_name || ''),
          last_name: String(data?.last_name || ''),
          role_name: String(data?.role_name || ''),
          role_id: Number(data?.role_id || 0),
        });
        setSchemaReady(Boolean(data?.schema_ready ?? true));
        setRoleDefaultModules(defaults);
        setManageableModules(manageable);
        setCheckedModules(effective);
      } catch (err) {
        if (!mounted) return;
        const message = err?.body?.message || err?.message || 'Failed to load module access.';
        setError(message);
      } finally {
        if (mounted) setLoadingAccess(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedUserId, isModuleAccessView]);

  React.useEffect(() => {
    if (!canManage || !isHomeContentView) return;
    let mounted = true;
    (async () => {
      setHomeSettingsLoading(true);
      setError('');
      setSuccess('');
      try {
        const data = await apiGet('app-settings/home');
        if (!mounted) return;
        const title = String(data?.home_title || '').trim();
        const color = String(data?.home_title_color || '').trim();
        setHomeTitleDraft(title || DEFAULT_HOME_TITLE);
        setHomeTitleColorDraft(/^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_HOME_TITLE_COLOR);
      } catch (err) {
        if (!mounted) return;
        const message = err?.body?.message || err?.body?.error || err?.message || 'Failed to load home page settings.';
        setError(message);
      } finally {
        if (mounted) setHomeSettingsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [canManage, isHomeContentView]);

  React.useEffect(() => {
    setModuleSearch('');
  }, [selectedUserId]);

  const roleDefaultSet = React.useMemo(() => new Set(roleDefaultModules), [roleDefaultModules]);
  const checkedSet = React.useMemo(() => new Set(checkedModules), [checkedModules]);
  const draftMode = React.useMemo(() => {
    if (checkedModules.length !== roleDefaultModules.length) return 'custom';
    for (const key of checkedModules) {
      if (!roleDefaultSet.has(key)) return 'custom';
    }
    return 'default';
  }, [checkedModules, roleDefaultModules, roleDefaultSet]);

  const moduleStats = React.useMemo(() => {
    const totalManageable = manageableModules.length;
    const enabledModules = checkedModules.length;
    const inheritedEnabled = checkedModules.filter((key) => roleDefaultSet.has(key)).length;
    const customEnabled = Math.max(0, enabledModules - inheritedEnabled);
    return { totalManageable, enabledModules, inheritedEnabled, customEnabled };
  }, [manageableModules, checkedModules, roleDefaultSet]);

  const moduleCards = React.useMemo(() => {
    const search = String(moduleSearch || '').trim().toLowerCase();
    const list = manageableModules.map((moduleKey) => {
      const label = formatModuleLabel(moduleKey);
      const category = detectModuleCategory(moduleKey);
      return {
        key: moduleKey,
        label,
        category,
        isChecked: checkedSet.has(moduleKey),
        isInherited: roleDefaultSet.has(moduleKey),
      };
    });

    const filtered = search
      ? list.filter((item) =>
        item.label.toLowerCase().includes(search)
        || item.key.toLowerCase().includes(search)
        || item.category.toLowerCase().includes(search)
      )
      : list;

    const orderIndex = (category) => {
      const idx = MODULE_CATEGORY_ORDER.indexOf(category);
      return idx === -1 ? MODULE_CATEGORY_ORDER.length : idx;
    };

    return filtered.sort((a, b) => {
      const categoryOrder = orderIndex(a.category) - orderIndex(b.category);
      if (categoryOrder !== 0) return categoryOrder;
      return a.label.localeCompare(b.label);
    });
  }, [manageableModules, checkedSet, roleDefaultSet, moduleSearch]);

  const groupedModuleCards = React.useMemo(() => {
    const groups = {};
    moduleCards.forEach((item) => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });

    return Object.keys(groups)
      .sort((a, b) => {
        const aIdx = MODULE_CATEGORY_ORDER.indexOf(a);
        const bIdx = MODULE_CATEGORY_ORDER.indexOf(b);
        const aOrder = aIdx === -1 ? MODULE_CATEGORY_ORDER.length : aIdx;
        const bOrder = bIdx === -1 ? MODULE_CATEGORY_ORDER.length : bIdx;
        return aOrder - bOrder;
      })
      .map((category) => ({ category, items: groups[category] }));
  }, [moduleCards]);

  const selectedUserLabel = React.useMemo(() => {
    if (targetInfo) {
      return `${targetInfo.first_name || ''} ${targetInfo.last_name || ''}`.trim() || `User #${targetInfo.user_id || selectedUserId}`;
    }
    const matched = filteredManagedUsers.find((item) => String(item?.user_id) === String(selectedUserId));
    if (!matched) return 'Selected User';
    const fullName = `${matched?.first_name || ''} ${matched?.last_name || ''}`.trim();
    return fullName || matched?.email || `User #${matched?.user_id}`;
  }, [targetInfo, selectedUserId, filteredManagedUsers]);

  const handleToggleModule = (moduleKey) => {
    setCheckedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleKey)) next.delete(moduleKey);
      else next.add(moduleKey);
      return Array.from(next).sort();
    });
  };

  const resetToDefault = () => {
    setCheckedModules(sortUnique(roleDefaultModules));
    setSuccess('');
  };

  const selectAllManageable = () => {
    setCheckedModules(sortUnique(manageableModules));
    setSuccess('');
  };

  const saveAccess = async () => {
    if (!selectedUserId) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = { selected_modules: checkedModules };
      const data = await apiPut(`users/${selectedUserId}/module-access`, payload);
      const manageable = sortUnique(data?.manageable_modules);
      const effective = sortUnique(data?.effective_modules).filter((key) => manageable.includes(key));
      const defaults = sortUnique(data?.role_default_modules).filter((key) => manageable.includes(key));
      setRoleDefaultModules(defaults);
      setManageableModules(manageable);
      setCheckedModules(effective);
      setSuccess('Module access updated successfully.');
      try {
        if (window?.Swal) {
          await window.Swal.fire({ icon: 'success', title: 'Saved', text: 'User module access was updated.' });
        }
      } catch (swErr) {
        console.warn('Swal success notification failed', swErr);
      }
    } catch (err) {
      const message = err?.body?.message || err?.message || 'Failed to save module access.';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const resetHomeDraft = () => {
    setHomeTitleDraft(DEFAULT_HOME_TITLE);
    setHomeTitleColorDraft(DEFAULT_HOME_TITLE_COLOR);
    setSuccess('');
    setError('');
  };

  const saveHomeContent = async () => {
    const title = String(homeTitleDraft || '').trim();
    const color = /^#[0-9a-fA-F]{6}$/.test(String(homeTitleColorDraft || '').trim())
      ? String(homeTitleColorDraft).trim()
      : DEFAULT_HOME_TITLE_COLOR;

    if (!title) {
      const message = 'Home title is required.';
      setError(message);
      try {
        if (window?.Swal) await window.Swal.fire({ icon: 'warning', title: 'Missing Title', text: message });
      } catch (swErr) {
        console.warn('Swal warning failed', swErr);
      }
      return;
    }

    try {
      if (window?.Swal) {
        const confirm = await window.Swal.fire({
          icon: 'question',
          title: 'Confirm Home Text',
          text: 'Publish this headline to the Home page?',
          showCancelButton: true,
          confirmButtonText: 'Confirm',
          cancelButtonText: 'Cancel',
          confirmButtonColor: '#198754',
        });
        if (!confirm.isConfirmed) return;
      }
    } catch (swErr) {
      console.warn('Swal confirmation failed', swErr);
    }

    setHomeSettingsSaving(true);
    setError('');
    setSuccess('');
    try {
      const data = await apiPut('app-settings/home', {
        home_title: title,
        home_title_color: color,
      });
      const savedTitle = String(data?.home_title || title).trim() || DEFAULT_HOME_TITLE;
      const savedColor = /^#[0-9a-fA-F]{6}$/.test(String(data?.home_title_color || '').trim())
        ? String(data.home_title_color).trim()
        : color;
      setHomeTitleDraft(savedTitle);
      setHomeTitleColorDraft(savedColor);
      setSuccess('Home page text updated successfully.');
      try {
        window.dispatchEvent(new CustomEvent('app-settings-updated', { detail: { group: 'home' } }));
      } catch (eventErr) {
        console.warn('Settings update event failed', eventErr);
      }
      try {
        if (window?.Swal) {
          await window.Swal.fire({ icon: 'success', title: 'Saved', text: 'Home page text was updated.' });
        }
      } catch (swErr) {
        console.warn('Swal success notification failed', swErr);
      }
    } catch (err) {
      const message = err?.body?.message || err?.body?.error || err?.message || 'Failed to save home page text.';
      setError(message);
      try {
        if (window?.Swal) {
          await window.Swal.fire({ icon: 'error', title: 'Save Failed', text: message });
        }
      } catch (swErr) {
        console.warn('Swal error notification failed', swErr);
      }
    } finally {
      setHomeSettingsSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="container-fluid py-3 general-settings-page">
        <div className="alert alert-danger mb-0">Only Admin and Dean can access General Settings module permissions.</div>
      </div>
    );
  }

  return (
    <div className="container-fluid py-3 general-settings-page">
      <div className="card border-0 shadow-sm gs-hero-card mb-3">
        <div className="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div>
            <h4 className="mb-1 fw-bold">General Settings</h4>
            <p className="mb-0 text-muted">
              {isHomeContentView
                ? 'Customize the Home page headline and preview it before publishing.'
                : 'Configure module visibility per user while keeping role defaults intact.'}
            </p>
          </div>
          <div className="d-flex align-items-center gap-2">
            {isModuleAccessView || isHomeContentView ? (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={openSettingsHome}>
                Back To Settings
              </button>
            ) : null}
            <span className={`gs-hero-badge ${isAdmin ? 'is-admin' : 'is-dean'}`}>
              {isAdmin ? 'Admin Control' : 'Dean Control'}
            </span>
          </div>
        </div>
      </div>

      {!isModuleAccessView && !isHomeContentView ? (
        <div className="row g-3 gs-entry-grid">
          {SETTINGS_LANDING_CARDS.map((card) => (
            <div key={card.id} className="col-12 col-md-6 col-xl-4">
              <button
                type="button"
                className={`gs-entry-card ${card.state === 'ready' ? 'is-live' : 'is-soon'}`}
                onClick={() => { handleSettingsCardClick(card); }}
              >
                <div className="gs-entry-top">
                  <span className="gs-entry-pill">{card.tag}</span>
                  <span className={`gs-entry-state ${card.state === 'ready' ? 'is-live' : 'is-soon'}`}>
                    {card.state === 'ready' ? 'Ready' : 'Soon'}
                  </span>
                </div>
                <span className="gs-entry-icon" aria-hidden="true">{card.initials}</span>
                <span className="gs-entry-title">{card.title}</span>
                <span className="gs-entry-desc">{card.description}</span>
                <span className="gs-entry-cta">{card.cta}</span>
              </button>
            </div>
          ))}
          <div className="col-12">
            <div className="gs-entry-note">Cards marked as <strong>Soon</strong> are prepared in UI and can be connected next.</div>
          </div>
        </div>
      ) : isHomeContentView ? (
        <>
          {error ? <div className="alert alert-danger">{error}</div> : null}
          {success ? <div className="alert alert-success">{success}</div> : null}

          <div className="row g-3">
            <div className="col-12 col-xl-5">
              <div className="card border-0 shadow-sm gs-control-card h-100">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                    <div>
                      <h5 className="mb-1 fw-bold">Home Headline</h5>
                      <p className="mb-0 text-muted small">Update the main Home page title and title color.</p>
                    </div>
                    <span className="gs-mini-chip">Live Preview</span>
                  </div>

                  {homeSettingsLoading ? (
                    <div className="text-muted">Loading home page settings...</div>
                  ) : (
                    <div className="d-grid gap-3">
                      <div>
                        <label className="form-label fw-semibold">Title Text</label>
                        <input
                          type="text"
                          className="form-control"
                          value={homeTitleDraft}
                          maxLength={80}
                          disabled={homeSettingsSaving}
                          onChange={(e) => setHomeTitleDraft(e.target.value)}
                          placeholder={DEFAULT_HOME_TITLE}
                        />
                        <div className="form-text">{String(homeTitleDraft || '').length}/80 characters</div>
                      </div>

                      <div>
                        <label className="form-label fw-semibold">Title Color</label>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                          <input
                            type="color"
                            className="form-control form-control-color gs-home-color-input"
                            value={/^#[0-9a-fA-F]{6}$/.test(homeTitleColorDraft) ? homeTitleColorDraft : DEFAULT_HOME_TITLE_COLOR}
                            disabled={homeSettingsSaving}
                            onChange={(e) => setHomeTitleColorDraft(e.target.value)}
                            title="Choose title color"
                          />
                          <input
                            type="text"
                            className="form-control gs-home-color-text"
                            value={homeTitleColorDraft}
                            disabled={homeSettingsSaving}
                            onChange={(e) => setHomeTitleColorDraft(e.target.value)}
                            placeholder={DEFAULT_HOME_TITLE_COLOR}
                          />
                        </div>
                        <div className="gs-home-swatches mt-2">
                          {HOME_TITLE_COLOR_PRESETS.map((color) => (
                            <button
                              key={color}
                              type="button"
                              className={`gs-home-swatch ${String(homeTitleColorDraft).toLowerCase() === color ? 'is-active' : ''}`}
                              style={{ backgroundColor: color }}
                              disabled={homeSettingsSaving}
                              onClick={() => setHomeTitleColorDraft(color)}
                              aria-label={`Use ${color}`}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>

                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-success"
                          disabled={homeSettingsSaving || homeSettingsLoading}
                          onClick={saveHomeContent}
                        >
                          {homeSettingsSaving ? 'Saving...' : 'Confirm Changes'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          disabled={homeSettingsSaving || homeSettingsLoading}
                          onClick={resetHomeDraft}
                        >
                          Reset Preview
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="col-12 col-xl-7">
              <div className="gs-home-preview-card">
                <div className="gs-home-preview-top">
                  <span className="gs-home-preview-pill">
                    <i className="bi bi-hourglass-split" aria-hidden="true"></i>
                    CDOC Attendance Home
                  </span>
                </div>
                <h1 className="gs-home-preview-title" style={homePreviewTitleStyle} title={String(homeTitleDraft || '').trim() || DEFAULT_HOME_TITLE}>
                  {String(homeTitleDraft || '').trim() || DEFAULT_HOME_TITLE}
                </h1>
                <p className="gs-home-preview-copy">
                  Every minute in class matters. This preview updates as you type or choose a color.
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {error ? <div className="alert alert-danger">{error}</div> : null}
          {success ? <div className="alert alert-success">{success}</div> : null}

          <div className="card border-0 shadow-sm mb-3 gs-control-card">
            <div className="card-body">
              <div className="row g-3 align-items-end">
                <div className="col-12 col-md-8">
                  <label className="form-label fw-semibold mb-1">Select User</label>
                  <select
                    className="form-select gs-user-select"
                    value={selectedUserId}
                    disabled={loadingUsers || loadingAccess || saving}
                    onChange={(e) => setSelectedUserId(String(e.target.value || ''))}
                  >
                    <option value="">Select user</option>
                    {filteredManagedUsers.map((item) => {
                      const fullName = `${item?.last_name || ''}, ${item?.first_name || ''}`.replace(/^,\s*/, '').trim();
                      const labelName = fullName || item?.email || `User #${item?.user_id}`;
                      const roleName = formatRoleName(item?.role_name || '');
                      return (
                        <option key={item.user_id} value={item.user_id}>
                          {labelName} {roleName ? `(${roleName})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {loadingUsers ? <div className="form-text">Loading users...</div> : <div className="form-text">Pick a user to manage module access.</div>}
                </div>
                <div className="col-12 col-md-4 text-md-end">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    disabled={!selectedUserId || loadingAccess || saving}
                    onClick={resetToDefault}
                  >
                    Reset To Role Default
                  </button>
                </div>
              </div>

              {selectedUserId ? (
                <div className="gs-user-strip mt-3">
                  <div className="gs-user-avatar" aria-hidden="true">
                    {getInitials(targetInfo?.first_name, targetInfo?.last_name)}
                  </div>
                  <div className="gs-user-meta">
                    <div className="fw-semibold">{selectedUserLabel}</div>
                    <div className="small text-muted">
                      Role: {formatRoleName(targetInfo?.role_name || '')}
                      {' | '}
                      Mode: {draftMode === 'custom' ? 'Custom Override' : 'Role Default'}
                    </div>
                  </div>
                  <div className="gs-user-stats">
                    <span className="gs-mini-chip">Manageable: {moduleStats.totalManageable}</span>
                    <span className="gs-mini-chip">Enabled: {moduleStats.enabledModules}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {selectedUserId ? (
            <div className="card border-0 shadow-sm gs-modules-card">
              <div className="card-body">
                {loadingAccess ? (
                  <div className="text-muted">Loading module access...</div>
                ) : (
                  <>
                    <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                      <div>
                        <h6 className="mb-1 fw-bold">Module Access Matrix</h6>
                        <div className="text-muted small">Toggle modules that this user can open in the sidebar and routes.</div>
                      </div>
                      <div className="d-flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-success"
                          disabled={saving || manageableModules.length === 0}
                          onClick={selectAllManageable}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          disabled={saving || !selectedUserId}
                          onClick={resetToDefault}
                        >
                          Reset Defaults
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-success"
                          disabled={saving || !schemaReady || !selectedUserId}
                          onClick={saveAccess}
                        >
                          {saving ? 'Saving...' : 'Save Access'}
                        </button>
                      </div>
                    </div>

                    <div className="gs-stats-grid mb-3">
                      <div className="gs-stat-card">
                        <div className="gs-stat-label">Manageable Modules</div>
                        <div className="gs-stat-value">{moduleStats.totalManageable}</div>
                      </div>
                      <div className="gs-stat-card">
                        <div className="gs-stat-label">Enabled Modules</div>
                        <div className="gs-stat-value">{moduleStats.enabledModules}</div>
                      </div>
                      <div className="gs-stat-card">
                        <div className="gs-stat-label">Role Default Enabled</div>
                        <div className="gs-stat-value">{moduleStats.inheritedEnabled}</div>
                      </div>
                      <div className="gs-stat-card">
                        <div className="gs-stat-label">Custom Enabled</div>
                        <div className="gs-stat-value">{moduleStats.customEnabled}</div>
                      </div>
                    </div>

                    <div className="gs-search-row mb-3">
                      <div className="input-group">
                        <span className="input-group-text">Search</span>
                        <input
                          type="search"
                          className="form-control"
                          placeholder="Filter by module name or key..."
                          value={moduleSearch}
                          onChange={(e) => setModuleSearch(String(e.target.value || ''))}
                          disabled={saving || manageableModules.length === 0}
                        />
                        <button
                          type="button"
                          className="btn btn-outline-secondary"
                          disabled={!moduleSearch}
                          onClick={() => setModuleSearch('')}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {!schemaReady ? (
                      <div className="alert alert-warning mb-0">
                        Missing database columns for module access. Please run migration:
                        <code className="ms-1">server-php/migrations/2026-04-16-add-user-module-permissions.sql</code>
                      </div>
                    ) : manageableModules.length === 0 ? (
                      <div className="text-muted">No manageable modules available for this user.</div>
                    ) : moduleCards.length === 0 ? (
                      <div className="text-muted">No modules match your search filter.</div>
                    ) : (
                      groupedModuleCards.map((group) => (
                        <div key={group.category} className="gs-module-group">
                          <div className="gs-module-group-head">
                            <h6 className="mb-0">{group.category}</h6>
                            <span className="badge text-bg-light">{group.items.length}</span>
                          </div>

                          <div className="row g-2">
                            {group.items.map((item) => (
                              <div key={item.key} className="col-12 col-md-6 col-xl-4">
                                <label className={`gs-module-tile ${item.isChecked ? 'is-checked' : ''}`}>
                                  <span className="gs-module-main">
                                    <input
                                      type="checkbox"
                                      className="form-check-input mt-1"
                                      checked={item.isChecked}
                                      onChange={() => handleToggleModule(item.key)}
                                      disabled={saving}
                                    />
                                    <span className="gs-module-copy">
                                      <span className="gs-module-label">{item.label}</span>
                                      <span className="gs-module-key">{item.key}</span>
                                    </span>
                                  </span>
                                  <span className={`gs-module-badge ${item.isInherited ? 'is-role-default' : 'is-override'}`}>
                                    {item.isInherited ? 'Role Default' : 'Override'}
                                  </span>
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="card border-0 shadow-sm">
              <div className="card-body text-center py-4 text-muted">
                Select a user first to view and update module permissions.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

