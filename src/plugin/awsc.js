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
    const code = generator(path.node).code
    if (code === 'void 0') {
      path.replaceWith(t.identifier('undefined'))
    } else {
      path.replaceWith(path.node.argument)
    }
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

function LintFunction(path) {
  let { id, params, body } = path.node
  if (id || params.length) {
    return
  }
  if (
    path.getFunctionParent() &&
    path.parentPath.isCallExpression() &&
    path.parentPath.parentPath.isUnaryExpression({ operator: '!' })
  ) {
    path.parentPath.parentPath.parentPath.replaceWith(body)
  }
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
  if (!upper.node || !t.isBlockStatement(upper.parent)) {
    return
  }
  // console.log(`move: ${generator(path.node).code}`)
  upper.insertBefore(t.expressionStatement(property))
  path.replaceWith(t.memberExpression(object, property.left, computed))
}

function RenameIdentifier(ast) {
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
  console.info(`Count: ${name_count - 1000}`)
}

let info_choice = {}
let info_key = {}

function CollectVars(ast) {
  // Collect vars
  const visitor_checker = {
    Identifier(path) {
      info_choice[this.name].parent = path.node.name
      path.stop()
    },
  }
  traverse(ast, {
    VariableDeclarator(path) {
      let { id, init } = path.node
      if (
        !t.isBinaryExpression(init, { operator: '&' }) ||
        !t.isNumericLiteral(init.left)
      ) {
        return
      }
      const name = id.name
      const binding = path.scope.getBinding(name)
      if (!binding || !binding.constant) {
        return
      }
      let upper1 = path.findParent((path) => path.isVariableDeclaration())
      if (!upper1.node) {
        return
      }
      let upper2 = path.findParent((path) => path.isForStatement())
      if (!upper2.node) {
        return
      }
      if (upper2.node.body.body.length !== 2) {
        console.warn('Unexpected block length of for statement!')
      }
      let pname = upper2.node.init?.declarations[0]?.id?.name
      info_choice[name] = {
        range: init.left.value + 1,
        root: pname,
      }
      if (!(pname in info_key)) {
        const start = upper2.node.init.declarations[0].init.value
        info_key[pname] = {
          start: start,
          code: generator(upper1.node).code,
          child: { pname: pname },
          value: {},
          visit: 0,
        }
      }
      info_key[pname].child[name] = name
      path.get('init').traverse(visitor_checker, { name: name })
    },
  })
  for (const p in info_choice) {
    console.info(`Var: ${p} Root: ${info_choice[p].root}`)
  }
}

function UpdateRef(ast) {
  const visitor_value = {
    AssignmentExpression(path) {
      if (path.node.left?.name === this.name) {
        const value = path.node.right.value
        if (value === undefined) {
          return
        }
        if (!(value in info_key[this.name].value)) {
          info_key[this.name].value[value] = 0
        }
        ++info_key[this.name].value[value]
      }
    },
  }
  traverse(ast, {
    VariableDeclarator(path) {
      let { id, init } = path.node
      if (id.name in info_key) {
        let upper2 = path.findParent((path) => path.isForStatement())
        info_key[id.name].value = {}
        info_key[id.name].value[init.value] = 1
        upper2.get('body.body.1').traverse(visitor_value, { name: id.name })
      }
    },
  })
  for (const p in info_key) {
    console.info(`Key: ${p} Size: ${Object.keys(info_key[p].value).length}`)
  }
}

function FlattenIf(ast) {
  // Transform if-else to switch
  let name
  let code
  let last
  function dfs(node, candidate) {
    const test = generator(node.test).code
    // console.log(test)
    let left = []
    let right = []
    for (const c of candidate) {
      if (eval(`let ${name}=${c}; ${test}`)) {
        left.push(c)
      } else {
        right.push(c)
      }
    }
    const hasNext = (node) => {
      if (!t.isIfStatement(node.body[0])) {
        return false
      }
      return node.body[0].test.left?.name === name
    }
    if (hasNext(node.consequent)) {
      dfs(node.consequent.body[0], left)
    } else if (left.length == 1) {
      code[left[0]] = node.consequent.body
    } else {
      if (last) {
        console.error('Multiple default choice!')
        throw new Error()
      }
      last = node.consequent.body
    }
    if (!node.alternate) {
      return
    }
    if (hasNext(node.alternate)) {
      dfs(node.alternate.body[0], right)
    } else if (right.length == 1) {
      code[right[0]] = node.alternate.body
    } else {
      if (last) {
        console.error('Multiple default choice!')
      }
      last = node.alternate.body
    }
  }
  traverse(ast, {
    IfStatement(path) {
      let path_test = path.get('test')
      if (!path_test.isBinaryExpression()) {
        return
      }
      name = path_test.node.left?.name
      if (!(name in info_choice)) {
        return
      }
      code = Array(info_choice[name].range)
      let candidate = Array.from(code.keys())
      last = null
      dfs(path.node, candidate)
      let cases = []
      for (let i = 0; i < code.length; ++i) {
        if (!code[i]) {
          break
        }
        code[i].push(t.breakStatement())
        cases.push(
          t.switchCase(t.numericLiteral(i), [t.blockStatement(code[i])])
        )
      }
      if (last) {
        last.push(t.breakStatement())
        cases.push(t.switchCase(null, [t.blockStatement(last)]))
      }
      const repl = t.switchStatement(t.identifier(name), cases)
      path.replaceWith(repl)
    },
  })
}

function FlattenSwitch(ast) {
  // Flatten switch
  function dfs2(path, candidate, key, cases) {
    let mp = {}
    for (const c of candidate) {
      let code = `var ${key}=${c};${info_key[key].code}`
      let test = generator(path.node.discriminant).code
      let value = eval(code + test)
      if (!(value in mp)) {
        mp[value] = []
      }
      mp[value].push(c)
    }
    for (let i in path.node.cases) {
      const choice = path.get(`cases.${i}`)
      let body, c
      if (!choice.node.test) {
        const keys = Object.keys(mp)
        if (keys.length != 1) {
          throw new Error('Key - Case miss match!')
        }
        c = keys[0]
      } else {
        c = choice.node.test.value
      }
      body = choice.node.consequent[0].body
      if (!(c in mp)) {
        console.warn(`Drop in key: ${key}`)
        continue
      }
      if (mp[c].length > 1) {
        if (body.length > 2) {
          console.error('Not empty before switch case')
        }
        dfs2(choice.get('consequent.0.body.0'), mp[c], key, cases)
      } else {
        const value = Number.parseInt(mp[c][0])
        if (body.length >= 2 && t.isIfStatement(body.at(-2))) {
          let line = body.at(-2)
          line.consequent.body.push(t.breakStatement())
          line.alternate.body.push(t.breakStatement())
          body.pop()
        }
        cases[value] = body
      }
      delete mp[c]
    }
  }
  // Merge switch
  let updated
  function dfs3(cases, vis, body, update, key, value) {
    if (update && value in vis) {
      return
    }
    vis[value] = 1
    let valid = true
    let last = -1
    while (valid) {
      if (t.isReturnStatement(body.at(-1))) {
        break
      }
      if (t.isIfStatement(body.at(-1))) {
        valid = false
        const choices = [body.at(-1).consequent, body.at(-1).alternate]
        const ret = []
        for (let c of choices) {
          ret.push(dfs3(cases, vis, c.body, false, key, value))
        }
        if (ret[0] == ret[1] && ~ret[0]) {
          let mv = choices[0].body.splice(choices[0].body.length - 2, 2)
          choices[1].body.splice(choices[1].body.length - 2, 2)
          body.push(...mv)
          --info_key[key].value[ret[0]]
          valid = true
          updated = true
          continue
        }
        if (value === ret[0]) {
          const arg = choices[0].body.at(-3)?.expression?.argument?.name
          const test = body.at(-1).test
          if (arg && ~generator(test).code.indexOf(arg)) {
            const body1 = choices[0].body.slice(0, -2)
            const repl = t.whileStatement(test, t.blockStatement(body1))
            body.pop()
            body.push(repl)
            if (choices[1].body) {
              body.push(...choices[1].body)
            }
            --info_key[key].value[ret[0]]
            console.info(`merge inner while-loop: ${key}:${ret[0]}`)
            valid = true
            updated = true
            continue
          }
        }
      } else {
        let next = body.at(-2).expression.right.value
        if (next === undefined) {
          break
        }
        if (info_key[key].value[next] > 1) {
          dfs3(cases, vis, cases[next], true, key, next)
          last = next
          break
        }
        body.splice(body.length - 2, 2)
        body.push(...cases[next])
        delete cases[next]
        updated = true
        // console.log(`merge ${key}:${next}->${value}`)
      }
    }
    if (update) {
      cases[value] = body
    }
    return last
  }
  traverse(ast, {
    ForStatement(path) {
      let key = path.node.init?.declarations[0]?.id?.name
      if (!(key in info_key) || info_key[key].visit) {
        return
      }
      let cases = {}
      let candidate = Object.keys(info_key[key].value)
      dfs2(path.get('body.body.1'), candidate, key, cases)
      let start = info_key[key].start
      updated = true
      while (updated) {
        updated = false
        dfs3(cases, {}, cases[start], true, key, start)
      }
      let body = []
      for (let value in cases) {
        body.push(
          t.switchCase(t.numericLiteral(Number.parseInt(value)), [
            t.blockStatement(cases[value]),
          ])
        )
      }
      const repl = t.switchStatement(t.identifier(key), body)
      path.get('body.body.1').replaceWith(repl)
      info_key[key].visit = 1
    },
  })
}

export default function (code) {
  let ast = parse(code)
  // Generate unique name for all identifiers
  RenameIdentifier(ast)
  // Pre Lint
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
    FunctionExpression: LintFunction,
  })
  traverse(ast, {
    BlockStatement: { exit: LintBlock },
  })
  // Extract methods
  CollectVars(ast)
  FlattenIf(ast)
  UpdateRef(ast)
  FlattenSwitch(ast)
  // Post Lint
  traverse(ast, {
    MemberExpression: LintMemberProperty,
  })
  // Generate code
  code = generator(ast, {
    comments: false,
    jsescOption: { minimal: true },
  }).code
  return code
}
