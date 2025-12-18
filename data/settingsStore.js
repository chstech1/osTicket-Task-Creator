const fs = require('fs');
const path = require('path');
const fileStore = require('./fileStore');

const filePath = path.join(__dirname, 'settings.json');

const defaultSettings = {
  osticketBaseUrl: 'https://tickets.welkeptbooks.com',
  taskUrlPattern: '/scp/tasks.php?id={taskId}',
  calendar: {
    colors: {
      openTaskDue: '#0d6efd',
      closedTaskDue: '#6c757d',
      futureCreation: '#20c997',
      futureDue: '#ffc107'
    },
    defaults: {
      showOpenTaskDue: true,
      showFutureCreation: true,
      showFutureDue: true
    },
    timezone: 'America/New_York',
    horizonDays: 180,
    taskWindow: {
      pastDays: 365,
      futureDays: 365
    }
  }
};

function ensureFile() {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultSettings, null, 2), 'utf8');
  }
}

function mergeWithDefaults(settings) {
  return {
    ...defaultSettings,
    ...settings,
    calendar: {
      ...defaultSettings.calendar,
      ...(settings?.calendar || {}),
      colors: {
        ...defaultSettings.calendar.colors,
        ...(settings?.calendar?.colors || {})
      },
      defaults: {
        ...defaultSettings.calendar.defaults,
        ...(settings?.calendar?.defaults || {})
      },
      taskWindow: {
        ...defaultSettings.calendar.taskWindow,
        ...(settings?.calendar?.taskWindow || {})
      }
    }
  };
}

async function getSettings() {
  ensureFile();
  try {
    const raw = await fileStore.readJson(filePath);
    const parsed = Array.isArray(raw) ? {} : raw;
    return mergeWithDefaults(parsed);
  } catch (err) {
    console.error('Failed to load settings.json, using defaults:', err.message);
    return { ...defaultSettings };
  }
}

async function saveSettings(nextSettings) {
  ensureFile();
  const merged = mergeWithDefaults(nextSettings);
  await fileStore.writeJson(filePath, merged);
  return merged;
}

module.exports = {
  getSettings,
  saveSettings,
  defaultSettings
};
