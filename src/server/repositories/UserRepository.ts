import { dbStore } from '../db';
import { User } from '../../types/cbt';

export class UserRepository {
  findByToken(token: string): User | undefined {
    return dbStore.getUserByToken(token);
  }

  findByParticipantCode(code: string): User | undefined {
    return dbStore.getUserByParticipantCode(code);
  }

  findById(id: string): User | undefined {
    return dbStore.getUserById(id);
  }

  getAllParticipants(): User[] {
    return dbStore.getAllParticipants();
  }

  createParticipant(user: User): User {
    dbStore.createParticipant(user);
    return user;
  }

  deleteParticipant(participantId: string): boolean {
    return dbStore.deleteParticipant(participantId);
  }

  clearAllParticipants(): number {
    return dbStore.clearAllParticipants();
  }

  unlockAllDevices(): number {
    return dbStore.unlockAllDevices();
  }

  unlockParticipantDevice(participantId: string): boolean {
    return dbStore.unlockParticipantDevice(participantId);
  }

  importParticipantsBatch(
    items: Array<{ name: string; participantCode: string; token?: string }>,
    clearExisting: boolean = false
  ): User[] {
    return dbStore.importParticipantsBatch(items, clearExisting);
  }
}

export const userRepository = new UserRepository();
