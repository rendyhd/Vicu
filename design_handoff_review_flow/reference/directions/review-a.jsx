/* global React, VicuChrome, VicuSidebar, REVIEW_TREE, lastReviewedLabel, I, PriorityDot, TaskCheckbox */
// Direction A — Inline accordion. List preserves sidebar order + hierarchy.
// Click a project header to expand its tasks inline with full edit controls.
const { useState: useStateRA } = React;

function ReviewA() {
  // expanded set; pre-open Auralscape > Mobile so the demo shows the surface
  const [expanded, setExpanded] = useStateRA(new Set(['mobile', 'koelap']));
  const [reviewed, setReviewed] = useStateRA(new Set());
  const [openTask, setOpenTask] = useStateRA(11); // pre-open one task to show the detail surface

  const toggle = (id) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };
  const markReviewed = (id) => {
    const next = new Set(reviewed); next.add(id); setReviewed(next);
    // collapse + move on
    const e = new Set(expanded); e.delete(id); setExpanded(e);
  };

  const total = countNodes(REVIEW_TREE);
  const done = reviewed.size;

  return (
    <VicuChrome dark width={1280} height={820} title="Review — Vicu">
      <VicuSidebar
        active="review"
        addReview reviewCount={total - done}
        projects={REVIEW_TREE.map(p => ({
          ...p, count: nodeTaskCount(p),
          children: p.children?.map(c => ({ ...c, count: c.tasks.length })),
        }))}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: 'var(--bg-primary)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '20px 28px 14px', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <I.repeat width={20} height={20} style={{ color: 'var(--accent-purple)' }}/>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Review</h1>
            <span style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
              background: 'rgba(175,82,222,0.15)', color: 'var(--accent-purple)',
            }}>{total - done} due</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>Click a project to review tasks in place. Press <kbd style={kbdStyle}>R</kbd> to mark reviewed.</span>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-hover)', overflow: 'hidden' }}>
              <div style={{ width: `${(done / total) * 100}%`, height: '100%', background: 'var(--accent-purple)', transition: 'width 0.3s' }}/>
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {done} / {total}
            </span>
          </div>
        </div>

        {/* Tree list */}
        <div className="vicu-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 16px 24px' }}>
          {REVIEW_TREE.map(parent => (
            <ProjectBranch
              key={parent.id}
              node={{ ...parent, _openTask: openTask, _onToggleTask: (id) => setOpenTask(openTask === id ? null : id), children: parent.children?.map(c => ({ ...c, _openTask: openTask, _onToggleTask: (id) => setOpenTask(openTask === id ? null : id) })) }}
              depth={0}
              expanded={expanded} reviewed={reviewed}
              onToggle={toggle} onReview={markReviewed}
            />
          ))}
        </div>
      </div>
    </VicuChrome>
  );
}

function ProjectBranch({ node, depth, expanded, reviewed, onToggle, onReview }) {
  const isOpen = expanded.has(node.id);
  const isReviewed = reviewed.has(node.id);
  const hasChildren = !!node.children;
  const taskCount = node.tasks?.length || 0;

  return (
    <div style={{ position: 'relative' }}>
      {depth > 0 && (
        <span style={{
          position: 'absolute', left: -12, top: 0, bottom: isOpen ? 0 : '50%',
          width: 1, background: 'var(--border-color)',
        }}/>
      )}
      {depth > 0 && (
        <span style={{
          position: 'absolute', left: -12, top: 22,
          width: 10, height: 1, background: 'var(--border-color)',
        }}/>
      )}

      <ProjectHeader
        node={node} depth={depth} isOpen={isOpen} isReviewed={isReviewed}
        onToggle={() => onToggle(node.id)}
        onReview={() => onReview(node.id)}
      />

      {isOpen && taskCount > 0 && (
        <div style={{ paddingLeft: 26 + depth * 18, paddingRight: 4, paddingBottom: 8 }}>
          {node.tasks.map(t => (
            <ReviewTaskRow
              key={t.id} task={t}
              expanded={node._openTask === t.id}
              onToggle={node._onToggleTask}
            />
          ))}
          <button style={addTaskBtn}>
            <I.plus width={12} height={12}/> Add task
          </button>
        </div>
      )}

      {hasChildren && (
        <div style={{ marginLeft: depth * 18 + 26, position: 'relative' }}>
          {node.children.map(child => (
            <ProjectBranch
              key={child.id} node={child} depth={depth + 1}
              expanded={expanded} reviewed={reviewed}
              onToggle={onToggle} onReview={onReview}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectHeader({ node, depth, isOpen, isReviewed, onToggle, onReview }) {
  const lr = lastReviewedLabel(node.daysSinceReview);
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px', borderRadius: 8,
        marginLeft: depth * 18,
        background: isOpen ? 'var(--bg-hover)' : 'transparent',
        cursor: 'pointer',
        opacity: isReviewed ? 0.45 : 1,
        marginBottom: 2,
      }}
    >
      <I.chevRight width={12} height={12} style={{
        color: 'var(--text-secondary)',
        transform: isOpen ? 'rotate(90deg)' : 'none',
        transition: 'transform 0.15s',
      }}/>
      <span style={{
        width: 10, height: 10, borderRadius: depth ? 5 : 2,
        background: node.color, flexShrink: 0,
        opacity: depth ? 0.6 : 1,
      }}/>
      <span style={{ fontSize: depth ? 13 : 14, fontWeight: depth ? 500 : 600, color: 'var(--text-primary)' }}>
        {node.title}
      </span>
      {depth === 0 && node.children && (
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
          {node.children.length} sub-projects
        </span>
      )}
      <LastReviewedTag lr={lr} reviewed={isReviewed}/>
      <span style={{ flex: 1 }}/>
      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{node.tasks?.length || 0} tasks</span>
      {!isReviewed && (
        <button
          onClick={(e) => { e.stopPropagation(); onReview(); }}
          style={{
            fontSize: 11, fontWeight: 600,
            padding: '4px 10px', borderRadius: 6,
            background: 'transparent',
            color: 'var(--accent-purple)',
            border: '1px solid rgba(175,82,222,0.4)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
          ✓ Mark reviewed
        </button>
      )}
      {isReviewed && (
        <span style={{
          fontSize: 11, fontWeight: 600, color: 'var(--accent-green)',
          padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>✓ Reviewed</span>
      )}
    </div>
  );
}

function LastReviewedTag({ lr, reviewed }) {
  if (reviewed) return null;
  let bg, color;
  if (lr.urgent) { bg = 'rgba(255,59,48,0.12)'; color = 'var(--accent-red)'; }
  else if (lr.warn) { bg = 'rgba(255,149,0,0.12)'; color = 'var(--accent-orange)'; }
  else { bg = 'var(--bg-hover)'; color = 'var(--text-secondary)'; }
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
      background: bg, color,
    }}>{lr.text}</span>
  );
}

function ReviewTaskRow({ task, expanded, onToggle }) {
  const overdue = task.due === 'overdue';
  return (
    <div style={{
      borderRadius: 8,
      background: expanded ? 'var(--bg-secondary)' : 'transparent',
      border: expanded ? '1px solid var(--border-color)' : '1px solid transparent',
      marginBottom: expanded ? 6 : 0,
      overflow: 'hidden',
      transition: 'background 0.15s',
    }}>
      <div
        onClick={() => onToggle && onToggle(task.id)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', fontSize: 12.5, cursor: 'pointer',
        }}
      >
        <span style={{ cursor: 'grab', color: 'var(--text-tertiary)', fontSize: 14, lineHeight: 1 }}>⋮⋮</span>
        <TaskCheckbox done={false}/>
        <span style={{ flex: 1, color: 'var(--text-primary)' }} className="truncate">{task.title}</span>
        <PriorityDot priority={task.priority}/>
        {task.due && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4,
            background: overdue ? 'rgba(255,59,48,0.12)' : 'transparent',
            color: overdue ? 'var(--accent-red)' : 'var(--text-secondary)',
          }}>{overdue ? 'Overdue' : task.due}</span>
        )}
        <I.chevRight width={11} height={11} style={{
          color: 'var(--text-tertiary)',
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
        }}/>
      </div>
      {expanded && <TaskDetailInline task={task}/>}
    </div>
  );
}

// Inline detail surface — the full task-editing controls that today's flow makes you leave Review for.
function TaskDetailInline({ task }) {
  const priorities = [
    { p: 4, label: 'Urgent', color: 'var(--accent-red)' },
    { p: 3, label: 'High',   color: 'var(--accent-orange)' },
    { p: 2, label: 'Med',    color: 'var(--accent-yellow)' },
    { p: 1, label: 'Low',    color: 'var(--accent-blue)' },
    { p: 0, label: 'None',   color: 'var(--text-tertiary)' },
  ];
  return (
    <div style={{
      padding: '4px 14px 14px 38px',
      display: 'flex', flexDirection: 'column', gap: 10,
      borderTop: '1px dashed var(--border-color)',
    }}>
      {/* Inline meta row */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', paddingTop: 10 }}>
        <DetailField label="Priority">
          <div style={{ display: 'flex', gap: 4 }}>
            {priorities.map(({ p, label, color }) => {
              const active = (task.priority || 0) === p;
              return (
                <button key={p} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 5,
                  fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  border: active ? '1px solid var(--border-color)' : '1px solid transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: color }}/>
                  {label}
                </button>
              );
            })}
          </div>
        </DetailField>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <DetailField label="Due date">
          <div style={{ display: 'flex', gap: 5 }}>
            {['Today', 'Tomorrow', 'This week', 'Pick…'].map(d => (
              <button key={d} style={chipBtn}>{d}</button>
            ))}
          </div>
        </DetailField>
        <DetailField label="Labels">
          <div style={{ display: 'flex', gap: 5 }}>
            <span style={labelChip('#34C759')}>grocery</span>
            <span style={labelChip('#FF9500')}>errand</span>
            <button style={{ ...chipBtn, color: 'var(--text-tertiary)', borderStyle: 'dashed' }}>+ Add</button>
          </div>
        </DetailField>
      </div>

      <DetailField label="Notes">
        <textarea placeholder="Add a note…" style={{
          width: '100%', resize: 'none', padding: '7px 9px', borderRadius: 6,
          border: '1px solid var(--border-color)', background: 'var(--bg-primary)',
          color: 'var(--text-primary)', fontSize: 12, fontFamily: 'inherit',
          minHeight: 44, outline: 'none',
        }}/>
      </DetailField>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 2 }}>
        <button style={{ ...chipBtn, color: 'var(--accent-blue)', borderColor: 'rgba(0,122,255,0.3)' }}>
          <I.plus width={11} height={11}/> Subtask
        </button>
        <button style={chipBtn}>Move to project…</button>
        <button style={chipBtn}>Convert to project</button>
        <span style={{ flex: 1 }}/>
        <button style={{ ...chipBtn, color: 'var(--accent-red)', borderColor: 'transparent' }}>Delete</button>
      </div>
    </div>
  );
}

function DetailField({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--text-tertiary)',
      }}>{label}</span>
      {children}
    </div>
  );
}

const chipBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  padding: '3px 9px', borderRadius: 5,
  fontSize: 11, fontWeight: 500, cursor: 'pointer',
  background: 'transparent', border: '1px solid var(--border-color)',
  color: 'var(--text-secondary)',
};
const labelChip = (hex) => {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 7px', borderRadius: 999,
    fontSize: 10, fontWeight: 500,
    background: `rgba(${r}, ${g}, ${b}, 0.14)`,
    color: hex,
  };
};

const addTaskBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 10px', marginTop: 2,
  background: 'transparent', border: 'none',
  color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer',
};
const kbdStyle = {
  fontFamily: '"SF Mono", ui-monospace, monospace', fontSize: 10,
  padding: '1px 5px', borderRadius: 3,
  background: 'var(--bg-hover)', border: '1px solid var(--border-color)',
};

function countNodes(tree) {
  let n = 0;
  tree.forEach(p => { n += 1; if (p.children) n += p.children.length; });
  return n;
}
function nodeTaskCount(p) {
  let n = (p.tasks?.length || 0);
  (p.children || []).forEach(c => n += (c.tasks?.length || 0));
  return n;
}

window.ReviewA = ReviewA;
