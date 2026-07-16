// Extend Express Request with our authenticated user type
// Using a standalone interface to avoid circular import issues

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      passwordHash: string | null;
      fullName: string;
      headline: string | null;
      avatarUrl: string | null;
      googleId: string | null;
      companyName: string | null;
      isReferrer: boolean;
      isSeeker: boolean;
      emailVerified: boolean;
      emailVerifyToken: string | null;
      resetToken: string | null;
      resetTokenExp: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};
