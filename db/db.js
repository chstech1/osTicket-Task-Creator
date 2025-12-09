const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Column mappings kept in one place for easy adjustment if the schema differs.
const columns = {
  departmentId: 'id',
  departmentName: 'name',
  teamId: 'team_id',
  teamName: 'name',
  staffId: 'staff_id',
  staffFirst: 'firstname',
  staffLast: 'lastname'
};

const configPath = path.join(__dirname, 'config.json');
let pool;
let initError;

function loadConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Database config file missing at ${configPath}`);
  }

  const content = fs.readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error('Invalid JSON in database config: ' + err.message);
  }
}

function initializePool() {
  try {
    const config = loadConfig();
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Validate the connection once during startup.
    pool
      .getConnection()
      .then((conn) => {
        console.log('Connected to osTicket database.');
        conn.release();
      })
      .catch((err) => {
        initError = err;
        console.error('Failed to connect to osTicket database:', err.message);
      });
  } catch (err) {
    initError = err;
    console.error('Database initialization failed:', err.message);
  }
}

initializePool();

function assertReady() {
  if (initError) {
    const error = new Error(`Database unavailable: ${initError.message}`);
    error.cause = initError;
    throw error;
  }
  if (!pool) {
    throw new Error('Database pool is not initialized.');
  }
}

function toDateTimeString(input, defaultTime = '00:00:00') {
  if (!input) return null;
  const date = input instanceof Date ? input : new Date(input);
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19) || defaultTime}`;
}

async function createTaskFromTemplate({ template, dueDate, creationDate }) {
  assertReady();

  const conn = await pool.getConnection();
  const createdAt = creationDate ? toDateTimeString(creationDate) : toDateTimeString(new Date());
  const dueAt = dueDate ? toDateTimeString(dueDate) : null;
  const staffId = template.assignee?.type === 'staff' ? Number(template.assignee.id) || 0 : 0;
  const teamId = template.assignee?.type === 'team' ? Number(template.assignee.id) || 0 : 0;

  const taskPayload = {
    object_id: 0,
    object_type: 'T',
    number: `T${Date.now()}`,
    dept_id: Number(template.departmentId) || 0,
    staff_id: staffId,
    team_id: teamId,
    lock_id: 0,
    flags: 0,
    duedate: dueAt,
    closed: null,
    created: createdAt,
    updated: createdAt
  };

  const cdataPayload = {
    title: template.title || ''
  };

  try {
    await conn.beginTransaction();
    const [taskResult] = await conn.query('INSERT INTO ost_task SET ?', taskPayload);
    const taskId = taskResult.insertId;
    cdataPayload.task_id = taskId;
    await conn.query('INSERT INTO ost_task__cdata SET ?', cdataPayload);
    await conn.commit();
    return { taskId, data: { task: taskPayload, cdata: cdataPayload } };
  } catch (err) {
    await conn.rollback();
    throw new Error('Failed to create osTicket task: ' + err.message);
  } finally {
    conn.release();
  }
}

async function getDepartments() {
  assertReady();
  try {
    const [rows] = await pool.query(
      `SELECT ${columns.departmentId} AS id, ${columns.departmentName} AS name FROM ost_department ORDER BY ${columns.departmentName} ASC`
    );
    return rows;
  } catch (err) {
    throw new Error('Failed to load departments: ' + err.message);
  }
}

async function getTeams() {
  assertReady();
  try {
    const [rows] = await pool.query(
      `SELECT ${columns.teamId} AS team_id, ${columns.teamName} AS name FROM ost_team ORDER BY ${columns.teamName} ASC`
    );
    return rows.map((team) => ({
      id: team.team_id,
      name: team.name
    }));
  } catch (err) {
    throw new Error('Failed to load teams: ' + err.message);
  }
}

async function getStaff() {
  assertReady();
  try {
    const [rows] = await pool.query(
      `SELECT ${columns.staffId} AS staff_id, ${columns.staffFirst} AS firstname, ${columns.staffLast} AS lastname FROM ost_staff ORDER BY ${columns.staffLast} ASC, ${columns.staffFirst} ASC`
    );
    return rows.map((staff) => ({
      id: staff.staff_id,
      firstname: staff.firstname,
      lastname: staff.lastname,
      displayName: `${staff.firstname} ${staff.lastname}`.trim()
    }));
  } catch (err) {
    throw new Error('Failed to load staff: ' + err.message);
  }
}

function getStatus() {
  return { hasError: Boolean(initError), error: initError ? initError.message : null };
}

module.exports = {
  getDepartments,
  getTeams,
  getStaff,
  columns,
  getStatus,
  createTaskFromTemplate
};
