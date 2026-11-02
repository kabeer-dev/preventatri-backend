module.exports.mergeAndDeduplicateFields = ({fields = [], scopedTo = []}) => {
  const mergedFields = fields.concat(scopedTo);

  return Array.from(new Set(mergedFields.filter(Boolean))); // removes falsy values and duplicates
};
