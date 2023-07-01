/**
 * Reference：
 * * [某宝登录bx-ua参数逆向思路(fireyejs 225算法)](https://zhuanlan.zhihu.com/p/626187669)
 */
import { parse } from '@babel/parser'
import _generate from '@babel/generator'
import _traverse from '@babel/traverse'
import * as t from '@babel/types'

const generator = _generate.default
const traverse = _traverse.default

function RemoveVoid(path) {
  if (path.node.operator === 'void') {
    path.replaceWith(path.node.argument)
  }
}

function LintConditionalAssign(path) {
  if (!t.isAssignmentExpression(path?.parent)) {
    return
  }
  let { test, consequent, alternate } = path.node
  let { operator, left } = path.parent
  consequent = t.assignmentExpression(operator, left, consequent)
  alternate = t.assignmentExpression(operator, left, alternate)
  path.parentPath.replaceWith(
    t.conditionalExpression(test, consequent, alternate)
  )
}

function LintConditionalIf(ast) {
  function conditional(path) {
    let { test, consequent, alternate } = path.node
    // console.log(generator(test, { minified: true }).code)
    if (t.isSequenceExpression(path.parent)) {
      if (!sequence(path.parentPath)) {
        path.stop()
      }
      return
    }
    if (t.isLogicalExpression(path.parent)) {
      if (!logical(path.parentPath)) {
        path.stop()
      }
      return
    }
    if (!t.isExpressionStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      path.stop()
      return
    }
    consequent = t.expressionStatement(consequent)
    alternate = t.expressionStatement(alternate)
    let statement = t.ifStatement(test, consequent, alternate)
    path.replaceWithMultiple(statement)
  }

  function sequence(path) {
    if (t.isLogicalExpression(path.parent)) {
      return logical(path.parentPath)
    }
    let body = []
    for (const item of path.node.expressions) {
      body.push(t.expressionStatement(item))
    }
    let node = t.blockStatement(body, [])
    let replace_path = path
    if (t.isExpressionStatement(path.parent)) {
      replace_path = path.parentPath
    } else if (!t.isBlockStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      return false
    }
    replace_path.replaceWith(node)
    return true
  }

  function logical(path) {
    let { operator, left, right } = path.node
    if (operator !== '&&') {
      console.error(`Unexpected logical operator: ${operator}`)
      return false
    }
    if (!t.isExpressionStatement(path.parent)) {
      console.error(`Unexpected parent type: ${path.parent.type}`)
      return false
    }
    let node = t.ifStatement(left, t.expressionStatement(right))
    path.parentPath.replaceWith(node)
    return true
  }

  traverse(ast, {
    ConditionalExpression: { enter: conditional },
  })
}

function LintLogicalIf(path) {
  let { operator, left, right } = path.node
  if (operator !== '&&') {
    // console.warn(`Unexpected logical operator: ${operator}`)
    return
  }
  if (!t.isExpressionStatement(path.parent)) {
    console.warn(`Unexpected parent type: ${path.parent.type}`)
    return
  }
  let node = t.ifStatement(left, t.expressionStatement(right))
  path.parentPath.replaceWith(node)
  return
}

function LintIfStatement(path) {
  let { test, consequent, alternate } = path.node
  let changed = false
  if (!t.isBlockStatement(consequent)) {
    consequent = t.blockStatement([consequent])
    changed = true
  }
  if (alternate && !t.isBlockStatement(alternate)) {
    alternate = t.blockStatement([alternate])
    changed = true
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.ifStatement(test, consequent, alternate))
}

function LintIfTestSequence(path) {
  let { test, consequent, alternate } = path.node
  if (!t.isSequenceExpression(test)) {
    return
  }
  if (!t.isBlockStatement(path.parent)) {
    return
  }
  let body = test.expressions
  let last = body.pop()
  let before = t.expressionStatement(t.sequenceExpression(body))
  path.insertBefore(before)
  path.replaceWith(t.ifStatement(last, consequent, alternate))
}

function LintIfTestBinary(path) {
  let path_test = path.get('test')
  if (!path_test.isBinaryExpression({ operator: '==' })) {
    return
  }
  let { left, right } = path_test.node
  if (t.isNumericLiteral(left) && t.isIdentifier(right)) {
    path_test.replaceWith(t.binaryExpression('==', right, left))
  }
}

function LintSwitchCase(path) {
  let { test, consequent } = path.node
  if (consequent.length == 1 && t.isBlockStatement(consequent[0])) {
    return
  }
  let block = t.blockStatement(consequent)
  path.replaceWith(t.switchCase(test, [block]))
}

function LintReturn(path) {
  let { argument } = path.node
  if (!t.isSequenceExpression(argument)) {
    return
  }
  if (!t.isBlockStatement(path.parent)) {
    return
  }
  let body = argument.expressions
  let last = body.pop()
  let before = t.expressionStatement(t.sequenceExpression(body))
  path.insertBefore(before)
  path.replaceWith(t.returnStatement(last))
}

function LintSequence(path) {
  let body = []
  for (const item of path.node.expressions) {
    body.push(t.expressionStatement(item))
  }
  let node = t.blockStatement(body, [])
  let replace_path = path
  if (t.isExpressionStatement(path.parent)) {
    replace_path = path.parentPath
  } else if (!t.isBlockStatement(path.parent)) {
    console.warn(`Unexpected parent type: ${path.parent.type}`)
    return
  }
  replace_path.replaceWith(node)
  return
}

function LintBlock(path) {
  let { body } = path.node
  if (!body.length) {
    return
  }
  let changed = false
  let arr = []
  for (const item of body) {
    if (!t.isBlockStatement(item)) {
      arr.push(item)
      continue
    }
    changed = true
    for (const sub of item.body) {
      arr.push(sub)
    }
  }
  if (!changed) {
    return
  }
  path.replaceWith(t.blockStatement(arr))
}

function LintMemberProperty(path) {
  let { object, property, computed } = path.node
  if (
    !t.isAssignmentExpression(property, { operator: '+=' }) ||
    !t.isIdentifier(property.left)
  ) {
    return
  }
  let upper = path.findParent((path) => path.isExpressionStatement())
  if (!upper || !t.isBlockStatement(upper.parent)) {
    return
  }
  // console.log(`move: ${generator(path.node).code}`)
  upper.insertBefore(t.expressionStatement(property))
  path.replaceWith(t.memberExpression(object, property.left, computed))
}

function DecodeRename(ast) {
  let name_count = 1000
  traverse(ast, {
    FunctionDeclaration(path) {
      if (!path.node?.id?.name) {
        return
      }
      let s = path.scope.generateUidIdentifier(`_u${name_count++}f`)
      path.scope.rename(path.node.id.name, s.name)
      for (let it of path.node.params) {
        s = path.scope.generateUidIdentifier(`_u${name_count++}p`)
        path.scope.rename(it.name, s.name)
      }
    },
    VariableDeclarator(path) {
      const s = path.scope.generateUidIdentifier(`_u${name_count++}v`)
      path.scope.rename(path.node.id.name, s.name)
    },
  })
  console.info(`Count: ${name_count}`)
}

export default function (code) {
  let ast = parse(code)
  // Lint
  traverse(ast, {
    UnaryExpression: RemoveVoid,
  })
  traverse(ast, {
    ConditionalExpression: { exit: LintConditionalAssign },
  })
  LintConditionalIf(ast)
  traverse(ast, {
    LogicalExpression: { exit: LintLogicalIf },
  })
  traverse(ast, {
    IfStatement: { exit: LintIfStatement },
  })
  traverse(ast, {
    IfStatement: { enter: LintIfTestSequence },
  })
  traverse(ast, {
    IfStatement: { exit: LintIfTestBinary },
  })
  traverse(ast, {
    SwitchCase: { enter: LintSwitchCase },
  })
  traverse(ast, {
    ReturnStatement: { enter: LintReturn },
  })
  traverse(ast, {
    SequenceExpression: { exit: LintSequence },
  })
  traverse(ast, {
    BlockStatement: { exit: LintBlock },
  })
  traverse(ast, {
    MemberExpression: LintMemberProperty,
  })
  // Extract methods
  DecodeRename(ast)

  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
