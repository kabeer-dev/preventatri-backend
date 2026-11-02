const {RISK_SCORE_THRESHOLDS} = require('../constants/riskCalcConstants');

module.exports = class EscalationAssignmentHelpers {
  /**
   * Fold a batch of ACTIVE escalations into each candidate's current workload.
   * Pure function — the caller fetches both sides.
   *
   * Every candidate is seeded before the fold, so the returned map always has an
   * entry for each one (callers can `.get()` without a miss) and an unassigned
   * nurse reads as an explicit {0, 0} rather than being absent. `nextExpiry`
   * stays Infinity for anyone with no escalations — only the assignment ranking
   * consumes it; the nurses-list stats ignore it.
   *
   * Shared by pickLeastLoadedNurse (auto-assignment) and the nurses-list alert
   * stats, where activeCount/redCount are the ASSIGNED ALERTS column's
   * "N Alerts (M High)" — one definition of "how loaded is this nurse".
   *
   * @param {Object} params
   * @param {Array}  params.candidates        [{userOrgId, userId}] nurses to score.
   * @param {Array}  params.activeEscalations ACTIVE escalations assigned to any
   *                                          candidate, each with currentAssigneeId,
   *                                          expiresAt and submissionFlag.flag.
   * @returns {Map<string, {activeCount: number, redCount: number, nextExpiry: number}>}
   *          Keyed by userOrgId.
   */
  static buildNurseLoadMap({candidates = [], activeEscalations = []}) {
    // Seed every candidate with an empty load, then fold their escalations in.
    const loadByUserOrgId = new Map(
      candidates.map((candidate) => [
        candidate.userOrgId,
        {activeCount: 0, redCount: 0, nextExpiry: Infinity},
      ])
    );

    activeEscalations.forEach((escalation) => {
      const load = loadByUserOrgId.get(escalation.currentAssigneeId);

      if (!load) {
        return;
      }

      load.activeCount += 1;

      if (escalation.submissionFlag?.flag === RISK_SCORE_THRESHOLDS.RED.flag) {
        load.redCount += 1;
      }

      if (escalation.expiresAt) {
        const expiresAtMs = new Date(escalation.expiresAt).getTime();

        if (expiresAtMs < load.nextExpiry) {
          load.nextExpiry = expiresAtMs;
        }
      }
    });

    return loadByUserOrgId;
  }

  /**
   * Rank region-nurse candidates by current workload and return the best pick
   * (or null when there are no candidates). Pure function — the caller fetches
   * the candidates and their ACTIVE escalations; this only decides the winner.
   *
   * Policy (highest priority first):
   *   1. FREE nurse — zero ACTIVE assigned escalations of any color;
   *   2. fewest ACTIVE RED escalations;
   *   3. soonest next expiry (whoever frees up a slot first);
   *   4. deterministic userOrgId tiebreak so equal loads pick stably.
   *
   * @param {Object}   params
   * @param {Array}    params.candidates        [{userOrgId, userId}] eligible nurses.
   * @param {Array}    params.activeEscalations  ACTIVE escalations assigned to any
   *                                             candidate, each with currentAssigneeId,
   *                                             expiresAt and submissionFlag.flag.
   * @returns {Object|null} The winning {userOrgId, userId} or null.
   */
  static pickLeastLoadedNurse({candidates = [], activeEscalations = []}) {
    if (candidates.length === 0) {
      return null;
    }

    const loadByUserOrgId = EscalationAssignmentHelpers.buildNurseLoadMap({
      candidates,
      activeEscalations,
    });

    const ranked = candidates.slice().sort((first, second) => {
      const firstLoad = loadByUserOrgId.get(first.userOrgId);
      const secondLoad = loadByUserOrgId.get(second.userOrgId);

      const firstFree = firstLoad.activeCount === 0;
      const secondFree = secondLoad.activeCount === 0;

      if (firstFree !== secondFree) {
        return firstFree ? -1 : 1;
      }

      if (firstLoad.redCount !== secondLoad.redCount) {
        return firstLoad.redCount - secondLoad.redCount;
      }

      if (firstLoad.nextExpiry !== secondLoad.nextExpiry) {
        return firstLoad.nextExpiry - secondLoad.nextExpiry;
      }

      return first.userOrgId < second.userOrgId ? -1 : 1;
    });

    return ranked[0];
  }
};
