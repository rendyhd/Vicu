/* global React, VicuChrome, VicuSidebar, REVIEW_TREE, flattenReview, lastReviewedLabel, I, PriorityDot, TaskCheckbox */
// Direction C — Focus stepper. One project at a time, large card, deliberate pace.
// Best for the GTD weekly-review ritual: calm, intentional, finish-line clear.
const { useState: useStateRC } = React;

function ReviewC() {
  const flat = flattenReview(REVIEW_TREE);
  const [idx, setIdx] = useStateRC(2);   // demo: somewhere into the queue
  const [reviewed, setReviewed] = useStateRC(new Set([flat[0].id, flat[1].id]));

  const current = flat[idx];
  const parent = current?.parentId ? flat.find(n => n.id === current.parentId) : null;
  const lr = lastReviewedLabel(current.daysSinceReview);

  const go = (n) => setIdx(Math.max(0, Math.min(flat.length - 1, n)));
  const reviewAndNext = () => {
    const next = new Set(reviewed); next.add(current.id); setReviewed(next);
    if (idx < flat.length - 1) setIdx(idx + 1);
  };

  return (
    <VicuChrome dark width={1280} height={820} title="Review — Vicu">
      <VicuSidebar
        active="review"
        addReview reviewCount={flat.length - reviewed.size}
        projects={REVIEW_TREE.map(p => ({
          ...p,
          count: (p.tasks?.length || 0) + (p.children || []).reduce((n, c) => n + (c.tasks?.length || 0), 0),
          children: p.children?.map(c => ({ ...c, count: c.tasks.length })),
        }))}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-secondary)', overflow: 'hidden' }}>
        {/* Focus header */}
        <div style={{ padding: '14px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--bg-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <I.repeat width={14} height={14} style={{ color: 'var(--accent-purple)' }}/>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Weekly review</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>· Sunday, 9:42 AM</span>
          </div>
          <span style={{ flex: 1 }}/>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
            {idx + 1} of {flat.length} · {reviewed.size} reviewed
          </span>
          <button style={{
            fontSize: 11, padding: '4px 10px', borderRadius: 6,
            background: 'transparent', border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}>Exit focus mode</button>
        </div>

        {/* Step dots — sidebar order */}
        <StepDots flat={flat} idx={idx} reviewed={reviewed} onJump={go}/>

        {/* The focus card */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px 48px', position: 'relative' }}>
          {/* Ghost cards behind */}
          {idx > 0 && <GhostCard side="left" node={flat[idx - 1]}/>}
          {idx < flat.length - 1 && <GhostCard side="right" node={flat[idx + 1]}/>}

          <button onClick={() => go(idx - 1)} disabled={idx === 0} style={arrowBtn('left', idx === 0)} title="Previous">‹</button>

          <FocusCard node={current} parent={parent} lr={lr} onReview={reviewAndNext}/>

          <button onClick={() => go(idx + 1)} disabled={idx === flat.length - 1} style={arrowBtn('right', idx === flat.length - 1)} title="Next">›</button>
        </div>

        {/* Keyboard footer */}
        <div style={{
          padding: '10px 24px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)',
          display: 'flex', justifyContent: 'center', gap: 18, fontSize: 11, color: 'var(--text-secondary)',
        }}>
          <span><kbd style={kbdC}>←</kbd> <kbd style={kbdC}>→</kbd> navigate</span>
          <span><kbd style={kbdC}>R</kbd> mark reviewed & next</span>
          <span><kbd style={kbdC}>S</kbd> skip</span>
          <span><kbd style={kbdC}>esc</kbd> exit</span>
        </div>
      </div>
    </VicuChrome>
  );
}

function StepDots({ flat, idx, reviewed, onJump }) {
  return (
    <div style={{
      padding: '12px 24px', background: 'var(--bg-primary)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto',
    }}>
      {flat.map((n, i) => {
        const isReviewed = reviewed.has(n.id);
        const isCurrent = i === idx;
        return (
          <button key={n.id} onClick={() => onJump(i)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 8px', borderRadius: 999,
            background: isCurrent ? 'var(--bg-selected)' : 'transparent',
            border: 'none', cursor: 'pointer',
            opacity: isReviewed ? 0.45 : 1,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isReviewed ? 'var(--accent-green)' : n.color,
              opacity: isReviewed ? 1 : (isCurrent ? 1 : 0.5),
              outline: isCurrent ? '2px solid var(--accent-purple)' : 'none',
              outlineOffset: 1,
            }}/>
            <span style={{
              fontSize: 11,
              color: isCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: isCurrent ? 600 : 400,
              paddingLeft: n.depth ? 6 : 0,
            }}>
              {n.depth > 0 && <span style={{ color: 'var(--text-tertiary)', marginRight: 4 }}>↳</span>}
              {n.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FocusCard({ node, parent, lr, onReview }) {
  const tasks = node.tasks || [];
  return (
    <div style={{
      width: 640, maxHeight: 540, background: 'var(--bg-primary)',
      borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06)',
      border: '1px solid var(--border-color)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 2,
    }}>
      {/* Card header */}
      <div style={{ padding: '22px 28px 16px', borderBottom: '1px solid var(--border-color)' }}>
        {parent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: 1, background: parent.color }}/>
            {parent.title}
            <I.chevRight width={11} height={11}/>
            <span style={{ color: 'var(--text-tertiary)' }}>sub-project</span>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ width: 16, height: 16, borderRadius: 4, background: node.color }}/>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.015em' }}>{node.title}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
            background: lr.urgent ? 'rgba(255,59,48,0.12)' : lr.warn ? 'rgba(255,149,0,0.12)' : 'var(--bg-hover)',
            color: lr.urgent ? 'var(--accent-red)' : lr.warn ? 'var(--accent-orange)' : 'var(--text-secondary)',
          }}>Last reviewed {lr.text}</span>
          <span>·</span>
          <span>{tasks.length} open tasks</span>
        </div>
      </div>

      {/* Editable tasks */}
      <div className="vicu-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 18px 16px' }}>
        {tasks.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13 }}>
            No open tasks. Add one or archive the project.
          </div>
        )}
        {tasks.map(t => <FocusTaskRow key={t.id} task={t}/>)}
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', marginTop: 6,
          background: 'transparent', border: 'none',
          color: 'var(--text-secondary)', fontSize: 12.5, cursor: 'pointer',
        }}>
          <I.plus width={12} height={12}/> Add task
        </button>
      </div>

      {/* Card action bar */}
      <div style={{
        padding: '12px 18px', borderTop: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-sidebar)',
      }}>
        <button style={cardGhost}>Skip</button>
        <button style={cardGhost}>Snooze 1w</button>
        <button style={cardGhost}>Archive project</button>
        <span style={{ flex: 1 }}/>
        <button onClick={onReview} style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '9px 18px', borderRadius: 8,
          background: 'var(--accent-purple)', color: '#fff',
          border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>
          ✓ Mark reviewed → next
        </button>
      </div>
    </div>
  );
}

function FocusTaskRow({ task }) {
  const overdue = task.due === 'overdue';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 10px', borderRadius: 6, fontSize: 13,
    }}>
      <span style={{ cursor: 'grab', color: 'var(--text-tertiary)' }}>⋮⋮</span>
      <TaskCheckbox done={false}/>
      <span style={{ flex: 1, color: 'var(--text-primary)' }} className="truncate">{task.title}</span>
      <PriorityDot priority={task.priority}/>
      {task.due && (
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
          background: overdue ? 'rgba(255,59,48,0.12)' : 'var(--bg-hover)',
          color: overdue ? 'var(--accent-red)' : 'var(--text-secondary)',
        }}>{overdue ? 'Overdue' : task.due}</span>
      )}
    </div>
  );
}

function GhostCard({ side, node }) {
  return (
    <div style={{
      position: 'absolute', top: '50%', [side]: 70,
      transform: `translate(${side === 'left' ? -20 : 20}px, -50%) rotate(${side === 'left' ? -2 : 2}deg)`,
      width: 80, height: 280, background: 'var(--bg-primary)',
      borderRadius: 10, border: '1px solid var(--border-color)',
      opacity: 0.45, zIndex: 1,
      display: 'flex', alignItems: 'flex-start', padding: 12, gap: 6,
      pointerEvents: 'none',
    }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: node.color, flexShrink: 0, marginTop: 2 }}/>
      <span style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
        writingMode: 'vertical-rl', textOrientation: 'mixed',
      }} className="truncate">{node.title}</span>
    </div>
  );
}

const arrowBtn = (side, disabled) => ({
  position: 'absolute', [side]: 30, top: '50%', transform: 'translateY(-50%)',
  width: 40, height: 40, borderRadius: '50%',
  background: 'var(--bg-primary)', border: '1px solid var(--border-color)',
  color: disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
  fontSize: 22, lineHeight: 1, cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.4 : 1,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 2px 6px rgba(0,0,0,0.08)', zIndex: 3,
});
const cardGhost = {
  padding: '6px 10px', borderRadius: 6,
  background: 'transparent', border: 'none',
  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
};
const kbdC = {
  fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 10,
  padding: '1px 5px', borderRadius: 3,
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
};

window.ReviewC = ReviewC;
