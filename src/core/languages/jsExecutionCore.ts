/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DRY RUN — JavaScript & TypeScript In-Context AST Execution Core
 *
 * Pure Babel AST instrumentation + JsTraceRuntime + shadow-scope execution
 * with zero dependency on BrowserExecutionManager or Worker APIs so it can run
 * cleanly inside jsWorker.ts as well as Node.js/Native fallback contexts.
 */

import * as BabelNamespace from '@babel/standalone';
import {
  ExecutionTrace,
  LanguageExecutionOptions,
  LanguageId,
  SecurityPolicy,
  TraceEvent,
} from '../types';
import {
  validateCodeSecurity,
  ExecutionGuard,
  DEFAULT_SECURITY_POLICY,
} from '../security/sandbox';
import { SourceMapper } from '../source-map/sourceMapper';
import { JsTraceRuntime } from './jsRuntime';
import {
  ExecutionCancellationToken,
  ExecutionCancelledError,
  createLifecycleErrorTrace,
} from '../execution/contracts';

const Babel: typeof BabelNamespace =
  (BabelNamespace as any).default || BabelNamespace;

let babelWarmupDurationMs: number | null = null;

/**
 * Performs a tiny one-time parse/transform warmup of @babel/standalone inside
 * the current execution context (typically a dedicated Web Worker).
 */
export function warmupJsCompiler(): number {
  if (babelWarmupDurationMs !== null) {
    return 0;
  }
  const start = performance.now();
  try {
    Babel.transform('const __dryRunWarmup = 1;', {
      filename: 'warmup.js',
      presets: [],
      plugins: [],
      compact: true,
      sourceMaps: false,
    });
  } catch {
    // Ignore unexpected warmup errors; real runs will report errors accurately
  }
  babelWarmupDurationMs = Math.max(1, Math.round(performance.now() - start));
  return babelWarmupDurationMs;
}

export interface JsExecutionCoreOptions extends LanguageExecutionOptions {
  language?: Extract<LanguageId, 'javascript' | 'typescript'>;
  cancellationToken?: ExecutionCancellationToken;
  streamBatchSize?: number;
  onProgressStep?: (totalEventsCount: number, recentEvents: TraceEvent[]) => void;
}

export interface JsExecutionCoreResult {
  trace: ExecutionTrace;
  transformDurationMs: number;
  executionDurationMs: number;
}

function extractPatternIdentifiers(t: any, patternNode: any, out: string[] = []): string[] {
  if (!patternNode) return out;
  if (t.isIdentifier(patternNode)) {
    out.push(patternNode.name);
  } else if (t.isAssignmentPattern(patternNode)) {
    extractPatternIdentifiers(t, patternNode.left, out);
  } else if (t.isRestElement(patternNode)) {
    extractPatternIdentifiers(t, patternNode.argument, out);
  } else if (t.isArrayPattern(patternNode)) {
    for (const el of patternNode.elements) {
      if (el) extractPatternIdentifiers(t, el, out);
    }
  } else if (t.isObjectPattern(patternNode)) {
    for (const prop of patternNode.properties) {
      if (t.isRestElement(prop)) {
        extractPatternIdentifiers(t, prop.argument, out);
      } else if (t.isObjectProperty(prop)) {
        extractPatternIdentifiers(t, prop.value, out);
      }
    }
  }
  return out;
}

function extractIndexIdentifier(t: any, propNode: any): string | undefined {
  if (!propNode) return undefined;
  if (t.isIdentifier(propNode)) {
    return propNode.name;
  }
  if (t.isBinaryExpression(propNode)) {
    if (t.isIdentifier(propNode.left)) return propNode.left.name;
    if (t.isIdentifier(propNode.right)) return propNode.right.name;
  }
  if (t.isUpdateExpression(propNode) && t.isIdentifier(propNode.argument)) {
    return propNode.argument.name;
  }
  return undefined;
}

function extractSourceSlice(sourceCode: string, node: any): string | undefined {
  if (!node) return undefined;
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    return sourceCode.slice(node.start, node.end).trim();
  }
  return undefined;
}

/**
 * Creates the Babel AST plugin that instruments user JavaScript/TypeScript code
 * with runtime hooks into `__dr` (JsTraceRuntime) while preserving original source locations.
 */
export function createDryRunInstrumentationPlugin(sourceCode: string) {
  return function dryRunPlugin({ types: t }: { types: any }) {
    let loopCounter = 0;
    let fnCounter = 0;

    const getLoc = (node: any): { line: number; col: number } => {
      const line = node?.loc?.start?.line ?? 1;
      const col = (node?.loc?.start?.column ?? 0) + 1;
      return { line, col };
    };

    const markInstrumented = <T extends object>(node: T): T => {
      (node as any).__drInstrumented = true;
      return node;
    };

    const isInstrumented = (node: any): boolean => {
      return Boolean(node && node.__drInstrumented);
    };

    const makeDrCall = (method: string, args: any[], locNode?: any) => {
      const call = t.callExpression(
        t.memberExpression(t.identifier('__dr'), t.identifier(method)),
        args
      );
      if (locNode?.loc) {
        call.loc = locNode.loc;
      }
      return markInstrumented(call);
    };

    const makeLocMarker = (line: number, col: number) => {
      return makeDrCall('markLoc', [t.numericLiteral(line), t.numericLiteral(col)]);
    };

    const ensureBlockStatement = (stmtOrBlock: any): any => {
      if (t.isBlockStatement(stmtOrBlock)) {
        return stmtOrBlock;
      }
      const block = t.blockStatement([stmtOrBlock]);
      block.loc = stmtOrBlock.loc;
      return block;
    };

    const instrumentLoop = (
      path: any,
      loopKind: 'for' | 'while' | 'do_while' | 'for_of' | 'for_in',
      extraBodyTopStatements: any[] = [],
      conditionExprStr?: string
    ) => {
      if (isInstrumented(path.node)) return;
      markInstrumented(path.node);

      loopCounter++;
      const loopId = `loop_${loopCounter}`;
      const { line, col } = getLoc(path.node);

      const bodyBlock = ensureBlockStatement(path.node.body);
      path.node.body = bodyBlock;

      const iterStmt = t.expressionStatement(
        makeDrCall('loopIter', [
          t.stringLiteral(loopId),
          t.stringLiteral(loopKind),
          t.numericLiteral(line),
          t.numericLiteral(col),
        ])
      );

      bodyBlock.body.unshift(iterStmt, ...extraBodyTopStatements);

      const initArgs: any[] = [
        t.stringLiteral(loopId),
        t.stringLiteral(loopKind),
        t.numericLiteral(line),
        t.numericLiteral(col),
      ];
      if (conditionExprStr) {
        initArgs.push(t.stringLiteral(conditionExprStr));
      }

      const initCallStmt = t.expressionStatement(makeDrCall('loopInit', initArgs));

      const endCallStmt = t.expressionStatement(
        makeDrCall('loopEnd', [
          t.stringLiteral(loopId),
          t.stringLiteral(loopKind),
          t.numericLiteral(line),
          t.numericLiteral(col),
        ])
      );

      if (path.parentPath && path.parentPath.isLabeledStatement()) {
        const labeledNode = path.parentPath.node;
        if (isInstrumented(labeledNode)) return;
        markInstrumented(labeledNode);

        const tryStmt = markInstrumented(
          t.tryStatement(
            t.blockStatement([initCallStmt, labeledNode]),
            null,
            t.blockStatement([endCallStmt])
          )
        );
        path.parentPath.replaceWith(tryStmt);
      } else {
        const tryStmt = markInstrumented(
          t.tryStatement(
            t.blockStatement([initCallStmt, path.node]),
            null,
            t.blockStatement([endCallStmt])
          )
        );
        path.replaceWith(tryStmt);
      }
    };

    const instrumentFunction = (path: any) => {
      if (isInstrumented(path.node)) return;
      if (path.node.generator || path.node.async) return;
      markInstrumented(path.node);

      fnCounter++;
      const frameVarId = t.identifier(`__drFrame_${fnCounter}`);
      const { line, col } = getLoc(path.node);
      const endLine = path.node.loc?.end?.line ?? line;
      const endCol = (path.node.loc?.end?.column ?? 0) + 1;

      let fnName = 'anonymous';
      if (path.node.id && t.isIdentifier(path.node.id)) {
        fnName = path.node.id.name;
      } else if (
        path.parentPath?.isVariableDeclarator() &&
        t.isIdentifier(path.parentPath.node.id)
      ) {
        fnName = path.parentPath.node.id.name;
      } else if (
        (path.isObjectMethod() || path.isClassMethod()) &&
        t.isIdentifier(path.node.key)
      ) {
        fnName = path.node.key.name;
      }

      const paramNames: string[] = [];
      const paramValueExprs: any[] = [];
      for (const param of path.node.params) {
        if (t.isIdentifier(param)) {
          paramNames.push(param.name);
          paramValueExprs.push(t.identifier(param.name));
        } else if (t.isAssignmentPattern(param) && t.isIdentifier(param.left)) {
          paramNames.push(param.left.name);
          paramValueExprs.push(t.identifier(param.left.name));
        } else if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
          paramNames.push(param.argument.name);
          paramValueExprs.push(t.identifier(param.argument.name));
        }
      }

      if (!t.isBlockStatement(path.node.body)) {
        const exprBody = path.node.body;
        const retStmt = t.returnStatement(exprBody);
        retStmt.loc = exprBody.loc;
        path.node.body = t.blockStatement([retStmt]);
      }

      path.get('body').traverse({
        Function(innerPath: any) {
          innerPath.skip();
        },
        ReturnStatement(retPath: any) {
          if (isInstrumented(retPath.node)) return;
          markInstrumented(retPath.node);
          const retLoc = getLoc(retPath.node);
          const argExpr = retPath.node.argument || t.identifier('undefined');
          retPath.node.argument = makeDrCall(
            'ret',
            [
              frameVarId,
              t.stringLiteral(fnName),
              argExpr,
              t.numericLiteral(retLoc.line),
              t.numericLiteral(retLoc.col),
            ],
            retPath.node
          );
        },
      });

      const enterDecl = markInstrumented(
        t.variableDeclaration('const', [
          markInstrumented(
            t.variableDeclarator(
              frameVarId,
              makeDrCall('enterFn', [
                t.stringLiteral(fnName),
                markInstrumented(t.arrayExpression(paramNames.map((n) => t.stringLiteral(n)))),
                markInstrumented(t.arrayExpression(paramValueExprs)),
                t.numericLiteral(line),
                t.numericLiteral(col),
              ])
            )
          ),
        ])
      );

      const implicitRetStmt = t.expressionStatement(
        makeDrCall('retImplicit', [
          frameVarId,
          t.stringLiteral(fnName),
          t.numericLiteral(endLine),
          t.numericLiteral(endCol),
        ])
      );

      const exitCallStmt = t.expressionStatement(
        makeDrCall('exitFn', [frameVarId])
      );

      const originalBodyStmts = path.node.body.body;
      const wrappedTry = markInstrumented(
        t.tryStatement(
          t.blockStatement([...originalBodyStmts, implicitRetStmt]),
          null,
          t.blockStatement([exitCallStmt])
        )
      );

      path.node.body = t.blockStatement([enterDecl, wrappedTry]);
    };

    return {
      visitor: {
        FunctionDeclaration(path: any) {
          instrumentFunction(path);
        },
        FunctionExpression(path: any) {
          instrumentFunction(path);
        },
        ArrowFunctionExpression(path: any) {
          instrumentFunction(path);
        },
        ObjectMethod(path: any) {
          instrumentFunction(path);
        },
        ClassMethod(path: any) {
          if (path.node.kind === 'constructor') return;
          instrumentFunction(path);
        },

        VariableDeclarator(path: any) {
          if (isInstrumented(path.node)) return;
          const parentDecl = path.parentPath;
          if (!parentDecl || !parentDecl.isVariableDeclaration()) return;

          const grandParent = parentDecl.parentPath;
          if (
            grandParent &&
            (grandParent.isForOfStatement() || grandParent.isForInStatement()) &&
            grandParent.node.left === parentDecl.node
          ) {
            return;
          }

          markInstrumented(path.node);
          const kind = parentDecl.node.kind || 'let';
          const { line, col } = getLoc(path.node);

          if (t.isIdentifier(path.node.id)) {
            const varName = path.node.id.name;
            const rawInit = path.node.init || t.identifier('undefined');
            const initWithLoc = t.sequenceExpression([
              makeLocMarker(line, col),
              rawInit,
            ]);
            path.node.init = makeDrCall(
              'decl',
              [
                t.stringLiteral(varName),
                initWithLoc,
                t.stringLiteral(kind),
                t.numericLiteral(line),
                t.numericLiteral(col),
              ],
              path.node
            );
          } else if (
            (t.isArrayPattern(path.node.id) || t.isObjectPattern(path.node.id)) &&
            grandParent &&
            !grandParent.isForStatement()
          ) {
            const names = extractPatternIdentifiers(t, path.node.id);
            if (names.length > 0) {
              const props = names.map((n) =>
                t.objectProperty(t.identifier(n), t.identifier(n), false, true)
              );
              const declPatternStmt = t.expressionStatement(
                makeDrCall('declPattern', [
                  t.objectExpression(props),
                  t.stringLiteral(kind),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ])
              );
              parentDecl.insertAfter(declPatternStmt);
            }
          }
        },

        ArrayExpression(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const { line, col } = getLoc(path.node);
          path.replaceWith(
            makeDrCall(
              'arrayCreate',
              [path.node, t.numericLiteral(line), t.numericLiteral(col)],
              path.node
            )
          );
        },

        AssignmentExpression(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const { line, col } = getLoc(path.node);
          const { left, right, operator } = path.node;

          if (t.isIdentifier(left)) {
            const varName = left.name;
            path.replaceWith(
              makeDrCall(
                'assign',
                [
                  t.stringLiteral(varName),
                  path.node,
                  t.stringLiteral(operator),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ],
                path.node
              )
            );
          } else if (t.isMemberExpression(left)) {
            (left as any).__drSkipMemberRead = true;
            const objName = t.isIdentifier(left.object)
              ? t.stringLiteral(left.object.name)
              : t.identifier('undefined');

            if (left.computed) {
              const rhsVarName = t.isIdentifier(right)
                ? t.stringLiteral(right.name)
                : t.identifier('undefined');
              const idxVar = extractIndexIdentifier(t, left.property);
              const idxVarArg = idxVar ? t.stringLiteral(idxVar) : t.identifier('undefined');

              // Only unconditional indexed operands can prove a dependency on this write.
              const sites: any[] = [];
              function collectOperands(node: any): boolean {
                if (t.isBinaryExpression(node)) return collectOperands(node.left) && collectOperands(node.right);
                if (t.isIdentifier(node) || t.isNumericLiteral(node)) return true;
                if (!t.isMemberExpression(node) || !node.computed || !t.isIdentifier(node.object)) return false;
                const site = getLoc(node);
                sites.push(markInstrumented(t.arrayExpression([t.numericLiteral(site.line), t.numericLiteral(site.col)])));
                return true;
              }
              const operandSites = collectOperands(right) ? sites : [];
              path.replaceWith(
                makeDrCall(
                  'setIdx',
                  [
                    left.object,
                    left.property,
                    right,
                    t.stringLiteral(operator),
                    objName,
                    rhsVarName,
                    t.numericLiteral(line),
                    t.numericLiteral(col),
                    idxVarArg,
                    markInstrumented(t.arrayExpression(operandSites)),
                  ],
                  path.node
                )
              );
            } else if (t.isIdentifier(left.property)) {
              path.replaceWith(
                makeDrCall(
                  'setProp',
                  [
                    left.object,
                    t.stringLiteral(left.property.name),
                    right,
                    t.stringLiteral(operator),
                    objName,
                    t.numericLiteral(line),
                    t.numericLiteral(col),
                  ],
                  path.node
                )
              );
            }
          } else if (
            t.isArrayPattern(left) &&
            t.isArrayExpression(right) &&
            left.elements.length === right.elements.length
          ) {
            const allComputedMembers = left.elements.every(
              (el: any) => el && t.isMemberExpression(el) && el.computed
            );
            const allIdentifiers = left.elements.every(
              (el: any) => el && t.isIdentifier(el)
            );

            if (allComputedMembers) {
              const tempParams = left.elements.map((_: any, idx: number) =>
                t.identifier(`__drSwap_${idx}`)
              );
              const setCalls = left.elements.map((el: any, idx: number) => {
                (el as any).__drSkipMemberRead = true;
                const objName = t.isIdentifier(el.object)
                  ? t.stringLiteral(el.object.name)
                  : t.identifier('undefined');
                const idxVar = extractIndexIdentifier(t, el.property);
                const idxVarArg = idxVar ? t.stringLiteral(idxVar) : t.identifier('undefined');
                return makeDrCall('setIdx', [
                  el.object,
                  el.property,
                  tempParams[idx],
                  t.stringLiteral('='),
                  objName,
                  t.identifier('undefined'),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                  idxVarArg,
                ]);
              });

              const arrowFn = markInstrumented(
                t.arrowFunctionExpression(
                  tempParams,
                  t.sequenceExpression(setCalls)
                )
              );
              const iife = markInstrumented(
                t.callExpression(arrowFn, [...right.elements])
              );
              path.replaceWith(iife);
            } else if (allIdentifiers) {
              const assignCalls = left.elements.map((el: any) =>
                makeDrCall('assign', [
                  t.stringLiteral(el.name),
                  t.identifier(el.name),
                  t.stringLiteral('='),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ])
              );
              path.replaceWith(
                t.sequenceExpression([path.node, ...assignCalls])
              );
            }
          }
        },

        UpdateExpression(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const { line, col } = getLoc(path.node);
          const { argument, operator, prefix } = path.node;

          if (t.isIdentifier(argument)) {
            const name = argument.name;
            const prefixMutation = markInstrumented(
              t.updateExpression(operator, t.identifier(name), true)
            );
            const oldValExpr =
              operator === '++'
                ? t.binaryExpression('-', t.identifier(name), t.numericLiteral(1))
                : t.binaryExpression('+', t.identifier(name), t.numericLiteral(1));

            path.replaceWith(
              makeDrCall(
                'update',
                [
                  t.stringLiteral(name),
                  prefixMutation,
                  oldValExpr,
                  t.stringLiteral(operator),
                  t.booleanLiteral(prefix),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ],
                path.node
              )
            );
          } else if (t.isMemberExpression(argument) && argument.computed) {
            (argument as any).__drSkipMemberRead = true;
            const objName = t.isIdentifier(argument.object)
              ? t.stringLiteral(argument.object.name)
              : t.identifier('undefined');
            const idxVar = extractIndexIdentifier(t, argument.property);
            const idxVarArg = idxVar ? t.stringLiteral(idxVar) : t.identifier('undefined');

            path.replaceWith(
              makeDrCall(
                'updateIdx',
                [
                  argument.object,
                  argument.property,
                  t.stringLiteral(operator),
                  t.booleanLiteral(prefix),
                  objName,
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                  idxVarArg,
                ],
                path.node
              )
            );
          }
        },

        MemberExpression(path: any) {
          if (isInstrumented(path.node) || (path.node as any).__drSkipMemberRead) {
            return;
          }
          if (!path.node.computed) return;

          const parent = path.parentPath;
          if (parent) {
            if (parent.isAssignmentExpression() && parent.node.left === path.node) return;
            if (parent.isUpdateExpression() && parent.node.argument === path.node) return;
            if (parent.isUnaryExpression({ operator: 'delete' })) return;
            if (parent.isCallExpression() && parent.node.callee === path.node) return;
            if (parent.isArrayPattern() || parent.isObjectPattern()) return;
          }

          markInstrumented(path.node);
          const { line, col } = getLoc(path.node);
          const objName = t.isIdentifier(path.node.object)
            ? t.stringLiteral(path.node.object.name)
            : t.identifier('undefined');
          const idxVar = extractIndexIdentifier(t, path.node.property);
          const idxVarArg = idxVar ? t.stringLiteral(idxVar) : t.identifier('undefined');

          path.replaceWith(
            makeDrCall(
              'getIdx',
              [
                path.node.object,
                path.node.property,
                objName,
                t.numericLiteral(line),
                t.numericLiteral(col),
                idxVarArg,
                t.booleanLiteral(t.isIdentifier(path.node.property)),
              ],
              path.node
            )
          );
        },

        CallExpression(path: any) {
          if (isInstrumented(path.node)) return;
          const { callee, arguments: args } = path.node;
          const { line, col } = getLoc(path.node);

          if (t.isMemberExpression(callee) && !t.isSuper(callee.object)) {
            markInstrumented(path.node);
            (callee as any).__drSkipMemberRead = true;

            const propExpr = callee.computed
              ? callee.property
              : t.stringLiteral((callee.property as any).name);

            const objName = t.isIdentifier(callee.object)
              ? t.stringLiteral(callee.object.name)
              : t.identifier('undefined');

            path.replaceWith(
              makeDrCall(
                'callMethod',
                [
                  callee.object,
                  propExpr,
                  markInstrumented(t.arrayExpression(args)),
                  objName,
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ],
                path.node
              )
            );
          } else if (!t.isSuper(callee) && !t.isImport(callee)) {
            markInstrumented(path.node);
            path.replaceWith(
              t.sequenceExpression([makeLocMarker(line, col), path.node])
            );
          }
        },

        IfStatement(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const testLoc = getLoc(path.node.test || path.node);
          const hasAlternate = Boolean(path.node.alternate);
          const exprStr = extractSourceSlice(sourceCode, path.node.test);

          path.node.test = makeDrCall(
            'cond',
            [
              path.node.test,
              t.stringLiteral('if'),
              t.numericLiteral(testLoc.line),
              t.numericLiteral(testLoc.col),
              t.booleanLiteral(hasAlternate),
              exprStr ? t.stringLiteral(exprStr) : t.identifier('undefined'),
            ],
            path.node.test
          );
        },

        ConditionalExpression(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const testLoc = getLoc(path.node.test || path.node);
          const exprStr = extractSourceSlice(sourceCode, path.node.test);

          path.node.test = makeDrCall(
            'cond',
            [
              path.node.test,
              t.stringLiteral('ternary'),
              t.numericLiteral(testLoc.line),
              t.numericLiteral(testLoc.col),
              t.booleanLiteral(true),
              exprStr ? t.stringLiteral(exprStr) : t.identifier('undefined'),
            ],
            path.node.test
          );
        },

        ForStatement(path: any) {
          if (isInstrumented(path.node)) return;
          const exprStr = extractSourceSlice(sourceCode, path.node.test);
          const testNode = path.node.test || t.booleanLiteral(true);
          const testLoc = getLoc(path.node.test || path.node);

          path.node.test = makeDrCall(
            'cond',
            [
              testNode,
              t.stringLiteral('for'),
              t.numericLiteral(testLoc.line),
              t.numericLiteral(testLoc.col),
              t.booleanLiteral(false),
              exprStr ? t.stringLiteral(exprStr) : t.identifier('undefined'),
            ],
            testNode
          );

          instrumentLoop(path, 'for', [], exprStr);
        },

        WhileStatement(path: any) {
          if (isInstrumented(path.node)) return;
          const exprStr = extractSourceSlice(sourceCode, path.node.test);
          const testLoc = getLoc(path.node.test || path.node);

          path.node.test = makeDrCall(
            'cond',
            [
              path.node.test,
              t.stringLiteral('while'),
              t.numericLiteral(testLoc.line),
              t.numericLiteral(testLoc.col),
              t.booleanLiteral(false),
              exprStr ? t.stringLiteral(exprStr) : t.identifier('undefined'),
            ],
            path.node.test
          );

          instrumentLoop(path, 'while', [], exprStr);
        },

        DoWhileStatement(path: any) {
          if (isInstrumented(path.node)) return;
          const exprStr = extractSourceSlice(sourceCode, path.node.test);
          const testLoc = getLoc(path.node.test || path.node);

          path.node.test = makeDrCall(
            'cond',
            [
              path.node.test,
              t.stringLiteral('do_while'),
              t.numericLiteral(testLoc.line),
              t.numericLiteral(testLoc.col),
              t.booleanLiteral(false),
              exprStr ? t.stringLiteral(exprStr) : t.identifier('undefined'),
            ],
            path.node.test
          );

          instrumentLoop(path, 'do_while', [], exprStr);
        },

        ForOfStatement(path: any) {
          if (isInstrumented(path.node)) return;
          const { line, col } = getLoc(path.node.left || path.node);
          const extraStmts: any[] = [];
          const exprStr = extractSourceSlice(sourceCode, path.node.right);

          const boundNames = t.isVariableDeclaration(path.node.left)
            ? extractPatternIdentifiers(t, path.node.left.declarations[0]?.id)
            : extractPatternIdentifiers(t, path.node.left);

          for (const name of boundNames) {
            extraStmts.push(
              t.expressionStatement(
                makeDrCall('decl', [
                  t.stringLiteral(name),
                  t.identifier(name),
                  t.stringLiteral('for_of'),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ])
              )
            );
          }

          instrumentLoop(path, 'for_of', extraStmts, exprStr ? `of ${exprStr}` : undefined);
        },

        ForInStatement(path: any) {
          if (isInstrumented(path.node)) return;
          const { line, col } = getLoc(path.node.left || path.node);
          const extraStmts: any[] = [];
          const exprStr = extractSourceSlice(sourceCode, path.node.right);

          const boundNames = t.isVariableDeclaration(path.node.left)
            ? extractPatternIdentifiers(t, path.node.left.declarations[0]?.id)
            : extractPatternIdentifiers(t, path.node.left);

          for (const name of boundNames) {
            extraStmts.push(
              t.expressionStatement(
                makeDrCall('decl', [
                  t.stringLiteral(name),
                  t.identifier(name),
                  t.stringLiteral('for_in'),
                  t.numericLiteral(line),
                  t.numericLiteral(col),
                ])
              )
            );
          }

          instrumentLoop(path, 'for_in', extraStmts, exprStr ? `in ${exprStr}` : undefined);
        },

        ThrowStatement(path: any) {
          if (isInstrumented(path.node)) return;
          markInstrumented(path.node);
          const { line, col } = getLoc(path.node);
          path.insertBefore(t.expressionStatement(makeLocMarker(line, col)));
        },
      },
    };
  };
}

// Add `markLoc` helper on JsTraceRuntime prototype so lightweight location markers work seamlessly
if (!(JsTraceRuntime.prototype as any).markLoc) {
  (JsTraceRuntime.prototype as any).markLoc = function (line: number, col: number): void {
    const frames = (this as any).frames;
    if (frames && frames.length > 0) {
      const top = frames[frames.length - 1];
      top.line = line;
      top.col = col;
    }
  };
}

const SHADOWED_EXECUTION_GLOBALS = [
  'window',
  'document',
  'globalThis',
  'self',
  'global',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'caches',
  'importScripts',
  'postMessage',
  'close',
  'onmessage',
  'onerror',
  'onmessageerror',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'navigator',
  'location',
  'crypto',
  'process',
  'require',
];

/**
 * Executes JavaScript/TypeScript inside the current JS thread (intended strictly for
 * dedicated Web Workers or Node.js/Native contexts — never the browser UI main thread).
 */
export function executeJavaScriptInCurrentContext(
  code: string,
  options: JsExecutionCoreOptions = {}
): JsExecutionCoreResult {
  const startTime = performance.now();
  const language: LanguageId = options.language || 'javascript';
  const fileName = language === 'typescript' ? 'solution.ts' : 'solution.js';
  const mapper = new SourceMapper(code);

  if (options.cancellationToken?.isCancelled) {
    return {
      trace: createLifecycleErrorTrace({
        language,
        code,
        status: 'error',
        errorMessage:
          options.cancellationToken.reason || 'Execution cancelled before start.',
        elapsedMs: performance.now() - startTime,
      }),
      transformDurationMs: 0,
      executionDurationMs: 0,
    };
  }

  // 1. Pre-Execution Static Security Verification
  const securityPolicy: SecurityPolicy = {
    ...DEFAULT_SECURITY_POLICY,
    maxSteps: options.maxSteps ?? DEFAULT_SECURITY_POLICY.maxSteps,
    timeoutMs: options.timeoutMs ?? DEFAULT_SECURITY_POLICY.timeoutMs,
    maxHeapObjects: options.maxHeapObjects ?? DEFAULT_SECURITY_POLICY.maxHeapObjects,
    maxOutputChars: options.maxOutputChars ?? DEFAULT_SECURITY_POLICY.maxOutputChars,
  };

  const securityScan = validateCodeSecurity(code, securityPolicy);
  const blockingViolations = securityScan.violations.filter(
    (v) => !v.startsWith('Loop safety warning:')
  );
  if (blockingViolations.length > 0) {
    const errorMsg = `Security sandbox check failed:\n${blockingViolations.join('\n')}`;
    return {
      trace: {
        language,
        sourceCode: code,
        events: [
          {
            stepIndex: 0,
            type: 'error',
            line: 1,
            col: 1,
            codeLine: mapper.getOriginalLine(1),
            description: errorMsg,
            stackFrames: [],
            heap: {},
            stdout: [],
            stderr: blockingViolations,
            diffs: [],
            timestamp: Date.now(),
          },
        ],
        totalSteps: 1,
        status: 'error',
        errorMessage: errorMsg,
        metrics: {
          executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
          stepCount: 1,
          peakMemoryBytes: 0,
          heapAllocations: 0,
        },
      },
      transformDurationMs: 0,
      executionDurationMs: 0,
    };
  }

  // 2. Parse & Instrument via Babel AST
  let instrumentedCode = '';
  const transformStart = performance.now();
  try {
    const transformResult = Babel.transform(code, {
      filename: fileName,
      presets: language === 'typescript' ? ['typescript'] : [],
      plugins: [createDryRunInstrumentationPlugin(code)],
      retainLines: true,
      sourceMaps: false,
      compact: false,
    });

    instrumentedCode = transformResult?.code || '';
  } catch (syntaxErr: any) {
    const rawLine = syntaxErr?.loc?.line ?? 1;
    const rawCol = (syntaxErr?.loc?.column ?? 0) + 1;
    const mapped = mapper.getOriginalLocation(rawLine, rawCol);
    const cleanMessage = syntaxErr?.message
      ? String(syntaxErr.message).split('\n')[0]
      : 'SyntaxError: Failed to parse code';

    return {
      trace: {
        language,
        sourceCode: code,
        events: [
          {
            stepIndex: 0,
            type: 'error',
            line: mapped.line,
            col: mapped.col,
            codeLine: mapped.originalSnippet,
            description: `SyntaxError (line ${mapped.line}, col ${mapped.col}): ${cleanMessage}`,
            stackFrames: [],
            heap: {},
            stdout: [],
            stderr: [cleanMessage],
            diffs: [],
            timestamp: Date.now(),
          },
        ],
        totalSteps: 1,
        status: 'error',
        errorMessage: `SyntaxError (line ${mapped.line}, col ${mapped.col}): ${cleanMessage}`,
        metrics: {
          executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
          stepCount: 1,
          peakMemoryBytes: 0,
          heapAllocations: 0,
        },
      },
      transformDurationMs: Math.max(1, Math.round(performance.now() - transformStart)),
      executionDurationMs: 0,
    };
  }
  const transformDurationMs = Math.max(1, Math.round(performance.now() - transformStart));

  // 3. Execute Instrumented Program inside Isolated Shadow-Scope Sandbox
  const guard = new ExecutionGuard(securityPolicy);
  guard.start();
  const runtime = new JsTraceRuntime(mapper, guard, fileName);

  const batchSize = options.streamBatchSize ?? 25;
  let lastFlushedCount = 0;

  if (options.cancellationToken || (options.onProgressStep && batchSize > 0)) {
    const baseRecordStep = guard.recordStep.bind(guard);
    guard.recordStep = () => {
      if (options.cancellationToken?.isCancelled) {
        throw new ExecutionCancelledError(options.cancellationToken.reason);
      }
      baseRecordStep();
      if (options.onProgressStep && batchSize > 0) {
        const currentEvents = runtime.getEvents();
        if (currentEvents.length - lastFlushedCount >= batchSize) {
          const chunk = currentEvents.slice(lastFlushedCount);
          lastFlushedCount = currentEvents.length;
          options.onProgressStep(currentEvents.length, chunk);
        }
      }
    };
  }

  const safeConsole = Object.freeze({
    __isDryRunConsole: true,
    log: (...args: any[]) => args,
    info: (...args: any[]) => args,
    warn: (...args: any[]) => args,
    error: (...args: any[]) => args,
  });

  const execStart = performance.now();
  try {
    options.cancellationToken?.throwIfCancelled();

    const sandboxRunner = new Function(
      '__dr',
      'console',
      ...SHADOWED_EXECUTION_GLOBALS,
      `"use strict";\n${instrumentedCode}`
    );

    sandboxRunner(
      runtime,
      safeConsole,
      ...SHADOWED_EXECUTION_GLOBALS.map(() => undefined)
    );

    const events = runtime.getEvents();
    const executionDurationMs = Math.max(1, Math.round(performance.now() - execStart));
    return {
      trace: {
        language,
        sourceCode: code,
        events,
        totalSteps: events.length,
        status: 'completed',
        metrics: {
          executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
          stepCount: events.length,
          peakMemoryBytes: events.length * 1024,
          heapAllocations: runtime.getHeapAllocationsCount(),
        },
      },
      transformDurationMs,
      executionDurationMs,
    };
  } catch (runtimeErr: any) {
    const executionDurationMs = Math.max(1, Math.round(performance.now() - execStart));

    if (runtimeErr instanceof ExecutionCancelledError) {
      const partialEvents = runtime.getEvents();
      return {
        trace: createLifecycleErrorTrace({
          language,
          code,
          status: 'error',
          errorMessage: runtimeErr.message,
          elapsedMs: performance.now() - startTime,
          partialEvents,
        }),
        transformDurationMs,
        executionDurationMs,
      };
    }

    const errMsg = runtimeErr instanceof Error ? runtimeErr.message : String(runtimeErr);

    if (errMsg.startsWith('Execution halted:')) {
      const isTimeout = errMsg.includes('CPU time budget');
      const events = runtime.getEvents();
      return {
        trace: {
          language,
          sourceCode: code,
          events,
          totalSteps: events.length,
          status: isTimeout ? 'timeout' : 'max_steps_exceeded',
          errorMessage: errMsg,
          metrics: {
            executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
            stepCount: events.length,
            peakMemoryBytes: events.length * 1024,
            heapAllocations: runtime.getHeapAllocationsCount(),
          },
        },
        transformDurationMs,
        executionDurationMs,
      };
    }

    runtime.recordRuntimeError(runtimeErr);
    const events = runtime.getEvents();
    const fullErrorName =
      runtimeErr instanceof Error
        ? `${runtimeErr.name}: ${runtimeErr.message}`
        : String(runtimeErr);

    return {
      trace: {
        language,
        sourceCode: code,
        events,
        totalSteps: events.length,
        status: 'error',
        errorMessage: fullErrorName,
        metrics: {
          executionTimeMs: Math.max(1, Math.round(performance.now() - startTime)),
          stepCount: events.length,
          peakMemoryBytes: events.length * 1024,
          heapAllocations: runtime.getHeapAllocationsCount(),
        },
      },
      transformDurationMs,
      executionDurationMs,
    };
  }
}
