function minutesInConfiguredTimezone() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.TIMEZONE || 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  return Number(parts.find(p => p.type === 'hour').value) * 60 + Number(parts.find(p => p.type === 'minute').value);
}

function parseClock(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || fallback);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error(`Format jam tidak valid: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWithinAccessHours() {
  const now = minutesInConfiguredTimezone();
  const start = parseClock(process.env.ACCESS_START, '07:00');
  const end = parseClock(process.env.ACCESS_END, '21:00');
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

module.exports = { isWithinAccessHours };
