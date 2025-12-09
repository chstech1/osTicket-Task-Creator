const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fileStore = require('./fileStore');

const filePath = path.join(__dirname, 'clients.json');
fileStore.ensureFileSync(filePath);

async function getAll() {
  return fileStore.readJson(filePath);
}

async function getById(id) {
  const clients = await getAll();
  return clients.find((client) => client.id === id) || null;
}

async function create(payload) {
  const clients = await getAll();
  const now = new Date().toISOString();
  const client = {
    id: uuidv4(),
    name: payload.name.trim(),
    notes: payload.notes ? payload.notes.trim() : '',
    createdAt: now,
    updatedAt: now
  };
  clients.push(client);
  await fileStore.writeJson(filePath, clients);
  return client;
}

async function update(id, payload) {
  const clients = await getAll();
  const index = clients.findIndex((client) => client.id === id);
  if (index === -1) return null;

  const updated = { ...clients[index] };
  if (payload.name) {
    updated.name = payload.name.trim();
  }
  if (payload.notes !== undefined) {
    updated.notes = typeof payload.notes === 'string' ? payload.notes.trim() : '';
  }
  updated.updatedAt = new Date().toISOString();
  clients[index] = updated;
  await fileStore.writeJson(filePath, clients);
  return updated;
}

async function remove(id) {
  const clients = await getAll();
  const index = clients.findIndex((client) => client.id === id);
  if (index === -1) return false;
  clients.splice(index, 1);
  await fileStore.writeJson(filePath, clients);
  return true;
}

module.exports = {
  getAll,
  getById,
  create,
  update,
  remove
};
