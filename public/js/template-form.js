const form = document.querySelector('#templateForm');
const alertBox = document.querySelector('#formAlert');
const departmentSelect = document.querySelector('#departmentId');
const assigneeWrapper = document.querySelector('#assigneeSelectWrapper');
const recurrenceTypeSelect = document.querySelector('#recurrenceType');
const recurrenceFields = document.querySelector('#recurrenceFields');

function showAlert(message, type = 'danger') {
  alertBox.textContent = message;
  alertBox.className = `alert alert-${type}`;
  alertBox.classList.remove('d-none');
}

function clearAlert() {
  alertBox.classList.add('d-none');
}

function buildOption(value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function populateDepartments(list) {
  departmentSelect.innerHTML = '';
  departmentSelect.appendChild(buildOption('', 'Select department'));
  list.forEach((dept) => {
    departmentSelect.appendChild(buildOption(dept.id, dept.name));
  });
}

function renderAssigneeSelect(type) {
  assigneeWrapper.innerHTML = '';
  const select = document.createElement('select');
  select.className = 'form-select';
  select.id = 'assigneeId';
  select.required = true;
  const placeholder = type === 'staff' ? 'Select staff' : 'Select team';
  select.appendChild(buildOption('', placeholder));
  const list = type === 'staff' ? referenceData.staff : referenceData.teams;
  list.forEach((item) => {
    select.appendChild(buildOption(item.id, type === 'staff' ? item.displayName : item.name));
  });
  assigneeWrapper.appendChild(select);
}

function renderRecurrenceFields(type, data = {}) {
  let html = '';
  switch (type) {
    case 'daily':
      html = `
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label" for="dailyInterval">Every X days</label>
            <input class="form-control" type="number" min="1" id="dailyInterval" value="${data.intervalDays || ''}" required />
          </div>
        </div>`;
      break;
    case 'weekly':
      html = `
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label" for="weeklyInterval">Every X weeks</label>
            <input class="form-control" type="number" min="1" id="weeklyInterval" value="${data.intervalWeeks || ''}" required />
          </div>
          <div class="col-md-4">
            <label class="form-label" for="weeklyDay">Day of week</label>
            <select class="form-select" id="weeklyDay" required>
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
              <option value="6">Saturday</option>
            </select>
          </div>
        </div>`;
      break;
    case 'monthly':
      html = `
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label" for="monthlyInterval">Every X months</label>
            <input class="form-control" type="number" min="1" id="monthlyInterval" value="${data.intervalMonths || ''}" required />
          </div>
          <div class="col-md-4">
            <label class="form-label" for="monthlyDay">On day</label>
            <input class="form-control" type="number" min="1" max="31" id="monthlyDay" value="${data.dayOfMonth || ''}" required />
          </div>
        </div>`;
      break;
    case 'quarterly':
      html = `<div class="alert alert-info">First day of each quarter (Jan 1, Apr 1, Jul 1, Oct 1).</div>`;
      break;
    case 'yearly':
      html = `
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label" for="yearlyMonth">Month</label>
            <select class="form-select" id="yearlyMonth" required>
              <option value="1">January</option>
              <option value="2">February</option>
              <option value="3">March</option>
              <option value="4">April</option>
              <option value="5">May</option>
              <option value="6">June</option>
              <option value="7">July</option>
              <option value="8">August</option>
              <option value="9">September</option>
              <option value="10">October</option>
              <option value="11">November</option>
              <option value="12">December</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label" for="yearlyDay">Day of month</label>
            <input class="form-control" type="number" min="1" max="31" id="yearlyDay" value="${data.day || ''}" required />
          </div>
        </div>`;
      break;
    case 'custom':
      html = `
        <div class="row g-3">
          <div class="col-md-4">
            <label class="form-label" for="customStart">Start date</label>
            <input class="form-control" type="date" id="customStart" value="${data.startDate || ''}" required />
          </div>
          <div class="col-md-4">
            <label class="form-label" for="customInterval">Repeat every X days</label>
            <input class="form-control" type="number" min="1" id="customInterval" value="${data.intervalDays || ''}" required />
          </div>
        </div>`;
      break;
    default:
      break;
  }
  recurrenceFields.innerHTML = html;
  // Apply saved values for select fields
  if (type === 'weekly' && data.dayOfWeek !== undefined) {
    document.querySelector('#weeklyDay').value = data.dayOfWeek;
  }
  if (type === 'yearly' && data.month !== undefined) {
    document.querySelector('#yearlyMonth').value = data.month;
  }
}

function hydrateForm() {
  if (!templateData) return;
  document.querySelector('#title').value = templateData.title;
  document.querySelector('#description').value = templateData.description || '';
  document.querySelector('#clientId').value = templateData.clientId;
  document.querySelector('#firstDueDate').value = templateData.firstDueDate;
  document.querySelector('#daysBefore').value = templateData.daysBeforeDueDateToCreate;
  const typeRadio = document.querySelector(`input[name="assigneeType"][value="${templateData.assignee.type}"]`);
  if (typeRadio) typeRadio.checked = true;
  renderAssigneeSelect(templateData.assignee.type);
  const assigneeSelect = document.querySelector('#assigneeId');
  assigneeSelect.value = templateData.assignee.id;
  departmentSelect.value = templateData.departmentId;
  recurrenceTypeSelect.value = templateData.recurrence.type;
  renderRecurrenceFields(templateData.recurrence.type, templateData.recurrence[templateData.recurrence.type] || {});
}

function loadReferenceLists() {
  // If server supplied empty lists (e.g., DB offline), try to fetch via API in case it recovers.
  const promises = [];
  if (!referenceData.departments.length) {
    promises.push(
      fetch('/api/departments')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) referenceData.departments = data;
        })
        .catch(() => {})
    );
  }
  if (!referenceData.staff.length) {
    promises.push(
      fetch('/api/staff')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) referenceData.staff = data;
        })
        .catch(() => {})
    );
  }
  if (!referenceData.teams.length) {
    promises.push(
      fetch('/api/teams')
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) referenceData.teams = data;
        })
        .catch(() => {})
    );
  }

  Promise.all(promises).finally(() => {
    populateDepartments(referenceData.departments);
    const selectedType = document.querySelector('input[name="assigneeType"]:checked').value;
    renderAssigneeSelect(selectedType);
    if (templateData) {
      hydrateForm();
    } else {
      renderRecurrenceFields(recurrenceTypeSelect.value);
    }
  });
}

function buildRecurrencePayload() {
  const type = recurrenceTypeSelect.value;
  const payload = { type };
  switch (type) {
    case 'daily':
      payload.daily = { intervalDays: Number(document.querySelector('#dailyInterval').value) };
      break;
    case 'weekly':
      payload.weekly = {
        intervalWeeks: Number(document.querySelector('#weeklyInterval').value),
        dayOfWeek: Number(document.querySelector('#weeklyDay').value)
      };
      break;
    case 'monthly':
      payload.monthly = {
        intervalMonths: Number(document.querySelector('#monthlyInterval').value),
        dayOfMonth: Number(document.querySelector('#monthlyDay').value)
      };
      break;
    case 'quarterly':
      payload.quarterly = { useFirstDayOfQuarter: true };
      break;
    case 'yearly':
      payload.yearly = {
        month: Number(document.querySelector('#yearlyMonth').value),
        day: Number(document.querySelector('#yearlyDay').value)
      };
      break;
    case 'custom':
      payload.custom = {
        startDate: document.querySelector('#customStart').value,
        intervalDays: Number(document.querySelector('#customInterval').value)
      };
      break;
    default:
      break;
  }
  return payload;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearAlert();
  const assigneeType = document.querySelector('input[name="assigneeType"]:checked').value;
  const assigneeId = document.querySelector('#assigneeId').value;
  const payload = {
    title: document.querySelector('#title').value.trim(),
    description: document.querySelector('#description').value.trim(),
    clientId: document.querySelector('#clientId').value,
    departmentId: document.querySelector('#departmentId').value,
    assignee: { type: assigneeType, id: assigneeId },
    firstDueDate: document.querySelector('#firstDueDate').value,
    daysBeforeDueDateToCreate: Number(document.querySelector('#daysBefore').value || 0),
    recurrence: buildRecurrencePayload()
  };

  if (!payload.title || !payload.clientId || !payload.departmentId || !assigneeId || !payload.firstDueDate) {
    showAlert('Please fill in all required fields.', 'warning');
    return;
  }

  const method = mode === 'edit' ? 'PUT' : 'POST';
  const url = mode === 'edit' && templateData ? `/api/templates/${templateData.id}` : '/api/templates';

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) {
      showAlert((data.errors && data.errors.join('\n')) || data.error || 'Validation failed.');
      return;
    }
    window.location.href = '/templates';
  } catch (err) {
    showAlert('Unexpected error saving template.');
  }
});

document.querySelectorAll('input[name="assigneeType"]').forEach((input) => {
  input.addEventListener('change', (event) => {
    renderAssigneeSelect(event.target.value);
  });
});

recurrenceTypeSelect.addEventListener('change', (event) => {
  renderRecurrenceFields(event.target.value);
});

loadReferenceLists();
