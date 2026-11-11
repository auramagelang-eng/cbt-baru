import { dbStore } from '../db';
import { User } from '../../types/cbt';
import { cloudflareService } from '../services/CloudflareService';

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
    cloudflareService.syncParticipant(user);
    return user;
  }

  deleteParticipant(participantId: string): boolean {
    const success = dbStore.deleteParticipant(participantId);
    if (success) {
      cloudflareService.deleteParticipant(participantId);
    }
    return success;
  }

  clearAllParticipants(): number {
    const count = dbStore.clearAllParticipants();
    cloudflareService.clearAllParticipants();
    return count;
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
    const users = dbStore.importParticipantsBatch(items, clearExisting);
    cloudflareService.syncParticipantsBatch(users);
    return users;
  }
}

export const userRepository = new UserRepository();
