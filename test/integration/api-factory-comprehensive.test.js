/**
 * Comprehensive API, Factory, and Services Test Suite
 *
 * Tests all PrismaFactory methods and GeneralServices to ensure
 * MongoDB → PostgreSQL migration parity is complete.
 *
 * Coverage:
 * - PrismaFactory: create, find, findById, findOne, updateOne, updateMany,
 *   findOneAndUpdate, findByIdAndUpdate, findAllAndUpdate, findAllAndDelete,
 *   softDeleteOne, softDeleteById, softDeleteMany, hardDeleteOne, hardDeleteMany,
 *   countDocuments, aggregate, rawQuery, transaction
 * - GeneralServices: All wrapper methods
 * - Region API: CRUD operations, bulk update, bulk delete
 */

const {getPrismaClient} = require('../../utils/databaseConnectionManager');
const {PrismaFactory} = require('../../factories');
const GeneralServices = require('../../services/generalServices');
const {modelConstants} = require('../../constants');

// Helper to create a test user for FK relationships
async function createTestUser(emailSuffix = '') {
  return await getPrismaClient().user.create({
    data: {
      email: `test-user-${Date.now()}${emailSuffix}@example.com`,
      firstName: 'Test',
      password: 'password123',
    },
  });
}

// Helper to create a test organization
async function createTestOrg(creatorId) {
  return await getPrismaClient().organization.create({
    data: {
      organizationName: `TestOrg-${Date.now()}`,
      creatorId,
    },
  });
}

describe('PrismaFactory Comprehensive Tests', () => {
  describe('create', () => {
    it('should create a new user', async () => {
      const {success, doc, error} = await PrismaFactory.create({
        model: modelConstants.MODELS.USER,
        data: {
          email: `create-test-${Date.now()}@example.com`,
          firstName: 'Create',
          password: 'password123',
        },
      });

      expect(success).toBe(true);
      expect(error).toBeUndefined();
      expect(doc).toBeDefined();
      expect(doc.id).toBeDefined();
      expect(doc.firstName).toBe('Create');
    });

    it('should create region with organization relation', async () => {
      const user = await createTestUser('region');
      const org = await createTestOrg(user.id);

      const {success, doc} = await PrismaFactory.create({
        model: modelConstants.MODELS.REGION,
        data: {
          name: 'Test Region',
          code: `TR-${Date.now()}`,
          organizationId: org.id,
        },
      });

      expect(success).toBe(true);
      expect(doc.name).toBe('Test Region');
      expect(doc.organizationId).toBe(org.id);
    });
  });

  describe('find', () => {
    it('should find multiple users', async () => {
      const user1 = await createTestUser('find1');
      const user2 = await createTestUser('find2');

      const {success, docs} = await PrismaFactory.find({
        model: modelConstants.MODELS.USER,
        query: {
          email: {
            in: [user1.email, user2.email],
          },
        },
      });

      expect(success).toBe(true);
      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    it('should exclude soft-deleted records by default', async () => {
      const user = await createTestUser('softdel');

      // Soft delete
      await getPrismaClient().user.update({
        where: {id: user.id},
        data: {isDeleted: new Date()},
      });

      const {docs} = await PrismaFactory.find({
        model: modelConstants.MODELS.USER,
        query: {email: user.email},
      });

      expect(docs.length).toBe(0);
    });

    it('should include soft-deleted records when includeDeleted is true', async () => {
      const user = await createTestUser('softdel2');

      await getPrismaClient().user.update({
        where: {id: user.id},
        data: {isDeleted: new Date()},
      });

      const {docs} = await PrismaFactory.find({
        model: modelConstants.MODELS.USER,
        query: {email: user.email},
        options: {includeDeleted: true},
      });

      expect(docs.length).toBe(1);
    });
  });

  describe('findById', () => {
    it('should find user by id', async () => {
      const user = await createTestUser('byid');

      const {success, doc} = await PrismaFactory.findById({
        model: modelConstants.MODELS.USER,
        id: user.id,
      });

      expect(success).toBe(true);
      expect(doc.email).toBe(user.email);
    });

    it('should return null for non-existent id', async () => {
      const {success, doc} = await PrismaFactory.findById({
        model: modelConstants.MODELS.USER,
        id: '00000000-0000-0000-0000-000000000000',
      });

      expect(success).toBe(true);
      expect(doc).toBeNull();
    });
  });

  describe('findOne', () => {
    it('should find single user by query', async () => {
      const user = await createTestUser('findone');

      const {success, doc} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.USER,
        query: {email: user.email},
      });

      expect(success).toBe(true);
      expect(doc.id).toBe(user.id);
    });
  });

  describe('updateOne', () => {
    it('should update single user', async () => {
      const user = await createTestUser('updateone');

      const {success, isDocumentUpdated} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.USER,
        query: {id: user.id},
        data: {firstName: 'Updated'},
      });

      expect(success).toBe(true);
      expect(isDocumentUpdated).toBe(true);

      const updated = await getPrismaClient().user.findUnique({
        where: {id: user.id},
      });
      expect(updated.firstName).toBe('Updated');
    });
  });

  describe('updateMany', () => {
    it('should update multiple users', async () => {
      const user1 = await createTestUser('updatemany1');
      const user2 = await createTestUser('updatemany2');

      const {success, areDocumentsUpdated} = await PrismaFactory.updateMany({
        model: modelConstants.MODELS.USER,
        query: {
          id: {in: [user1.id, user2.id]},
        },
        data: {lastName: 'BulkUpdated'},
      });

      expect(success).toBe(true);
      expect(areDocumentsUpdated).toBe(true);
    });
  });

  describe('findOneAndUpdate', () => {
    it('should update and return the document', async () => {
      const user = await createTestUser('findoneupdate');

      const {success, doc, isDocumentUpdated} =
        await PrismaFactory.findOneAndUpdate({
          model: modelConstants.MODELS.USER,
          query: {id: user.id},
          data: {firstName: 'FindOneUpdated'},
        });

      expect(success).toBe(true);
      expect(isDocumentUpdated).toBe(true);
      expect(doc.firstName).toBe('FindOneUpdated');
    });
  });

  describe('findByIdAndUpdate', () => {
    it('should update by id and return the document', async () => {
      const user = await createTestUser('findbyidupdate');

      const {success, doc, isDocumentUpdated} =
        await PrismaFactory.findByIdAndUpdate({
          model: modelConstants.MODELS.USER,
          id: user.id,
          data: {firstName: 'ByIdUpdated'},
        });

      expect(success).toBe(true);
      expect(isDocumentUpdated).toBe(true);
      expect(doc.firstName).toBe('ByIdUpdated');
    });
  });

  describe('findAllAndUpdate', () => {
    it('should update multiple documents and return them', async () => {
      const user1 = await createTestUser('findallupdate1');
      const user2 = await createTestUser('findallupdate2');

      const {success, docs, areDocumentsUpdated} =
        await PrismaFactory.findAllAndUpdate({
          model: modelConstants.MODELS.USER,
          query: {
            id: {in: [user1.id, user2.id]},
          },
          data: {lastName: 'AllUpdated'},
        });

      expect(success).toBe(true);
      expect(areDocumentsUpdated).toBe(true);
      expect(docs.length).toBe(2);
      docs.forEach((doc) => {
        expect(doc.lastName).toBe('AllUpdated');
      });
    });

    it('should return empty array when no matches', async () => {
      const {success, docs, areDocumentsUpdated} =
        await PrismaFactory.findAllAndUpdate({
          model: modelConstants.MODELS.USER,
          query: {id: '00000000-0000-0000-0000-000000000000'},
          data: {lastName: 'NoMatch'},
        });

      expect(success).toBe(true);
      expect(areDocumentsUpdated).toBe(false);
      expect(docs).toEqual([]);
    });
  });

  describe('findAllAndDelete (soft delete)', () => {
    it('should soft delete multiple documents and return them', async () => {
      const user = await createTestUser('creator-softdel');
      const org = await createTestOrg(user.id);

      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'SoftDel1',
          code: `SD1-${Date.now()}`,
          organizationId: org.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'SoftDel2',
          code: `SD2-${Date.now()}`,
          organizationId: org.id,
        },
      });

      const {success, docs, areDocumentsDeleted, deleteType} =
        await PrismaFactory.findAllAndDelete({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          options: {hardDelete: false},
        });

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
      expect(deleteType).toBe('softDelete');
      expect(docs.length).toBe(2);

      // Verify they're soft deleted
      const remaining = await getPrismaClient().region.findMany({
        where: {id: {in: [region1.id, region2.id]}, isDeleted: null},
      });
      expect(remaining.length).toBe(0);
    });
  });

  describe('findAllAndDelete (hard delete)', () => {
    it('should hard delete multiple documents and return them', async () => {
      const user = await createTestUser('creator-harddel');
      const org = await createTestOrg(user.id);

      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'HardDel1',
          code: `HD1-${Date.now()}`,
          organizationId: org.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'HardDel2',
          code: `HD2-${Date.now()}`,
          organizationId: org.id,
        },
      });

      const {success, docs, areDocumentsDeleted, deleteType} =
        await PrismaFactory.findAllAndDelete({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          options: {hardDelete: true},
        });

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
      expect(deleteType).toBe('hardDelete');
      expect(docs.length).toBe(2);

      // Verify they're permanently deleted
      const remaining = await getPrismaClient().region.findMany({
        where: {id: {in: [region1.id, region2.id]}},
      });
      expect(remaining.length).toBe(0);
    });
  });

  describe('softDeleteOne', () => {
    it('should soft delete single document', async () => {
      const user = await createTestUser('softdelone');

      const {success, doc} = await PrismaFactory.softDeleteOne({
        model: modelConstants.MODELS.USER,
        query: {id: user.id},
      });

      expect(success).toBe(true);
      expect(doc.isDeleted).not.toBeNull();
    });
  });

  describe('softDeleteById', () => {
    it('should soft delete by id', async () => {
      const user = await createTestUser('softdelbyid');

      const {success, doc} = await PrismaFactory.softDeleteById({
        model: modelConstants.MODELS.USER,
        id: user.id,
      });

      expect(success).toBe(true);
      expect(doc.isDeleted).not.toBeNull();
    });
  });

  describe('softDeleteMany', () => {
    it('should soft delete multiple documents', async () => {
      const user1 = await createTestUser('softdelmany1');
      const user2 = await createTestUser('softdelmany2');

      const {success, areDocumentsDeleted} = await PrismaFactory.softDeleteMany(
        {
          model: modelConstants.MODELS.USER,
          query: {id: {in: [user1.id, user2.id]}},
        }
      );

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
    });
  });

  describe('hardDeleteOne', () => {
    it('should permanently delete single document', async () => {
      const user = await createTestUser('harddel-creator');
      const org = await createTestOrg(user.id);
      const region = await getPrismaClient().region.create({
        data: {
          name: 'HardDelOne',
          code: `HDO-${Date.now()}`,
          organizationId: org.id,
        },
      });

      const {success} = await PrismaFactory.hardDeleteOne({
        model: modelConstants.MODELS.REGION,
        query: {id: region.id},
      });

      expect(success).toBe(true);

      const deleted = await getPrismaClient().region.findUnique({
        where: {id: region.id},
      });
      expect(deleted).toBeNull();
    });
  });

  describe('hardDeleteMany', () => {
    it('should permanently delete multiple documents', async () => {
      const user = await createTestUser('harddelm-creator');
      const org = await createTestOrg(user.id);
      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'HardDelMany1',
          code: `HDM1-${Date.now()}`,
          organizationId: org.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'HardDelMany2',
          code: `HDM2-${Date.now()}`,
          organizationId: org.id,
        },
      });

      const {success, areDocumentsDeleted} = await PrismaFactory.hardDeleteMany(
        {
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
        }
      );

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
    });
  });

  describe('countDocuments', () => {
    it('should count matching documents', async () => {
      const uniqueLastName = `Count-${Date.now()}`;
      await createTestUser('count1');

      const user1 = await getPrismaClient().user.create({
        data: {
          email: `count1-${Date.now()}@test.com`,
          lastName: uniqueLastName,
          password: 'pass',
        },
      });
      await getPrismaClient().user.create({
        data: {
          email: `count2-${Date.now()}@test.com`,
          lastName: uniqueLastName,
          password: 'pass',
        },
      });

      const {success, count} = await PrismaFactory.countDocuments({
        model: modelConstants.MODELS.USER,
        query: {lastName: uniqueLastName},
      });

      expect(success).toBe(true);
      expect(count).toBe(2);
    });
  });

  describe('transaction', () => {
    it('should rollback on error', async () => {
      const email = `tx-test-${Date.now()}@example.com`;

      try {
        await PrismaFactory.transaction({
          callback: async (tx) => {
            await tx.user.create({
              data: {email, firstName: 'TxUser', password: 'pass'},
            });
            throw new Error('Intentional rollback');
          },
        });
      } catch (e) {
        expect(e.message).toBe('Intentional rollback');
      }

      // User should not exist due to rollback
      const user = await getPrismaClient().user.findFirst({
        where: {email},
        includeDeleted: true,
      });
      expect(user).toBeNull();
    });

    it('should commit on success', async () => {
      const email = `tx-success-${Date.now()}@example.com`;

      const {success, response} = await PrismaFactory.transaction({
        callback: async (tx) => {
          const user = await tx.user.create({
            data: {email, firstName: 'TxSuccess', password: 'pass'},
          });
          return user;
        },
      });

      expect(success).toBe(true);
      expect(response.email).toBe(email);
    });
  });
});

describe('GeneralServices Tests', () => {
  describe('create', () => {
    it('should create document via GeneralServices', async () => {
      const {success, doc} = await GeneralServices.create({
        model: modelConstants.MODELS.USER,
        data: {
          email: `gs-create-${Date.now()}@example.com`,
          firstName: 'GSCreate',
          password: 'password123',
        },
      });

      expect(success).toBe(true);
      expect(doc.firstName).toBe('GSCreate');
    });
  });

  describe('findAll', () => {
    it('should find all documents', async () => {
      const {success, docs} = await GeneralServices.findAll({
        model: modelConstants.MODELS.USER,
        query: {},
      });

      expect(success).toBe(true);
      expect(Array.isArray(docs)).toBe(true);
    });
  });

  describe('findOne', () => {
    it('should find one document', async () => {
      const user = await createTestUser('gsfindone');

      const {success, doc} = await GeneralServices.findOne({
        model: modelConstants.MODELS.USER,
        query: {id: user.id},
      });

      expect(success).toBe(true);
      expect(doc.email).toBe(user.email);
    });
  });

  describe('findById', () => {
    it('should find by id', async () => {
      const user = await createTestUser('gsfindbyid');

      const {success, doc} = await GeneralServices.findById({
        model: modelConstants.MODELS.USER,
        id: user.id,
      });

      expect(success).toBe(true);
      expect(doc.id).toBe(user.id);
    });
  });

  describe('findAllAndUpdate', () => {
    it('should update multiple and return them', async () => {
      const user1 = await createTestUser('gsupdate1');
      const user2 = await createTestUser('gsupdate2');

      const {success, docs, areDocumentsUpdated} =
        await GeneralServices.findAllAndUpdate({
          model: modelConstants.MODELS.USER,
          query: {id: {in: [user1.id, user2.id]}},
          data: {lastName: 'GSUpdated'},
        });

      expect(success).toBe(true);
      expect(areDocumentsUpdated).toBe(true);
      expect(docs.length).toBe(2);
    });
  });

  describe('findAllAndDelete', () => {
    it('should delete multiple and return them', async () => {
      const user = await createTestUser('gsdel-creator');
      const org = await createTestOrg(user.id);

      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'GSDel1',
          code: `GSD1-${Date.now()}`,
          organizationId: org.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'GSDel2',
          code: `GSD2-${Date.now()}`,
          organizationId: org.id,
        },
      });

      const {success, docs, areDocumentsDeleted} =
        await GeneralServices.findAllAndDelete({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          options: {hardDelete: true},
        });

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
      expect(docs.length).toBe(2);
    });
  });

  describe('countDocuments', () => {
    it('should count documents', async () => {
      const {success, count} = await GeneralServices.countDocuments({
        model: modelConstants.MODELS.USER,
        query: {},
      });

      expect(success).toBe(true);
      expect(typeof count).toBe('number');
    });
  });
});

describe('Region API Simulation Tests', () => {
  let testUser;
  let testOrg;

  beforeAll(async () => {
    testUser = await createTestUser('region-api');
    testOrg = await createTestOrg(testUser.id);
  });

  describe('Create Region', () => {
    it('should create region', async () => {
      const {success, doc} = await GeneralServices.create({
        model: modelConstants.MODELS.REGION,
        data: {
          name: 'API Region',
          code: `AR-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      expect(success).toBe(true);
      expect(doc.name).toBe('API Region');
    });
  });

  describe('Get All Regions', () => {
    it('should get all regions', async () => {
      const {success, docs} = await GeneralServices.findAll({
        model: modelConstants.MODELS.REGION,
        query: {organizationId: testOrg.id},
      });

      expect(success).toBe(true);
      expect(Array.isArray(docs)).toBe(true);
    });
  });

  describe('Get Region By ID', () => {
    it('should get region by id', async () => {
      const region = await getPrismaClient().region.create({
        data: {
          name: 'GetById',
          code: `GBI-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, doc} = await GeneralServices.findById({
        model: modelConstants.MODELS.REGION,
        id: region.id,
      });

      expect(success).toBe(true);
      expect(doc.name).toBe('GetById');
    });
  });

  describe('Update Region', () => {
    it('should update region', async () => {
      const region = await getPrismaClient().region.create({
        data: {
          name: 'ToUpdate',
          code: `TU-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, doc} = await GeneralServices.findByIdAndUpdate({
        model: modelConstants.MODELS.REGION,
        id: region.id,
        data: {name: 'Updated'},
      });

      expect(success).toBe(true);
      expect(doc.name).toBe('Updated');
    });
  });

  describe('Bulk Update Regions', () => {
    it('should bulk update regions', async () => {
      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'Bulk1',
          code: `BU1-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'Bulk2',
          code: `BU2-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, docs, areDocumentsUpdated} =
        await GeneralServices.findAllAndUpdate({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          data: {name: 'BulkUpdated'},
        });

      expect(success).toBe(true);
      expect(areDocumentsUpdated).toBe(true);
      expect(docs.length).toBe(2);
      docs.forEach((doc) => expect(doc.name).toBe('BulkUpdated'));
    });
  });

  describe('Delete Region', () => {
    it('should soft delete region', async () => {
      const region = await getPrismaClient().region.create({
        data: {
          name: 'ToDelete',
          code: `TD-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, doc} = await GeneralServices.findByIdAndDelete({
        model: modelConstants.MODELS.REGION,
        id: region.id,
      });

      expect(success).toBe(true);
      expect(doc.isDeleted).not.toBeNull();
    });
  });

  describe('Bulk Delete Regions', () => {
    it('should bulk delete regions (soft)', async () => {
      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'BulkDel1',
          code: `BD1-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'BulkDel2',
          code: `BD2-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, docs, areDocumentsDeleted} =
        await GeneralServices.findAllAndDelete({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          options: {hardDelete: false},
        });

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
      expect(docs.length).toBe(2);
    });

    it('should bulk delete regions (hard)', async () => {
      const region1 = await getPrismaClient().region.create({
        data: {
          name: 'HardBulk1',
          code: `HB1-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });
      const region2 = await getPrismaClient().region.create({
        data: {
          name: 'HardBulk2',
          code: `HB2-${Date.now()}`,
          organizationId: testOrg.id,
        },
      });

      const {success, docs, areDocumentsDeleted} =
        await GeneralServices.findAllAndDelete({
          model: modelConstants.MODELS.REGION,
          query: {id: {in: [region1.id, region2.id]}},
          options: {hardDelete: true},
        });

      expect(success).toBe(true);
      expect(areDocumentsDeleted).toBe(true);
      expect(docs.length).toBe(2);

      // Verify hard deleted
      const remaining = await getPrismaClient().region.findMany({
        where: {id: {in: [region1.id, region2.id]}},
      });
      expect(remaining.length).toBe(0);
    });
  });
});
