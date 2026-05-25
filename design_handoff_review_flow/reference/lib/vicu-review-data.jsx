/* global window */
// Sample review tree — mirrors sidebar order, includes parent/child hierarchy.
// Each node has tasks (for inline editing) and daysSinceReview (null = never).
const REVIEW_TREE = [
  {
    id: 'auralscape', title: 'Auralscape', color: '#AF52DE', daysSinceReview: 16,
    children: [
      { id: 'mobile', title: 'Mobile', color: '#AF52DE', daysSinceReview: null, tasks: [
        { id: 11, title: 'Fix offline playback bug on Android 14', priority: 3, due: 'overdue' },
        { id: 12, title: 'Spec push-notification schema', priority: 2 },
        { id: 13, title: 'Investigate crash on cold start', priority: 4 },
      ]},
      { id: 'audiomuse', title: 'AudioMuse', color: '#AF52DE', daysSinceReview: 14, tasks: [
        { id: 21, title: 'Tune EQ presets for podcast mode', priority: 2 },
        { id: 22, title: 'Review competitive landscape Q2' },
      ]},
    ],
    tasks: [
      { id: 1, title: 'Draft roll-out plan for v2 launch', priority: 3, due: 'May 4' },
      { id: 2, title: 'Work with Todd Wilcox / Harshini TM on IT landing page', priority: 2 },
      { id: 3, title: 'Schedule stakeholder demo', priority: 2 },
    ],
  },
  {
    id: 'koelap', title: 'Koelap', color: '#34C759', daysSinceReview: 21,
    tasks: [
      { id: 31, title: 'Renew domain registration', priority: 3, due: 'overdue' },
      { id: 32, title: 'Migrate analytics to Plausible', priority: 2 },
      { id: 33, title: 'Replace hero photography' },
    ],
  },
  {
    id: 'jci', title: 'JCI', color: '#FF3B30', daysSinceReview: null,
    children: [
      { id: 'portfolio', title: 'Portfolio', color: '#FF3B30', daysSinceReview: 18, tasks: [
        { id: 41, title: 'Update case-study screenshots' },
        { id: 42, title: 'Write Auralscape postmortem', priority: 2 },
      ]},
      { id: 'orgstrat', title: 'Organizational Strategy', color: '#FF3B30', daysSinceReview: null, tasks: [
        { id: 51, title: 'Draft Q3 OKR proposal', priority: 4 },
        { id: 52, title: 'Interview team leads', priority: 2 },
        { id: 53, title: 'Circulate strategy doc v0.3' },
      ]},
    ],
    tasks: [
      { id: 61, title: 'Pay annual membership' },
    ],
  },
  {
    id: 'personal', title: 'Personal', color: '#007AFF', daysSinceReview: 19,
    children: [
      { id: 'eva', title: 'EVA', color: '#007AFF', daysSinceReview: null, tasks: [
        { id: 71, title: 'Schedule first home-care visit', priority: 3 },
        { id: 72, title: 'Confirm Tuesday appointment with mom', priority: 4 },
      ]},
    ],
    tasks: [
      { id: 81, title: 'Renew passport', priority: 4, due: 'overdue' },
      { id: 82, title: 'Reply to Pieter — wedding RSVP', priority: 3 },
      { id: 83, title: 'Dental cleaning' },
    ],
  },
  { id: 'homelab', title: 'Homelab', color: '#5AC8FA', daysSinceReview: 30, tasks: [
    { id: 91, title: 'Update Proxmox to 8.2', priority: 2 },
    { id: 92, title: 'Migrate Plex library to new NAS' },
  ]},
  { id: 'home', title: 'Home', color: '#FF9500', daysSinceReview: 15, tasks: [
    { id: 101, title: 'Call the plumber about the leak', priority: 3, due: 'today' },
    { id: 102, title: 'Water the plants', priority: 1 },
    { id: 103, title: 'Replace doormat' },
  ]},
  { id: 'vicu', title: 'Vicu', color: '#FFCC00', daysSinceReview: null, tasks: [
    { id: 111, title: 'Ship Review redesign', priority: 4 },
    { id: 112, title: 'Write changelog for 1.5' },
  ]},
];

// Flatten with hierarchy info for split/stepper UIs
function flattenReview(tree) {
  const out = [];
  tree.forEach(p => {
    out.push({ ...p, depth: 0, isParent: !!p.children });
    if (p.children) p.children.forEach(c => out.push({ ...c, depth: 1, parentId: p.id }));
  });
  return out;
}

// Format last-reviewed
function lastReviewedLabel(days) {
  if (days == null) return { text: 'Never reviewed', urgent: true };
  if (days >= 21) return { text: `${days}d ago`, urgent: true };
  if (days >= 14) return { text: `${days}d ago`, urgent: false, warn: true };
  return { text: `${days}d ago`, urgent: false };
}

Object.assign(window, { REVIEW_TREE, flattenReview, lastReviewedLabel });
