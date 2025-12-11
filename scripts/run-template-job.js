#!/usr/bin/env node
/**
 * Cron-friendly script that reads templates.json and determines which templates
 * should create work today based on their recurrence rules and creation lead
 * time. Matching occurrences are written directly to the osTicket database as
 * tasks (ost_task) using the configured MySQL connection. An audit trail is
 * also appended to data/generated-tasks.json for visibility.
 */
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const templatesStore = require('../data/templatesStore');
const fileStore = require('../data/fileStore');
const clientsStore = require('../data/clientsStore');
const db = require('../db/db');

const createTaskFromTemplate = db.createTaskFromTemplate;
if (typeof createTaskFromTemplate !== 'function') {
  throw new Error('Database helper is missing createTaskFromTemplate; please reinstall or update code.');
}

const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'generated-tasks.json');
fileStore.ensureFileSync(OUTPUT_PATH);

function toDateOnly(dateInput) {
  const d = typeof dateInput === 'string' ? new Date(`${dateInput}T00:00:00Z`) : dateInput;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(base, days) {
  const copy = new Date(base.valueOf());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function nextDueDate(prevDue, recurrence) {
  const type = recurrence?.type;
  const base = toDateOnly(prevDue);

  switch (type) {
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

function initialDueDate(template) {
  if (template.recurrence?.type === 'custom' && template.recurrence.custom?.startDate) {
    return toDateOnly(template.recurrence.custom.startDate);
  }
  return toDateOnly(template.firstDueDate);
}

function fastForwardDailyLike(due, today, daysBefore, intervalDays) {
  let creation = addDays(due, -daysBefore);
  const millisPerDay = 24 * 60 * 60 * 1000;

  if (creation.getTime() < today.getTime()) {
    const diffDays = Math.floor((today.getTime() - creation.getTime()) / (intervalDays * millisPerDay));
    if (diffDays > 0) {
      due = addDays(due, diffDays * intervalDays);
      creation = addDays(creation, diffDays * intervalDays);
    }
  }

  while (creation.getTime() < today.getTime()) {
    due = addDays(due, intervalDays);
    creation = addDays(creation, intervalDays);
  }

  return { due, creation };
}

function getCreationForDate(template, today, log = () => {}) {
  const recurrence = template.recurrence || {};
  const daysBefore = Math.max(0, Number(template.daysBeforeDueDateToCreate || 0));
  let due = initialDueDate(template);
  const maxIterations = 50000; // high ceiling for long-lived schedules
  let iterations = 0;

  log('Evaluating creation schedule', {
    firstDueDate: due.toISOString().slice(0, 10),
    recurrence: recurrence.type || 'none',
    daysBeforeDueDateToCreate: daysBefore
  });

  while (iterations < maxIterations) {
    const creationDate = addDays(due, -daysBefore);
    log('Iteration check', {
      dueDate: due.toISOString().slice(0, 10),
      creationDate: creationDate.toISOString().slice(0, 10)
    });

    if (creationDate.getTime() === today.getTime()) {
      log('Creation date matches today.');
      return { dueDate: due, creationDate };
    }
    if (creationDate.getTime() > today.getTime()) {
      log('Creation date is in the future; stopping evaluation.');
      return null;
    }
    if (['daily', 'custom'].includes(recurrence.type)) {
      const interval = Math.max(1, Number((recurrence.daily || recurrence.custom)?.intervalDays || 1));
      const fast = fastForwardDailyLike(due, today, daysBefore, interval);
      log('Fast-forwarded daily/custom recurrence', {
        intervalDays: interval,
        newDueDate: fast.due.toISOString().slice(0, 10)
      });
      due = fast.due;
    } else if (recurrence.type === 'weekly') {
      const intervalWeeks = Math.max(1, Number(recurrence.weekly?.intervalWeeks || 1));
      const intervalDays = intervalWeeks * 7;
      const fast = fastForwardDailyLike(due, today, daysBefore, intervalDays);
      log('Fast-forwarded weekly recurrence', {
        intervalWeeks,
        newDueDate: fast.due.toISOString().slice(0, 10)
      });
      due = fast.due;
    } else {
      const nextDue = nextDueDate(due, recurrence);
      if (!nextDue) {
        log('No next due date could be calculated; stopping evaluation.');
        return null;
      }
      if (nextDue.getTime() === due.getTime()) {
        return null; // prevent infinite loop
      }
      due = nextDue;
    }
    iterations += 1;
  }

  console.warn(`Stopped evaluating template ${template.id} after ${maxIterations} iterations.`);
  return null;
}

async function run() {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const logVerbose = (...args) => {
    if (verbose) {
      console.log('[debug]', ...args);
    }
  };

  const today = toDateOnly(new Date());
  const [templates, clients] = await Promise.all([templatesStore.getAll(), clientsStore.getAll()]);
  const existing = await fileStore.readJson(OUTPUT_PATH);
  const nowIso = new Date().toISOString();
  const created = [];
  const failed = [];
  const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

  logVerbose('Job start', {
    today: today.toISOString().slice(0, 10),
    templateCount: templates.length,
    clientCount: clients.length
  });

  for (const template of templates) {
    const scopedLog = (...args) => logVerbose(`[template ${template.id} - ${template.title}]`, ...args);
    scopedLog('Evaluating template');
    const match = getCreationForDate(template, today, scopedLog);
    if (!match) {
      scopedLog('No creation scheduled for today.');
      continue;
    }

    try {
      const { taskId, data } = await db.createTaskFromTemplate({
        template,
        dueDate: match.dueDate,
        creationDate: match.creationDate
      });

      scopedLog('Task created', {
        taskId,
        dueDate: match.dueDate.toISOString().slice(0, 10),
        creationDate: match.creationDate.toISOString().slice(0, 10)
      });

      const audit = {
        id: uuidv4(),
        taskId,
        templateId: template.id,
        title: template.title,
        clientName: clientNameById.get(template.clientId) || null,
        dueDate: match.dueDate.toISOString().slice(0, 10),
        creationDate: match.creationDate.toISOString().slice(0, 10),
        dbPayload: data,
        createdAt: nowIso
      };
      existing.push(audit);
      created.push(audit);
    } catch (err) {
      scopedLog('Failed to create task from template', err.message);
      failed.push({ templateId: template.id, title: template.title, error: err.message });
    }
  }

  if (created.length) {
    await fileStore.writeJson(OUTPUT_PATH, existing);
    console.log(`Created ${created.length} task instance(s).`);
    created.forEach((entry) => console.log(`- ${entry.title} (task ${entry.taskId}) due ${entry.dueDate}`));
  } else {
    console.log('No task templates are scheduled to create today.');
  }

  if (failed.length) {
    console.error('The following templates could not be converted into tasks:');
    failed.forEach((item) => console.error(`- ${item.title} (${item.templateId}): ${item.error}`));
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Template cron job failed:', err);
  process.exitCode = 1;
});
