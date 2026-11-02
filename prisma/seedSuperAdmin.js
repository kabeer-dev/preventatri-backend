/**
 * Super admin seed for Prisma 7
 *
 * Creates the super admin and the organization it lives in. The organization is
 * the super admin's alone: nobody else is ever added to it.
 *
 * Called by prisma/seed.js (`npx prisma db seed`) when SUPER_ADMIN_EMAIL and
 * SUPER_ADMIN_PASSWORD are set. Seeding an email that already exists changes
 * nothing.
 */

const {DEFAULT_OTP_METHODS} = require('../constants/generalConstant');
const {ORGANIZATION_STATUSES} = require('../constants/organizationsConstants');
const {SYSTEM_ROLES} = require('../constants/usersConstants');
const {hashString} = require('../utils/bcryptUtils');
const {createDefaultLevels} = require('../utils/permissionUtils');

const DEFAULT_ORGANIZATION_NAME = 'PreventaTri Platform';

/**
 * The user, the organization it creates and owns, the membership with the
 * super admin role, and the empty permission row every membership has.
 * Everything is created together or not at all.
 *
 * @returns {Promise<{user, organization}|null>} null when the email exists
 */
async function seedSuperAdmin({
  prisma,
  email,
  password,
  firstName = 'Super',
  lastName = 'Admin',
  organizationName = DEFAULT_ORGANIZATION_NAME,
}) {
  const existing = await prisma.user.findFirst({where: {email}});

  if (existing) {
    // eslint-disable-next-line no-console -- Seed script output
    console.info(`Super admin ${email} already exists. Nothing changed.`);

    return null;
  }

  const hashedPassword = await hashString({string: password});

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        firstName,
        lastName,
        password: hashedPassword,
        isVerified: true,
        language: 'en',
      },
    });

    const organization = await tx.organization.create({
      data: {
        organizationName,
        creatorId: user.id,
        status: ORGANIZATION_STATUSES.ACTIVE.value,
      },
    });

    await tx.user.update({
      where: {id: user.id},
      data: {primaryOrgId: organization.id},
    });

    await tx.userOrganization.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: SYSTEM_ROLES.super_admin.value,
        isActive: true,
      },
    });

    await tx.permission.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        levels: createDefaultLevels({
          roleValue: SYSTEM_ROLES.super_admin.value,
        }),
      },
    });

    await tx.security.create({
      data: {userId: user.id, otpMethods: DEFAULT_OTP_METHODS},
    });

    return {user, organization};
  });
}

module.exports = {seedSuperAdmin};
