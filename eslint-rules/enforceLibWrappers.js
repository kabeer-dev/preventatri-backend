/**
 * Custom ESLint rule: enforce-lib-wrappers
 *
 * Some libraries may be imported in one wrapper file only. Every other file
 * imports what it needs from that wrapper, so switching the library later
 * means changing one file.
 *
 * Options: {wrappers: {'<library>': '<wrapper path from the project root>'}}
 * An entry also covers the library's subpaths ('luxon' covers 'luxon/...').
 *
 * Checks imports, re-exports, dynamic import() and require().
 *
 * → Desol Int. internal rule
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import wrapped libraries only inside their wrapper file → Desol Int. internal rule',
      recommended: false,
    },
    schema: [
      {
        type: 'object',
        properties: {
          wrappers: {
            type: 'object',
            additionalProperties: {type: 'string'},
          },
        },
        required: ['wrappers'],
        additionalProperties: false,
      },
    ],
    messages: {
      useWrapper:
        "Import '{{library}}' only in {{wrapper}}. Add what you need there and import it from that file. → Desol Int. internal rule",
    },
  },

  create(context) {
    const {wrappers} = context.options[0];
    const filename = context.filename.replace(/\\/g, '/');

    function findLibrary({source}) {
      return Object.keys(wrappers).find(
        (library) => source === library || source.startsWith(`${library}/`)
      );
    }

    function check({node, sourceNode}) {
      if (sourceNode?.type !== 'Literal') return;
      if (typeof sourceNode.value !== 'string') return;

      const library = findLibrary({source: sourceNode.value});
      if (!library) return;

      const wrapper = wrappers[library];
      if (filename.endsWith(`/${wrapper}`)) return;

      context.report({
        node,
        messageId: 'useWrapper',
        data: {library, wrapper},
      });
    }

    return {
      ImportDeclaration(node) {
        check({node, sourceNode: node.source});
      },
      ExportNamedDeclaration(node) {
        check({node, sourceNode: node.source});
      },
      ExportAllDeclaration(node) {
        check({node, sourceNode: node.source});
      },
      ImportExpression(node) {
        check({node, sourceNode: node.source});
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier') return;
        if (node.callee.name !== 'require') return;

        check({node, sourceNode: node.arguments[0]});
      },
    };
  },
};
