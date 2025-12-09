/* Shared helper used by multiple pages to describe recurrence rules. */
(function () {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function recurrenceDescription(recurrence) {
    if (!recurrence || !recurrence.type) return 'Not set';
    switch (recurrence.type) {
      case 'daily':
        return `Daily every ${recurrence.daily?.intervalDays ?? '?'} day(s)`;
      case 'weekly':
        return `Weekly every ${recurrence.weekly?.intervalWeeks ?? '?'} week(s) on ${days[recurrence.weekly?.dayOfWeek ?? 0]}`;
      case 'monthly':
        return `Monthly every ${recurrence.monthly?.intervalMonths ?? '?'} month(s) on day ${recurrence.monthly?.dayOfMonth ?? '?'}`;
      case 'quarterly':
        return 'Quarterly on the first day of each quarter';
      case 'yearly':
        return `Yearly on ${recurrence.yearly?.month ?? '?'}/${recurrence.yearly?.day ?? '?'}`;
      case 'custom':
        return `Custom: start ${recurrence.custom?.startDate ?? '?'} every ${recurrence.custom?.intervalDays ?? '?'} day(s)`;
      default:
        return 'Unknown recurrence';
    }
  }

  // Expose globally for simple use in inline scripts.
  window.recurrenceDescription = recurrenceDescription;
})();
