const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fileStore = require('./fileStore');

const filePath = path.join(__dirname, 'templates.json');
fileStore.ensureFileSync(filePath);

async function getAll() {
  return fileStore.readJson(filePath);
}

async function getById(id) {
  const templates = await getAll();
  return templates.find((template) => template.id === id) || null;
}

async function create(payload) {
  const templates = await getAll();
  const now = new Date().toISOString();
  const template = {
    ...payload,
    id: uuidv4(),
    createdAt: now,
    updatedAt: now
  };
  templates.push(template);
  await fileStore.writeJson(filePath, templates);
  return template;
}

async function update(id, payload) {
  const templates = await getAll();
  const index = templates.findIndex((template) => template.id === id);
  if (index === -1) return null;
  const updated = {
    ...templates[index],
    ...payload,
    updatedAt: new Date().toISOString()
  };
  templates[index] = updated;
  await fileStore.writeJson(filePath, templates);
  return updated;
}

async function remove(id) {
  const templates = await getAll();
  const index = templates.findIndex((template) => template.id === id);
  if (index === -1) return false;
  templates.splice(index, 1);
  await fileStore.writeJson(filePath, templates);
  return true;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
