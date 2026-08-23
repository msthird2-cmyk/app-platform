import { describe, expect, it } from 'vitest';
import { initializeApp } from 'firebase/app';
import { FirebaseBackupService } from '../src/services/FirebaseBackupService';

/**
 * A backup identifier reaches a Cloud Storage path. Firebase's `ref()`
 * normalises `..`, so an unvalidated id could resolve outside the owner's
 * prefix. These assert the id is rejected before any path is built.
 */
describe('backup identifier validation', () => {
  const app = initializeApp(
    {
      apiKey: 'test-api-key',
      authDomain: 'example.firebaseapp.com',
      projectId: 'app-platform-rules-test',
      storageBucket: 'example.appspot.com',
      messagingSenderId: '1',
      appId: '1:1:web:1',
    },
    'backup-path-test',
  );

  const service = new FirebaseBackupService(app);

  it.each([
    '../../other-user/backups/theirs',
    '..%2F..%2Fescape',
    'has spaces',
    'semi;colon',
    'slash/inside',
    '',
    'x'.repeat(65),
  ])('rejects the unsafe identifier %j', async (id) => {
    // Rejected before authentication is even consulted, so the failure is the
    // identifier and not a missing session.
    await expect(service.download(id)).rejects.toMatchObject({ domain: 'backup' });
    await expect(service.remove(id)).rejects.toMatchObject({ domain: 'backup' });
  });
});
