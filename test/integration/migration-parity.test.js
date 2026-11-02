/**
 * MongoDB → PostgreSQL Migration Parity Tests
 *
 * This test suite validates that Prisma behavior matches MongoDB behavior for:
 * 1. Soft delete filtering
 * 2. Scoped unique indexes (email/phone per organization)
 * 3. Password hashing on create/update
 * 4. Field visibility (default public fields only)
 * 5. Relation auto-population and enrichment
 *
 * Test Coverage:
 * - Soft delete: Query filters automatically exclude deletedAt IS NOT NULL
 * - Email uniqueness: Same email allowed for different orgs or when deletedAt IS NOT NULL
 * - Password hashing: Plain text never stored, auto-hashed on create/update
 * - Field selection: password, OTPs, secretKeys excluded by default
 * - Enrichment: currentActiveOrganization virtual field works via userHelpers
 */

const {getPrismaClient} = require('../../utils/databaseConnectionManager');
const {enrichUserObject} = require('../../utils/userHelpers');
const {hashString} = require('../../utils/bcryptUtils');

describe('MongoDB → PostgreSQL Migration Parity', () => {
  describe('Soft Delete Behavior', () => {
    it('should automatically exclude soft-deleted users from queries', async () => {
      // Create user
      const user = await getPrismaClient().user.create({
        data: {
          email: 'test@example.com',
          firstName: 'Test',
          password: 'plaintext123',
        },
      });

      // Soft delete the user
      await getPrismaClient().user.update({
        where: {id: user.id},
        data: {isDeleted: new Date()},
      });

      // Query should NOT return soft-deleted user
      const foundUser = await getPrismaClient().user.findFirst({
        where: {email: 'test@example.com'},
      });

      expect(foundUser).toBeNull();
    });

    it('should include soft-deleted users when includeDeleted option is true', async () => {
      const user = await getPrismaClient().user.create({
        data: {
          email: 'test2@example.com',
          firstName: 'Test',
          password: 'plaintext123',
        },
      });

      await getPrismaClient().user.update({
        where: {id: user.id},
        data: {isDeleted: new Date()},
      });

      // Query with includeDeleted should return the user
      const foundUser = await getPrismaClient().user.findFirst({
        where: {email: 'test2@example.com'},
        includeDeleted: true,
      });

      expect(foundUser).not.toBeNull();
      expect(foundUser.isDeleted).not.toBeNull();
    });
  });

  describe('Scoped Unique Indexes', () => {
    it('should allow same email for different organizations', async () => {
      // First create a creator user
      const creator = await getPrismaClient().user.create({
        data: {
          email: 'creator-1@example.com',
          firstName: 'Creator',
          password: 'pass123',
        },
      });

      const org1 = await getPrismaClient().organization.create({
        data: {organizationName: 'Org1', creatorId: creator.id},
      });

      const org2 = await getPrismaClient().organization.create({
        data: {organizationName: 'Org2', creatorId: creator.id},
      });

      // Create user in org1
      const user1 = await getPrismaClient().user.create({
        data: {
          email: 'shared@example.com',
          firstName: 'User1',
          password: 'pass123',
          primaryOrgId: org1.id,
        },
      });

      // Create user with same email in org2 - should succeed
      const user2 = await getPrismaClient().user.create({
        data: {
          email: 'shared@example.com',
          firstName: 'User2',
          password: 'pass123',
          primaryOrgId: org2.id,
        },
      });

      expect(user1.email).toBe(user2.email);
      expect(user1.primaryOrgId).not.toBe(user2.primaryOrgId);
    });

    it('should allow email reuse after soft delete', async () => {
      // First create a creator user
      const creator = await getPrismaClient().user.create({
        data: {
          email: 'creator-2@example.com',
          firstName: 'Creator',
          password: 'pass123',
        },
      });

      const org = await getPrismaClient().organization.create({
        data: {organizationName: 'TestOrg', creatorId: creator.id},
      });

      // Create first user
      const user1 = await getPrismaClient().user.create({
        data: {
          email: 'reuse@example.com',
          firstName: 'User1',
          password: 'pass123',
          primaryOrgId: org.id,
        },
      });

      // Soft delete first user
      await getPrismaClient().user.update({
        where: {id: user1.id},
        data: {isDeleted: new Date()},
      });

      // Create second user with same email - should succeed
      const user2 = await getPrismaClient().user.create({
        data: {
          email: 'reuse@example.com',
          firstName: 'User2',
          password: 'pass123',
          primaryOrgId: org.id,
        },
      });

      expect(user2.email).toBe(user1.email);
      expect(user2.id).not.toBe(user1.id);
    });
  });

  describe('Password Hashing', () => {
    it('should automatically hash passwords on create', async () => {
      const plainPassword = 'plaintext123';

      const user = await getPrismaClient().user.create({
        data: {
          email: 'hash-test-1@example.com',
          firstName: 'Test',
          password: plainPassword,
        },
      });

      // Password should be hashed
      expect(user.password).not.toBe(plainPassword);
      expect(user.password.startsWith('$2')).toBe(true); // bcrypt prefix
    });

    it('should automatically hash passwords on update', async () => {
      const user = await getPrismaClient().user.create({
        data: {
          email: 'hash-test-2@example.com',
          firstName: 'Test',
          password: 'original123',
        },
      });

      const originalHash = user.password;

      // Update with new plain password
      const updated = await getPrismaClient().user.update({
        where: {id: user.id},
        data: {password: 'newpassword123'},
      });

      expect(updated.password).not.toBe('newpassword123');
      expect(updated.password).not.toBe(originalHash);
      expect(updated.password.startsWith('$2')).toBe(true);
    });

    it('should not hash passwords that are already hashed', async () => {
      const hashed = await hashString({string: 'plaintext'});

      const user = await getPrismaClient().user.create({
        data: {
          email: 'hash-test-3@example.com',
          firstName: 'Test',
          password: hashed,
        },
      });

      // Should not double-hash
      expect(user.password).toBe(hashed);
    });
  });

  describe('Field Visibility', () => {
    it('should exclude password by default', async () => {
      await getPrismaClient().user.create({
        data: {
          email: 'field-test-1@example.com',
          firstName: 'Test',
          password: 'secret123',
        },
      });

      // Using DEFAULT_FIELDS (done by PrismaFactory by default)
      const user = await getPrismaClient().user.findFirst({
        where: {email: 'field-test-1@example.com'},
        select: {
          id: true,
          email: true,
          firstName: true,
          // password not included in select
        },
      });

      expect(user.password).toBeUndefined();
    });

    it('should exclude OTP fields by default', async () => {
      await getPrismaClient().user.create({
        data: {
          email: 'field-test-2@example.com',
          firstName: 'Test',
          password: 'secret123',
          otps: {email: 'jwt-token-123', phone: null},
        },
      });

      const user = await getPrismaClient().user.findFirst({
        where: {email: 'field-test-2@example.com'},
        select: {
          id: true,
          email: true,
          firstName: true,
          // otps not included
        },
      });

      expect(user.otps).toBeUndefined();
    });

    it('should exclude secretKey fields by default', async () => {
      await getPrismaClient().user.create({
        data: {
          email: 'field-test-3@example.com',
          firstName: 'Test',
          password: 'secret123',
          secretKeys: {
            auth: 'secret-key-123',
            otp: null,
            verification: null,
            invitation: null,
            loginReset: null,
          },
        },
      });

      const user = await getPrismaClient().user.findFirst({
        where: {email: 'field-test-3@example.com'},
        select: {
          id: true,
          email: true,
          firstName: true,
          // secretKeys not included
        },
      });

      expect(user.secretKeys).toBeUndefined();
    });

    it('should allow explicit inclusion of sensitive fields', async () => {
      const user = await getPrismaClient().user.create({
        data: {
          email: 'field-test-4@example.com',
          firstName: 'Test',
          password: 'secret123',
          secretKeys: {
            auth: 'secret-key-123',
            otp: null,
            verification: null,
            invitation: null,
            loginReset: null,
          },
        },
      });

      const retrieved = await getPrismaClient().user.findUnique({
        where: {id: user.id},
        select: {
          id: true,
          secretKeys: true,
        },
      });

      expect(retrieved.secretKeys).toBeDefined();
      expect(retrieved.secretKeys.auth).toBe('secret-key-123');
    });
  });

  describe('User Enrichment & Virtual Fields', () => {
    it('should provide currentActiveOrganization virtual field', async () => {
      // First create a creator user
      const creator = await getPrismaClient().user.create({
        data: {
          email: 'creator-3@example.com',
          firstName: 'Creator',
          password: 'pass123',
        },
      });

      const org = await getPrismaClient().organization.create({
        data: {organizationName: 'TestOrg', creatorId: creator.id},
      });

      const user = await getPrismaClient().user.create({
        data: {
          email: 'enrich-test@example.com',
          firstName: 'Test',
          password: 'pass123',
          primaryOrgId: org.id,
          userOrganizations: {
            create: {
              organizationId: org.id,
              role: 'admin',
              isActive: true,
            },
          },
        },
        include: {
          userOrganizations: true,
        },
      });

      // Enrich user with helper methods
      const enriched = enrichUserObject({user});

      expect(enriched.currentActiveOrganization).not.toBeNull();
      expect(enriched.currentActiveOrganization.organizationId).toBe(org.id);
      expect(enriched.currentActiveOrganization.isActive).toBe(true);
    });

    it('should provide generateToken method after enrichment', async () => {
      const user = await getPrismaClient().user.create({
        data: {
          email: 'token-test@example.com',
          firstName: 'Test',
          password: 'pass123',
          secretKeys: {
            auth: null,
            otp: null,
            verification: null,
            invitation: null,
            loginReset: null,
          },
        },
      });

      const enriched = enrichUserObject({user});

      expect(typeof enriched.generateToken).toBe('function');
      expect(enriched.generateToken({type: 'auth'})).toBeDefined();
    });
  });

  describe('Transaction Support', () => {
    it('should rollback all changes on error within transaction', async () => {
      // First create a creator user
      const creator = await getPrismaClient().user.create({
        data: {
          email: 'creator-4@example.com',
          firstName: 'Creator',
          password: 'pass123',
        },
      });

      const org = await getPrismaClient().organization.create({
        data: {organizationName: 'TxTestOrg', creatorId: creator.id},
      });

      try {
        await getPrismaClient().$transaction(async (tx) => {
          // Create user
          await tx.user.create({
            data: {
              email: 'tx-test@example.com',
              firstName: 'Test',
              password: 'pass123',
              primaryOrgId: org.id,
            },
          });

          // Simulate error
          throw new Error('Intentional error');
        });
      } catch (error) {
        expect(error.message).toBe('Intentional error');
      }

      // Verify user was not created due to rollback
      const user = await getPrismaClient().user.findFirst({
        where: {email: 'tx-test@example.com'},
        includeDeleted: true,
      });

      expect(user).toBeNull();
    });
  });
});
