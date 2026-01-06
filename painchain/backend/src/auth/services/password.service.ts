import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly SALT_ROUNDS = 12; // Production-grade security

  /**
   * Hash a plaintext password using bcrypt
   * @param password - The plaintext password to hash
   * @returns Promise<string> - The hashed password
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  /**
   * Verify a plaintext password against a hashed password
   * @param password - The plaintext password to verify
   * @param hash - The hashed password to compare against
   * @returns Promise<boolean> - True if password matches, false otherwise
   */
  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
