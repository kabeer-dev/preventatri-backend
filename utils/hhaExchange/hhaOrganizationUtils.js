const config = require('config');

/**
 * The HHAeXchange credentials are one global set, so the integration belongs to
 * one organization: the one named in HHAX_ORGANIZATION_ID. Nobody else gets the
 * integration, and with no organization named, nobody does.
 */
const getHhaOrganizationId = () => config.get('hhax.organizationId') || null;

const isHhaOrganization = ({organizationId}) => {
  const hhaOrganizationId = getHhaOrganizationId();

  return Boolean(
    hhaOrganizationId && organizationId && hhaOrganizationId === organizationId
  );
};

module.exports = {getHhaOrganizationId, isHhaOrganization};
