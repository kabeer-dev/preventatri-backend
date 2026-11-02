/**
 * Custom ESLint rule: enforce-single-object-param
 *
 * Enforces that functions either:
 * - Take no parameters, OR
 * - Accept only a single parameter of type object (object pattern or typed object)
 *
 * Why?
 * - Encourages clean, scalable APIs
 * - Prevents primitive, positional, or multiple param usage
 * - Improves function readability and testability
 *
 * Automatically ignores:
 * - Callback-style functions (e.g., map callbacks, JSX handlers)
 * - Class constructors
 *
 * → Desol Int. internal rule
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Only object-type param is allowed in top-level or named functions (0 or 1 param allowed) → Desol Int. internal rule',
      recommended: false,
    },
    schema: [],
    messages: {
      invalidParams:
        'Params passed to the function are not allowed. Only a single object-type param is allowed. → Desol Int. internal rule',
    },
  },

  create(context) {
    // Identify patterns that are clearly callback-style functions
    function isLikelyCallback({node}) {
      let parent = node.parent;

      // JSX handlers like onClick={() => ...}
      if (
        parent?.type === 'JSXExpressionContainer' &&
        parent.parent?.type === 'JSXAttribute'
      ) {
        return true;
      }

      // JSX directly
      if (parent?.type === 'JSXAttribute') {
        return true;
      }

      // Array methods
      if (parent?.type === 'CallExpression') {
        return true;
      }

      // Inline object callbacks like mutationFn: (x) => ...
      if (
        parent?.type === 'Property' &&
        parent.parent?.type === 'ObjectExpression'
      ) {
        return true;
      }

      return false;
    }

    // Skip constructor methods — they often have required positional params
    function isConstructor({node}) {
      return (
        node.type === 'FunctionExpression' &&
        node.parent?.type === 'MethodDefinition' &&
        node.parent.kind === 'constructor'
      );
    }

    // Determines whether a type annotation refers to an object type
    function isObjectTypeAnnotation({typeAnnotationNode}) {
      if (!typeAnnotationNode) return false;

      if (
        typeAnnotationNode.type === 'TSTypeLiteral' ||
        typeAnnotationNode.type === 'TSInterfaceBody'
      ) {
        return true;
      }

      // Union types are only valid if all branches are object types
      if (typeAnnotationNode.type === 'TSUnionType') {
        return typeAnnotationNode.types.every((t) =>
          isObjectTypeAnnotation({typeAnnotationNode: t})
        );
      }

      // Allow references to object types (e.g., User), disallow known primitives
      if (typeAnnotationNode.type === 'TSTypeReference') {
        let typeName;
        if (typeAnnotationNode.typeName.type === 'Identifier') {
          typeName = typeAnnotationNode.typeName.name;
        } else if (typeAnnotationNode.typeName.type === 'TSQualifiedName') {
          typeName = typeAnnotationNode.typeName.right.name;
        } else {
          return false; // Unknown structure
        }

        const forbidden = [
          'string',
          'number',
          'boolean',
          'null',
          'undefined',
          'bigint',
          'symbol',
        ];

        return !forbidden.includes(typeName);
      }

      return false;
    }

    function check({node}) {
      if (!node?.params) return;
      if (isLikelyCallback({node}) || isConstructor({node})) return;

      // Remove `...rest` params from consideration
      const regularParams = node.params.filter((p) => p.type !== 'RestElement');
      if (regularParams.length === 0) return;

      // Disallow multiple regular parameters
      if (regularParams.length > 1) {
        context.report({
          node,
          messageId: 'invalidParams',
        });

        return;
      }

      const param = regularParams[0];

      // ✅ Allow object destructuring: function({ id }) {}
      const isObjectDestructuring = param.type === 'ObjectPattern';

      // ✅ Allow typed identifier: function(user: User) {}
      const isTypedObjectParam =
        param.type === 'Identifier' &&
        isObjectTypeAnnotation({
          typeAnnotationNode: param.typeAnnotation?.typeAnnotation,
        });

      // ✅ Allow destructured default: function({ name } = {}) {}
      const isDefaultObjectParam =
        param.type === 'AssignmentPattern' &&
        param.left.type === 'ObjectPattern';

      // ❌ Otherwise, disallow (e.g. function(x), function(id: number))
      if (
        !isObjectDestructuring &&
        !isTypedObjectParam &&
        !isDefaultObjectParam
      ) {
        context.report({
          node: param,
          messageId: 'invalidParams',
        });
      }
    }

    return {
      FunctionDeclaration: (node) => check({node}),
      FunctionExpression: (node) => check({node}),
      ArrowFunctionExpression: (node) => check({node}),
    };
  },
};
