/* global React, VicuChrome, VicuSidebar, REVIEW_TREE, flattenReview, lastReviewedLabel, I, PriorityDot, TaskCheckbox */
// Direction B — Master-detail. Review list on left (sidebar order + hierarchy).
// Selected project's full editable surface on the right. R = mark reviewed & next.
const { useState: useStateRB } = React;

function ReviewB() {
  const flat = flattenReview(REVIEW_TREE);
  const [reviewed, setReviewed] = useStateRB(new Set(['audiomuse']));
  const [selectedId, setSelectedId] = useStateRB('mobile');

  const remaining = flat.filter(n => !reviewed.has(n.id));
  const selected = flat.find(n => n.id === selectedId);
  const parent = selected?.parentId ? flat.find(n => n.id === selected.parentId) : null;
  const done = reviewed.size;
  const total = flat.length;

  const reviewAndNext = () => {
    const next = new Set(reviewed); next.add(selectedId); setReviewed(next);
    const idx = remaining.findIndex(n => n.id === selectedId);
    const nextNode = remaining[idx + 1] || remaining[idx - 1] || remaining[0];
    if (nextNode && nextNode.id !== selectedId) setSelectedId(nextNode.id);
  };

  return (
    <VicuChrome dark width={1280} height={820} title="Review — Vicu">
      <VicuSidebar
        active="review"
        addReview reviewCount={total - done}
        projects={REVIEW_TREE.map(p => ({
          ...p,
          count: (p.tasks?.length || 0) + (p.children || []).reduce((n, c) => n + (c.tasks?.length || 0), 0),
          children: p.children?.map(c => ({ ...c, count: c.tasks.length })),
        }))}
      />

      {/* Master: review list */}
      <div style={{
        width: 320, flexShrink: 0, background: 'var(--bg-sidebar)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <I.repeat width={16} height={16} style={{ color: 'var(--accent-purple)' }}/>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Review queue</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 }}>
            {total - done} of {total} remaining · sidebar order
          </div>
          <div style={{ height: 3, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
            <div style={{ width: `${(done / total) * 100}%`, height: '100%', background: 'var(--accent-purple)' }}/>
          </div>
        </div>

        <div className="vicu-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
          {flat.map(node => (
            <ReviewListRow
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              reviewed={reviewed.has(node.id)}
              onClick={() => setSelectedId(node.id)}
            />
          ))}
        </div>

        {/* Keyboard helper footer */}
        <div style={{
          padding: '10px 14px', borderTop: '1px solid var(--border-color)',
          display: 'flex', gap: 12, fontSize: 10, color: 'var(--text-secondary)',
        }}>
          <span><kbd style={kbdB}>J</kbd> <kbd style={kbdB}>K</kbd> move</span>
          <span><kbd style={kbdB}>R</kbd> review + next</span>
          <span><kbd style={kbdB}>S</kbd> skip</span>
        </div>
      </div>

      {/* Detail: full editable project surface */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-primary)' }}>
        {selected && (
          <ProjectDetail
            node={selected} parent={parent}
            reviewed={reviewed.has(selected.id)}
            onReview={reviewAndNext}
          />
        )}
      </div>
    </VicuChrome>
  );
}

function ReviewListRow({ node, selected, reviewed, onClick }) {
  const lr = lastReviewedLabel(node.daysSinceReview);
  const indent = node.depth * 14;
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `7px 10px 7px ${10 + indent}px`,
        borderRadius: 6, cursor: 'pointer',
        background: selected ? 'var(--bg-selected)' : 'transparent',
        opacity: reviewed ? 0.4 : 1,
        marginBottom: 1,
      }}
    >
      {node.depth > 0 && (
        <span style={{
          position: 'absolute', left: 18, top: 0, bottom: 0,
          width: 1, background: 'var(--border-color)',
        }}/>
      )}
      <span style={{
        width: 8, height: 8, borderRadius: node.depth ? 4 : 2,
        background: node.color, flexShrink: 0,
        opacity: node.depth ? 0.6 : 1,
      }}/>
      <span style={{
        fontSize: 13, fontWeight: node.depth ? 400 : 500,
        color: 'var(--text-primary)', flex: 1,
        textDecoration: reviewed ? 'line-through' : 'none',
      }} className="truncate">{node.title}</span>
      {reviewed ? (
        <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>✓</span>
      ) : (
        <span style={{
          fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 999,
          background: lr.urgent ? 'rgba(255,59,48,0.15)' : lr.warn ? 'rgba(255,149,0,0.15)' : 'var(--bg-hover)',
          color: lr.urgent ? 'var(--accent-red)' : lr.warn ? 'var(--accent-orange)' : 'var(--text-secondary)',
        }}>{lr.text}</span>
      )}
    </div>
  );
}

function ProjectDetail({ node, parent, reviewed, onReview }) {
  const lr = lastReviewedLabel(node.daysSinceReview);
  const tasks = node.tasks || [];
  return (
    <>
      {/* Detail header */}
      <div style={{ padding: '20px 28px 14px', borderBottom: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', marginBottom: 8 }}>
          <I.repeat width={11} height={11} style={{ color: 'var(--accent-purple)' }}/>
          <span>Reviewing</span>
          {parent && (
            <>
              <span>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: 1, background: parent.color }}/>
                {parent.title}
              </span>
              <I.chevRight width={10} height={10}/>
            </>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, background: node.color }}/>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{node.title}</h1>
          <span style={{
            fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999,
            background: lr.urgent ? 'rgba(255,59,48,0.12)' : lr.warn ? 'rgba(255,149,0,0.12)' : 'var(--bg-hover)',
            color: lr.urgent ? 'var(--accent-red)' : lr.warn ? 'var(--accent-orange)' : 'var(--text-secondary)',
          }}>Last reviewed {lr.text}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {tasks.length} open tasks · Make any changes you need below — re-prioritize, set dates, prune, add. Then mark reviewed.
        </div>
      </div>

      {/* Editable task list */}
      <div className="vicu-scroll" style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
        {tasks.map(t => <EditableTaskRow key={t.id} task={t}/>)}
        <button style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 12px', marginTop: 6,
          background: 'transparent', border: '1px dashed var(--border-color)',
          borderRadius: 6, color: 'var(--text-secondary)',
          fontSize: 12.5, cursor: 'pointer', width: '100%', justifyContent: 'flex-start',
        }}>
          <I.plus width={13} height={13}/> Add task
        </button>
      </div>

      {/* Sticky action bar */}
      <div style={{
        padding: '14px 24px', borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-sidebar)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button style={ghostBtn}>Skip for now</button>
        <button style={ghostBtn}>Snooze 1 week</button>
        <span style={{ flex: 1 }}/>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Done with this one?</span>
        <button onClick={onReview} style={primaryBtn}>
          ✓ Mark reviewed
          <span style={{ opacity: 0.7, fontWeight: 400 }}>· next →</span>
          <kbd style={{ ...kbdB, background: 'rgba(255,255,255,0.18)', color: '#fff', borderColor: 'transparent' }}>R</kbd>
        </button>
      </div>
    </>
  );
}

function EditableTaskRow({ task }) {
  const overdue = task.due === 'overdue';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 8px', borderBottom: '1px solid var(--border-color)',
      fontSize: 13,
    }}>
      <span style={{ cursor: 'grab', color: 'var(--text-tertiary)' }}>⋮⋮</span>
      <TaskCheckbox done={false}/>
      <span style={{ flex: 1, color: 'var(--text-primary)' }}>{task.title}</span>
      <PriorityDot priority={task.priority}/>
      {task.due && (
        <span style={{
          fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
          background: overdue ? 'rgba(255,59,48,0.12)' : 'var(--bg-hover)',
          color: overdue ? 'var(--accent-red)' : 'var(--text-secondary)',
        }}>{overdue ? 'Overdue' : task.due}</span>
      )}
      <button style={iconBtn} title="Reschedule"><I.cal width={13} height={13}/></button>
      <button style={iconBtn} title="More"><span style={{ fontSize: 14, lineHeight: 1 }}>⋯</span></button>
    </div>
  );
}

const primaryBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '8px 14px', borderRadius: 8,
  background: 'var(--accent-purple)', color: '#fff',
  border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const ghostBtn = {
  padding: '6px 10px', borderRadius: 6,
  background: 'transparent', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
};
const iconBtn = {
  width: 24, height: 24, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center',
  background: 'transparent', border: 'none',
  color: 'var(--text-secondary)', cursor: 'pointer', borderRadius: 4,
};
const kbdB = {
  fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 10,
  padding: '1px 5px', borderRadius: 3,
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
};

window.ReviewB = ReviewB;
