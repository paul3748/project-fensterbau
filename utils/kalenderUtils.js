const { DateTime } = require('luxon');

function terminLiegtImSlot(slot, event) {
  const slotStart = DateTime.fromISO(slot.start).toUTC().toMillis();
  const slotEnd = DateTime.fromISO(slot.end).toUTC().toMillis();
  const eventStart = DateTime.fromISO(event.start).toUTC().toMillis();
  const eventEnd = DateTime.fromISO(event.end).toUTC().toMillis();

  const überlappt = eventEnd > slotStart && eventStart < slotEnd;
  
  return überlappt;
}

function logWithLocalTime(label, isoStart, isoEnd) {
  const start = DateTime.fromISO(isoStart).setZone('Europe/Berlin');
  const end = DateTime.fromISO(isoEnd).setZone('Europe/Berlin');
  console.log(`🕒 ${label}: ${start.toFormat('d.M.yyyy, HH:mm:ss')} - ${end.toFormat('HH:mm:ss')}`);
}

/**
 * Filtert freie Slots anhand der maximal erlaubten Überschneidungen.
 *
 * @param {Array} slots - Alle Slots (start, end)
 * @param {Array} events - Alle Outlook-Termine (start, end)
 * @param {number} maxOverlap - Anzahl erlaubter Überschneidungen (Standard: 1, bedeutet bei 2+ wird blockiert)
 * @returns {Array} - Gefilterte freie Slots
 */
function filterFreieSlots(slots, events, maxOverlap = 1) {
  return slots.filter(slot => {
    let overlaps = 0;

    for (const event of events) {
      if (terminLiegtImSlot(slot, event)) {
        overlaps++;
      }
    }

    // Slot ist buchbar, wenn weniger als 2 Termine im Slot liegen
    // Bei maxOverlap = 1: 0-1 Termine = buchbar, 2+ Termine = blockiert
    return overlaps <= maxOverlap;
  });
}

module.exports = { filterFreieSlots };