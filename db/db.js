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

function formatDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function nextTaskNumber() {
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  const now = Date.now().toString().slice(-8);
  return `T${now}${random}`;
}

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

async function createTaskFromTemplate({ template, dueDate, creationDate }) {
  assertReady();
  const connection = await pool.getConnection();

  try {
    const [columnsResult] = await connection.query('SHOW COLUMNS FROM ost_task');
    const availableColumns = new Set(columnsResult.map((col) => col.Field));

    const payload = {};
    if (availableColumns.has('number')) payload.number = nextTaskNumber();
    if (availableColumns.has('dept_id')) payload.dept_id = template.departmentId ?? null;
    if (availableColumns.has('staff_id') && template.assignee?.type === 'staff') {
      payload.staff_id = template.assignee.id;
    }
    if (availableColumns.has('team_id') && template.assignee?.type === 'team') {
      payload.team_id = template.assignee.id;
    }
    if (availableColumns.has('title')) payload.title = template.title;
    if (availableColumns.has('duedate') && dueDate) payload.duedate = formatDateTime(dueDate);
    if (availableColumns.has('est_duedate') && dueDate) payload.est_duedate = formatDateTime(dueDate);

    const createdAt = formatDateTime(creationDate || new Date());
    if (availableColumns.has('created')) payload.created = createdAt;
    if (availableColumns.has('updated')) payload.updated = createdAt;

    if (!Object.keys(payload).length) {
      throw new Error('Could not determine suitable columns for ost_task insert.');
    }

    const [result] = await connection.query('INSERT INTO ost_task SET ?', payload);

    return { taskId: result.insertId, data: payload };
  } catch (err) {
    throw new Error('Failed to create task from template: ' + err.message);
  } finally {
    connection.release();
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
