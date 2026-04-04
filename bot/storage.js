const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STORE = {
  appointments: [],
  users: {},
  feedback: [],
};

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeChain = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await fs.access(this.filePath);
    } catch {
      await this.#write(DEFAULT_STORE);
    }
  }

  async read() {
    await this.init();
    const raw = await fs.readFile(this.filePath, "utf8");
    return JSON.parse(raw);
  }

  async update(mutator) {
    const nextTask = this.writeChain.then(async () => {
      const data = await this.read();
      const result = await mutator(data);
      await this.#write(data);
      return result;
    });

    this.writeChain = nextTask.catch(() => {});
    return nextTask;
  }

  async upsertUser(user) {
    return this.update((data) => {
      const existing = data.users[user.userId] || {};
      data.users[user.userId] = {
        ...existing,
        ...user,
        updatedAt: new Date().toISOString(),
      };

      return data.users[user.userId];
    });
  }

  async addAppointment(appointment) {
    return this.update((data) => {
      data.appointments.push(appointment);
      return appointment;
    });
  }

  async getAppointment(appointmentId) {
    const data = await this.read();
    return data.appointments.find((item) => item.id === appointmentId) || null;
  }

  async getAppointmentsByUser(userId) {
    const data = await this.read();
    return data.appointments
      .filter((item) => item.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getBookedSlots(date) {
    const data = await this.read();
    return data.appointments
      .filter(
        (item) =>
          item.date === date &&
          !["rejected", "cancelled"].includes(item.status)
      )
      .map((item) => item.time);
  }

  async updateAppointment(appointmentId, updater) {
    return this.update((data) => {
      const index = data.appointments.findIndex((item) => item.id === appointmentId);

      if (index === -1) {
        return null;
      }

      const current = data.appointments[index];
      const nextState =
        typeof updater === "function" ? updater(current) : { ...current, ...updater };

      data.appointments[index] = {
        ...nextState,
        updatedAt: new Date().toISOString(),
      };

      return data.appointments[index];
    });
  }

  async getStats() {
    const data = await this.read();
    const pending = data.appointments.filter(
      (item) => item.status === "pending_review"
    ).length;
    const approved = data.appointments.filter(
      (item) => item.status === "approved"
    ).length;
    const cancelled = data.appointments.filter(
      (item) => item.status === "cancelled"
    ).length;

    return {
      totalAppointments: data.appointments.length,
      totalUsers: Object.keys(data.users).length,
      pending,
      approved,
      cancelled,
    };
  }

  async #write(data) {
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

module.exports = {
  JsonStore,
};
