/**
 * Development seed — creates deterministic test data.
 * Run: npm run db:seed
 */
import 'dotenv/config';
import { db, queryClient } from '../config/db';
import { users, connections, jobs, applications } from './schema';
import bcrypt from 'bcrypt';

async function seed() {
  console.log('🌱 Seeding database...\n');

  // ── Clean existing data ──────────────────────────────────────────────────
  await db.delete(applications);
  await db.delete(jobs);
  await db.delete(connections);
  await db.delete(users);
  console.log('  ✓ Cleared existing data');

  // ── Users ────────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('Password1', 12);

  const [sarah] = await db.insert(users).values({
    email: 'sarah@example.com',
    passwordHash: password,
    fullName: 'Sarah Alon',
    headline: 'Senior Product Designer at Google',
    companyName: 'Google',
    isReferrer: true,
    isSeeker: false,
    emailVerified: true,
  }).returning();

  const [jonathan] = await db.insert(users).values({
    email: 'jonathan@example.com',
    passwordHash: password,
    fullName: 'Jonathan Katz',
    headline: 'Engineering Manager at Wix',
    companyName: 'Wix',
    isReferrer: true,
    isSeeker: false,
    emailVerified: true,
  }).returning();

  const [maya] = await db.insert(users).values({
    email: 'maya@example.com',
    passwordHash: password,
    fullName: 'Maya Ron',
    headline: 'Product Designer looking for next role',
    isReferrer: true,
    isSeeker: true,
    emailVerified: true,
  }).returning();

  console.log('  ✓ Created 3 users (sarah, jonathan, maya)');
  console.log('    All passwords: Password1');

  // ── Connections ──────────────────────────────────────────────────────────
  await db.insert(connections).values({
    requesterId: maya.id,
    addresseeId: sarah.id,
    status: 'accepted',
  });

  await db.insert(connections).values({
    requesterId: maya.id,
    addresseeId: jonathan.id,
    status: 'accepted',
  });

  console.log('  ✓ Created 2 accepted connections (maya ↔ sarah, maya ↔ jonathan)');

  // ── Jobs ─────────────────────────────────────────────────────────────────
  const [googleJob] = await db.insert(jobs).values({
    referrerId: sarah.id,
    sourceUrl: 'https://careers.google.com/jobs/results/example-123',
    title: 'Senior UX Researcher',
    companyName: 'Google',
    location: 'Tel Aviv, Israel / Remote',
    description: 'Join Google to shape the next generation of consumer products. You\'ll conduct user research, run usability studies, and translate insights into product decisions.',
    jobType: 'full-time',
    salaryRange: '$130k–$170k',
    bonusAmount: '5000',
    bonusCurrency: 'USD',
    bonusNotes: 'Referral bonus paid after 90 days employment',
    isActive: true,
  }).returning();

  const [wixJob] = await db.insert(jobs).values({
    referrerId: jonathan.id,
    sourceUrl: 'https://www.wix.com/jobs/locations/tel-aviv/positions/backend-node',
    title: 'Backend Engineer — Node.js',
    companyName: 'Wix',
    location: 'Herzliya, Israel',
    description: 'We\'re looking for a Node.js expert to join our platform team. You\'ll work on high-scale infrastructure serving millions of users.',
    jobType: 'full-time',
    salaryRange: '₪35,000–₪45,000/month',
    bonusAmount: '8000',
    bonusCurrency: 'ILS',
    isActive: true,
  }).returning();

  console.log('  ✓ Created 2 jobs (Google UX Researcher by Sarah, Wix Backend by Jonathan)');

  // ── Print summary ─────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('Test accounts:');
  console.log('  Sarah  (referrer) : sarah@example.com    / Password1');
  console.log('  Jonathan (referrer): jonathan@example.com / Password1');
  console.log('  Maya   (seeker)   : maya@example.com     / Password1');
  console.log('\nJob IDs:');
  console.log(`  Google UX Researcher: ${googleJob.id}`);
  console.log(`  Wix Backend Eng:      ${wixJob.id}`);
}

seed()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    queryClient.end();
  });
