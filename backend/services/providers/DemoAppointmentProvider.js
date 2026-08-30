/**
 * Demo/mock AppointmentProvider — the only implementation that exists
 * today. Availability is generated on the fly (see
 * services/availabilityService.js); bookings are real MongoDB documents
 * via AppointmentRepository, so a booking made through this app really
 * does persist and really does reduce future availability, but nothing
 * here talks to an actual practice's real-world calendar or PMS.
 */

const AppointmentProvider = require('./AppointmentProvider');
const availabilityService = require('../availabilityService');
const appointmentRepository = require('../../repositories/AppointmentRepository');

class DemoAppointmentProvider extends AppointmentProvider {
  async getAvailability(practice, date) {
    let bookedTimes = [];
    try {
      const existing = await appointmentRepository.findByDate(practice.practiceId, date);
      bookedTimes = existing.map((a) => a.time).filter(Boolean);
    } catch (err) {
      // A down/unreachable DB should degrade to mock-only availability,
      // not fail the whole request — see server.js bufferCommands note.
      console.error('DemoAppointmentProvider: DB lookup failed, falling back to mock-only:', err.message);
    }

    return {
      date,
      isOpen: availabilityService.isOpenDay(practice, date),
      slots: availabilityService.getAvailableSlots(practice, date, { bookedTimes }),
    };
  }

  getAvailableDates(practice, count) {
    return availabilityService.nextOpenDates(practice, count);
  }

  async createAppointment(practice, data) {
    return appointmentRepository.create(practice.practiceId, data);
  }

  async rescheduleAppointment(practice, id, { date, time }) {
    return appointmentRepository.update(practice.practiceId, id, {
      ...(date ? { date } : {}),
      ...(time ? { time } : {}),
      status: 'Rescheduled',
    });
  }

  async cancelAppointment(practice, id) {
    return appointmentRepository.update(practice.practiceId, id, { status: 'Cancelled' });
  }

  async getAppointment(practice, id) {
    return appointmentRepository.findById(practice.practiceId, id);
  }

  async searchAppointments(practice, phone) {
    return appointmentRepository.findByPhone(practice.practiceId, phone);
  }

  async getAllAppointments(practice) {
    return appointmentRepository.findAll(practice.practiceId);
  }
}

module.exports = DemoAppointmentProvider;
