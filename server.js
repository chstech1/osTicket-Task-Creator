const express = require('express');
const path = require('path');
const clientsStore = require('./data/clientsStore');
const templatesStore = require('./data/templatesStore');
const db = require('./db/db');
const settingsStore = require('./data/settingsStore');
const calendarService = require('./services/calendar');

const app = express();
const PORT = process.env.PORT || 3000;

// Express configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Utility: fetch supporting data from the osTicket database while handling
// connection errors gracefully. Returns empty arrays when unavailable.
async function loadReferenceData() {
  const status = db.getStatus();
  if (status.hasError) {
    return {
      data: { departments: [], teams: [], staff: [] },
      error: status.error
    };
  }

  try {
    const [departments, teams, staff] = await Promise.all([
      db.getDepartments(),
      db.getTeams(),
      db.getStaff()
    ]);
    return { data: { departments, teams, staff }, error: null };
  } catch (err) {
    console.error('Reference data lookup failed:', err.message);
    return {
      data: { departments: [], teams: [], staff: [] },
      error: err.message
    };
  }
}

// Helper: build recurrence object based on the selected type.
function normalizeRecurrence(recurrence) {
  const type = recurrence.type;
  const normalized = { type };

  switch (type) {
    case 'daily':
      normalized.daily = { intervalDays: Number(recurrence.daily?.intervalDays || 0) };
      break;
    case 'weekly':
      normalized.weekly = {
        intervalWeeks: Number(recurrence.weekly?.intervalWeeks || 0),
        dayOfWeek: Number(recurrence.weekly?.dayOfWeek ?? 0)
      };
      break;
    case 'monthly':
      normalized.monthly = {
        intervalMonths: Number(recurrence.monthly?.intervalMonths || 0),
        dayOfMonth: Number(recurrence.monthly?.dayOfMonth || 0)
      };
      break;
    case 'quarterly':
      normalized.quarterly = { useFirstDayOfQuarter: true };
      break;
    case 'yearly':
      normalized.yearly = {
        month: Number(recurrence.yearly?.month || 0),
        day: Number(recurrence.yearly?.day || 0)
      };
      break;
    case 'custom':
      normalized.custom = {
        startDate: recurrence.custom?.startDate,
        intervalDays: Number(recurrence.custom?.intervalDays || 0)
      };
      break;
    default:
      break;
  }

  return normalized;
}

// Validation helper for template payloads.
function validateTemplatePayload(body) {
  const errors = [];
  const requiredFields = ['title', 'clientId', 'departmentId', 'assignee', 'firstDueDate', 'recurrence'];
  requiredFields.forEach((field) => {
    if (!body[field]) {
      errors.push(`${field} is required.`);
    }
  });

  const deptId = Number(body.departmentId);
  if (!Number.isInteger(deptId)) {
    errors.push('departmentId must be a valid integer.');
  }

  const daysBefore = Number(body.daysBeforeDueDateToCreate ?? 0);
  if (!Number.isInteger(daysBefore) || daysBefore < 0) {
    errors.push('daysBeforeDueDateToCreate must be an integer greater than or equal to 0.');
  }

  if (!body.assignee || !['staff', 'team'].includes(body.assignee.type)) {
    errors.push('assignee.type must be either "staff" or "team".');
  }

  if (!body.assignee || Number.isNaN(Number(body.assignee.id))) {
    errors.push('assignee.id must be provided.');
  }

  if (!body.recurrence || !body.recurrence.type) {
    errors.push('recurrence.type is required.');
  } else {
    const validTypes = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom'];
    if (!validTypes.includes(body.recurrence.type)) {
      errors.push('recurrence.type is not supported.');
    }
  }

  const recurrence = body.recurrence || {};
  switch (recurrence.type) {
    case 'daily':
      if (!recurrence.daily || Number(recurrence.daily.intervalDays) < 1) {
        errors.push('Daily recurrence requires intervalDays >= 1.');
      }
      break;
    case 'weekly':
      if (!recurrence.weekly || Number(recurrence.weekly.intervalWeeks) < 1) {
        errors.push('Weekly recurrence requires intervalWeeks >= 1.');
      }
      if (recurrence.weekly && (recurrence.weekly.dayOfWeek < 0 || recurrence.weekly.dayOfWeek > 6)) {
        errors.push('Weekly recurrence dayOfWeek must be between 0 and 6.');
      }
      break;
    case 'monthly':
      if (!recurrence.monthly || Number(recurrence.monthly.intervalMonths) < 1) {
        errors.push('Monthly recurrence requires intervalMonths >= 1.');
      }
      if (recurrence.monthly && (recurrence.monthly.dayOfMonth < 1 || recurrence.monthly.dayOfMonth > 31)) {
        errors.push('Monthly recurrence dayOfMonth must be between 1 and 31.');
      }
      break;
    case 'quarterly':
      break;
    case 'yearly':
      if (!recurrence.yearly || Number(recurrence.yearly.month) < 1 || Number(recurrence.yearly.month) > 12) {
        errors.push('Yearly recurrence month must be between 1 and 12.');
      }
      if (!recurrence.yearly || Number(recurrence.yearly.day) < 1 || Number(recurrence.yearly.day) > 31) {
        errors.push('Yearly recurrence day must be between 1 and 31.');
      }
      break;
    case 'custom':
      if (!recurrence.custom || !recurrence.custom.startDate) {
        errors.push('Custom recurrence requires a startDate.');
      }
      if (!recurrence.custom || Number(recurrence.custom.intervalDays) < 1) {
        errors.push('Custom recurrence requires intervalDays >= 1.');
      }
      break;
    default:
      break;
  }

  return errors;
}

function isHexColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(value || '');
}

// Page routes
app.get('/', (req, res) => res.redirect('/templates'));

app.get('/calendar', async (req, res) => {
  const [clients, reference, settings] = await Promise.all([
    clientsStore.getAll(),
    loadReferenceData(),
    settingsStore.getSettings()
  ]);

  res.render('calendar', {
    title: 'Calendar',
    clients,
    referenceData: reference.data,
    dbError: reference.error,
    settings
  });
});

app.get('/clients', async (req, res) => {
  const clients = await clientsStore.getAll();
  res.render('clients', { title: 'Clients', clients });
});

app.get('/settings', async (req, res) => {
  const settings = await settingsStore.getSettings();
  res.render('settings', { title: 'Settings', settings, errors: [], message: null });
});

app.post('/settings', async (req, res) => {
  const current = await settingsStore.getSettings();
  const errors = [];

  const colors = {
    openTaskDue: (req.body.color_openTaskDue || current.calendar.colors.openTaskDue || '').trim(),
    futureCreation: (req.body.color_futureCreation || current.calendar.colors.futureCreation || '').trim(),
    futureDue: (req.body.color_futureDue || current.calendar.colors.futureDue || '').trim()
  };

  Object.entries(colors).forEach(([key, value]) => {
    if (!isHexColor(value)) {
      errors.push(`${key} must be a 6-character hex color like #ff0000.`);
    }
  });

  const timezone = (req.body.timezone || current.calendar.timezone || '').trim();
  if (!timezone) {
    errors.push('Timezone is required.');
  }

  const horizonDays = Number.parseInt(req.body.horizonDays, 10);
  if (Number.isNaN(horizonDays) || horizonDays < 0) {
    errors.push('horizonDays must be a non-negative integer.');
  }

  const osticketBaseUrl = (req.body.osticketBaseUrl || '').trim();
  if (!osticketBaseUrl || !/^https?:\/\//i.test(osticketBaseUrl)) {
    errors.push('osticketBaseUrl must be a valid http(s) URL.');
  }

  const taskUrlPattern = (req.body.taskUrlPattern || current.taskUrlPattern || '').trim();
  if (!taskUrlPattern.includes('{taskId}')) {
    errors.push('taskUrlPattern must include {taskId}.');
  }

  const nextSettings = {
    ...current,
    osticketBaseUrl,
    taskUrlPattern,
    calendar: {
      ...current.calendar,
      colors,
      timezone,
      horizonDays
    }
  };

  if (errors.length) {
    return res.status(400).render('settings', {
      title: 'Settings',
      settings: nextSettings,
      errors,
      message: null
    });
  }

  const saved = await settingsStore.saveSettings(nextSettings);
  res.render('settings', { title: 'Settings', settings: saved, errors: [], message: 'Settings updated successfully.' });
});

app.get('/templates', async (req, res) => {
  const clientFilter = req.query.clientId || '';
  const [clients, templates] = await Promise.all([
    clientsStore.getAll(),
    templatesStore.getAll()
  ]);
  const filteredTemplates = clientFilter
    ? templates.filter((t) => t.clientId === clientFilter)
    : templates;
  const reference = await loadReferenceData();

  res.render('templates', {
    title: 'Task Templates',
    clients,
    templates: filteredTemplates,
    clientFilter,
    referenceData: reference.data,
    dbError: reference.error
  });
});

app.get('/templates/new', async (req, res) => {
  const clients = await clientsStore.getAll();
  const reference = await loadReferenceData();
  res.render('template-form', {
    title: 'New Template',
    mode: 'create',
    template: null,
    clients,
    referenceData: reference.data,
    dbError: reference.error
  });
});

app.get('/templates/:id/edit', async (req, res) => {
  const template = await templatesStore.getById(req.params.id);
  if (!template) {
    return res.status(404).send('Template not found');
  }
  const clients = await clientsStore.getAll();
  const reference = await loadReferenceData();
  res.render('template-form', {
    title: 'Edit Template',
    mode: 'edit',
    template,
    clients,
    referenceData: reference.data,
    dbError: reference.error
  });
});

app.get('/api/calendar/events', async (req, res) => {
  const { start, end } = req.query;
  const settings = await settingsStore.getSettings();
  if (!start || !end || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    return res.status(400).json({ error: 'Invalid start/end query params.', events: [] });
  }

  const allowedLayers = ['openDue', 'futureCreation', 'futureDue'];
  const requestedLayers = (req.query.layers || '')
    .split(',')
    .map((l) => l.trim())
    .filter((l) => allowedLayers.includes(l));

  const defaults = settings.calendar?.defaults || {};
  const defaultLayers = [];
  if (defaults.showOpenTaskDue) defaultLayers.push('openDue');
  if (defaults.showFutureCreation) defaultLayers.push('futureCreation');
  if (defaults.showFutureDue) defaultLayers.push('futureDue');
  const layers = requestedLayers.length ? requestedLayers : defaultLayers.length ? defaultLayers : allowedLayers;

  const assigneeType = req.query.assigneeType || '';
  const assigneeId = req.query.assigneeId;
  if (assigneeType && !['staff', 'team'].includes(assigneeType)) {
    return res.status(400).json({ error: 'Invalid assigneeType.', events: [] });
  }
  if (assigneeId && !assigneeType) {
    return res.status(400).json({ error: 'assigneeType is required when assigneeId is provided.', events: [] });
  }

  try {
    const events = await calendarService.getCalendarEvents({
      start,
      end,
      layers,
      clientId: req.query.clientId,
      assigneeType: assigneeType || undefined,
      assigneeId
    });
    res.json(events);
  } catch (err) {
    console.error('Calendar events failed:', err.message);
    res.status(500).json([]);
  }
});

// API routes for osTicket lookup data
app.get('/api/departments', async (req, res) => {
  try {
    const departments = await db.getDepartments();
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teams', async (req, res) => {
  try {
    const teams = await db.getTeams();
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/staff', async (req, res) => {
  try {
    const staff = await db.getStaff();
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Client CRUD API
app.get('/api/clients', async (req, res) => {
  const clients = await clientsStore.getAll();
  res.json(clients);
});

app.post('/api/clients', async (req, res) => {
  const { name, notes } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const client = await clientsStore.create({ name, notes });
  res.status(201).json(client);
});

app.put('/api/clients/:id', async (req, res) => {
  const { name, notes } = req.body;
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: 'Name cannot be empty.' });
  }
  const updated = await clientsStore.update(req.params.id, { name, notes });
  if (!updated) {
    return res.status(404).json({ error: 'Client not found.' });
  }
  res.json(updated);
});

app.delete('/api/clients/:id', async (req, res) => {
  const templates = await templatesStore.getAll();
  const inUse = templates.some((template) => template.clientId === req.params.id);
  if (inUse) {
    return res.status(400).json({ error: 'Client is referenced by existing templates and cannot be deleted.' });
  }
  const removed = await clientsStore.remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Client not found.' });
  }
  res.json({ success: true });
});

// Template CRUD API
app.get('/api/templates', async (req, res) => {
  const { clientId } = req.query;
  const templates = await templatesStore.getAll();
  const filtered = clientId ? templates.filter((t) => t.clientId === clientId) : templates;
  res.json(filtered);
});

app.get('/api/templates/:id', async (req, res) => {
  const template = await templatesStore.getById(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json(template);
});

app.post('/api/templates', async (req, res) => {
  const errors = validateTemplatePayload(req.body);
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const payload = {
    title: req.body.title,
    description: req.body.description || '',
    clientId: req.body.clientId,
    departmentId: Number(req.body.departmentId),
    assignee: {
      type: req.body.assignee.type,
      id: Number(req.body.assignee.id)
    },
    firstDueDate: req.body.firstDueDate,
    daysBeforeDueDateToCreate: Number(req.body.daysBeforeDueDateToCreate ?? 0),
    recurrence: normalizeRecurrence(req.body.recurrence)
  };

  const created = await templatesStore.create(payload);
  res.status(201).json(created);
});

app.put('/api/templates/:id', async (req, res) => {
  const errors = validateTemplatePayload(req.body);
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const payload = {
    title: req.body.title,
    description: req.body.description || '',
    clientId: req.body.clientId,
    departmentId: Number(req.body.departmentId),
    assignee: {
      type: req.body.assignee.type,
      id: Number(req.body.assignee.id)
    },
    firstDueDate: req.body.firstDueDate,
    daysBeforeDueDateToCreate: Number(req.body.daysBeforeDueDateToCreate ?? 0),
    recurrence: normalizeRecurrence(req.body.recurrence)
  };

  const updated = await templatesStore.update(req.params.id, payload);
  if (!updated) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json(updated);
});

app.delete('/api/templates/:id', async (req, res) => {
  const removed = await templatesStore.remove(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Template not found.' });
  }
  res.json({ success: true });
});

app.use((err, req, res, next) => {
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`osTicket Task Creator listening on http://localhost:${PORT}`);
});
