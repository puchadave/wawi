import argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function generateSecurePassword(length = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let password = '';
  const randomBytes = new Uint8Array(length);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}

export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (password.length < 12) {
    errors.push('Passwort muss mindestens 12 Zeichen lang sein');
  }
  
  if (password.length > 128) {
    errors.push('Passwort darf maximal 128 Zeichen lang sein');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Mindestens ein Großbuchstabe erforderlich');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Mindestens ein Kleinbuchstabe erforderlich');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Mindestens eine Zahl erforderlich');
  }
  
  if (!/[!@#$%^&*]/.test(password)) {
    errors.push('Mindestens ein Sonderzeichen erforderlich');
  }
  
  const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Passwort enthält ein zu häufig verwendetes Wort');
  }
  
  return { valid: errors.length === 0, errors };
}