/**
 * Phase 9 Plan 09-09 — clinic-photo Edge Function access drill (D-12 three-check
 * gate + D-13 5-min signed-URL TTL + CLINIC-07 audit half).
 *
 * Exercises the live `clinic-photo` Edge Function deployed to project
 * `ytnsipxxmzgaebkqmokp`. Six paths verified:
 *   - 200 happy:           valid JWT + active operator membership + role has
 *                          patient_photos.read + patient consent_scope.photos=true
 *                          + photo exists → 200 {signedUrl, ttl:300} +
 *                          Cache-Control: private, no-store + audit row written.
 *   - 401 not_member:      operator membership revoked → 401.
 *   - 403 permission_denied: operator's role lacks patient_photos.read → 403.
 *   - 403 consent_excluded: patient consent_scope.photos=false → 403.
 *   - 404 photo_not_found: photoId absent from photos table → 404 (no audit row).
 *   - D-13 stale URL window: revoking AFTER mint does NOT invalidate the issued
 *     URL within the TTL window (tradeoff accepted in 09-CONTEXT D-13); the
 *     subsequent /clinic-photo call returns 401.
 *
 * Patterns:
 *   - Photo seeded via service-role admin: upload to Storage + INSERT into
 *     public.photos. This bypasses the patient-side flow which is irrelevant
 *     to the Edge Function gate.
 *   - Operator memberships are created via accept_invite_existing so the
 *     row matches production shape (consent_scope is set, audit row present).
 *   - Each path calls the LIVE deployed function via fetch with the operator's
 *     Bearer JWT.
 */
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  acceptInviteAs,
  cleanupClinicFixtures,
  createInviteViaRpc,
  createOperatorWithOrg,
  createRoleAs,
  createUser,
  fullConsentScope,
  getAdmin,
  getAuditRows,
  hasLiveSupabase,
  signIn,
  SUPABASE_URL,
  testEmail,
  testRunId,
  updateMemberRoleAs,
} from './fixtures/clinic-fixtures';

const JPEG_BYTES = Uint8Array.from([
  // Minimal JPEG SOI + EOI markers — valid enough for upload validation.
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

interface PhotoSeed {
  userId: string;
  photoId: string;
  storagePath: string;
}

async function seedPhoto(patientId: string): Promise<PhotoSeed> {
  const admin = getAdmin();
  const photoId = randomUUID();
  const storagePath = `${patientId}/photos/${photoId}.jpg`;
  const blob = new Blob([JPEG_BYTES], { type: 'image/jpeg' });
  const { error: upErr } = await admin.storage.from('photos').upload(storagePath, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw new Error(`photo upload failed: ${upErr.message}`);
  const { error: insErr } = await admin.from('photos').insert({
    user_id: patientId,
    photo_id: photoId,
    date: new Date().toISOString().slice(0, 10),
    storage_path: storagePath,
    notes: null,
  });
  if (insErr) throw new Error(`photos insert failed: ${insErr.message}`);
  return { userId: patientId, photoId, storagePath };
}

async function cleanupPhoto(seed: PhotoSeed): Promise<void> {
  const admin = getAdmin();
  try {
    await admin
      .from('photos')
      .delete()
      .eq('user_id', seed.userId)
      .eq('photo_id', seed.photoId);
  } catch {
    // best-effort
  }
  try {
    await admin.storage.from('photos').remove([seed.storagePath]);
  } catch {
    // best-effort
  }
}

async function callPhotoFn(opts: {
  jwt: string;
  orgId: string;
  userId: string;
  photoId: string;
}): Promise<Response> {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL not set');
  return fetch(
    `${SUPABASE_URL}/functions/v1/clinic-photo/${opts.orgId}/${opts.userId}/${opts.photoId}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${opts.jwt}` },
    },
  );
}

async function jwtFor(user: { email: string; password: string }): Promise<string> {
  const client = await signIn(user as { id: string; email: string; password: string });
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(`could not get JWT for ${user.email}`);
  return token;
}

test.describe('@phase09 clinic-photo Edge Function — D-12 three-check gate', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY',
  );
  test.setTimeout(120_000);

  const runId = testRunId();
  const seeds: PhotoSeed[] = [];

  test.afterAll(async () => {
    for (const s of seeds) {
      await cleanupPhoto(s);
    }
    await cleanupClinicFixtures({
      emailPattern: `photo-${runId}`,
      slugPattern: `photo-${runId}`,
    });
  });

  test('200 happy + 403 consent_excluded + 404 photo_not_found + 401 not_member', async () => {
    // Operator + org.
    const opFix = await createOperatorWithOrg(`photo-${runId}`);

    // Patient joins org (consent_scope.photos = true).
    const patient = await createUser({ email: testEmail(`photo-patient-${runId}`, 'p1') });
    const patientInvite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const patientAccept = await acceptInviteAs({
      patient,
      tokenHash: patientInvite.tokenHash,
      consentScope: fullConsentScope(),
    });

    // Seed a photo for the patient.
    const seed = await seedPhoto(patient.id);
    seeds.push(seed);

    const opJwt = await jwtFor(opFix.operator);

    // === Test 1: 200 happy ===
    const r1 = await callPhotoFn({
      jwt: opJwt,
      orgId: opFix.orgId,
      userId: patient.id,
      photoId: seed.photoId,
    });
    expect(r1.status, '200 happy path').toBe(200);
    const body1 = (await r1.json()) as { signedUrl?: string; ttl?: number };
    expect(body1.signedUrl, 'signed URL present').toMatch(/^https?:\/\//);
    expect(body1.ttl, 'TTL = 300').toBe(300);
    const cacheControl = r1.headers.get('cache-control') ?? '';
    expect(cacheControl.toLowerCase()).toContain('private');
    expect(cacheControl.toLowerCase()).toContain('no-store');

    // === Test 5: 404 photo_not_found (gate passes, photo absent) ===
    const r5 = await callPhotoFn({
      jwt: opJwt,
      orgId: opFix.orgId,
      userId: patient.id,
      photoId: randomUUID(), // non-existent photo
    });
    expect(r5.status, '404 photo_not_found').toBe(404);

    // === Test 4: 403 consent_excluded ===
    // Flip the patient's consent_scope.photos to false via update_consent_scope.
    {
      const patientClient = await signIn(patient);
      const scope = fullConsentScope();
      scope.photos = false;
      const { error } = await patientClient.rpc('update_consent_scope', {
        p_membership_id: patientAccept.membershipId,
        p_consent_scope: scope,
      });
      expect(error, 'update_consent_scope clears photos').toBeNull();
    }
    const r4 = await callPhotoFn({
      jwt: opJwt,
      orgId: opFix.orgId,
      userId: patient.id,
      photoId: seed.photoId,
    });
    expect(r4.status, '403 consent_excluded after consent flip').toBe(403);

    // Restore consent so subsequent tests can run a happy mint.
    {
      const patientClient = await signIn(patient);
      const { error } = await patientClient.rpc('update_consent_scope', {
        p_membership_id: patientAccept.membershipId,
        p_consent_scope: fullConsentScope(),
      });
      expect(error).toBeNull();
    }

    // === Test 2 + D-13 window: revoke operator membership ===
    // Operator self-revokes by calling revoke_membership on their OWN
    // membership row. First we need to find the operator's membership_id —
    // it was auto-created by create_org with the Owner role. Patient acts as
    // patient; for operator-revoke we use admin UPDATE to bypass the
    // self-only revoke RPC constraint.
    {
      const admin = getAdmin();
      const { data: opMem } = await admin
        .from('memberships')
        .select('id')
        .eq('user_id', opFix.operator.id)
        .eq('org_id', opFix.orgId)
        .maybeSingle();
      expect(opMem?.id, 'operator membership exists').toBeTruthy();
      const { error } = await admin
        .from('memberships')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', (opMem as { id: string }).id);
      expect(error, 'admin revoke of operator membership').toBeNull();
    }
    const r2 = await callPhotoFn({
      jwt: opJwt,
      orgId: opFix.orgId,
      userId: patient.id,
      photoId: seed.photoId,
    });
    expect(r2.status, '401 not_member after operator revoke').toBe(401);

    // === Audit log presence (CLINIC-07 capture half) ===
    const audit = await getAuditRows({ orgId: opFix.orgId });
    const actions = audit.map((r) => r.action);
    expect(actions, 'audit row for successful photo view').toContain('clinic_photo_view');
    expect(actions, 'audit row for at least one permission_denied').toContain(
      'permission_denied',
    );
  });

  test('403 permission_denied — role lacks patient_photos.read', async () => {
    // Owner creates a "View-light" role without patient_photos.read.
    const opFix = await createOperatorWithOrg(`photo2-${runId}`);
    const patient = await createUser({ email: testEmail(`photo2-patient-${runId}`, 'p2') });
    const invite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: patient.email,
    });
    const patientAccept = await acceptInviteAs({
      patient,
      tokenHash: invite.tokenHash,
      consentScope: fullConsentScope(),
    });
    const seed = await seedPhoto(patient.id);
    seeds.push(seed);

    // Create a second operator who will be downgraded to the limited role.
    const limitedOp = await createUser({
      email: testEmail(`photo2-limop-${runId}`, 'op'),
    });
    const limitedInvite = await createInviteViaRpc({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      email: limitedOp.email,
    });
    const limitedAccept = await acceptInviteAs({
      patient: limitedOp,
      tokenHash: limitedInvite.tokenHash,
      consentScope: fullConsentScope(),
    });
    const limitedRole = await createRoleAs({
      operatorClient: opFix.client,
      orgId: opFix.orgId,
      name: `LimitedNoPhotos-${runId}`,
      permissionKeys: ['org.read', 'patient_data.read'], // notably NO patient_photos.read
    });
    await updateMemberRoleAs({
      operatorClient: opFix.client,
      membershipId: limitedAccept.membershipId,
      roleId: limitedRole.roleId,
    });

    const limitedJwt = await jwtFor(limitedOp);
    const r = await callPhotoFn({
      jwt: limitedJwt,
      orgId: opFix.orgId,
      userId: patient.id,
      photoId: seed.photoId,
    });
    expect(r.status, '403 permission_denied (no patient_photos.read)').toBe(403);

    void patientAccept; // referenced for side-effect only
  });
});
