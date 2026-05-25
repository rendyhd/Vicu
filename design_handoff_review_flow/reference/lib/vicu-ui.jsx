/* global React */
// Shared Vicu UI primitives — window chrome, sidebar, task row
const { useState, useMemo } = React;

// ---------- Icons (small SVG set — line style to match lucide stroke-1.8) ----------
const I = {
  inbox:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  sun:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>,
  cal:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  layers:   (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  book:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  plus:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  search:   (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
  tag:      (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41L13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>,
  comment:  (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  users:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  chevRight:(p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>,
  repeat:   (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>,
  send:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  x:        (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>,
  smile:    (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>,
  paperclip:(p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>,
  bell:     (p) => <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
};

// ---------- Avatar ----------
function Avatar({ person, size = 18, ring, style }) {
  const p = typeof person === 'string' ? PEOPLE[person] : person;
  if (!p) return null;
  return (
    <span
      className={`av ${p.cls} ${ring ? 'av-ring' : ''}`}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.45), ...style }}
      title={p.name}
    >
      {p.initial}
    </span>
  );
}

function AvatarStack({ ids, size = 18, max = 3 }) {
  const shown = ids.slice(0, max);
  return (
    <span style={{ display: 'inline-flex' }}>
      {shown.map((id, i) => (
        <span key={id} style={{ marginLeft: i === 0 ? 0 : -6 }}>
          <Avatar person={id} size={size} ring />
        </span>
      ))}
    </span>
  );
}

// ---------- Label chip ----------
function LabelChip({ id, size = 'sm' }) {
  const l = LABELS[id]; if (!l) return null;
  const hex = l.hex;
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: size === 'sm' ? '1px 6px' : '2px 8px',
      fontSize: size === 'sm' ? 10 : 11, fontWeight: 500, lineHeight: 1.3,
      borderRadius: 999,
      backgroundColor: `rgba(${r}, ${g}, ${b}, 0.12)`,
      color: hex,
    }}>
      {l.title}
    </span>
  );
}

// ---------- Due badge ----------
function DueBadge({ due }) {
  if (!due) return null;
  const overdue = due === 'overdue';
  const today = due === 'today';
  let bg = 'transparent', color = 'var(--text-secondary)';
  if (overdue) { bg = 'rgba(255,59,48,0.1)'; color = 'var(--accent-red)'; }
  else if (today) { bg = 'rgba(255,149,0,0.1)'; color = 'var(--accent-orange)'; }
  return (
    <span style={{ fontSize: 10, fontWeight: 500, padding: '2px 6px', borderRadius: 4, background: bg, color, flexShrink: 0 }}>
      {overdue ? 'Overdue' : due === 'today' ? 'Today' : due === 'tomorrow' ? 'Tomorrow' : due}
    </span>
  );
}

// ---------- Priority dot ----------
function PriorityDot({ priority }) {
  if (!priority) return null;
  const colors = { 1: 'var(--accent-blue)', 2: 'var(--accent-yellow)', 3: 'var(--accent-orange)', 4: 'var(--accent-red)' };
  return <span style={{ width: 8, height: 8, borderRadius: 4, background: colors[priority], flexShrink: 0 }} title={`Priority ${priority}`} />;
}

// ---------- Checkbox ----------
function TaskCheckbox({ done, onClick }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      style={{
        width: 18, height: 18, borderRadius: 9, border: '1px solid',
        borderColor: done ? 'var(--text-secondary)' : 'var(--border-color)',
        background: done ? 'var(--text-secondary)' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, cursor: 'pointer', padding: 0,
      }}
    >
      {done && (
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      )}
    </button>
  );
}

// ---------- Window chrome ----------
function VicuChrome({ children, width = 1280, height = 820, title, dark }) {
  return (
    <div className={dark ? 'dark' : ''} style={{
      width, height, background: 'var(--bg-primary)',
      borderRadius: 12, overflow: 'hidden',
      boxShadow: '0 30px 80px rgba(0,0,0,0.22), 0 6px 14px rgba(0,0,0,0.08)',
      border: '1px solid rgba(0,0,0,0.08)',
      display: 'flex', flexDirection: 'column',
      color: 'var(--text-primary)',
    }}>
      {/* Title bar */}
      <div style={{
        height: 32, background: 'var(--bg-sidebar)', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', flexShrink: 0,
      }}>
        <div className="traffic"><i className="r"/><i className="y"/><i className="g"/></div>
        <div style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
          {title || 'Vicu'}
        </div>
        <div style={{ width: 72 }} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>{children}</div>
    </div>
  );
}

// ---------- Sidebar ----------
function VicuSidebar({ active = 'today', width = 220, showHousehold = false, household = HOUSEHOLD, projects: projectsOverride, reviewCount, addReview }) {
  const smart = [
    { id: 'inbox', label: 'Inbox', icon: I.inbox, color: 'var(--accent-blue)', count: 3 },
    { id: 'today', label: 'Today', icon: I.sun, color: 'var(--accent-red)', count: 5 },
    { id: 'upcoming', label: 'Upcoming', icon: I.cal, color: 'var(--accent-orange)' },
    { id: 'anytime', label: 'Anytime', icon: I.layers, color: 'var(--accent-teal)' },
  ];
  if (addReview) {
    smart.push({ id: 'review', label: 'Review', icon: I.repeat, color: 'var(--accent-purple)', count: reviewCount });
  }
  smart.push({ id: 'logbook', label: 'Logbook', icon: I.book, color: 'var(--accent-green)' });

  const defaultProjects = [
    { id: 'home', title: 'Home', color: '#007AFF', shared: showHousehold, count: 8 },
    { id: 'trip', title: 'Japan trip', color: '#AF52DE', shared: showHousehold, count: 12 },
    { id: 'work', title: 'Work', color: '#FF9500', count: 4 },
    { id: 'reading', title: 'Reading', color: '#34C759', count: 2 },
  ];
  const projects = projectsOverride || defaultProjects;
  const labels = Object.values(LABELS).slice(0, 4);

  const renderProject = (p, depth = 0) => {
    const isActive = p.id === active;
    return (
      <React.Fragment key={p.id}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, height: 26,
          padding: depth ? `0 8px 0 ${8 + depth * 16}px` : '0 8px', fontSize: 13,
          borderRadius: 6, color: 'var(--text-primary)',
          background: isActive ? 'var(--bg-selected)' : 'transparent',
          fontWeight: isActive ? 500 : 400,
          position: 'relative',
        }}>
          {depth > 0 && (
            <span style={{
              position: 'absolute', left: 14, top: 0, bottom: 0,
              width: 1, background: 'var(--border-color)',
            }}/>
          )}
          <span style={{
            width: 8, height: 8, borderRadius: depth ? 4 : 2,
            background: p.color, flexShrink: 0,
            opacity: depth ? 0.55 : 1,
          }}/>
          <span style={{ flex: 1 }} className="truncate">{p.title}</span>
          {p.shared && <AvatarStack ids={household.map(h => h.id)} size={14} />}
          {p.count != null && (
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{p.count}</span>
          )}
        </div>
        {p.children && p.children.map(c => renderProject(c, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <div style={{
      width, flexShrink: 0, background: 'var(--bg-sidebar)',
      borderRight: '1px solid var(--border-color)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Smart lists */}
      <nav style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {smart.map(s => {
          const isActive = s.id === active;
          const Icon = s.icon;
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, height: 28,
              padding: '0 10px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              background: isActive ? 'var(--bg-selected)' : 'transparent',
              color: 'var(--text-primary)',
              border: isActive && s.id === 'review' ? '1px solid rgba(175,82,222,0.4)' : 'none',
            }}>
              <Icon width={14} height={14} style={{ color: s.color, flexShrink: 0 }}/>
              <span style={{ flex: 1 }}>{s.label}</span>
              {s.count != null && (
                <span style={{
                  fontSize: 11,
                  color: s.id === 'review' && s.count > 0 ? 'var(--accent-purple)' : 'var(--text-secondary)',
                  fontWeight: s.id === 'review' && s.count > 0 ? 600 : 400,
                }}>{s.count}</span>
              )}
            </div>
          );
        })}
      </nav>
      <div style={{ margin: '0 16px', borderTop: '1px solid var(--border-color)' }}/>

      <div className="vicu-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {/* Projects */}
        <div style={{ padding: '12px 16px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Projects</span>
          <I.plus width={13} height={13} style={{ color: 'var(--text-secondary)' }}/>
        </div>
        <div style={{ padding: '0 8px' }}>
          {projects.map(p => renderProject(p, 0))}
        </div>

        <div style={{ margin: '8px 16px', borderTop: '1px solid var(--border-color)' }}/>

        {/* Labels */}
        <div style={{ padding: '12px 16px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Labels</span>
          <I.plus width={13} height={13} style={{ color: 'var(--text-secondary)' }}/>
        </div>
        <div style={{ padding: '0 8px' }}>
          {labels.map(l => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, height: 26, padding: '0 8px', fontSize: 13, borderRadius: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: l.hex, flexShrink: 0 }}/>
              <span style={{ flex: 1 }}>{l.title}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer — household chip if collab on */}
      {showHousehold && (
        <div style={{
          borderTop: '1px solid var(--border-color)', padding: '10px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <AvatarStack ids={household.map(h => h.id)} size={18} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }} className="truncate">
              {household.map(h => h.name).join(' & ')}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Household · online</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Task row (base — variants override assignee display) ----------
function TaskRowBase({ task, selected, onClick, assigneeRender, rightRender, dense }) {
  const project = PROJECTS[task.project];
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        height: dense ? 34 : 40, padding: '0 16px',
        borderBottom: '1px solid var(--border-color)',
        background: selected ? 'var(--bg-hover)' : 'transparent',
        cursor: 'default',
      }}
    >
      <TaskCheckbox done={task.done} />
      {task.labels.length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {task.labels.map(l => <LabelChip key={l} id={l} />)}
        </div>
      )}
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }} className="truncate">
        {task.title}
      </span>
      {rightRender && rightRender(task)}
      {task.recurring && <I.repeat width={12} height={12} style={{ color: 'var(--text-secondary)' }}/>}
      {task.note && <I.paperclip width={12} height={12} style={{ color: 'var(--text-secondary)' }}/>}
      <PriorityDot priority={task.priority} />
      <DueBadge due={task.due} />
      {assigneeRender && assigneeRender(task)}
    </div>
  );
}

// ---------- Content header ----------
function ContentHeader({ title, subtitle, right }) {
  return (
    <div style={{ padding: '18px 24px 10px', display: 'flex', alignItems: 'flex-end', gap: 12 }}>
      <div style={{ flex: 1 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h1>
        {subtitle && <div style={{ marginTop: 3, fontSize: 12, color: 'var(--text-secondary)' }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

Object.assign(window, {
  I, Avatar, AvatarStack, LabelChip, DueBadge, PriorityDot, TaskCheckbox,
  VicuChrome, VicuSidebar, TaskRowBase, ContentHeader,
});
