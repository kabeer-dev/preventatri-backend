/**
 * Custom ESLint Rule: no-spread-operator
 *
 * Ensures:
 * 1. No spread operator (...) is used for merging/concatenation in the codebase
 * 2. Spread in arrays: [...array, ...anotherArray]
 * 3. Spread in objects: {...obj, ...anotherObj}
 * 4. Spread in function calls: func(...args)
 *
 * This rule only targets SPREAD operators used for merging/spreading.
 *
 * ALLOWED (Rest operators):
 * ✅ Rest in destructuring: const {a, ...rest} = obj
 * ✅ Rest in array destructuring: const [first, ...rest] = array
 * ✅ Rest parameters: function fn(...args) {}
 *
 * NOT ALLOWED (Spread operators):
 * ❌ Spread in objects: {...obj}
 * ❌ Spread in arrays: [...array]
 * ❌ Spread in calls: func(...args)
 *
 * → Desol Int. internal rule
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow spread operators (...) for merging/concatenation in the codebase → Desol Int. internal rule',
      recommended: false,
    },
    fixable: null,
    schema: [],
    messages: {
      noSpreadOperator:
        'Spread operator is not allowed. Found spread syntax in {{context}}. → Desol Int. internal rule',
    },
  },

  create(context) {
    return {
      // Detect spread operator in arrays, objects, and function calls
      // This only flags SPREAD syntax (merging/concatenation), not REST syntax (destructuring)
      SpreadElement(node) {
        const parent = node.parent;
        let contextType = 'unknown context';

        if (parent.type === 'ArrayExpression') {
          contextType = 'array expression';
        } else if (parent.type === 'CallExpression') {
          contextType = 'function call';
        } else if (parent.type === 'NewExpression') {
          contextType = 'constructor call';
        } else if (parent.type === 'ObjectExpression') {
          contextType = 'object expression';
        }

        context.report({
          node,
          messageId: 'noSpreadOperator',
          data: {
            context: contextType,
          },
        });
      },

      // Note: RestElement is intentionally NOT checked here
      // Rest parameters (function fn(...args)) and rest in destructuring
      // (const {a, ...rest} = obj) are allowed by this rule
    };
  },
};
