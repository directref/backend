import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env } from './env';
import { db } from './db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { AppError } from '../middleware/errorHandler';

export function configurePassport(): void {
  // ─── Local Strategy (email + password) ────────────────────────────────────
  passport.use(
    new LocalStrategy(
      { usernameField: 'email', passwordField: 'password' },
      async (email, password, done) => {
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.toLowerCase()))
            .limit(1);

          if (!user) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          if (!user.passwordHash) {
            return done(null, false, { message: 'Please sign in with Google' });
          }
          const match = await bcrypt.compare(password, user.passwordHash);
          if (!match) {
            return done(null, false, { message: 'Invalid email or password' });
          }
          if (!user.emailVerified) {
            return done(
              new AppError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email before logging in'),
            );
          }
          return done(null, user);
        } catch (err) {
          return done(err);
        }
      },
    ),
  );

  // ─── Google OAuth Strategy ─────────────────────────────────────────────────
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          callbackURL: env.GOOGLE_CALLBACK_URL,
          scope: ['profile', 'email'],
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const googleEmail = profile.emails?.[0]?.value?.toLowerCase();
            const googleId = profile.id;
            const avatarUrl = profile.photos?.[0]?.value ?? null;
            const fullName = profile.displayName || 'Unknown';

            // 1. Try finding by google_id
            const [byGoogleId] = await db
              .select()
              .from(users)
              .where(eq(users.googleId, googleId))
              .limit(1);

            if (byGoogleId) {
              await db
                .update(users)
                .set({ avatarUrl, updatedAt: new Date() })
                .where(eq(users.id, byGoogleId.id));
              return done(null, byGoogleId);
            }

            // 2. Try linking by email
            if (googleEmail) {
              const [byEmail] = await db
                .select()
                .from(users)
                .where(eq(users.email, googleEmail))
                .limit(1);

              if (byEmail) {
                await db
                  .update(users)
                  .set({ googleId, avatarUrl, emailVerified: true, updatedAt: new Date() })
                  .where(eq(users.id, byEmail.id));
                return done(null, byEmail);
              }
            }

            // 3. Create new user
            const [newUser] = await db
              .insert(users)
              .values({
                email: googleEmail ?? `google_${googleId}@placeholder.vouch`,
                fullName,
                googleId,
                avatarUrl,
                emailVerified: true,
              })
              .returning();

            return done(null, newUser);
          } catch (err) {
            return done(err as Error);
          }
        },
      ),
    );
  }
}
