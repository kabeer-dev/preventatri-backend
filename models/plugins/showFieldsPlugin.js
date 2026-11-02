function showFieldsPlugin(schema, options = {}) {
  const {fieldsToShow = []} = options;

  // Ensure a Set for fast lookups
  const fieldsSet = new Set(fieldsToShow);

  // Keep _id exposed by default
  fieldsSet.add('_id');

  // Loop through each path in the schema
  schema.eachPath((pathName, schemaType) => {
    if (!fieldsSet.has(pathName)) {
      schemaType.select(false); // Hide everything not explicitly listed
    }
  });
}

module.exports = showFieldsPlugin;
