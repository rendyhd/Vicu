// Shared sample data for all Vicu mocks
const PEOPLE = {
  rendy: { id: 'rendy', name: 'Rendy', initial: 'R', cls: 'av-r', you: true },
  maya:  { id: 'maya',  name: 'Maya',  initial: 'M', cls: 'av-m' },
  sam:   { id: 'sam',   name: 'Sam',   initial: 'S', cls: 'av-s' },
  kai:   { id: 'kai',   name: 'Kai',   initial: 'K', cls: 'av-k' },
};

// Labels with hex (matches Vikunja label model)
const LABELS = {
  grocery:  { id: 1, title: 'grocery',   hex: '#34C759' },
  errand:   { id: 2, title: 'errand',    hex: '#FF9500' },
  home:     { id: 3, title: 'home',      hex: '#007AFF' },
  trip:     { id: 4, title: 'trip',      hex: '#AF52DE' },
  deep:     { id: 5, title: 'deep-work', hex: '#FF3B30' },
};

const PROJECTS = {
  inbox:   { id: 1, title: 'Inbox',     color: '#8E8E93' },
  home:    { id: 2, title: 'Home',      color: '#007AFF' },
  trip:    { id: 3, title: 'Japan trip',color: '#AF52DE' },
  work:    { id: 4, title: 'Work',      color: '#FF9500' },
  reading: { id: 5, title: 'Reading',   color: '#34C759' },
};

// Shared household — for collaboration mocks
const HOUSEHOLD = [PEOPLE.rendy, PEOPLE.maya];

function makeTasks() {
  return [
    { id: 101, title: 'Pick up groceries for dinner', project: 'home', labels: ['grocery'], due: 'today', priority: 4, assignees: ['maya'], comments: 2, shared: true },
    { id: 102, title: 'Call the plumber about the leak', project: 'home', labels: ['home','errand'], due: 'today', priority: 3, assignees: ['rendy'], comments: 1, shared: true },
    { id: 103, title: 'Book shinkansen tickets — Tokyo → Kyoto', project: 'trip', labels: ['trip'], due: 'tomorrow', priority: 3, assignees: ['rendy','maya'], comments: 4, shared: true },
    { id: 104, title: 'Renew car registration', project: 'home', labels: ['errand'], due: 'Fri', priority: 2, assignees: ['rendy'], comments: 0, shared: true, note: true },
    { id: 105, title: 'Research hotel in Kyoto', project: 'trip', labels: ['trip'], due: 'Sat', priority: 2, assignees: ['maya'], comments: 3, shared: true },
    { id: 106, title: 'Draft Q2 planning doc', project: 'work', labels: ['deep'], due: 'today', priority: 4, assignees: ['rendy'], comments: 0, shared: false },
    { id: 107, title: 'Water the plants', project: 'home', labels: ['home'], due: 'today', priority: 1, assignees: ['maya'], comments: 0, shared: true, recurring: true },
    { id: 108, title: 'Finish reading "The Creative Act"', project: 'reading', labels: [], due: null, priority: 1, assignees: ['rendy'], comments: 0, shared: false },
  ];
}

// Sample comments for task 103 (the trip-booking task)
const COMMENTS_103 = [
  { id: 1, who: 'maya',  ts: 'Tue 9:12 AM', body: 'I found cheaper tickets on the Nozomi — worth the extra ¥3000?' },
  { id: 2, who: 'rendy', ts: 'Tue 9:40 AM', body: 'Go for it. Saves us 40 min each way.' },
  { id: 3, who: 'maya',  ts: 'Tue 9:42 AM', body: 'Booking for Sat morning 🚅' },
  { id: 4, who: 'maya',  ts: 'Wed 6:18 PM', body: 'Tickets are in my email. I\'ll attach the PDF here.' },
];

// Activity feed sample
const ACTIVITY = [
  { who: 'maya',  verb: 'completed', what: 'Drop off dry cleaning', when: '2h ago' },
  { who: 'rendy', verb: 'assigned',  what: 'Call the plumber',      when: '3h ago', to: 'rendy' },
  { who: 'maya',  verb: 'commented on', what: 'Book shinkansen tickets', when: '5h ago' },
  { who: 'maya',  verb: 'added',     what: 'Research hotel in Kyoto', when: 'yesterday' },
];

Object.assign(window, { PEOPLE, LABELS, PROJECTS, HOUSEHOLD, makeTasks, COMMENTS_103, ACTIVITY });
