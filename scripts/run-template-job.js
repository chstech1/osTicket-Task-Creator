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
const mysql = require('mysql2/promise');
const templatesStore = require('../data/templatesStore');
const fileStore = require('../data/fileStore');
const clientsStore = require('../data/clientsStore');
const db = require('../db/db');
const dbConfig = require('../db/config.json');

const pool = mysql.createPool({
  ...dbConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const MAIN_TASK_FORM_ID = 5;
const TITLE_FIELD_ID = 32;
const DESCRIPTION_FIELD_ID = 33;

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

function toDateTimeString(date) {
  if (!date) return null;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

function logQuery(logFn, sql, params) {
  const trimmed = sql.replace(/\s+/g, ' ').trim();
  const paramLog = Array.isArray(params) && params.length ? ` | params: ${JSON.stringify(params)}` : '';
  logFn(`[sql] ${trimmed}${paramLog}`);
}

async function fetchStaff(conn, staffId, logFn = console.log) {
  if (!staffId) return null;
  const sql = 'SELECT staff_id, firstname, lastname, username FROM ost_staff WHERE staff_id = ? LIMIT 1';
  logQuery(logFn, sql, [staffId]);
  const [rows] = await conn.query(sql, [staffId]);
  return rows[0] || null;
}

function buildPoster(staff) {
  if (!staff) return 'System';
  const name = `${staff.firstname || ''} ${staff.lastname || ''}`.trim() || staff.username || 'Staff';
  return staff.username ? `${name} [${staff.username}]` : name;
}

async function createTaskFromTemplate({ template, dueDate, creationDate, log = console.log }) {
  if (typeof db.getStatus === 'function') {
    const status = db.getStatus();
    if (status.hasError) {
      throw new Error(`Database unavailable: ${status.error}`);
    }
  }

  const staffId = template.assignee?.type === 'staff' ? Number(template.assignee.id) || 0 : 0;
  const teamId = template.assignee?.type === 'team' ? Number(template.assignee.id) || 0 : 0;
  const createdAt = creationDate ? toDateTimeString(creationDate) : toDateTimeString(new Date());
  const dueAt = dueDate ? toDateTimeString(dueDate) : null;

  const conn = await pool.getConnection();

  try {
    log('[sql] BEGIN');
    await conn.beginTransaction();

    const staff = await fetchStaff(conn, staffId, log);
    const staffPoster = buildPoster(staff);
    const staffUsername = staff?.username || null;

    let sql = 'SELECT * FROM ost_sequence WHERE id = ? FOR UPDATE';
    logQuery(log, sql, [2]);
    const [seqRows] = await conn.query(sql, [2]);
    if (!seqRows.length) {
      throw new Error('Task sequence (id=2) is missing.');
    }
    const taskNumber = seqRows[0].next;
    sql = 'UPDATE ost_sequence SET next = ?, updated = NOW() WHERE id = ? LIMIT 1';
    logQuery(log, sql, [taskNumber + 1, 2]);
    await conn.query(sql, [taskNumber + 1, 2]);

    sql =
      `INSERT INTO ost_task (object_id, object_type, number, dept_id, staff_id, team_id, flags, duedate, closed, created, updated)
       VALUES (0, 'A', ?, ?, ?, ?, 1, ?, NULL, ?, ?)`;
    logQuery(log, sql, [
      String(taskNumber),
      Number(template.departmentId) || 0,
      staffId || 0,
      teamId || 0,
      dueAt,
      createdAt,
      createdAt
    ]);
    const [taskResult] = await conn.query(sql, [
      String(taskNumber),
      Number(template.departmentId) || 0,
      staffId || 0,
      teamId || 0,
      dueAt,
      createdAt,
      createdAt
    ]);
    const taskId = taskResult.insertId;

    sql =
      `INSERT INTO ost_form_entry (form_id, sort, created, updated, object_type, object_id)
       VALUES (?, 1, NOW(), NOW(), 'A', ?)`;
    logQuery(log, sql, [MAIN_TASK_FORM_ID, taskId]);
    const [formEntryResult] = await conn.query(sql, [MAIN_TASK_FORM_ID, taskId]);
    const formEntryId = formEntryResult.insertId;

    sql = `INSERT INTO ost_form_entry_values (field_id, value, entry_id) VALUES (?, ?, ?)`;
    logQuery(log, sql, [TITLE_FIELD_ID, template.title || '', formEntryId]);
    await conn.query(sql, [TITLE_FIELD_ID, template.title || '', formEntryId]);
    logQuery(log, sql, [DESCRIPTION_FIELD_ID, template.description || '', formEntryId]);
    await conn.query(sql, [DESCRIPTION_FIELD_ID, template.description || '', formEntryId]);

    sql =
      `INSERT INTO ost_task__cdata (task_id, title)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title)`;
    logQuery(log, sql, [taskId, template.title || '']);
    await conn.query(sql, [taskId, template.title || '']);

    sql = `INSERT INTO ost_thread (object_id, object_type, created) VALUES (?, 'A', NOW())`;
    logQuery(log, sql, [taskId]);
    const [threadResult] = await conn.query(sql, [taskId]);
    const threadId = threadResult.insertId;

    sql =
      `INSERT INTO ost_thread_entry (created, updated, type, thread_id, format, staff_id, poster, title, body, flags)
       VALUES (NOW(), NOW(), 'M', ?, 'html', ?, ?, ?, ?, 0)`;
    logQuery(log, sql, [threadId, staffId || 0, staffPoster, template.title || '', template.description || '']);
    const [entryResult] = await conn.query(sql, [threadId, staffId || 0, staffPoster, template.title || '', template.description || '']);
    const threadEntryId = entryResult.insertId;

    sql = `REPLACE INTO ost__search (object_type, object_id, content, title) VALUES ('H', ?, ?, ?)`;
    logQuery(log, sql, [threadEntryId, template.description || '', template.title || '']);
    await conn.query(sql, [threadEntryId, template.description || '', template.title || '']);

    const creationEventData = JSON.stringify({ type: 'task.created', title: template.title || '' });
    sql =
      `INSERT INTO ost_thread_event (thread_id, thread_type, staff_id, team_id, uid_type, uid, username, timestamp, data)
       VALUES (?, 'A', ?, ?, 'S', ?, ?, NOW(), ?)`;
    logQuery(log, sql, [threadId, staffId || null, teamId || 0, staffId || null, staffUsername, creationEventData]);
    await conn.query(sql, [threadId, staffId || null, teamId || 0, staffId || null, staffUsername, creationEventData]);

    const assignEventData = JSON.stringify({ type: 'task.assigned', assignee: staffId || null });
    logQuery(log, sql, [threadId, staffId || null, teamId || 0, staffId || null, staffUsername, assignEventData]);
    await conn.query(sql, [threadId, staffId || null, teamId || 0, staffId || null, staffUsername, assignEventData]);

    if (staffId) {
      sql = 'UPDATE ost_task SET staff_id = ? WHERE id = ? LIMIT 1';
      logQuery(log, sql, [staffId, taskId]);
      await conn.query(sql, [staffId, taskId]);
    }

    log('[sql] COMMIT');
    await conn.commit();

    console.log(`Created task ${taskNumber} with id ${taskId}`);
    return {
      taskId,
      taskNumber,
      data: {
        sequence: { next: taskNumber },
        task: { id: taskId, number: taskNumber, dept_id: template.departmentId, staff_id: staffId, team_id: teamId, duedate: dueAt },
        formEntryId,
        threadId,
        threadEntryId
      }
    };
  } catch (err) {
    log('[sql] ROLLBACK');
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
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
    const isSql = args.some((arg) => typeof arg === 'string' && arg.includes('[sql]'));
    if (isSql || verbose) {
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
      const { taskId, data } = await createTaskFromTemplate({
        template,
        dueDate: match.dueDate,
        creationDate: match.creationDate,
        log: scopedLog
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
