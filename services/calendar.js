const templatesStore = require('../data/templatesStore');
const settingsStore = require('../data/settingsStore');
const db = require('../db/db');

function toDateOnly(dateInput) {
  const d = typeof dateInput === 'string' ? new Date(`${dateInput}T00:00:00Z`) : new Date(dateInput);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(date, days) {
  const copy = new Date(date.valueOf());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function startOfDayInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const year = Number(parts.year);
  const month = Number(parts.month) - 1;
  const day = Number(parts.day);
  return new Date(Date.UTC(year, month, day));
}

function nextDueDate(prevDueDate, recurrence) {
  const base = toDateOnly(prevDueDate);
  switch (recurrence?.type) {
    case 'daily': {
      const interval = Math.max(1, Number(recurrence.daily?.intervalDays || 1));
      return addDays(base, interval);
    }
    case 'weekly': {
      const intervalWeeks = Math.max(1, Number(recurrence.weekly?.intervalWeeks || 1));
      return addDays(base, intervalWeeks * 7);
    }
    case 'monthly': {
      const intervalMonths = Math.max(1, Number(recurrence.monthly?.intervalMonths || 1));
      const dayOfMonth = Number(recurrence.monthly?.dayOfMonth || base.getUTCDate());
      const year = base.getUTCFullYear();
      const month = base.getUTCMonth() + intervalMonths;
      return new Date(Date.UTC(year, month, dayOfMonth));
    }
    case 'quarterly': {
      const month = base.getUTCMonth();
      const nextQuarterStartMonth = month < 3 ? 3 : month < 6 ? 6 : month < 9 ? 9 : 12;
      const year = base.getUTCFullYear() + (nextQuarterStartMonth === 12 ? 1 : 0);
      const normalizedMonth = nextQuarterStartMonth === 12 ? 0 : nextQuarterStartMonth;
      return new Date(Date.UTC(year, normalizedMonth, 1));
    }
    case 'yearly': {
      const year = base.getUTCFullYear() + 1;
      const month = (Number(recurrence.yearly?.month || base.getUTCMonth() + 1) - 1);
      const day = Number(recurrence.yearly?.day || base.getUTCDate());
      return new Date(Date.UTC(year, month, day));
    }
    case 'custom': {
      const interval = Math.max(1, Number(recurrence.custom?.intervalDays || 1));
      return addDays(base, interval);
    }
    default:
      return null;
  }
}

function buildTaskUrl(taskId, settings) {
  const baseUrl = (settings.osticketBaseUrl || '').replace(/\/$/, '');
  const pattern = (settings.taskUrlPattern || '/scp/tasks.php?id={taskId}').replace('{taskId}', taskId);
  if (!baseUrl) return pattern;
  return pattern.startsWith('http') ? pattern : `${baseUrl}${pattern.startsWith('/') ? '' : '/'}${pattern}`;
}

function shouldIncludeClient(clientId, filterClientId) {
  if (!filterClientId) return true;
  return Boolean(clientId) && String(clientId) === String(filterClientId);
}

function templateAssignee(template, staffLookup, teamLookup) {
  if (template.assignee?.type === 'staff') {
    const staff = staffLookup.get(Number(template.assignee.id));
    return staff
      ? { type: 'staff', id: staff.id, displayName: staff.displayName }
      : { type: 'staff', id: Number(template.assignee.id), displayName: `Staff ${template.assignee.id}` };
  }
  if (template.assignee?.type === 'team') {
    const team = teamLookup.get(Number(template.assignee.id));
    return team
      ? { type: 'team', id: team.id, displayName: team.name }
      : { type: 'team', id: Number(template.assignee.id), displayName: `Team ${template.assignee.id}` };
  }
  return { type: 'none', id: null, displayName: 'Unassigned' };
}

function assigneeMatchesFilters(assignee, filterType, filterId) {
  if (!filterType && !filterId) return true;
  if (!assignee) return false;
  return assignee.type === filterType && String(assignee.id) === String(filterId);
}

async function generateTemplateEvents({ start, end, layers, clientId, assigneeType, assigneeId, settings }) {
  const [templates, reference] = await Promise.all([
    templatesStore.getAll(),
    (async () => {
      try {
        const [departments, teams, staff] = await Promise.all([
          db.getDepartments(),
          db.getTeams(),
          db.getStaff()
        ]);
        return { departments, teams, staff };
      } catch (err) {
        console.warn('Unable to load reference data for calendar:', err.message);
        return { departments: [], teams: [], staff: [] };
      }
    })()
  ]);

  const staffLookup = new Map(reference.staff.map((s) => [Number(s.id), s]));
  const teamLookup = new Map(reference.teams.map((t) => [Number(t.id), t]));
  const colorCreation = settings.calendar.colors.futureCreation;
  const colorDue = settings.calendar.colors.futureDue;

  const events = [];
  const maxIterations = 1000;

  templates.forEach((template) => {
    if (!shouldIncludeClient(template.clientId, clientId)) return;
    const assignee = templateAssignee(template, staffLookup, teamLookup);
    if (!assigneeMatchesFilters(assignee, assigneeType, assigneeId)) return;

    let dueDate = startOfDayInZone(toDateOnly(template.firstDueDate), settings.calendar.timezone);
    let iterations = 0;

    while (dueDate && dueDate < start && iterations < maxIterations) {
      dueDate = nextDueDate(dueDate, template.recurrence);
      iterations += 1;
    }

    while (dueDate && dueDate <= end && iterations < maxIterations) {
      const creationDate = addDays(dueDate, -Number(template.daysBeforeDueDateToCreate || 0));
      const dueDateStr = formatDate(dueDate);
      const creationDateStr = formatDate(creationDate);

      if (layers.futureDue && dueDate >= start) {
        events.push({
          id: `tmplDue-${template.id}-${dueDateStr}`,
          title: `${template.title} (Due)`,
          start: dueDateStr,
          allDay: true,
          backgroundColor: colorDue,
          borderColor: colorDue,
          extendedProps: {
            layer: 'futureDue',
            templateId: template.id,
            clientId: template.clientId,
            assignee,
            url: `/templates/${template.id}/edit`
          }
        });
      }

      if (layers.futureCreation && creationDate >= start && creationDate <= end) {
        events.push({
          id: `tmplCreate-${template.id}-${creationDateStr}`,
          title: `${template.title} (Create)`,
          start: creationDateStr,
          allDay: true,
          backgroundColor: colorCreation,
          borderColor: colorCreation,
          extendedProps: {
            layer: 'futureCreation',
            templateId: template.id,
            clientId: template.clientId,
            assignee,
            url: `/templates/${template.id}/edit`
          }
        });
      }

      dueDate = nextDueDate(dueDate, template.recurrence);
      iterations += 1;
      if (!dueDate) break;
    }
  });

  return events;
}

async function generateOpenTaskEvents({ layers, clientId, assigneeType, assigneeId, settings }) {
  if (!layers.openDue) return [];
  try {
    const tasks = await db.getOpenTasks();
    const color = settings.calendar.colors.openTaskDue;
    const events = tasks
      .filter((task) => {
        if (!shouldIncludeClient(task.clientId, clientId)) return false;
        if (assigneeType && assigneeId) {
          return task.assignee && task.assignee.type === assigneeType && String(task.assignee.id) === String(assigneeId);
        }
        return true;
      })
      .map((task) => {
        const dueDateStr = formatDate(toDateOnly(task.dueDate));
        return {
          id: `open-${task.taskId}`,
          title: task.title,
          start: dueDateStr,
          allDay: true,
          backgroundColor: color,
          borderColor: color,
          extendedProps: {
            layer: 'openDue',
            taskId: task.taskId,
            assignee: task.assignee,
            clientId: task.clientId,
            url: buildTaskUrl(task.taskId, settings)
          }
        };
      });
    return events;
  } catch (err) {
    console.error('Failed to load open tasks for calendar:', err.message);
    return [];
  }
}

async function getCalendarEvents(params) {
  const settings = await settingsStore.getSettings();
  const start = toDateOnly(params.start);
  const end = toDateOnly(params.end);

  const now = startOfDayInZone(new Date(), settings.calendar.timezone);
  const windowStart = addDays(now, -14);
  const windowEnd = addDays(now, Number(settings.calendar.horizonDays || 0));
  const clampedStart = start < windowStart ? windowStart : start;
  const clampedEnd = end > windowEnd ? windowEnd : end;

  const layers = {
    openDue: params.layers?.includes('openDue'),
    futureCreation: params.layers?.includes('futureCreation'),
    futureDue: params.layers?.includes('futureDue')
  };

  const [openEvents, templateEvents] = await Promise.all([
    generateOpenTaskEvents({
      layers,
      clientId: params.clientId,
      assigneeType: params.assigneeType,
      assigneeId: params.assigneeId,
      settings
    }),
    generateTemplateEvents({
      start: clampedStart,
      end: clampedEnd,
      layers,
      clientId: params.clientId,
      assigneeType: params.assigneeType,
      assigneeId: params.assigneeId,
      settings
    })
  ]);

  return [...openEvents, ...templateEvents];
}

module.exports = {
  getCalendarEvents,
  buildTaskUrl,
  startOfDayInZone,
  formatDate
};
