document.addEventListener('DOMContentLoaded', () => {
  const calendarEl = document.getElementById('calendar');
  const clientFilter = document.getElementById('clientFilter');
  const assigneeFilter = document.getElementById('assigneeFilter');
  const alertBox = document.getElementById('calendarAlert');
  const layerCheckboxes = Array.from(document.querySelectorAll('.layer-toggle'));

  function showAlert(message) {
    if (!alertBox) return;
    if (!message) {
      alertBox.classList.add('d-none');
      alertBox.textContent = '';
      return;
    }
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
  }

  function selectedLayers() {
    const layers = layerCheckboxes.filter((cb) => cb.checked).map((cb) => cb.value);
    return layers.length ? layers : Object.entries(calendarPageData.defaultLayers)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
  }

  function buildQuery(info) {
    const params = new URLSearchParams();
    params.set('start', info.startStr);
    params.set('end', info.endStr);

    const layers = selectedLayers();
    if (layers.length) {
      params.set('layers', layers.join(','));
    }

    if (clientFilter.value) {
      params.set('clientId', clientFilter.value);
    }

    if (assigneeFilter.value) {
      const [type, id] = assigneeFilter.value.split(':');
      if (type && id) {
        params.set('assigneeType', type);
        params.set('assigneeId', id);
      }
    }

    return params.toString();
  }

  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    height: 'auto',
    headerToolbar: {
      start: 'dayGridMonth,timeGridWeek,timeGridDay',
      center: 'title',
      end: 'prev,next today'
    },
    eventSources: [
      async function (info, successCallback, failureCallback) {
        const query = buildQuery(info);
        try {
          const response = await fetch(`/api/calendar/events?${query}`);
          if (!response.ok) {
            showAlert('Unable to load events.');
            failureCallback();
            return;
          }
          const events = await response.json();
          showAlert('');
          successCallback(events);
        } catch (err) {
          console.error('Failed to fetch calendar events:', err);
          showAlert('Unable to load events.');
          failureCallback(err);
        }
      }
    ],
    eventClick: function (info) {
      const props = info.event.extendedProps || {};
      if (props.layer === 'openDue') {
        window.open(props.url, '_blank');
      } else if (props.url) {
        window.location.href = props.url;
      }
    }
  });

  calendar.render();

  layerCheckboxes.forEach((cb) => cb.addEventListener('change', () => calendar.refetchEvents()));
  if (clientFilter) {
    clientFilter.addEventListener('change', () => calendar.refetchEvents());
  }
  if (assigneeFilter) {
    assigneeFilter.addEventListener('change', () => calendar.refetchEvents());
  }
});
