function oneObject(str) {
  const obj = {}
  str.split(',').forEach(_ => { obj[_] = true })
  return obj
}
const voidTag = oneObject('area,base,basefont,br,col,frame,hr,img,input,link,meta,param,embed,command,keygen,source,track,wbr')
const specalTag = oneObject('xmp,style,script,noscript,textarea,template,#comment')
const hiddenTag = oneObject('style,script,noscript,template')

function JSXParser (a, f) {
  if (!(this instanceof JSXParser)) {
    return parse(a, f)
  }
  this.input = a
  this.getOne = f
}

JSXParser.prototype = {
  parse() {
    return parse(this.input, this.getOne)
  },
}

const rsp = /\s/

/**
 * @param {any} string
 * @param {any} getOne 只返回一个节点
 * @returns
 */
function parse(string, getOne) {
  const ret = lexer(string, getOne)
  if (getOne) {
    return typeof ret[0] === 'string' ? ret[1] : ret[0]
  }
  return ret
}

function lexer(sourceString, getOne) {
  let string = sourceString
  let breakIndex = 120
  const stack = []
  const origString = string
  const origLength = string.length
  const ret = []

  stack.last = () => stack[stack.length - 1]

  function addNode(node) {
      const p = stack.last()
      if (p && p.children) {
          p.children.push(node)
      } else {
          ret.push(node)
      }
  }

  let lastNode
  do {
      breakIndex -= 1
      if (breakIndex <= 0) {
        break
      }
      const arr = getCloseTag(string)

      if (arr) { // 处理关闭标签
          string = string.replace(arr[0], '')
          const node = stack.pop()
          // 处理下面两种特殊情况：
          // 1. option会自动移除元素节点，将它们的nodeValue组成新的文本节点
          // 2. table会将没有被thead, tbody, tfoot包起来的tr或文本节点，收集到一个新的tbody元素中
          if (node.type === 'option') {
              node.children = [{
                  type: '#text',
                  nodeValue: getText(node),
              }]
          } else if (node.type === 'table') {
              insertTbody(node.children)
          }
          lastNode = null
          if (getOne && ret.length === 1 && !stack.length) {
            return [origString.slice(0, origLength - string.length), ret[0]]
          }
          // eslint-disable-next-line no-continue
          continue
      }

      const openArr = getOpenTag(string)
      if (openArr) {
          string = string.replace(openArr[0], '')
          const node = openArr[1]
          addNode(node)
          const selfClose = !!(node.isVoidTag || specalTag[node.type])
          if (!selfClose) { // 放到这里可以添加孩子
              stack.push(node)
          }
          if (getOne && selfClose && !stack.length) {
              return [origString.slice(0, origLength - string.length), node]
          }
          lastNode = node
          // eslint-disable-next-line no-continue
          continue
      }

      let text = ''
      do {
          // 处理<div><<<<<<div>的情况
          const index = string.indexOf('<')
          if (index === 0) {
              text += string.slice(0, 1)
              string = string.slice(1)
          } else {
              break
          }
      } while (string.length);
      // 处理<div>{aaa}</div>,<div>xxx{aaa}xxx</div>,<div>xxx</div>{aaa}sss的情况
      const index = string.indexOf('<') // 判定它后面是否存在标签
      const bindex = string.indexOf('{') // 判定它后面是否存在jsx
      const aindex = string.indexOf('}')

      const hasJSX = (bindex < aindex) && (index === -1 || bindex < index)
      if (hasJSX) {
          if (bindex !== 0) { // 收集jsx之前的文本节点
              text += string.slice(0, bindex)
              string = string.slice(bindex)
          }
          addText(lastNode, text, addNode)
          string = string.slice(1) // 去掉前面{
          const codeArr = parseCode(string)
          addNode(makeJSX(codeArr[1]))
          lastNode = false
          string = string.slice(codeArr[0].length + 1) // 去掉后面的}
      } else {
          if (index === -1) {
              text = string
              string = ''
          } else {
              text += string.slice(0, index)
              string = string.slice(index)
          }
          addText(lastNode, text, addNode)
      }
  } while (string.length);
  return ret
}


function addText(lastNode, text, addNode) {
  let resultNode = lastNode
  if (/\S/.test(text)) {
      if (resultNode && resultNode.type === '#text') {
          resultNode.text += text
      } else {
          resultNode = {
              type: '#text',
              nodeValue: text,
          }
          addNode(resultNode)
      }
  }
}

// 它用于解析{}中的内容，如果遇到不匹配的}则返回, 根据标签切割里面的内容
function parseCode(string) { // <div id={ function(){<div/>} }>
  // 用于匹配前面的单词
  let word = ''
  let braceIndex = 1
  let codeIndex = 0
  const nodes = []
  let quote = null
  let escape = false
  let state = 'code'
  for (let i = 0, n = string.length; i < n; i += 1) {
    let c = string.charAt(i)
    const next = string.charAt(i + 1)
    switch (state) {
      case 'code':
        if (c === '"' || c === "'") {
            state = 'string'
            quote = c
        } else if (c === '{') {
            braceIndex += 1
        } else if (c === '}') {
          braceIndex -= 1
          if (braceIndex === 0) {
            collectJSX(string, codeIndex, i, nodes)
            return [string.slice(0, i), nodes]
          }
        } else if (c === '<') {
          word = '';
          let empty = true;
          let index = i - 1
          do {
            c = string.charAt(index)
            index -= 1
            if (empty && rsp.test(c)) {
              // eslint-disable-next-line no-continue
              continue
            }
            if (rsp.test(c)) {
              break
            }
            empty = false
            word = c + word
            if (word.length > 7) { // 性能优化
              break
            }
          } while (index >= 0);
          const chunkString = string.slice(i)
          if ((word === '' || /(=>|return|\{|\(|\[|,)$/.test(word)) && /<\w/.test(chunkString)) {
            collectJSX(string, codeIndex, i, nodes)
            const chunk = lexer(chunkString, true)
            nodes.push(chunk[1])
            i += (chunk[0].length - 1) // 因为已经包含了<, 需要减1
            codeIndex = i + 1
          }
        }
        break
      case 'string':
        if (c === '\\' && (next === '"' || next === "'")) {
          escape = !escape
        } else if (c === quote && !escape) {
          state = 'code'
        }
        break
      default:
        break
    }
  }
  return []
}

function collectJSX(string, codeIndex, i, nodes) {
  const nodeValue = string.slice(codeIndex, i)
  if (/\S/.test(nodeValue)) { // 将{前面的东西放进去
    nodes.push({
      type: '#jsx',
      nodeValue,
    })
  }
}

const rtbody = /^(tbody|thead|tfoot)$/

function insertTbody(nodes) {
  let tbody = false
  for (let i = 0, n = nodes.length; i < n; i += 1) {
      const node = nodes[i]
      if (rtbody.test(node.nodeName)) {
        tbody = false
        // eslint-disable-next-line no-continue
        continue
      }

      if (node.nodeName === 'tr') {
        if (tbody) {
          nodes.splice(i, 1)
          tbody.children.push(node)
          n -= 1
          i -= 1
        } else {
          tbody = {
            nodeName: 'tbody',
            props: {},
            children: [node],
          }
          nodes.splice(i, 1, tbody)
        }
      } else if (tbody) {
        nodes.splice(i, 1)
        tbody.children.push(node)
        n -= 1
        i -= 1
      }
  }
}


function getCloseTag(sourceString) {
  let string = sourceString
  if (string.indexOf('</') === 0) {
      const match = string.match(/<\/(\w+)>/)
      if (match) {
        const tag = match[1]
        string = string.slice(3 + tag.length)
        return [match[0], {
            type: tag,
        }]
      }
  }
  return null
}

function getOpenTag(sourceString) {
  let string = sourceString
  if (string.indexOf('<') === 0) {
      const i = string.indexOf('<!--') // 处理注释节点
      if (i === 0) {
          const l = string.indexOf('-->')
          if (l === -1) {
            throw (new Error(`注释节点没有闭合 ${string.slice(0, 100)}`))
          }
          const node = {
            type: '#comment',
            nodeValue: string.slice(4, l),
          }
          return [string.slice(0, l + 3), node]
      }
      const match = string.match(/<(\w[^\s/>]*)/) // 处理元素节点
      if (match) {
          let leftContent = match[0]
          const tag = match[1]
          const node = {
              type: tag,
              props: {},
              children: [],
          }

          string = string.replace(leftContent, '') // 去掉标签名(rightContent)
          const arr = getAttrs(string) // 处理属性
          if (arr) {
              // eslint-disable-next-line prefer-destructuring
              node.props = arr[1]
              string = string.replace(arr[0], '')
              leftContent += arr[0]
          }

          if (string[0] === '>') { // 处理开标签的边界符
              leftContent += '>'
              string = string.slice(1)
              if (voidTag[node.type]) {
                  node.isVoidTag = true
              }
          } else if (string.slice(0, 2) === '/>') { // 处理开标签的边界符
              leftContent += '/>'
              string = string.slice(2)
              node.isVoidTag = true
          }

          if (!node.isVoidTag && specalTag[tag]) { // 如果是script, style, xmp等元素
              const closeTag = `</${tag}>`
              const j = string.indexOf(closeTag)
              const nodeValue = string.slice(0, j)
              leftContent += nodeValue + closeTag
              node.children.push({
                type: '#text',
                nodeValue,
              })
          }
          return [leftContent, node]
      }
  }
  return null
}

function getText(node) {
  let ret = ''
  node.children.forEach(el => {
    if (el.type === '#text') {
      ret += el.nodeValue
    } else if (el.children && !hiddenTag[el.type]) {
      ret += getText(el)
    }
  })
  return ret
}

function getAttrs(string) {
  let state = 'AttrNameOrJSX'
  let attrName = ''
  let attrValue = ''
  let quote
  let escape
  const props = {}

  for (let i = 0, n = string.length; i < n; i += 1) {
      const c = string[i]
      const arr = parseCode(string.slice(i))
      switch (state) {
          case 'AttrNameOrJSX':
              if (c === '/' || c === '>') {
                  return [string.slice(0, i), props]
              }
              if (rsp.test(c)) {
                  if (attrName) {
                    state = 'AttrEqual'
                  }
              } else if (c === '=') {
                  if (!attrName) {
                      throw new Error('必须指定属性名')
                  }
                  state = 'AttrQuoteOrJSX'
              } else if (c === '{') {
                  state = 'SpreadJSX'
              } else {
                  attrName += c
              }
              break
          case 'AttrEqual':
              if (c === '=') {
                  state = 'AttrQuoteOrJSX'
              }
              break
          case 'AttrQuoteOrJSX':
              if (c === '"' || c === "'") {
                  quote = c
                  state = 'AttrValue'
                  escape = false
              } else if (c === '{') {
                  state = 'JSX'
              }
              break
          case 'AttrValue':
              if (c === '\\') {
                  escape = !escape
              }
              if (c !== quote) {
                  attrValue += c
              } else if (c === quote && !escape) {
                  props[attrName] = attrValue
                  attrName = ''
                  attrValue = ''
                  state = 'AttrNameOrJSX'
              }
              break
          case 'SpreadJSX':
              i += 3
              break
          case 'JSX':
              i += arr[0].length
              props[state === 'SpreadJSX' ? 'spreadAttribute' : attrName] = makeJSX(arr[1])
              attrName = ''
              attrValue = ''
              state = 'AttrNameOrJSX'
              break
          default:
            break
      }
  }
  throw new Error('必须关闭标签')
}

function makeJSX(JSXNode) {
  return JSXNode.length === 1 && JSXNode[0].type === '#jsx' ? JSXNode[0] : { type: '#jsx', nodeValue: JSXNode }
}

export default JSXParser
