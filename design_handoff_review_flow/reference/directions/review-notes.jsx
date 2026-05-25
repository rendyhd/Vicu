/* global React */
// Diagnosis + design philosophy for the Review redesign.

function ReviewNotes() {
  const issues = [
    {
      h: 'Reviewing forces you to leave the review',
      b: 'GTD weekly review isn\'t a notification queue — it\'s a deliberate pass through stale work where you re-prioritize, prune, and sometimes add. The current flow sends you to the project page to do that work, then makes you click back to Review to advance. That round-trip kills the rhythm and gives "Mark reviewed" a meaning it shouldn\'t have ("I clicked it without actually reviewing"). The fix: bring full project-editing power INTO the Review surface.',
    },
    {
      h: 'Hierarchy is flattened — sub-projects look like peers',
      b: 'Mobile, Portfolio, EVA, Organizational Strategy all sit at the same indent as Auralscape, JCI, Personal. Visually identical, semantically nested. You lose the "what belongs to what" map at exactly the moment you need it most — when deciding whether a project is healthy. Solution: render parent → children with indent + tree-line connector, just like the sidebar should.',
    },
    {
      h: 'Order is arbitrary, not the sidebar\'s order',
      b: 'The user\'s mental sequence is the sidebar order (Auralscape → Koelap → JCI → …). Showing Review in a different order means switching to a different mental index every time. Match sidebar order including hierarchy and the cognitive cost drops to zero.',
    },
  ];

  const principles = [
    { h: 'Never leave Review during a review', b: 'Full controls inline — priority, due, complete, drag, add task.' },
    { h: 'Match the sidebar', b: 'Same order, same indent, same tree shape. Review is "your projects, filtered to stale".' },
    { h: 'Progress > completion', b: 'Show "3 of 8 reviewed", a progress bar, or a stepper. The ritual has a finish line.' },
    { h: 'Keyboard-first for power users', b: 'R = mark reviewed & next. J/K to navigate. Esc to exit focus.' },
  ];

  const directions = [
    { tag: 'A', h: 'Inline accordion', b: 'List with hierarchy intact. Click a project → tasks expand in place with full edit controls. Lowest UI cost, highest legibility. Best for skimmers.' },
    { tag: 'B', h: 'Master-detail split', b: 'Left rail = projects-to-review list (hierarchical, sidebar order). Right pane = full editable project surface. Power-user mode; pairs with R = next.' },
    { tag: 'C', h: 'Focus stepper', b: 'One project at a time, large card. Forward/back arrows; progress bar; "Mark reviewed → next" advances. Most GTD-ritual-flavoured, calmest, deliberate pace.' },
  ];

  return (
    <div style={{ width: 820, minHeight: 820, background: 'var(--bg-primary)', borderRadius: 12, padding: '28px 32px', boxShadow: '0 30px 80px rgba(0,0,0,0.22), 0 6px 14px rgba(0,0,0,0.08)', border: '1px solid rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--accent-purple)', marginBottom: 8 }}>Notes on the Review flow</div>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.015em' }}>Make Review a place to actually <em style={{ fontStyle: 'italic' }}>review</em>.</h1>
      <p style={{ marginTop: 10, marginBottom: 22, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', maxWidth: 620 }}>
        Today's Review screen is a checklist: 12 projects, each with a "Mark reviewed" button. The button is the easy part — the hard part (actually engaging with the project) lives somewhere else. Three observations, four principles, three directions.
      </p>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>What's wrong</div>
      {issues.map((p, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', columnGap: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-red)', paddingTop: 2, fontFamily: '"SF Mono", ui-monospace, monospace' }}>0{i + 1}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{p.h}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{p.b}</div>
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', margin: '24px 0 10px' }}>Principles</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        {principles.map((p, i) => (
          <div key={i} style={{ padding: '12px 14px', background: 'var(--bg-hover)', borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.h}</div>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{p.b}</div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 10 }}>Three directions →</div>
      {directions.map((d) => (
        <div key={d.tag} style={{ display: 'grid', gridTemplateColumns: '32px 1fr', columnGap: 14, marginBottom: 14 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#fff', background: 'var(--accent-purple)',
            width: 24, height: 24, borderRadius: 6, display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center',
          }}>{d.tag}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{d.h}</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-secondary)' }}>{d.b}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

window.ReviewNotes = ReviewNotes;
