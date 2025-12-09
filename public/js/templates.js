const templatesTableBody = document.querySelector('#templatesTable tbody');
const templateAlert = document.querySelector('#templateAlert');
const clientFilter = document.querySelector('#clientFilter');

let templates = templatesData || [];

function showAlert(message, type = 'info') {
  templateAlert.textContent = message;
  templateAlert.className = `alert alert-${type}`;
  templateAlert.classList.remove('d-none');
}

function hideAlert() {
  templateAlert.classList.add('d-none');
}

function findClient(id) {
  return clientsData.find((c) => c.id === id);
}

function findDepartment(id) {
  return referenceData.departments.find((d) => Number(d.id) === Number(id));
}

function findTeam(id) {
  return referenceData.teams.find((t) => Number(t.id) === Number(id));
}

function findStaff(id) {
  return referenceData.staff.find((s) => Number(s.id) === Number(id));
}

function renderTemplates() {
  templatesTableBody.innerHTML = '';
  templates.forEach((template) => {
    const client = findClient(template.clientId);
    const department = findDepartment(template.departmentId);
    let assigneeText = 'Unassigned';
    if (template.assignee?.type === 'staff') {
      const staff = findStaff(template.assignee.id);
      assigneeText = staff ? staff.displayName : 'Staff #' + template.assignee.id;
    } else if (template.assignee?.type === 'team') {
      const team = findTeam(template.assignee.id);
      assigneeText = team ? team.name : 'Team #' + template.assignee.id;
    }
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${template.title}</td>
      <td>${client ? client.name : 'Unknown client'}</td>
      <td>${department ? department.name : 'Unknown department'}</td>
      <td>${assigneeText}</td>
      <td>${recurrenceDescription(template.recurrence)}</td>
      <td>
        <a class="btn btn-sm btn-outline-primary me-2" href="/templates/${template.id}/edit">View / Edit</a>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${template.id}">Delete</button>
      </td>
    `;
    templatesTableBody.appendChild(row);
  });
}

async function loadTemplatesForClient(clientId) {
  hideAlert();
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
  try {
    const response = await fetch(`/api/templates${query}`);
    const data = await response.json();
    if (!response.ok) {
      showAlert(data.error || 'Failed to load templates', 'danger');
      return;
    }
    templates = data;
    renderTemplates();
  } catch (err) {
    showAlert('Unexpected error loading templates.', 'danger');
  }
}

clientFilter.addEventListener('change', (event) => {
  loadTemplatesForClient(event.target.value);
});

templatesTableBody.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const id = event.target.dataset.id;
  if (!action || !id) return;
  if (action === 'delete') {
    if (!confirm('Delete this template?')) return;
    try {
      const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) {
        showAlert(data.error || 'Unable to delete template', 'danger');
        return;
      }
      templates = templates.filter((t) => t.id !== id);
      renderTemplates();
      showAlert('Template deleted.', 'success');
    } catch (err) {
      showAlert('Unexpected error deleting template.', 'danger');
    }
  }
});

renderTemplates();
