import type { SyntaxNode } from '../utils.js';
import type { LanguageTypeConfig, ParameterExtractor, TypeBindingExtractor, InitializerExtractor, ClassNameLookup, ConstructorBindingScanner, PendingAssignmentExtractor, PatternBindingExtractor, ForLoopExtractor } from './types.js';
import { extractSimpleTypeName, extractVarName, extractElementTypeFromString, extractGenericTypeArgs, resolveIterableElementType, methodToTypeArgPosition, type TypeArgPosition } from './shared.js';

const DECLARATION_NODE_TYPES: ReadonlySet<string> = new Set([
  'assignment',
  'named_expression',
  'expression_statement',
]);

/** Python: x: Foo = ... (PEP 484 annotated assignment) or x: Foo (standalone annotation).
 *
 * tree-sitter-python grammar produces two distinct shapes:
 *
 *   1. Annotated assignment with value:  `name: str = ""`
 *      Node type: `assignment`
 *      Fields: left=identifier, type=identifier/type, right=value
 *
 *   2. Standalone annotation (no value):  `name: str`
 *      Node type: `expression_statement`
 *      Child: `type` node with fields name=identifier, type=identifier/type
 *
 * Both appear at file scope and inside class bodies (PEP 526 class variable annotations).
 */
const extractDeclaration: TypeBindingExtractor = (node: SyntaxNode, env: Map<string, string>): void => {
  if (node.type === 'expression_statement') {
    // Standalone annotation: expression_statement > type { name: identifier, type: identifier }
    const typeChild = node.firstNamedChild;
    if (!typeChild || typeChild.type !== 'type') return;
    const nameNode = typeChild.childForFieldName('name');
    const typeNode = typeChild.childForFieldName('type');
    if (!nameNode || !typeNode) return;
    const varName = extractVarName(nameNode);
    const inner = typeNode.type === 'type' ? (typeNode.firstNamedChild ?? typeNode) : typeNode;
    const typeName = extractSimpleTypeName(inner) ?? inner.text;
    if (varName && typeName) env.set(varName, typeName);
    return;
  }

  // Annotated assignment: left : type = value
  const left = node.childForFieldName('left');
  const typeNode = node.childForFieldName('type');
  if (!left || !typeNode) return;
  const varName = extractVarName(left);
  // extractSimpleTypeName handles identifiers and qualified names.
  // Python 3.10+ union syntax `User | None` is parsed as binary_operator,
  // which extractSimpleTypeName doesn't handle. Fall back to raw text so
  // stripNullable can process it at lookup time (e.g., "User | None" → "User").
  const inner = typeNode.type === 'type' ? (typeNode.firstNamedChild ?? typeNode) : typeNode;
  const typeName = extractSimpleTypeName(inner) ?? inner.text;
  if (varName && typeName) env.set(varName, typeName);
};

/** Python: parameter with type annotation */
const extractParameter: ParameterExtractor = (node: SyntaxNode, env: Map<string, string>): void => {
  let nameNode: SyntaxNode | null = null;
  let typeNode: SyntaxNode | null = null;

  if (node.type === 'parameter') {
    nameNode = node.childForFieldName('name');
    typeNode = node.childForFieldName('type');
  } else {
    nameNode = node.childForFieldName('name') ?? node.childForFieldName('pattern');
    typeNode = node.childForFieldName('type');
  }

  if (!nameNode || !typeNode) return;
  const varName = extractVarName(nameNode);
  const typeName = extractSimpleTypeName(typeNode);
  if (varName && typeName) env.set(varName, typeName);
};

/** Python: user = User("alice") — infer type from call when callee is a known class.
 *  Python constructors are syntactically identical to function calls, so we verify
 *  against classNames (which may include cross-file SymbolTable lookups).
 *  Also handles walrus operator: if (user := User("alice")): */
const extractInitializer: InitializerExtractor = (node: SyntaxNode, env: Map<string, string>, classNames: ClassNameLookup): void => {
  let left: SyntaxNode | null;
  let right: SyntaxNode | null;

  if (node.type === 'named_expression') {
    // Walrus operator: (user := User("alice"))
    // tree-sitter-python: named_expression has 'name' and 'value' fields
    left = node.childForFieldName('name');
    right = node.childForFieldName('value');
  } else if (node.type === 'assignment') {
    left = node.childForFieldName('left');
    right = node.childForFieldName('right');
    // Skip if already has type annotation — extractDeclaration handled it
    if (node.childForFieldName('type')) return;
  } else {
    return;
  }

  if (!left || !right) return;
  const varName = extractVarName(left);
  if (!varName || env.has(varName)) return;
  if (right.type !== 'call') return;
  const func = right.childForFieldName('function');
  if (!func) return;
  // Support both direct calls (User()) and qualified calls (models.User())
  // tree-sitter-python: direct → identifier, qualified → attribute
  const calleeName = extractSimpleTypeName(func);
  if (!calleeName) return;
  if (classNames.has(calleeName)) {
    env.set(varName, calleeName);
  }
};

/** Python: user = User("alice") — scan assignment/walrus for constructor-like calls.
 *  Returns {varName, calleeName} without checking classNames (caller validates). */
const scanConstructorBinding: ConstructorBindingScanner = (node) => {
  let left: SyntaxNode | null;
  let right: SyntaxNode | null;

  if (node.type === 'named_expression') {
    left = node.childForFieldName('name');
    right = node.childForFieldName('value');
  } else if (node.type === 'assignment') {
    left = node.childForFieldName('left');
    right = node.childForFieldName('right');
    if (node.childForFieldName('type')) return undefined;
  } else {
    return undefined;
  }

  if (!left || !right) return undefined;
  if (left.type !== 'identifier') return undefined;
  if (right.type !== 'call') return undefined;
  const func = right.childForFieldName('function');
  if (!func) return undefined;
  const calleeName = extractSimpleTypeName(func);
  if (!calleeName) return undefined;
  return { varName: left.text, calleeName };
};

const FOR_LOOP_NODE_TYPES: ReadonlySet<string> = new Set([
  'for_statement',
]);

/** Python function/method node types that carry a parameters list. */
const PY_FUNCTION_NODE_TYPES = new Set([
  'function_definition', 'decorated_definition',
]);

/**
 * Extract element type from a Python type annotation AST node.
 * Handles:
 *   subscript "List[User]"  →  extractElementTypeFromString("List[User]") → "User"
 *   generic_type            →  extractGenericTypeArgs → first arg
 * Falls back to text-based extraction.
 */
const extractPyElementTypeFromAnnotation = (typeNode: SyntaxNode, pos: TypeArgPosition = 'last'): string | undefined => {
  // Unwrap 'type' wrapper node to get to the actual type (e.g., type > generic_type)
  const inner = typeNode.type === 'type' ? (typeNode.firstNamedChild ?? typeNode) : typeNode;

  // Python subscript: List[User], Sequence[User] — use raw text
  if (inner.type === 'subscript') {
    return extractElementTypeFromString(inner.text, pos);
  }
  // generic_type: dict[str, User] — tree-sitter-python uses type_parameter child
  if (inner.type === 'generic_type') {
    // Try standard extractGenericTypeArgs first (handles type_arguments)
    const args = extractGenericTypeArgs(inner);
    if (args.length >= 1) return pos === 'first' ? args[0] : args[args.length - 1];
    // Fallback: look for type_parameter child (tree-sitter-python specific)
    for (let i = 0; i < inner.namedChildCount; i++) {
      const child = inner.namedChild(i);
      if (child?.type === 'type_parameter') {
        if (pos === 'first') {
          const firstArg = child.firstNamedChild;
          if (firstArg) return extractSimpleTypeName(firstArg);
        } else {
          const lastArg = child.lastNamedChild;
          if (lastArg) return extractSimpleTypeName(lastArg);
        }
      }
    }
  }
  // Fallback: raw text extraction (handles User[], [User], etc.)
  return extractElementTypeFromString(inner.text, pos);
};

/**
 * Walk up the AST from a for-statement to find the enclosing function definition,
 * then search its parameters for one named `iterableName`.
 * Returns the element type extracted from its type annotation, or undefined.
 *
 * Handles both `parameter` and `typed_parameter` node types in tree-sitter-python.
 * `typed_parameter` may not expose the name as a `name` field — falls back to
 * checking the first identifier-type named child.
 */
const findPyParamElementType = (iterableName: string, startNode: SyntaxNode, pos: TypeArgPosition = 'last'): string | undefined => {
  let current: SyntaxNode | null = startNode.parent;
  while (current) {
    if (current.type === 'function_definition') {
      const paramsNode = current.childForFieldName('parameters');
      if (paramsNode) {
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const param = paramsNode.namedChild(i);
          if (!param) continue;
          // Try named `name` field first (parameter node), then first identifier child
          // (typed_parameter node may store name as first positional child)
          const nameNode = param.childForFieldName('name')
            ?? (param.firstNamedChild?.type === 'identifier' ? param.firstNamedChild : null);
          if (nameNode?.text !== iterableName) continue;
          // Try `type` field, then last named child (typed_parameter stores type last)
          const typeAnnotation = param.childForFieldName('type')
            ?? (param.namedChildCount >= 2 ? param.namedChild(param.namedChildCount - 1) : null);
          if (typeAnnotation && typeAnnotation !== nameNode) {
            return extractPyElementTypeFromAnnotation(typeAnnotation, pos);
          }
        }
      }
      break;
    }
    current = current.parent;
  }
  return undefined;
};

/**
 * Python: for user in users: where users has a known container type annotation.
 *
 * AST node: `for_statement` with `left` (loop variable) and `right` (iterable).
 *
 * Tier 1c: resolves the element type via three strategies in priority order:
 *   1. declarationTypeNodes — raw type annotation AST node (covers stored container types)
 *   2. scopeEnv string — extractElementTypeFromString on the stored type
 *   3. AST walk — walks up to the enclosing function's parameters to read List[User] directly
 */
const extractForLoopBinding: ForLoopExtractor = (node, { scopeEnv, declarationTypeNodes, scope, returnTypeLookup }): void => {
  if (node.type !== 'for_statement') return;

  // The iterable is the `right` field — may be identifier, attribute, or call.
  const rightNode = node.childForFieldName('right');
  let iterableName: string | undefined;
  let methodName: string | undefined;
  let callExprElementType: string | undefined;
  if (rightNode?.type === 'identifier') {
    iterableName = rightNode.text;
  } else if (rightNode?.type === 'attribute') {
    const prop = rightNode.lastNamedChild;
    if (prop) iterableName = prop.text;
  } else if (rightNode?.type === 'call') {
    // data.items() → call > function: attribute > identifier('data') + identifier('items')
    // get_users() → call > function: identifier (Phase 7.3 — return-type path)
    const fn = rightNode.childForFieldName('function');
    if (fn?.type === 'attribute') {
      const obj = fn.firstNamedChild;
      if (obj?.type === 'identifier') iterableName = obj.text;
      // Extract method name: items, keys, values
      const method = fn.lastNamedChild;
      if (method?.type === 'identifier' && method !== obj) methodName = method.text;
    } else if (fn?.type === 'identifier') {
      // Direct function call: for user in get_users()
      const rawReturn = returnTypeLookup.lookupRawReturnType(fn.text);
      if (rawReturn) callExprElementType = extractElementTypeFromString(rawReturn);
    }
  }
  if (!iterableName && !callExprElementType) return;

  let elementType: string | undefined;
  if (callExprElementType) {
    elementType = callExprElementType;
  } else {
    const containerTypeName = scopeEnv.get(iterableName!);
    const typeArgPos = methodToTypeArgPosition(methodName, containerTypeName);
    elementType = resolveIterableElementType(
      iterableName!, node, scopeEnv, declarationTypeNodes, scope,
      extractPyElementTypeFromAnnotation, findPyParamElementType,
      typeArgPos,
    );
  }
  if (!elementType) return;

  // The loop variable is the `left` field — identifier or pattern_list.
  const leftNode = node.childForFieldName('left');
  if (!leftNode) return;

  // Handle tuple unpacking: for key, value in data.items()
  if (leftNode.type === 'pattern_list') {
    const lastChild = leftNode.lastNamedChild;
    if (lastChild?.type === 'identifier') {
      scopeEnv.set(lastChild.text, elementType);
    }
    return;
  }

  const loopVarName = extractVarName(leftNode);
  if (loopVarName) scopeEnv.set(loopVarName, elementType);
};

/** Python: alias = u → assignment with left/right fields.
 *  Also handles walrus operator: alias := u → named_expression with name/value fields. */
const extractPendingAssignment: PendingAssignmentExtractor = (node, scopeEnv) => {
  let left: SyntaxNode | null;
  let right: SyntaxNode | null;

  if (node.type === 'assignment') {
    left = node.childForFieldName('left');
    right = node.childForFieldName('right');
  } else if (node.type === 'named_expression') {
    left = node.childForFieldName('name');
    right = node.childForFieldName('value');
  } else {
    return undefined;
  }

  if (!left || !right) return undefined;
  const lhs = left.type === 'identifier' ? left.text : undefined;
  if (!lhs || scopeEnv.has(lhs)) return undefined;
  if (right.type === 'identifier') return { kind: 'copy', lhs, rhs: right.text };
  return undefined;
};

/**
 * Python match/case `as` pattern binding: `case User() as u:`
 *
 * AST structure (tree-sitter-python):
 *   as_pattern
 *     alias: as_pattern_target   ← the bound variable name (e.g. "u")
 *     children[0]: case_pattern  ← wraps class_pattern (or is class_pattern directly)
 *       class_pattern
 *         dotted_name            ← the class name (e.g. "User")
 *
 * The `alias` field is an `as_pattern_target` node whose `.text` is the identifier.
 * The class name lives in the first non-alias named child: either a `case_pattern`
 * wrapping a `class_pattern`, or a direct `class_pattern`.
 *
 * Conservative: returns undefined when:
 * - The node is not an `as_pattern`
 * - The pattern side is not a class_pattern (e.g. guard or literal match)
 * - The variable was already bound in scopeEnv
 */
const extractPatternBinding: PatternBindingExtractor = (node, scopeEnv) => {
  if (node.type !== 'as_pattern') return undefined;

  // as_pattern: `case User() as u:` — binds matched value to a name.
  // Try named field first (future grammar versions may expose it), fall back to positional.
  if (node.namedChildCount < 2) return undefined;

  const patternChild = node.namedChild(0);
  const varNameNode = node.childForFieldName('alias')
    ?? node.namedChild(node.namedChildCount - 1);
  if (!patternChild || !varNameNode) return undefined;
  if (varNameNode.type !== 'identifier') return undefined;

  const varName = varNameNode.text;
  if (!varName || scopeEnv.has(varName)) return undefined;

  // Find the class_pattern — may be direct or wrapped in case_pattern.
  let classPattern: SyntaxNode | null = null;
  if (patternChild.type === 'class_pattern') {
    classPattern = patternChild;
  } else if (patternChild.type === 'case_pattern') {
    // Unwrap one level: case_pattern wraps class_pattern
    for (let j = 0; j < patternChild.namedChildCount; j++) {
      const inner = patternChild.namedChild(j);
      if (inner?.type === 'class_pattern') {
        classPattern = inner;
        break;
      }
    }
  }
  if (!classPattern) return undefined;

  // class_pattern children: dotted_name (the class name) + optional keyword_pattern args.
  const classNameNode = classPattern.firstNamedChild;
  if (!classNameNode || (classNameNode.type !== 'dotted_name' && classNameNode.type !== 'identifier')) return undefined;
  const typeName = classNameNode.text;
  if (!typeName) return undefined;

  return { varName, typeName };
};

const PATTERN_BINDING_NODE_TYPES: ReadonlySet<string> = new Set(['as_pattern']);

export const typeConfig: LanguageTypeConfig = {
  declarationNodeTypes: DECLARATION_NODE_TYPES,
  forLoopNodeTypes: FOR_LOOP_NODE_TYPES,
  patternBindingNodeTypes: PATTERN_BINDING_NODE_TYPES,
  extractDeclaration,
  extractParameter,
  extractInitializer,
  scanConstructorBinding,
  extractForLoopBinding,
  extractPendingAssignment,
  extractPatternBinding,
};
