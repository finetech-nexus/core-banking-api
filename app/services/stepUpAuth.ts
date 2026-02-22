// stepUpAuth.ts
export interface StepUpAuthRequest {
  userId: string;
  action: string; // e.g., 'top-up', 'card-creation', 'transfer'
  passcode?: string;
  biometricVerified?: boolean;
}

// Example: validate step-up authentication
export function verifyStepUpAuth(req: StepUpAuthRequest): boolean {
  // Example logic:
  // 1. Biometric verified on device OR
  // 2. Correct passcode entered
  if (req.biometricVerified) return true;

  if (req.passcode) {
    // Here, you would check against securely stored passcode hash
    const storedHash = getStoredPasscodeHash(req.userId);
    return comparePasscodeHash(req.passcode, storedHash);
  }

  return false;
}

// Dummy functions for illustration
function getStoredPasscodeHash(userId: string): string {
  // retrieve hashed passcode from DB or secure storage
  return 'hashed-passcode';
}

function comparePasscodeHash(passcode: string, hash: string): boolean {
  // simple example, use bcrypt or scrypt in production
  return hash === 'hashed-passcode' && passcode === '1234';
}
