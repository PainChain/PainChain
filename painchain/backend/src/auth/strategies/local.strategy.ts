import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
    });
  }

  /**
   * Validate user credentials
   * Called automatically by Passport when using LocalGuard
   * @param email - User's email
   * @param password - User's password
   * @returns User object if valid
   * @throws UnauthorizedException if invalid
   */
  async validate(email: string, password: string): Promise<any> {
    const user = await this.authService.validateUserCredentials(email, password);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }
}
