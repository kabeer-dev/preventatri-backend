/**
 * An organization's own HHAeXchange credentials.
 *
 * The secret and key are stored encrypted. getConnection answers for screens
 * and never returns them; getCredentials hands the decrypted set to the sync
 * and must not be passed on to a response or a log.
 *
 * Every method names the organization it works on and skips the request-scoped
 * organization filter, because the nightly sync has no request.
 */

const modelConstants = require('../constants/modelConstants');
const PrismaFactory = require('../factories/PrismaFactory');
const {getCurrentTime, getEpochMillis} = require('../utils/dateUtils');
const {decryptString, encryptString} = require('../utils/encryptionUtils');
const {isDocumentDuplicationError} = require('../utils/general');

const BYPASS_REQUEST_SCOPE = {bypassExtraQueries: true};

// A sync sends hundreds of requests, so the decrypted set is kept briefly
// instead of being read and decrypted for each one. Only connected sets are
// kept, and every change here drops the organization's entry. Another server
// keeps its own copy until it expires.
const CREDENTIALS_CACHE_TTL_MS = 60 * 1000;

const credentialsCache = new Map();

// Raised on every drop. A read that was already running when the credentials
// changed would otherwise store the old set after the drop, so it only stores
// what it read when the version is still the one it started with.
const credentialsVersions = new Map();

const readCredentialsVersion = ({organizationId}) =>
  credentialsVersions.get(organizationId) || 0;

const readCachedCredentials = ({organizationId}) => {
  const entry = credentialsCache.get(organizationId);

  if (!entry) return null;

  if (entry.expiresAt <= getEpochMillis()) {
    credentialsCache.delete(organizationId);

    return null;
  }

  return entry.credentials;
};

const forgetCredentials = ({organizationId}) => {
  credentialsCache.delete(organizationId);

  credentialsVersions.set(
    organizationId,
    readCredentialsVersion({organizationId}) + 1
  );
};

// Expired entries are removed on every store, so the secret of an organization
// that stopped syncing does not stay in memory until the process restarts.
const storeCredentials = ({organizationId, credentials}) => {
  const now = getEpochMillis();

  credentialsCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) credentialsCache.delete(key);
  });

  credentialsCache.set(organizationId, {
    credentials,
    expiresAt: now + CREDENTIALS_CACHE_TTL_MS,
  });
};

// Enough for an error id or a short reason, never a response body.
const LAST_ERROR_MAX_LENGTH = 255;

module.exports = class HhaCredentialsServices {
  /**
   * What a screen may show: whether the organization is connected, the app
   * name and when it was last checked. Null when nothing was ever saved.
   */
  static async getConnection({organizationId}) {
    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId},
        options: BYPASS_REQUEST_SCOPE,
      });

      return {success, doc, error};
    } catch (error) {
      return {success: false, doc: null, error};
    }
  }

  /**
   * Whether HHAeXchange is on for the organization: it has credentials that
   * HHAeXchange accepted. A failed lookup is reported as a failure, not as
   * "not connected", so an outage is not mistaken for a missing connection.
   */
  static async isConnected({organizationId}) {
    if (!organizationId)
      return {success: true, isConnected: false, error: null};

    try {
      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId, isConnected: true},
        fieldsInclusion: {includeSpecificFields: ['id']},
        options: BYPASS_REQUEST_SCOPE,
      });

      return {success, isConnected: Boolean(success && doc), error};
    } catch (error) {
      return {success: false, isConnected: false, error};
    }
  }

  /**
   * The decrypted credentials the sync signs requests with. Null when the
   * organization has none or has not been connected.
   */
  static async getCredentials({organizationId}) {
    try {
      const cached = readCachedCredentials({organizationId});

      if (cached) return {success: true, credentials: cached, error: null};

      const versionAtStart = readCredentialsVersion({organizationId});

      const {success, doc, error} = await PrismaFactory.findOne({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId, isConnected: true},
        fieldsInclusion: {
          includeSpecificFields: [
            'appName',
            'encryptedAppSecret',
            'encryptedAppKey',
          ],
        },
        options: BYPASS_REQUEST_SCOPE,
      });

      if (!success) return {success: false, credentials: null, error};

      if (!doc) return {success: true, credentials: null, error: null};

      const credentials = {
        appName: doc.appName,
        appSecret: decryptString({encryptedText: doc.encryptedAppSecret}),
        appKey: decryptString({encryptedText: doc.encryptedAppKey}),
      };

      // Changed while this read was running: use what was read, keep nothing.
      if (readCredentialsVersion({organizationId}) === versionAtStart) {
        storeCredentials({organizationId, credentials});
      }

      return {success: true, credentials, error: null};
    } catch (error) {
      return {success: false, credentials: null, error};
    }
  }

  /**
   * Organizations that can sync: the ones with connected credentials.
   */
  static async listConnectedOrganizationIds() {
    try {
      const {success, docs, error} = await PrismaFactory.find({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {isConnected: true},
        fieldsInclusion: {includeSpecificFields: ['organizationId']},
        options: BYPASS_REQUEST_SCOPE,
      });

      return {
        success,
        organizationIds: (docs || []).map((doc) => doc.organizationId),
        error,
      };
    } catch (error) {
      return {success: false, organizationIds: [], error};
    }
  }

  /**
   * Saves (or replaces) the credentials. Pass isConnected true only after
   * HHAeXchange accepted them; markVerified records a later re-check.
   */
  static async saveCredentials({
    organizationId,
    appName,
    appSecret,
    appKey,
    connectedByUserId = null,
    isConnected = false,
    tx = null,
  }) {
    try {
      // Dropped before and after the write, so a read that starts in between
      // cannot keep the old set. Inside a caller's transaction the second drop
      // runs before the commit, so the caller must not pass one and rely on this.
      forgetCredentials({organizationId});

      const data = {
        appName,
        encryptedAppSecret: encryptString({plainText: appSecret}),
        encryptedAppKey: encryptString({plainText: appKey}),
        isConnected,
        lastVerifiedAt: isConnected ? getCurrentTime() : null,
        lastError: null,
        connectedByUserId,
      };

      const {
        success: isLookedUp,
        doc: existing,
        error: lookupError,
      } = await PrismaFactory.findOne({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId},
        fieldsInclusion: {includeSpecificFields: ['id']},
        options: BYPASS_REQUEST_SCOPE,
        tx,
      });

      if (!isLookedUp) return {success: false, error: lookupError};

      const written = existing
        ? await PrismaFactory.updateOne({
            model: modelConstants.MODELS.HHA_CREDENTIAL,
            query: {id: existing.id},
            data,
            options: BYPASS_REQUEST_SCOPE,
            tx,
          })
        : await PrismaFactory.create({
            model: modelConstants.MODELS.HHA_CREDENTIAL,
            data: Object.assign({organizationId}, data),
            options: BYPASS_REQUEST_SCOPE,
            tx,
          });

      // Another save created the row between the lookup and the create (a
      // double click): update that row instead of failing on the unique key.
      if (!existing && isDocumentDuplicationError({error: written.error})) {
        const {success, error} = await PrismaFactory.updateOne({
          model: modelConstants.MODELS.HHA_CREDENTIAL,
          query: {organizationId},
          data,
          options: BYPASS_REQUEST_SCOPE,
          tx,
        });

        forgetCredentials({organizationId});

        return {success, error};
      }

      forgetCredentials({organizationId});

      return {success: written.success, error: written.error};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Records the outcome of checking the credentials against HHAeXchange.
   * A failure keeps the organization not connected and remembers why.
   */
  static async markVerified({organizationId, isConnected, lastError = null}) {
    try {
      forgetCredentials({organizationId});

      const {success, error} = await PrismaFactory.updateOne({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId},
        data: {
          isConnected,
          lastVerifiedAt: getCurrentTime(),
          lastError: lastError
            ? String(lastError).slice(0, LAST_ERROR_MAX_LENGTH)
            : null,
        },
        options: BYPASS_REQUEST_SCOPE,
      });

      forgetCredentials({organizationId});

      return {success, error};
    } catch (error) {
      return {success: false, error};
    }
  }

  /**
   * Removes the organization's credentials, which turns HHAeXchange off for it.
   */
  static async disconnect({organizationId}) {
    try {
      forgetCredentials({organizationId});

      const {success, error} = await PrismaFactory.hardDeleteMany({
        model: modelConstants.MODELS.HHA_CREDENTIAL,
        query: {organizationId},
        options: BYPASS_REQUEST_SCOPE,
      });

      forgetCredentials({organizationId});

      return {success, error};
    } catch (error) {
      return {success: false, error};
    }
  }
};
