/**
 * Custom ESLint Rule: enforce-route-order
 *
 * Ensures:
 * 1. Routes are grouped by HTTP method (GET, POST, PATCH, DELETE, etc.)
 * 2. Within each method group, static routes come BEFORE dynamic ones (/:param)
 *    Note: We DO NOT enforce lexicographic order among static routes (or among dynamic ones).
 *    The original relative order within static and within dynamic groups is preserved.
 *
 * Now includes autofix for misplaced HTTP methods.
 *
 * → Desol Int. internal rule
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ensure routes are grouped by HTTP method and static routes come before dynamic ones → Desol Int. internal rule',
      recommended: false,
    },
    fixable: 'code',
    schema: [],
    messages: {
      dynamicBeforeStatic:
        'Dynamic route "{{method}} {{route}}" should be placed after static route "{{method}} {{staticRoute}}" (line {{staticLine}}). Static routes must come first within each method group. → Desol Int. internal rule',
      methodOutOfOrder:
        '{{method}} route "{{route}}" appears after {{lastMethod}} routes. Group all {{method}} routes together before {{lastMethod}} routes. Expected method order: {{expectedOrder}}. → Desol Int. internal rule',
    },
  },

  create(context) {
    const routerIdentifiers = new Set();
    const routeStacksByRouter = new Map();

    const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'all'];

    const METHOD_ORDER_MAP = new Map(
      METHOD_ORDER.map((method, index) => [method, index])
    );

    function isExpressRouterDeclaration({node}) {
      return (
        node.type === 'VariableDeclarator' &&
        node.init &&
        node.init.type === 'CallExpression' &&
        node.init.callee &&
        node.init.callee.object &&
        node.init.callee.object.name === 'express' &&
        node.init.callee.property &&
        node.init.callee.property.name === 'Router'
      );
    }

    function isExpressRoute({node}) {
      if (!node.callee || !node.callee.object || !node.callee.property)
        return false;

      const routerName = node.callee.object.name;
      const method = node.callee.property.name;

      return (
        routerIdentifiers.has(routerName) &&
        METHOD_ORDER_MAP.has(method) &&
        node.arguments &&
        node.arguments[0] &&
        node.arguments[0].type === 'Literal'
      );
    }

    function isDynamicRoute({routePath}) {
      if (typeof routePath !== 'string') return false;

      // Consider a route dynamic if it has param segments like ":id", wildcard "*",
      // or express-style regex params like ":id(\\d+)".

      return routePath.includes('/:') || routePath.includes('*');
    }

    // Safe trailing whitespace stripper to avoid any potential regex backtracking issues.
    // Removes standard Unicode whitespace via trimEnd, then explicitly removes NBSP (\u00A0)
    // and BOM/ZWNBSP (\uFEFF) from the end without using regex.
    function stripTrailingWhitespaceSafe({text}) {
      const s = String(text).trimEnd();
      let end = s.length;
      while (end > 0) {
        const ch = s.charCodeAt(end - 1);
        if (ch === 0x00a0 || ch === 0xfeff) {
          end--;
        } else {
          break;
        }
      }

      return end === s.length ? s : s.slice(0, end);
    }

    return {
      VariableDeclarator(node) {
        if (isExpressRouterDeclaration({node}) && node.id && node.id.name) {
          const routerName = node.id.name;
          routerIdentifiers.add(routerName);
          routeStacksByRouter.set(routerName, []);
        }
      },

      CallExpression(node) {
        if (!isExpressRoute({node})) return;

        const routerName = node.callee.object.name;
        const method = node.callee.property.name;
        const routePath = node.arguments[0].value;
        if (typeof routePath !== 'string') return;

        const stack = routeStacksByRouter.get(routerName);
        stack.push({
          node,
          method,
          methodOrder: METHOD_ORDER_MAP.get(method),
          route: routePath,
          isDynamic: isDynamicRoute({routePath}),
          line: node.loc.start.line,
        });
      },

      'Program:exit'() {
        const sourceCode = context.getSourceCode();

        for (const [, routeStack] of routeStacksByRouter) {
          if (routeStack.length <= 1) continue;

          // Build desired order WITHOUT enforcing lexicographic sorting inside groups.
          // For each method (in METHOD_ORDER), place all static routes first (preserving
          // original order), then all dynamic routes (preserving their original order).
          const byMethod = new Map();
          for (const r of routeStack) {
            if (!byMethod.has(r.method)) byMethod.set(r.method, []);
            byMethod.get(r.method).push(r);
          }

          let sorted = [];
          for (const method of METHOD_ORDER) {
            const items = byMethod.get(method);
            if (!items || items.length === 0) continue;
            const staticOnes = items.filter((x) => !x.isDynamic);
            const dynamicOnes = items.filter((x) => x.isDynamic);
            sorted = sorted.concat(staticOnes).concat(dynamicOnes);
          }

          // Check if already in desired order
          let alreadySorted = true;
          for (let i = 0; i < routeStack.length; i++) {
            if (routeStack[i].node !== sorted[i].node) {
              alreadySorted = false;
              break;
            }
          }
          if (alreadySorted) continue;

          const firstStmt = routeStack[0].node.parent;
          const lastStmt = routeStack[routeStack.length - 1].node.parent;

          // Build replacement text with double newlines between each route statement for readability
          const newBlock = sorted
            .map((r) =>
              stripTrailingWhitespaceSafe({
                text: sourceCode.getText(r.node.parent),
              })
            )
            .join('\n\n');

          // Find a representative mismatch to produce a meaningful message
          let offending = null;
          for (let i = 0; i < routeStack.length; i++) {
            if (routeStack[i].node !== sorted[i].node) {
              offending = {current: routeStack[i], target: sorted[i]};
              break;
            }
          }

          context.report({
            node: offending?.current?.node || firstStmt,
            messageId:
              offending &&
              offending.current.methodOrder !== offending.target.methodOrder
                ? 'methodOutOfOrder'
                : 'dynamicBeforeStatic',
            data: offending
              ? {
                  method: offending.current.method.toUpperCase(),
                  route: offending.current.route,
                  lastMethod: offending.target.method.toUpperCase(),
                  expectedOrder: METHOD_ORDER.map((m) => m.toUpperCase()).join(
                    ' → '
                  ),
                  staticRoute: offending.target.route,
                  staticLine: offending.target.line,
                }
              : {},
            fix(fixer) {
              return fixer.replaceTextRange(
                [firstStmt.range[0], lastStmt.range[1]],
                newBlock
              );
            },
          });
        }
      },
    };
  },
};
