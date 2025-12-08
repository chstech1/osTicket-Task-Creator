const tableBody = document.querySelector('#clientsTable tbody');
const alertBox = document.querySelector('#clientAlert');
const formCard = document.querySelector('#clientFormCard');
const form = document.querySelector('#clientForm');
const formTitle = document.querySelector('#clientFormTitle');
const clientName = document.querySelector('#clientName');
const clientNotes = document.querySelector('#clientNotes');
const clientIdInput = document.querySelector('#clientId');
const addBtn = document.querySelector('#addClientBtn');
const cancelBtn = document.querySelector('#cancelClientBtn');

let clients = clientsData || [];

function showAlert(message, type = 'info') {
  alertBox.textContent = message;
  alertBox.className = `alert alert-${type}`;
  alertBox.classList.remove('d-none');
}

function hideAlert() {
  alertBox.classList.add('d-none');
}

function renderTable() {
  tableBody.innerHTML = '';
  clients.forEach((client) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${client.name}</td>
      <td>${client.notes || ''}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-2" data-action="edit" data-id="${client.id}">Edit</button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${client.id}">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });
}

function openForm(client = null) {
  form.reset();
  if (client) {
    formTitle.textContent = 'Edit Client';
    clientName.value = client.name;
    clientNotes.value = client.notes || '';
    clientIdInput.value = client.id;
  } else {
    formTitle.textContent = 'Add Client';
    clientIdInput.value = '';
  }
  formCard.classList.remove('d-none');
}

function closeForm() {
  formCard.classList.add('d-none');
  form.reset();
  clientIdInput.value = '';
}

addBtn.addEventListener('click', () => openForm());
cancelBtn.addEventListener('click', closeForm);

tableBody.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const id = event.target.dataset.id;
  if (!action || !id) return;

  if (action === 'edit') {
    const client = clients.find((c) => c.id === id);
    openForm(client);
  }

  if (action === 'delete') {
    if (!confirm('Delete this client?')) return;
    try {
      const response = await fetch(`/api/clients/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        showAlert(data.error || 'Unable to delete client', 'danger');
        return;
      }
      clients = clients.filter((c) => c.id !== id);
      renderTable();
      showAlert('Client deleted.', 'success');
    } catch (err) {
      showAlert('Unexpected error deleting client.', 'danger');
    }
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideAlert();
  const payload = {
    name: clientName.value.trim(),
    notes: clientNotes.value.trim()
  };
  const id = clientIdInput.value;
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/clients/${id}` : '/api/clients';

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || 'Validation error', 'danger');
      return;
    }
    if (id) {
      clients = clients.map((c) => (c.id === id ? data : c));
      showAlert('Client updated.', 'success');
    } else {
      clients.push(data);
      showAlert('Client created.', 'success');
    }
    renderTable();
    closeForm();
  } catch (err) {
    showAlert('Unexpected error saving client.', 'danger');
  }
});

renderTable();
